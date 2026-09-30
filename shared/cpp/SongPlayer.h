#pragma once

#include "PreviewSynth.h"
#include <array>
#include <atomic>
#include <memory>
#include <vector>

// 曲の試聴（ChordSketch）。JS（song.js・player.js）が作った「音の予定表」（秒）を、サンプル単位の時刻で鳴らす。
// ノートは PreviewSynth のボイスで、ドラム（メトロノーム・カウントイン）はここで鳴らす。ループ・再生中の差し替え・位置の報告もここ。
// play()・update()・stop() はメッセージスレッド、scheduleBlock()・renderDrums() はオーディオスレッドから呼ぶ
class SongPlayer
{
public:
    enum class Drum { kick, snare, hat, hatAccent, click, clickHigh };

    struct Note    { double start = 0, length = 0; int note = 60; float velocity = 0.8f; bool melody = false; };   // melody はメロディーの音色で鳴らす
    struct DrumHit { double start = 0; Drum kind = Drum::click; };

    struct Song
    {
        std::vector<Note> notes;       // start の順
        std::vector<DrumHit> drums;    // start の順。カウントインのクリックは負の時刻
        double length = 0;             // 1 周の長さ（秒）
        double leadIn = 0;             // カウントインの長さ（秒。play() のときだけ使う）
        bool loop = false;
        PreviewSynth::Timbre timbre = PreviewSynth::Timbre::piano;         // コード
        PreviewSynth::Timbre melodyTimbre = PreviewSynth::Timbre::lead;    // メロディー（Note::melody）
        int session = -1;              // JS が付ける番号（位置の報告に付けて返す）
    };

    static constexpr int synthOwner = 7;   // PreviewSynth のボイスに付ける印
    static constexpr int maxDrumVoices = 32;

    void prepare (double sampleRate);

    // いまから鳴らす（カウントインがあればその後に曲の頭）。鳴っている曲は止める
    void play (Song song);
    // 位置はそのままで中身だけ差し替える（再生中の変更）。鳴っている音は切り、その位置でまだ続くはずの音を鳴らし直す
    void update (Song song);
    void stop();

    // オーディオスレッド：synth.render() の前に呼ぶ（このブロックで始まる音を PreviewSynth に予約する）
    void scheduleBlock (PreviewSynth& synth, int numSamples);
    // オーディオスレッド：synth.render() の後に呼ぶ（ドラムを足す）
    void renderDrums (juce::AudioBuffer<float>& buffer);

    struct Position
    {
        int session = -1;
        double seconds = 0;     // 1 周の中の位置。カウントイン中は負
        bool playing = false;
    };
    Position getPosition() const;   // どのスレッドから読んでもよい

private:
    enum class Command { none, play, update, stop };

    struct DrumVoice
    {
        bool active = false;
        Drum kind = Drum::click;
        juce::int64 startIn = 0, age = 0;
        double phase = 0;
        float hp = 0, lp = 0, prevNoise = 0;   // ノイズのフィルタ
    };

    void post (Command, std::shared_ptr<Song>);
    void takeCommand (PreviewSynth&);
    void seek (juce::int64 samplePos, bool includeLeadIn);
    void chase (PreviewSynth&);
    void triggerDrum (Drum, juce::int64 startIn);
    float renderDrumSample (DrumVoice&);

    double sampleRate = 44100.0;
    juce::Random random;

    // メッセージスレッド → オーディオスレッド
    juce::SpinLock lock;
    Command pendingCommand = Command::none;
    std::shared_ptr<Song> pendingSong;
    std::array<std::shared_ptr<Song>, 4> retired;   // オーディオスレッドで解放しないよう、使い終わった曲をここに置く

    // オーディオスレッドだけが触る
    std::shared_ptr<Song> current;
    bool playing = false;
    juce::int64 pos = 0;          // 曲の頭からのサンプル数（カウントイン中は負）
    size_t nextNote = 0, nextDrum = 0;
    std::array<DrumVoice, maxDrumVoices> drumVoices {};

    std::atomic<int> positionSession { -1 };
    std::atomic<double> positionSeconds { 0.0 };
    std::atomic<bool> positionPlaying { false };
};
