#include "PreviewSynth.h"

class PreviewSynthTests : public juce::UnitTest
{
public:
    PreviewSynthTests() : juce::UnitTest ("PreviewSynth", "Godoken") {}

    void runTest() override
    {
        constexpr double sr = 48000.0;

        beginTest ("Silent when nothing is queued");
        {
            PreviewSynth synth;
            synth.prepare (sr);
            juce::AudioBuffer<float> buf (2, 512);
            buf.applyGain (0.0f);
            buf.setSample (0, 0, 1.0f);   // 前の内容は上書きされること
            synth.render (buf);
            expectEquals (buf.getMagnitude (0, 512), 0.0f);
        }

        beginTest ("Chord sounds, stays within range, and ends after its duration");
        {
            PreviewSynth synth;
            synth.prepare (sr);
            expect (synth.queue ({ 36, 48, 52, 55 }, 0.0, 0.5));

            juce::AudioBuffer<float> buf (2, 4800);   // 0.1 秒
            synth.render (buf);
            expectEquals (synth.getNumActiveVoices(), 4);
            expect (buf.getMagnitude (0, 4800) > 0.05f);
            expect (buf.getMagnitude (0, 4800) <= 4 * PreviewSynth::peakGain + 1.0e-4f);

            // 左右同じ信号
            for (int i = 0; i < 4800; i += 97)
                expectEquals (buf.getSample (1, i), buf.getSample (0, i));

            for (int i = 0; i < 5; ++i) synth.render (buf);   // 合計 0.6 秒
            expectEquals (synth.getNumActiveVoices(), 0);
            expectEquals (buf.getMagnitude (0, 4800), 0.0f);
        }

        beginTest ("Delayed chord starts after its delay");
        {
            PreviewSynth synth;
            synth.prepare (sr);
            expect (synth.queue ({ 60 }, 0.2, 0.5));

            juce::AudioBuffer<float> buf (1, 4800);
            synth.render (buf);  synth.render (buf);            // 0〜0.2 秒
            expectEquals (buf.getMagnitude (0, 4800), 0.0f);
            synth.render (buf);                                  // 0.2〜0.3 秒
            expect (buf.getMagnitude (0, 4800) > 0.05f);
        }

        beginTest ("Envelope decays toward 0.001 of peak");
        {
            PreviewSynth synth;
            synth.prepare (sr);
            expect (synth.queue ({ 69 }, 0.0, 1.0));

            juce::AudioBuffer<float> buf (1, 2400);   // 50ms ずつ
            synth.render (buf);
            const auto early = buf.getMagnitude (0, 2400);
            for (int i = 0; i < 18; ++i) synth.render (buf);   // 0.95〜1.0 秒
            expect (buf.getMagnitude (0, 2400) < early * 0.05f);
        }

        beginTest ("Rejects empty requests");
        {
            PreviewSynth synth;
            synth.prepare (sr);
            expect (! synth.queue ({}, 0.0, 1.0));
            expect (! synth.queue ({ 60 }, 0.0, 0.0));
        }
    }
};

static PreviewSynthTests previewSynthTests;
