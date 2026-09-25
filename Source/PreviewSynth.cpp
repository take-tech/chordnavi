#include "PreviewSynth.h"

#include <cmath>

void PreviewSynth::prepare (double newSampleRate)
{
    sampleRate = newSampleRate > 0 ? newSampleRate : 44100.0;

    for (auto& v : voices)
        v.active = false;
}

bool PreviewSynth::queue (const std::vector<int>& notes, double delaySeconds, double durationSeconds)
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
    return true;
}

void PreviewSynth::startVoices (const Request& r)
{
    const auto length   = (juce::int64) (r.durationSeconds * sampleRate);
    const auto attack   = attackSeconds * sampleRate;
    // WebAudio の exponentialRampToValueAtTime と同じく、アタック後に peak → 0.001 へ指数減衰
    const auto decay    = (float) std::pow (0.001 / peakGain, 1.0 / juce::jmax (1.0, (double) length - attack));

    for (int n = 0; n < r.numNotes; ++n)
    {
        // 空きボイスが無ければ一番古いボイスを使う
        auto* target = &voices[0];
        for (auto& v : voices)
        {
            if (! v.active) { target = &v; break; }
            if (v.age > target->age) target = &v;
        }

        const auto freq = 440.0 * std::pow (2.0, (r.notes[(size_t) n] - 69) / 12.0);
        *target = {};
        target->active    = true;
        target->phaseInc  = freq / sampleRate;
        target->startIn   = (juce::int64) (r.delaySeconds * sampleRate);
        target->length    = length;
        target->decayRate = decay;
    }
}

void PreviewSynth::render (juce::AudioBuffer<float>& buffer)
{
    {
        const auto scope = fifo.read (fifo.getNumReady());
        for (int i = 0; i < scope.blockSize1; ++i) startVoices (requests[(size_t) (scope.startIndex1 + i)]);
        for (int i = 0; i < scope.blockSize2; ++i) startVoices (requests[(size_t) (scope.startIndex2 + i)]);
    }

    const int numSamples = buffer.getNumSamples();
    buffer.clear();

    if (buffer.getNumChannels() == 0)
        return;

    auto* out = buffer.getWritePointer (0);
    const auto attackSamples = (juce::int64) (attackSeconds * sampleRate);

    for (auto& v : voices)
    {
        if (! v.active)
            continue;

        for (int s = 0; s < numSamples; ++s)
        {
            if (v.startIn > 0) { --v.startIn; continue; }

            if (v.age >= v.length) { v.active = false; break; }

            if (v.age < attackSamples)
                v.gain = peakGain * (float) v.age / (float) juce::jmax<juce::int64> (1, attackSamples);
            else
                v.gain = (v.age == attackSamples ? peakGain : v.gain * v.decayRate);

            // 三角波（-1〜1）
            const auto tri = (float) (4.0 * std::abs (v.phase - 0.5) - 1.0);
            out[s] += tri * v.gain;

            v.phase += v.phaseInc;
            if (v.phase >= 1.0) v.phase -= 1.0;
            ++v.age;
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
