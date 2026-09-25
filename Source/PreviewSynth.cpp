#include "PreviewSynth.h"

#include <cmath>

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
    return true;
}

bool PreviewSynth::stopAll()
{
    const auto scope = fifo.write (1);
    if (scope.blockSize1 + scope.blockSize2 == 0)
        return false;

    auto& r = requests[(size_t) (scope.blockSize1 > 0 ? scope.startIndex1 : scope.startIndex2)];
    r.numNotes   = 0;
    r.stopOthers = true;
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
    if (r.stopOthers)
    {
        const auto fade = (juce::int64) (fadeSeconds * sampleRate);

        for (auto& v : voices)
        {
            if (! v.active) continue;
            if (v.startIn > 0)       v.active = false;        // まだ鳴っていない予約は取り消し
            else if (v.fadeLeft < 0) v.fadeLeft = fade;
        }
    }

    const auto startIn = (juce::int64) (r.delaySeconds * sampleRate);
    const auto length  = (juce::int64) (r.durationSeconds * sampleRate);

    for (int n = 0; n < r.numNotes; ++n)
    {
        // ギターは低い弦から順に少しずらして鳴らす（ストローク）
        const auto strum = r.timbre == Timbre::guitar ? (juce::int64) (n * strumSeconds * sampleRate) : 0;
        startVoice (findFreeVoice(), r.notes[(size_t) n], startIn + strum, juce::jmax<juce::int64> (1, length - strum), r.timbre);
    }
}

void PreviewSynth::startVoice (Voice& v, int note, juce::int64 startIn, juce::int64 length, Timbre timbre)
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
            v.phaseInc  = freq / sampleRate;
            v.decayRate = (float) std::pow (0.001 / peakGain, 1.0 / juce::jmax (1.0, (double) length - attack));
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
            if (! held) { v.active = false; return 0; }

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

        case Timbre::pad:
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

void PreviewSynth::render (juce::AudioBuffer<float>& buffer)
{
    {
        const auto scope = fifo.read (fifo.getNumReady());
        for (int i = 0; i < scope.blockSize1; ++i) handleRequest (requests[(size_t) (scope.startIndex1 + i)]);
        for (int i = 0; i < scope.blockSize2; ++i) handleRequest (requests[(size_t) (scope.startIndex2 + i)]);
    }

    const int numSamples = buffer.getNumSamples();
    buffer.clear();

    if (buffer.getNumChannels() == 0)
        return;

    auto* out = buffer.getWritePointer (0);

    for (auto& v : voices)
    {
        for (int s = 0; s < numSamples && v.active; ++s)
        {
            if (v.startIn > 0) { --v.startIn; continue; }
            out[s] += renderSample (v);
        }
    }

    for (int ch = 1; ch < buffer.getNumChannels(); ++ch)
        buffer.copyFrom (ch, 0, buffer, 0, 0, numSamples);
}

int PreviewSynth::getNumActiveVoices() const
{
    int n = 0;
    for (const auto& v : voices)
        n += v.active ? 1 : 0;
    return n;
}
