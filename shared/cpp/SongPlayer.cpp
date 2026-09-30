#include "SongPlayer.h"
#include <cmath>

namespace
{
    // exponentialRampToValueAtTime(0.001) と同じ：peak から seconds で 0.001 まで指数で下がる
    float expDecay (float peak, double t, double seconds)
    {
        return t >= seconds ? 0.0f : peak * (float) std::pow (0.001 / peak, t / seconds);
    }
}

void SongPlayer::prepare (double newSampleRate)
{
    sampleRate = newSampleRate > 0 ? newSampleRate : 44100.0;
}

void SongPlayer::post (Command command, std::shared_ptr<Song> song)
{
    const juce::SpinLock::ScopedLockType sl (lock);
    // 前にオーディオスレッドが置いた、使い終わった曲をここ（メッセージスレッド）で解放する
    for (auto& r : retired) r.reset();
    // 連続して届いたら、play の後の update は play の中身に入れ替える（位置の頭から鳴らす指示は残す）
    if (command == Command::update && pendingCommand == Command::play)
        command = Command::play;
    pendingCommand = command;
    pendingSong = std::move (song);
}

void SongPlayer::play (Song song)   { post (Command::play, std::make_shared<Song> (std::move (song))); }
void SongPlayer::update (Song song) { post (Command::update, std::make_shared<Song> (std::move (song))); }
void SongPlayer::stop()             { post (Command::stop, nullptr); }

SongPlayer::Position SongPlayer::getPosition() const
{
    return { positionSession.load(), positionSeconds.load(), positionPlaying.load() };
}

// pos から先の最初のノート・ドラムを探す（includeLeadIn でなければ負の時刻のドラムは飛ばす）
void SongPlayer::seek (juce::int64 samplePos, bool includeLeadIn)
{
    nextNote = nextDrum = 0;
    if (current == nullptr) return;
    const auto at = (double) samplePos / sampleRate;
    while (nextNote < current->notes.size() && current->notes[nextNote].start < at) ++nextNote;
    while (nextDrum < current->drums.size()
           && (current->drums[nextDrum].start < at || (! includeLeadIn && current->drums[nextDrum].start < 0)))
        ++nextDrum;
}

// 今の位置でまだ鳴っているはずのノートを、その位置から鳴らし直す
void SongPlayer::chase (PreviewSynth& synth)
{
    if (current == nullptr || pos < 0) return;
    const auto at = (double) pos / sampleRate;
    for (const auto& n : current->notes)
    {
        if (n.start >= at) break;
        const auto end = n.start + n.length;
        if (end > at + 0.01)
            synth.startNote (n.note, n.velocity, 0, (juce::int64) ((end - at) * sampleRate), n.melody ? current->melodyTimbre : current->timbre, synthOwner);
    }
}

void SongPlayer::takeCommand (PreviewSynth& synth)
{
    Command command = Command::none;
    std::shared_ptr<Song> song;
    {
        const juce::SpinLock::ScopedTryLockType sl (lock);
        if (! sl.isLocked() || pendingCommand == Command::none) return;
        command = pendingCommand;
        song = std::move (pendingSong);
        pendingCommand = Command::none;

        // 止まっているときの差し替えは何もしない（届いた曲は retired へ。解放はメッセージスレッドで）
        auto& old = (command == Command::update && ! playing) ? song : current;
        // 使い終わった曲は retired に移す（オーディオスレッドでは解放しない）
        for (auto& r : retired)
            if (r == nullptr) { r = std::move (old); break; }
        if (command == Command::update && ! playing) return;
    }

    switch (command)
    {
        case Command::stop:
            synth.fadeOwner (synthOwner);
            current.reset();   // 通常は retired に移してあるので空（retired が満杯のときだけここで解放）
            playing = false;
            break;

        case Command::play:
            synth.fadeOwner (synthOwner);
            for (auto& d : drumVoices) d.active = false;
            current = std::move (song);
            pos = -(juce::int64) std::llround (current->leadIn * sampleRate);
            playing = current->length > 0;
            seek (pos, true);
            break;

        case Command::update:
            synth.fadeOwner (synthOwner);
            current = std::move (song);
            {
                const auto length = (juce::int64) std::llround (current->length * sampleRate);
                if (pos >= length && length > 0) pos = current->loop ? pos % length : length;
            }
            seek (pos, pos < 0);
            chase (synth);
            break;

        case Command::none: break;
    }
}

void SongPlayer::scheduleBlock (PreviewSynth& synth, int numSamples)
{
    takeCommand (synth);

    if (playing && current != nullptr)
    {
        const auto length = (juce::int64) std::llround (current->length * sampleRate);
        juce::int64 offset = 0;

        while (offset < numSamples && playing)
        {
            auto segEnd = pos + (numSamples - offset);
            if (segEnd > length && pos < length) segEnd = length;   // 1 周の終わりでいったん区切る

            const auto segEndSec = (double) segEnd / sampleRate;
            for (; nextNote < current->notes.size() && current->notes[nextNote].start < segEndSec; ++nextNote)
            {
                const auto& n = current->notes[nextNote];
                const auto at = (juce::int64) std::llround (n.start * sampleRate);
                synth.startNote (n.note, n.velocity, offset + juce::jmax<juce::int64> (0, at - pos),
                                 (juce::int64) std::llround (n.length * sampleRate), n.melody ? current->melodyTimbre : current->timbre, synthOwner);
            }
            for (; nextDrum < current->drums.size() && current->drums[nextDrum].start < segEndSec; ++nextDrum)
            {
                const auto& d = current->drums[nextDrum];
                const auto at = (juce::int64) std::llround (d.start * sampleRate);
                triggerDrum (d.kind, offset + juce::jmax<juce::int64> (0, at - pos));
            }

            offset += segEnd - pos;
            pos = segEnd;

            if (pos >= length)
            {
                if (current->loop && length > 0) { pos = 0; seek (0, false); }   // 頭へ（カウントインのクリックは鳴らさない）
                else                             { playing = false; }
            }
        }
    }

    positionSession.store (current != nullptr ? current->session : -1);
    positionSeconds.store ((double) pos / sampleRate);
    positionPlaying.store (playing);
}

void SongPlayer::triggerDrum (Drum kind, juce::int64 startIn)
{
    // 空きが無ければ一番古いものを使う
    auto* target = &drumVoices[0];
    for (auto& v : drumVoices)
    {
        if (! v.active) { target = &v; break; }
        if (v.age > target->age) target = &v;
    }
    *target = DrumVoice{};
    target->active = true;
    target->kind = kind;
    target->startIn = startIn;
}

float SongPlayer::renderDrumSample (DrumVoice& v)
{
    const auto t = (double) v.age / sampleRate;
    ++v.age;
    float out = 0;

    switch (v.kind)
    {
        case Drum::kick:
        {
            const auto freq = 140.0 * std::pow (45.0 / 140.0, juce::jmin (1.0, t / 0.12));
            v.phase += freq / sampleRate;
            out = (float) std::sin (juce::MathConstants<double>::twoPi * v.phase) * expDecay (0.55f, t, 0.32);
            if (t >= 0.32) v.active = false;
            break;
        }
        case Drum::snare:
        {
            const auto noise = random.nextFloat() * 2.0f - 1.0f;
            v.hp = 0.9f * (v.hp + noise - v.prevNoise);   // 低い音を落とす
            v.prevNoise = noise;
            v.lp += 0.45f * (v.hp - v.lp);                 // 高すぎる音を落とす
            v.phase += 190.0 / sampleRate;
            out = v.lp * expDecay (0.30f, t, 0.16)
                + (float) std::sin (juce::MathConstants<double>::twoPi * v.phase) * expDecay (0.2f, t, 0.08);
            if (t >= 0.16) v.active = false;
            break;
        }
        case Drum::hat:
        case Drum::hatAccent:
        {
            const auto noise = random.nextFloat() * 2.0f - 1.0f;
            v.hp = 0.35f * (v.hp + noise - v.prevNoise);  // 高い音だけ残す
            v.prevNoise = noise;
            out = v.hp * expDecay (v.kind == Drum::hatAccent ? 0.16f : 0.09f, t, 0.045);
            if (t >= 0.045) v.active = false;
            break;
        }
        case Drum::click:
        case Drum::clickHigh:
        {
            v.phase += (v.kind == Drum::clickHigh ? 1760.0 : 1175.0) / sampleRate;
            const auto square = std::fmod (v.phase, 1.0) < 0.5 ? 1.0f : -1.0f;
            out = square * expDecay (0.10f, t, 0.035);
            if (t >= 0.035) v.active = false;
            break;
        }
    }
    return out;
}

void SongPlayer::renderDrums (juce::AudioBuffer<float>& buffer)
{
    const int numSamples = buffer.getNumSamples();
    if (buffer.getNumChannels() == 0) return;
    auto* out = buffer.getWritePointer (0);
    bool any = false;

    for (auto& v : drumVoices)
    {
        for (int s = 0; s < numSamples && v.active; ++s)
        {
            if (v.startIn > 0) { --v.startIn; continue; }
            out[s] += renderDrumSample (v);
            any = true;
        }
    }

    // PreviewSynth::render() は全チャンネルに同じ信号を書くので、ドラムを足した 0 番をほかのチャンネルに写す
    if (any)
        for (int ch = 1; ch < buffer.getNumChannels(); ++ch)
            buffer.copyFrom (ch, 0, buffer, 0, 0, numSamples);
}
