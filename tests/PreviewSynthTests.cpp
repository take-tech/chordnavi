#include "PreviewSynth.h"

namespace
{
    using Timbre = PreviewSynth::Timbre;
    constexpr double sr = 48000.0;
    constexpr int block = 4800;   // 0.1 秒

    float renderSeconds (PreviewSynth& synth, double seconds, float* peakOut = nullptr)
    {
        juce::AudioBuffer<float> buf (2, block);
        float peak = 0, last = 0;
        for (int i = 0; i < (int) std::round (seconds * sr / block); ++i)
        {
            synth.render (buf);
            last = buf.getMagnitude (0, block);
            peak = juce::jmax (peak, last);
        }
        if (peakOut != nullptr) *peakOut = peak;
        return last;
    }
}

class PreviewSynthTests : public juce::UnitTest
{
public:
    PreviewSynthTests() : juce::UnitTest ("PreviewSynth", "Godoken") {}

    void runTest() override
    {
        beginTest ("Silent when nothing is queued");
        {
            PreviewSynth synth;
            synth.prepare (sr);
            juce::AudioBuffer<float> buf (2, 512);
            buf.clear();
            buf.setSample (0, 0, 1.0f);   // 前の内容は上書きされること
            synth.render (buf);
            expectEquals (buf.getMagnitude (0, 512), 0.0f);
        }

        beginTest ("Triangle: sounds, stays within range, and ends after its duration");
        {
            PreviewSynth synth;
            synth.prepare (sr);
            expect (synth.queue ({ 36, 48, 52, 55 }, 0.0, 0.5));

            juce::AudioBuffer<float> buf (2, block);
            synth.render (buf);
            expectEquals (synth.getNumActiveVoices(), 4);
            expect (buf.getMagnitude (0, block) > 0.05f);
            expect (buf.getMagnitude (0, block) <= 4 * PreviewSynth::peakGain + 1.0e-4f);

            for (int i = 0; i < block; i += 97)
                expectEquals (buf.getSample (1, i), buf.getSample (0, i));   // 左右同じ

            expectEquals (renderSeconds (synth, 0.5), 0.0f);
            expectEquals (synth.getNumActiveVoices(), 0);
        }

        beginTest ("Delayed chord starts after its delay");
        {
            PreviewSynth synth;
            synth.prepare (sr);
            expect (synth.queue ({ 60 }, 0.2, 0.5));
            expectEquals (renderSeconds (synth, 0.2), 0.0f);
            expect (renderSeconds (synth, 0.1) > 0.05f);
        }

        beginTest ("Triangle envelope decays toward 0.001 of peak");
        {
            PreviewSynth synth;
            synth.prepare (sr);
            expect (synth.queue ({ 69 }, 0.0, 1.0));
            juce::AudioBuffer<float> buf (1, 2400);
            synth.render (buf);
            const auto early = buf.getMagnitude (0, 2400);
            for (int i = 0; i < 18; ++i) synth.render (buf);   // 0.95〜1.0 秒
            expect (buf.getMagnitude (0, 2400) < early * 0.05f);
        }

        for (auto [timbre, label] : { std::pair { Timbre::piano, "piano" },
                                     std::pair { Timbre::electricPiano, "electric piano" },
                                     std::pair { Timbre::guitar, "guitar" },
                                     std::pair { Timbre::organ, "organ" },
                                     std::pair { Timbre::pad, "pad" } })
        {
            beginTest (juce::String ("Timbre ") + label + ": audible, bounded, released after duration");
            PreviewSynth synth;
            synth.prepare (sr);
            expect (synth.queue ({ 36, 48, 52, 55 }, 0.0, 0.9, timbre));

            float peak = 0;
            const auto last = renderSeconds (synth, 0.8, &peak);
            logMessage (juce::String ("  peak level: ") + juce::String (peak, 3));
            expect (peak > 0.03f, "too quiet: " + juce::String (peak));
            expect (peak < 1.0f, "too loud: " + juce::String (peak));
            expect (last > 0.0f);

            renderSeconds (synth, 0.5);   // 0.9 秒で離してリリース
            expectEquals (synth.getNumActiveVoices(), 0);
        }

        for (auto [timbre, label] : { std::pair { Timbre::organ, "organ" }, std::pair { Timbre::pad, "pad" } })
        {
            beginTest (juce::String ("Timbre ") + label + ": sustains without decay while held");
            PreviewSynth synth;
            synth.prepare (sr);
            expect (synth.queue ({ 48, 52, 55 }, 0.0, 2.0, timbre));
            const auto early = renderSeconds (synth, 0.3);
            const auto late  = renderSeconds (synth, 1.5);   // 1.7〜1.8 秒
            expectWithinAbsoluteError (late, early, early * 0.25f);
        }

        beginTest ("stopOthers fades out playing voices and cancels pending ones");
        {
            PreviewSynth synth;
            synth.prepare (sr);
            // 進行の試聴：1つ目は今、2つ目は 0.9 秒後
            expect (synth.queue ({ 36, 48, 52, 55 }, 0.0, 0.9, Timbre::piano, true));
            expect (synth.queue ({ 43, 55, 59, 62 }, 0.9, 0.9, Timbre::piano));
            renderSeconds (synth, 0.3);
            expectEquals (synth.getNumActiveVoices(), 8);

            // 別の進行を試聴：前の音は 10ms でフェードし、予約も消える
            expect (synth.queue ({ 38 }, 0.0, 0.9, Timbre::piano, true));
            renderSeconds (synth, 0.1);
            expectEquals (synth.getNumActiveVoices(), 1);
        }

        beginTest ("stopAll silences playing and pending voices");
        {
            PreviewSynth synth;
            synth.prepare (sr);
            expect (synth.queue ({ 48, 52, 55 }, 0.0, 2.0, Timbre::organ));
            expect (synth.queue ({ 50, 53, 57 }, 1.0, 2.0, Timbre::organ));
            renderSeconds (synth, 0.2);
            expect (synth.stopAll());
            renderSeconds (synth, 0.1);                         // 10ms のフェードを含む
            expectEquals (synth.getNumActiveVoices(), 0);
            expectEquals (renderSeconds (synth, 1.0), 0.0f);    // 予約していた2つ目も鳴らない
            expectEquals (synth.getNumActiveVoices(), 0);
        }

        for (auto [timbre, label] : { std::pair { Timbre::triangle, "triangle" }, std::pair { Timbre::organ, "organ" },
                                      std::pair { Timbre::piano, "piano" } })
        {
            beginTest (juce::String ("Live MIDI (") + label + "): sounds while held, stops after note-off");
            PreviewSynth synth;
            synth.prepare (sr);
            synth.noteOn (60, 1.0f, timbre);
            expect (renderSeconds (synth, 0.3) > 0.01f);
            expectEquals (synth.getNumActiveVoices(), 1);
            synth.noteOff (60);
            renderSeconds (synth, 0.6);                 // リリース
            expectEquals (synth.getNumActiveVoices(), 0);
            expectEquals (renderSeconds (synth, 0.1), 0.0f);
        }

        beginTest ("Live MIDI: velocity scales the level, re-trigger does not stack voices");
        {
            PreviewSynth loud, soft;
            loud.prepare (sr); soft.prepare (sr);
            loud.noteOn (60, 1.0f, Timbre::organ);
            soft.noteOn (60, 0.2f, Timbre::organ);
            float pl = 0, ps = 0;
            renderSeconds (loud, 0.2, &pl); renderSeconds (soft, 0.2, &ps);
            expect (ps < pl * 0.5f, "soft " + juce::String (ps) + " loud " + juce::String (pl));

            loud.noteOn (60, 1.0f, Timbre::organ);      // 同じ音を弾き直す
            renderSeconds (loud, 0.3);
            expectEquals (loud.getNumActiveVoices(), 1);
            loud.allNotesOff();
            renderSeconds (loud, 0.5);
            expectEquals (loud.getNumActiveVoices(), 0);
        }

        beginTest ("Rejects empty requests");
        {
            PreviewSynth synth;
            synth.prepare (sr);
            expect (! synth.queue ({}, 0.0, 1.0));
            expect (! synth.queue ({ 60 }, 0.0, 0.0));
        }

        using Events = std::vector<PreviewSynth::ChordEvent>;
        const auto twoChords = [] { return Events { { { 48, 52, 55 }, 0.0, 0.5 }, { { 50, 53, 57 }, 0.5, 0.5 } }; };

        beginTest ("Progression reports the sounding chord on the audio clock");
        {
            PreviewSynth synth;
            synth.prepare (sr);
            expect (synth.queueProgression (twoChords(), Timbre::organ, 7, false));
            renderSeconds (synth, 0.1);
            auto p = synth.getPosition();
            expectEquals (p.session, 7);
            expectEquals (p.index, 0);
            expect (p.playing);

            renderSeconds (synth, 0.5);                    // 0.6 秒：2つ目
            expectEquals (synth.getPosition().index, 1);

            renderSeconds (synth, 0.5);                    // 1.1 秒：鳴り終わり
            expect (! synth.getPosition().playing);
        }

        beginTest ("Appended progression starts exactly where the previous one ends");
        {
            PreviewSynth synth;
            synth.prepare (sr);
            expect (synth.queueProgression (twoChords(), Timbre::organ, 1, false));
            renderSeconds (synth, 0.7);                    // 最後のコードが鳴っている間に次の周を予約
            expect (synth.queueProgression (twoChords(), Timbre::organ, 2, true));

            juce::AudioBuffer<float> buf (2, 48);          // 1ms ずつ
            int switchedAt = -1;
            for (int i = 0; i < 600 && switchedAt < 0; ++i)
            {
                synth.render (buf);
                if (synth.getPosition().session == 2) switchedAt = 700 + i;   // このブロックの頭の時刻（ms）
                else expect (synth.getPosition().playing);                   // 周の間でも止まらない
            }
            expectEquals (switchedAt, 1000);               // 1.000〜1.001 秒のブロックで次の周の先頭が鳴り始める
            expectEquals (synth.getPosition().index, 0);
        }

        beginTest ("Starting a progression stops the previous one and its reservations");
        {
            PreviewSynth synth;
            synth.prepare (sr);
            expect (synth.queueProgression (twoChords(), Timbre::organ, 1, false));
            renderSeconds (synth, 0.1);
            expect (synth.queueProgression ({ { { 60 }, 0.0, 0.3 } }, Timbre::organ, 2, false));
            renderSeconds (synth, 0.1);
            expectEquals (synth.getPosition().session, 2);
            expectEquals (synth.getNumActiveVoices(), 1);  // 前の周の音はフェード済み、2つ目の予約も消えた
            renderSeconds (synth, 0.6);
            expect (! synth.getPosition().playing);
            expectEquals (renderSeconds (synth, 0.3), 0.0f);
        }

        beginTest ("Long progressions do not run out of voices");
        {
            PreviewSynth synth;
            synth.prepare (sr);
            Events chords;
            for (int i = 0; i < 16; ++i)
                chords.push_back ({ { 36, 48, 52, 55, 59 }, i * 0.25, 0.25 });   // 16 コード × 5 音
            expect (synth.queueProgression (chords, Timbre::organ, 1, false));
            renderSeconds (synth, 0.1);
            expectEquals (synth.getNumActiveVoices(), 80);    // 鳴っている 5 音＋予約 75 音
            renderSeconds (synth, 3.8);                       // 最後のコード
            expectEquals (synth.getPosition().index, 15);
            expect (renderSeconds (synth, 0.1) > 0.05f);
        }
    }
};

static PreviewSynthTests previewSynthTests;
