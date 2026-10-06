#include "PreviewSynth.h"

#include <cmath>
#include <limits>

namespace
{
    constexpr double twoPi = juce::MathConstants<double>::twoPi;

    // 1サンプルごとに掛けると seconds 秒で 0.001 倍（-60dB）になる係数
    float decayPerSample (double seconds, double sampleRate)
    {
        return (float) std::pow (0.001, 1.0 / juce::jmax (1.0, seconds * sampleRate));
    }

    double noteToFrequency (int note)
    {
        return 440.0 * std::pow (2.0, (note - 69) / 12.0);
    }

    // 低い音ほど長く鳴る（note==ref で base 秒）
    double pitchDecaySeconds (int note, double base, int ref, double lo, double hi)
    {
        return juce::jlimit (lo, hi, base * std::pow (2.0, -(note - ref) / 24.0));
    }

    // 帯域制限したノコギリ波（PolyBLEP）
    float polyBlepSaw (double t, double dt)
    {
        auto v = 2.0 * t - 1.0;
        if (t < dt)            { const auto x = t / dt;         v -= x + x - x * x - 1.0; }
        else if (t > 1.0 - dt) { const auto x = (t - 1.0) / dt; v -= x * x + x + x + 1.0; }
        return (float) v;
    }

    void advance (double& phase, double inc)
    {
        phase += inc;
        if (phase >= 1.0) phase -= 1.0;
    }
}

void PreviewSynth::prepare (double newSampleRate)
{
    sampleRate = newSampleRate > 0 ? newSampleRate : 44100.0;

    // ギターの遅延線（最低 25Hz まで）はここで確保し、オーディオスレッドでは確保しない
    const auto delaySize = (size_t) (sampleRate / 25.0) + 4;

    for (auto& v : voices)
    {
        v.active = false;
        v.delay.assign (delaySize, 0.0f);
    }
}

bool PreviewSynth::queue (const std::vector<int>& notes, double delaySeconds, double durationSeconds,
                          Timbre timbre, bool stopOthers)
{
    if (notes.empty() || durationSeconds <= attackSeconds)
        return false;

    const auto scope = fifo.write (1);
    if (scope.blockSize1 + scope.blockSize2 == 0)
        return false;

    auto& r = requests[(size_t) (scope.blockSize1 > 0 ? scope.startIndex1 : scope.startIndex2)];
    r.numNotes = juce::jmin ((int) notes.size(), maxNotesPerChord);
    for (int i = 0; i < r.numNotes; ++i)
        r.notes[(size_t) i] = juce::jlimit (0, 127, notes[(size_t) i]);
    r.delaySeconds    = juce::jmax (0.0, delaySeconds);
    r.durationSeconds = durationSeconds;
    r.timbre          = timbre;
    r.stopOthers      = stopOthers;
    r.groupStart      = true;
    r.append          = false;
    r.session         = -1;
    r.tag             = -1;
    return true;
}

bool PreviewSynth::queueProgression (const std::vector<ChordEvent>& chords, Timbre timbre, int session, bool append)
{
    if (chords.empty() || fifo.getFreeSpace() < (int) chords.size())
        return false;

    for (size_t i = 0; i < chords.size(); ++i)
    {
        const auto& c = chords[i];
        const auto scope = fifo.write (1);
        auto& r = requests[(size_t) (scope.blockSize1 > 0 ? scope.startIndex1 : scope.startIndex2)];
        r.numNotes = juce::jmin ((int) c.notes.size(), maxNotesPerChord);
        for (int n = 0; n < r.numNotes; ++n)
            r.notes[(size_t) n] = juce::jlimit (0, 127, c.notes[(size_t) n]);
        r.delaySeconds    = juce::jmax (0.0, c.startSeconds);
        r.durationSeconds = juce::jmax (attackSeconds * 2, c.durationSeconds);
        r.timbre          = timbre;
        r.groupStart      = i == 0;
        r.append          = append;
        r.stopOthers      = i == 0 && ! append;
        r.session         = session;
        r.tag             = (int) i;
    }
    return true;
}

PreviewSynth::Position PreviewSynth::getPosition() const
{
    return { positionSession.load(), positionIndex.load(), positionPlaying.load() };
}

bool PreviewSynth::stopAll()
{
    const auto scope = fifo.write (1);
    if (scope.blockSize1 + scope.blockSize2 == 0)
        return false;

    auto& r = requests[(size_t) (scope.blockSize1 > 0 ? scope.startIndex1 : scope.startIndex2)];
    r.numNotes   = 0;
    r.stopOthers = true;
    r.groupStart = true;
    r.append     = false;
    r.session    = -1;
    r.tag        = -1;
    return true;
}

PreviewSynth::Voice& PreviewSynth::findFreeVoice()
{
    // 空きボイスが無ければ一番古いボイスを使う
    auto* target = &voices[0];
    for (auto& v : voices)
    {
        if (! v.active) return v;
        if (v.age > target->age) target = &v;
    }
    return *target;
}

void PreviewSynth::handleRequest (const Request& r)
{
    if (r.groupStart)
        groupBase = r.append ? juce::jmax (progressionEnd, clock) : clock;

    if (r.stopOthers)
    {
        const auto fade = (juce::int64) (fadeSeconds * sampleRate);

        for (auto& v : voices)
        {
            if (! v.active) continue;
            if (v.startIn > 0)       v.active = false;        // まだ鳴っていない音（ギターのストローク）は取り消し
            else if (v.fadeLeft < 0) v.fadeLeft = fade;
        }

        numScheduled   = 0;                                   // 予約も取り消し
        progressionEnd = clock;
        lastIndex      = -1;
    }

    if (r.numNotes == 0 || numScheduled >= maxScheduled)
        return;

    const auto at = groupBase + (juce::int64) (r.delaySeconds * sampleRate);
    if (r.tag >= 0)
        progressionEnd = juce::jmax (progressionEnd, at + (juce::int64) (r.durationSeconds * sampleRate));

    scheduled[(size_t) numScheduled++] = { r, at };
}

// 時刻 now までに鳴り始める予約のボイスを割り当てる
void PreviewSynth::startDue (juce::int64 now)
{
    for (int i = 0; i < numScheduled;)
    {
        if (scheduled[(size_t) i].at > now) { ++i; continue; }

        const auto& r = scheduled[(size_t) i].request;
        const auto length = (juce::int64) (r.durationSeconds * sampleRate);

        for (int n = 0; n < r.numNotes; ++n)
        {
            // ギターは低い弦から順に少しずらして鳴らす（ストローク）
            const auto strum = r.timbre == Timbre::guitar ? (juce::int64) (n * strumSeconds * sampleRate) : 0;
            startVoice (findFreeVoice(), r.notes[(size_t) n], strum, juce::jmax<juce::int64> (1, length - strum), r.timbre);
        }

        if (r.tag >= 0) { lastSession = r.session; lastIndex = r.tag; }

        scheduled[(size_t) i] = scheduled[(size_t) --numScheduled];   // 順番は気にしない
    }
}

void PreviewSynth::startNote (int note, float velocity, juce::int64 startIn, juce::int64 length, Timbre timbre, int owner, int part)
{
    auto& v = findFreeVoice();
    startVoice (v, juce::jlimit (0, 127, note), juce::jmax<juce::int64> (0, startIn), juce::jmax<juce::int64> (1, length), timbre);
    v.owner   = owner;
    v.part    = juce::jlimit (0, numParts - 1, part);
    v.velGain = std::pow (juce::jlimit (0.0f, 1.0f, velocity), 0.7f) * 1.2f;
}

void PreviewSynth::fadeOwner (int owner)
{
    const auto fade = (juce::int64) (fadeSeconds * sampleRate);

    for (auto& v : voices)
    {
        if (! v.active || v.owner != owner) continue;
        if (v.startIn > 0)       v.active = false;
        else if (v.fadeLeft < 0) v.fadeLeft = fade;
    }
}

void PreviewSynth::noteOn (int note, float velocity, Timbre timbre)
{
    noteOff (note);   // 同じ音を弾き直したら前の音はリリース
    // 押している間は鳴らし続ける（長さは実質無限）。三角波は 2 秒かけて減衰
    auto& v = findFreeVoice();
    startVoice (v, juce::jlimit (0, 127, note), 0, std::numeric_limits<juce::int64>::max() / 4, timbre, 2.0);
    v.midiNote = note;
    v.velGain  = std::pow (juce::jlimit (0.0f, 1.0f, velocity), 0.7f) * 1.2f;
}

void PreviewSynth::noteOff (int note)
{
    for (auto& v : voices)
    {
        if (! v.active || v.midiNote != note || v.age >= v.length)
            continue;

        v.length = juce::jmax<juce::int64> (1, v.age);   // ここからリリース
        v.midiNote = -1;
        if (v.timbre == Timbre::triangle)
        {
            v.liveRelease = true;
            v.releaseRate = decayPerSample (0.08, sampleRate);
        }
    }
}

void PreviewSynth::allNotesOff()
{
    for (auto& v : voices)
        if (v.active && v.midiNote >= 0)
            noteOff (v.midiNote);
}

void PreviewSynth::startVoice (Voice& v, int note, juce::int64 startIn, juce::int64 length, Timbre timbre, double decayHintSeconds)
{
    // 遅延線のメモリは使い回す（オーディオスレッドで確保・解放しない）
    auto delay = std::move (v.delay);
    v = Voice{};
    v.delay = std::move (delay);

    const auto freq = noteToFrequency (note);
    v.active  = true;
    v.timbre  = timbre;
    v.startIn = startIn;
    v.length  = length;

    switch (timbre)
    {
        case Timbre::triangle:
        {
            // WebAudio の exponentialRampToValueAtTime と同じく、アタック後に peak → 0.001 へ指数減衰
            const auto attack = attackSeconds * sampleRate;
            const auto decayLength = decayHintSeconds > 0 ? decayHintSeconds * sampleRate : (double) length;
            v.phaseInc  = freq / sampleRate;
            v.decayRate = (float) std::pow (0.001 / peakGain, 1.0 / juce::jmax (1.0, decayLength - attack));
            break;
        }

        case Timbre::piano:
        {
            // わずかに不協和な倍音（弦の硬さ）を重ね、高い倍音ほど早く減衰させる
            constexpr double inharmonicity = 0.0004;
            const auto t1 = pitchDecaySeconds (note, 4.0, 36, 0.8, 6.0);
            float sum = 0;

            for (int k = 0; k < maxPartials; ++k)
            {
                const auto n  = k + 1;
                const auto fn = n * freq * std::sqrt (1.0 + inharmonicity * n * n);
                if (fn >= 0.45 * sampleRate) break;

                v.pInc[(size_t) k]   = fn / sampleRate;
                v.pAmp[(size_t) k]   = 1.0f / std::pow ((float) n, 1.2f);
                v.pDecay[(size_t) k] = decayPerSample (t1 / (1.0 + 0.8 * k), sampleRate);
                sum += v.pAmp[(size_t) k];
                v.numPartials = n;
            }

            for (int k = 0; k < v.numPartials; ++k)
                v.pAmp[(size_t) k] *= peakGain * 1.4f / sum;

            v.releaseRate = decayPerSample (0.12, sampleRate);
            break;
        }

        case Timbre::electricPiano:
        {
            // 1:1 の FM。モジュレーションの深さが素早く減って柔らかい音になる
            v.phaseInc      = freq / sampleRate;
            v.gain          = peakGain * 1.1f;
            v.decayRate     = decayPerSample (pitchDecaySeconds (note, 3.0, 48, 1.0, 5.0), sampleRate);
            v.modIndex      = 2.2f;
            v.modIndexDecay = (float) std::exp (-1.0 / (0.3 * sampleRate));
            v.releaseRate   = decayPerSample (0.15, sampleRate);
            break;
        }

        case Timbre::organ:
        {
            // ドローバー風に倍音を重ねる（16' 8' 4' 2 2/3' 2'）。押さえている間は減衰しない
            constexpr std::array<std::pair<double, float>, 5> drawbars {{ { 0.5, 0.6f }, { 1.0, 1.0f }, { 2.0, 0.6f }, { 3.0, 0.4f }, { 4.0, 0.3f } }};
            float sum = 0;

            for (const auto& [ratio, amp] : drawbars)
            {
                if (ratio * freq >= 0.45 * sampleRate) break;
                const auto k = (size_t) v.numPartials++;
                v.pInc[k]   = ratio * freq / sampleRate;
                v.pAmp[k]   = amp;
                v.pDecay[k] = 1.0f;
                sum += amp;
            }

            for (int k = 0; k < v.numPartials; ++k)
                v.pAmp[(size_t) k] *= peakGain * 1.2f / sum;

            v.attackSamples = (juce::int64) (0.005 * sampleRate);
            v.releaseRate   = decayPerSample (0.06, sampleRate);
            break;
        }

        case Timbre::pad:
        {
            // わずかにずらした2本のノコギリ波をローパスで丸め、ゆっくり立ち上げる
            constexpr double detuneCents = 6.0;
            v.phaseInc  = freq * std::pow (2.0,  detuneCents / 1200.0) / sampleRate;
            v.phaseInc2 = freq * std::pow (2.0, -detuneCents / 1200.0) / sampleRate;
            v.phase2    = 0.37;
            v.lpCoeff   = (float) (1.0 - std::exp (-twoPi * 1800.0 / sampleRate));
            v.gain      = peakGain * 0.95f;
            v.attackSamples = (juce::int64) (0.15 * sampleRate);
            v.releaseRate   = decayPerSample (0.3, sampleRate);
            break;
        }

        case Timbre::lead:
        {
            // メロディー向け：少しずらした2本のノコギリ波を、パッドより明るいローパスで。立ち上がりは速く、離したら短く切る
            constexpr double detuneCents = 5.0;
            v.phaseInc  = freq * std::pow (2.0,  detuneCents / 1200.0) / sampleRate;
            v.phaseInc2 = freq * std::pow (2.0, -detuneCents / 1200.0) / sampleRate;
            v.phase2    = 0.21;
            v.lpCoeff   = (float) (1.0 - std::exp (-twoPi * 3200.0 / sampleRate));
            v.gain      = peakGain * 0.85f;
            v.attackSamples = (juce::int64) (0.006 * sampleRate);
            v.releaseRate   = decayPerSample (0.07, sampleRate);
            break;
        }

        case Timbre::square:
        {
            // 矩形波（ノコギリ波を半周ずらして引く）。伸ばしている間は減らさず、離したら少しだけ余韻を残す
            v.phaseInc  = freq / sampleRate;
            v.phaseInc2 = v.phaseInc;
            v.phase2    = 0.5;
            v.lpCoeff   = (float) (1.0 - std::exp (-twoPi * 6000.0 / sampleRate));   // 耳に痛い高域だけ少し丸める
            v.gain      = peakGain * 0.5f;
            v.attackSamples = (juce::int64) (0.003 * sampleRate);
            v.releaseRate   = decayPerSample (0.12, sampleRate);
            break;
        }

        case Timbre::guitar:
        {
            // Karplus-Strong：ノイズで弾いた遅延線を平均化フィルタで回す
            const auto size   = (int) v.delay.size();
            const auto loop   = juce::jlimit (2.0, (double) size - 3, sampleRate / freq - 0.5);  // 平均化で 0.5 サンプル遅れる分を引く
            v.delayInt  = (int) loop;
            v.delayFrac = (float) (loop - v.delayInt);
            v.loss      = (float) std::pow (10.0, -3.0 / (pitchDecaySeconds (note, 3.0, 40, 1.0, 5.0) * freq));
            v.releaseRate = decayPerSample (0.08, sampleRate);

            std::fill (v.delay.begin(), v.delay.end(), 0.0f);
            float lp = 0;
            for (int k = 1; k <= v.delayInt + 2; ++k)
            {
                lp = 0.5f * lp + 0.5f * (random.nextFloat() * 2.0f - 1.0f);
                v.delay[(size_t) (size - k)] = lp * peakGain * 2.0f;
            }
            v.writePos = 0;
            break;
        }
    }
}

float PreviewSynth::renderSample (Voice& v)
{
    float out = 0;
    const bool held = v.age < v.length;

    switch (v.timbre)
    {
        case Timbre::triangle:
        {
            if (! held && ! v.liveRelease) { v.active = false; return 0; }
            if (v.gain < 1.0e-5f && v.age > (juce::int64) (attackSeconds * sampleRate)) { v.active = false; return 0; }

            const auto attack = (juce::int64) (attackSeconds * sampleRate);
            if (v.age < attack)
                v.gain = peakGain * (float) v.age / (float) juce::jmax<juce::int64> (1, attack);
            else
                v.gain = (v.age == attack ? peakGain : v.gain * v.decayRate);

            out = (float) (4.0 * std::abs (v.phase - 0.5) - 1.0) * v.gain;
            v.phase += v.phaseInc;
            if (v.phase >= 1.0) v.phase -= 1.0;
            break;
        }

        case Timbre::piano:
        case Timbre::organ:
        {
            for (int k = 0; k < v.numPartials; ++k)
            {
                auto& ph = v.pPhase[(size_t) k];
                out += (float) std::sin (twoPi * ph) * v.pAmp[(size_t) k];
                v.pAmp[(size_t) k] *= v.pDecay[(size_t) k];
                ph += v.pInc[(size_t) k];
                if (ph >= 1.0) ph -= 1.0;
            }

            const auto attack = v.timbre == Timbre::organ ? (double) v.attackSamples : 0.003 * sampleRate;
            if ((double) v.age < attack) out *= (float) ((double) v.age / attack);
            break;
        }

        case Timbre::square:
        {
            const auto sq = 0.5f * (polyBlepSaw (v.phase, v.phaseInc) - polyBlepSaw (v.phase2, v.phaseInc2));
            v.lpState += v.lpCoeff * (sq - v.lpState);
            out = v.lpState * v.gain;
            advance (v.phase, v.phaseInc);
            advance (v.phase2, v.phaseInc2);

            if (v.age < v.attackSamples) out *= (float) v.age / (float) v.attackSamples;
            break;
        }

        case Timbre::pad:
        case Timbre::lead:
        {
            const auto saw = 0.5f * (polyBlepSaw (v.phase, v.phaseInc) + polyBlepSaw (v.phase2, v.phaseInc2));
            v.lpState += v.lpCoeff * (saw - v.lpState);
            out = v.lpState * v.gain;
            advance (v.phase, v.phaseInc);
            advance (v.phase2, v.phaseInc2);

            if (v.age < v.attackSamples) out *= (float) v.age / (float) v.attackSamples;
            break;
        }

        case Timbre::electricPiano:
        {
            const auto mod = std::sin (twoPi * v.modPhase) * (v.modIndex + 0.25f);
            out = (float) std::sin (twoPi * v.phase + mod) * v.gain;
            v.gain     *= v.decayRate;
            v.modIndex *= v.modIndexDecay;
            v.phase    += v.phaseInc;  if (v.phase >= 1.0)    v.phase -= 1.0;
            v.modPhase += v.phaseInc;  if (v.modPhase >= 1.0) v.modPhase -= 1.0;

            const auto attack = 0.002 * sampleRate;
            if ((double) v.age < attack) out *= (float) ((double) v.age / attack);
            break;
        }

        case Timbre::guitar:
        {
            const auto size = (int) v.delay.size();
            const auto a = v.delay[(size_t) ((v.writePos - v.delayInt + size) % size)];
            const auto b = v.delay[(size_t) ((v.writePos - v.delayInt - 1 + size) % size)];
            const auto tap = a + v.delayFrac * (b - a);
            out = v.loss * 0.5f * (tap + v.prevTap);
            v.prevTap = tap;
            v.delay[(size_t) v.writePos] = out;
            v.writePos = (v.writePos + 1) % size;
            break;
        }
    }

    out *= v.velGain;

    // 押さえている時間が過ぎたらダンパーで止める（三角波は上で終了済み）
    if (! held)
    {
        v.release *= v.releaseRate;
        out *= v.release;
        if (v.release < 0.001f) v.active = false;
    }

    if (v.fadeLeft >= 0)
    {
        out *= (float) v.fadeLeft / (float) juce::jmax (1.0, fadeSeconds * sampleRate);
        if (--v.fadeLeft < 0) v.active = false;
    }

    ++v.age;
    return out;
}

void PreviewSynth::renderVoices (float* out, int from, int to)
{
    for (auto& v : voices)
    {
        for (int s = from; s < to && v.active; ++s)
        {
            if (v.startIn > 0) { --v.startIn; continue; }
            auto x = renderSample (v);
            if (v.part > 0)   // 組の音量：ブロックの中で前の値から今の値へ直線で変える（つまみを動かしてもぶつぶつしない）
            {
                const auto p = (size_t) v.part;
                x *= partFrom[p] + (partTo[p] - partFrom[p]) * (float) s / (float) blockSamples;
            }
            if (out != nullptr) out[s] += x;
        }
    }
}

void PreviewSynth::render (juce::AudioBuffer<float>& buffer)
{
    {
        const auto scope = fifo.read (fifo.getNumReady());
        for (int i = 0; i < scope.blockSize1; ++i) handleRequest (requests[(size_t) (scope.startIndex1 + i)]);
        for (int i = 0; i < scope.blockSize2; ++i) handleRequest (requests[(size_t) (scope.startIndex2 + i)]);
    }

    const int numSamples = buffer.getNumSamples();
    buffer.clear();
    blockSamples = juce::jmax (1, numSamples);
    for (size_t p = 1; p < (size_t) numParts; ++p) { partFrom[p] = partTo[p]; partTo[p] = partTarget[p].load(); }
    auto* out = buffer.getNumChannels() > 0 ? buffer.getWritePointer (0) : nullptr;

    // 予約の鳴り始めの位置でブロックを区切り、サンプル単位の正確な時刻で鳴らす
    for (int pos = 0; pos < numSamples;)
    {
        startDue (clock + pos);

        auto next = clock + numSamples;
        for (int i = 0; i < numScheduled; ++i)
            next = juce::jmin (next, scheduled[(size_t) i].at);

        const auto end = (int) juce::jlimit<juce::int64> (pos + 1, numSamples, next - clock);
        renderVoices (out, pos, end);
        pos = end;
    }

    clock += numSamples;

    positionSession.store (lastSession);
    positionIndex.store (lastIndex);
    positionPlaying.store (lastIndex >= 0 && clock < progressionEnd);

    for (int ch = 1; ch < buffer.getNumChannels(); ++ch)
        buffer.copyFrom (ch, 0, buffer, 0, 0, numSamples);
}

int PreviewSynth::getNumActiveVoices() const
{
    int n = 0;
    for (const auto& v : voices)
        n += v.active ? 1 : 0;
    for (int i = 0; i < numScheduled; ++i)
        n += scheduled[(size_t) i].request.numNotes;
    return n;
}
