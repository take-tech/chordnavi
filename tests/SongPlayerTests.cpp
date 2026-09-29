#include "SongPlayer.h"

// 曲の試聴（SongPlayer）：時刻の正確さ・位置・ループ・差し替え・停止・ドラム・カウントイン
namespace
{
    constexpr double sr = 48000.0;
    constexpr int block = 256;
    using Timbre = PreviewSynth::Timbre;

    struct Rig
    {
        PreviewSynth synth;
        SongPlayer player;
        std::vector<float> out;   // これまでに鳴らした音（0 番チャンネル）

        Rig() { synth.prepare (sr); player.prepare (sr); }

        void run (double seconds)
        {
            const auto blocks = (int) std::ceil (seconds * sr / block);
            juce::AudioBuffer<float> buf (2, block);
            for (int b = 0; b < blocks; ++b)
            {
                player.scheduleBlock (synth, block);
                synth.render (buf);
                player.renderDrums (buf);
                out.insert (out.end(), buf.getReadPointer (0), buf.getReadPointer (0) + block);
            }
        }

        // 壁時計（play してからの秒）で from〜to の最大振幅
        float peak (double from, double to) const
        {
            float m = 0;
            for (auto i = (size_t) (from * sr); i < (size_t) (to * sr) && i < out.size(); ++i)
                m = juce::jmax (m, std::abs (out[i]));
            return m;
        }
    };

    SongPlayer::Song songWith (std::vector<SongPlayer::Note> notes, double length, bool loop = false)
    {
        SongPlayer::Song s;
        s.notes = std::move (notes);
        s.length = length;
        s.loop = loop;
        s.timbre = Timbre::triangle;
        s.session = 3;
        return s;
    }
}

class SongPlayerTests : public juce::UnitTest
{
public:
    SongPlayerTests() : juce::UnitTest ("SongPlayer", "Godoken") {}

    void runTest() override
    {
        beginTest ("Notes start on the exact sample and stop after their length");
        {
            Rig r;
            r.player.play (songWith ({ { 1000.0 / sr, 0.3, 69, 0.8f } }, 2.0));
            r.run (1.5);
            size_t first = 0;
            while (first < r.out.size() && std::abs (r.out[first]) < 1.0e-6f) ++first;
            expect (first >= 1000 && first <= 1003, "first sample " + juce::String ((int) first));
            expect (r.peak (0.05, 0.3) > 0.01f);
            expect (r.peak (0.45, 1.5) < 0.002f);
        }

        beginTest ("Position is reported in seconds (negative during the count-in)");
        {
            Rig r;
            auto s = songWith ({}, 4.0);
            s.leadIn = 1.0;
            r.player.play (s);
            r.run (0.25);
            auto p = r.player.getPosition();
            expect (p.playing && p.session == 3);
            expectWithinAbsoluteError (p.seconds, -0.75, 0.01);
            r.run (1.25);
            expectWithinAbsoluteError (r.player.getPosition().seconds, 0.5, 0.01);
        }

        beginTest ("Loop replays from the top without a gap; no loop stops at the end");
        {
            Rig r;
            r.player.play (songWith ({ { 0.0, 0.1, 69, 0.8f } }, 0.5, true));
            r.run (1.3);
            expect (r.peak (0.5, 0.58) > 0.01f && r.peak (1.0, 1.08) > 0.01f);
            expect (r.player.getPosition().playing);
            expect (r.player.getPosition().seconds < 0.5);

            Rig once;
            once.player.play (songWith ({ { 0.0, 0.1, 69, 0.8f } }, 0.5, false));
            once.run (1.0);
            expect (! once.player.getPosition().playing);
            expect (once.peak (0.6, 1.0) < 0.002f);
        }

        beginTest ("Update keeps the position and re-sounds notes that should still be ringing");
        {
            Rig r;
            const auto song = songWith ({ { 0.0, 2.0, 57, 0.8f } }, 4.0);
            r.player.play (song);
            r.run (0.5);
            r.player.update (song);                 // 同じ中身：鳴り続ける
            r.run (0.5);
            expect (r.peak (0.6, 1.0) > 0.005f);
            expectWithinAbsoluteError (r.player.getPosition().seconds, 1.0, 0.02);
            r.player.update (songWith ({}, 4.0));   // 音を消した中身：止まる
            r.run (0.5);
            expect (r.peak (1.2, 1.5) < 0.002f);
            expect (r.player.getPosition().playing);
        }

        beginTest ("Stop silences the song");
        {
            Rig r;
            r.player.play (songWith ({ { 0.0, 3.0, 60, 0.8f } }, 4.0));
            r.run (0.3);
            r.player.stop();
            r.run (0.5);
            expect (r.peak (0.45, 0.8) < 0.001f);
            expect (! r.player.getPosition().playing);
        }

        beginTest ("Drums and count-in clicks sound; the count-in is not repeated when looping");
        {
            Rig r;
            auto s = songWith ({}, 1.0, true);
            s.leadIn = 0.5;
            s.drums = { { -0.5, SongPlayer::Drum::clickHigh }, { 0.2, SongPlayer::Drum::kick } };
            r.player.play (s);
            r.run (2.4);
            expect (r.peak (0.0, 0.03) > 0.02f);          // カウントイン（壁時計 0 秒）
            expect (r.peak (0.7, 0.8) > 0.05f);           // キック（曲の 0.2 秒）
            expect (r.peak (1.7, 1.8) > 0.05f);           // 2 周目のキック
            expect (r.peak (1.45, 1.55) < 0.002f);        // 2 周目の頭にカウントインは無い
        }

        beginTest ("Many notes do not run out or crash");
        {
            Rig r;
            std::vector<SongPlayer::Note> notes;
            for (int i = 0; i < 2000; ++i) notes.push_back ({ i * 0.002, 0.05, 48 + i % 24, 0.7f });
            r.player.play (songWith (notes, 5.0));
            r.run (4.5);
            expect (r.peak (0.5, 3.5) > 0.01f);
            expect (r.peak (0.0, 4.5) < 4.0f);
        }
    }
};

static SongPlayerTests songPlayerTests;
