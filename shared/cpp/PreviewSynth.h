#pragma once

#include <juce_audio_basics/juce_audio_basics.h>
#include <array>
#include <atomic>
#include <vector>

// 試聴用の簡易シンセ。三角波はプロトタイプの playChord() と同じ音色・エンベロープ。
// queue() はメッセージスレッド、render() はオーディオスレッドから呼ぶ（ロックフリーの単一生産者・単一消費者）
class PreviewSynth
{
public:
    // lead は ChordSketch のメロディー向け（最後に足したので、ほかの番号は変わらない）
    enum class Timbre { triangle, piano, electricPiano, guitar, organ, pad, lead };

    static constexpr int maxNotesPerChord = 8;
    static constexpr int maxVoices        = 64;
    static constexpr int maxScheduled     = 128;   // 鳴る前の予約（コード単位。ボイスは鳴り始めるときに割り当てる）
    static constexpr int maxPartials      = 8;
    static constexpr float peakGain       = 0.12f;
    static constexpr double attackSeconds = 0.02;
    static constexpr double fadeSeconds   = 0.01;   // 停止時のフェードアウト
    static constexpr double strumSeconds  = 0.012;  // ギターの弦ごとのずれ

    void prepare (double sampleRate);

    // MIDI ノート番号のリストを、delaySeconds 後に durationSeconds の長さで鳴らす。
    // stopOthers なら、それまで鳴っている音・予約中の音を止めてから鳴らす。キューが満杯なら false
    bool queue (const std::vector<int>& notes, double delaySeconds, double durationSeconds,
                Timbre timbre = Timbre::triangle, bool stopOthers = false);

    // 鳴っている音をフェードアウトし、予約中の音を取り消す
    bool stopAll();

    // 進行の試聴。session は JS が付ける番号で、何番目のコードが鳴っているかを getPosition() で返すのに使う。
    // append なら、予約済みの進行の終わりにすき間なく続ける（ループ）。そうでなければ他の試聴を止めてから鳴らす
    struct ChordEvent
    {
        std::vector<int> notes;
        double startSeconds = 0, durationSeconds = 0;
    };
    bool queueProgression (const std::vector<ChordEvent>& chords, Timbre timbre, int session, bool append);

    // 今鳴っている進行のコード（オーディオの時計で更新する。どのスレッドから読んでもよい）
    struct Position
    {
        int session = -1;     // 最後に鳴り始めたコードの session
        int index = -1;       // そのコードの番号（止めたら -1）
        bool playing = false; // 進行の最後のコードが鳴り終わるまで true

        bool operator== (const Position& o) const { return session == o.session && index == o.index && playing == o.playing; }
        bool operator!= (const Position& o) const { return ! (*this == o); }
    };
    Position getPosition() const;

    // MIDI キーボードからの演奏（オーディオスレッドから呼ぶ）。離すまで鳴らし続け、離したらリリース
    void noteOn (int note, float velocity, Timbre timbre);
    void noteOff (int note);
    void allNotesOff();

    // 曲の試聴（ChordSketch の SongPlayer）用。オーディオスレッドから、次の render() の前に呼ぶ。
    // 次の render() の startIn サンプル目から length サンプル鳴らす（その後リリース）。owner は止めるときの印（0 以外）
    void startNote (int note, float velocity, juce::int64 startIn, juce::int64 length, Timbre timbre, int owner);
    // owner の音をフェードで止める（まだ鳴っていない音は取り消し）。オーディオスレッドから呼ぶ
    void fadeOwner (int owner);

    // バッファを上書きで書き込む（全チャンネル同じ信号）
    void render (juce::AudioBuffer<float>& buffer);

    // 鳴っているボイスと、予約中の音の数
    int getNumActiveVoices() const;

private:
    struct Request
    {
        std::array<int, maxNotesPerChord> notes {};
        int numNotes = 0;
        double delaySeconds = 0, durationSeconds = 0;
        Timbre timbre = Timbre::triangle;
        bool stopOthers = false;
        bool groupStart = true;   // 時刻の基準を決め直す（queue() は毎回、進行は先頭のコードだけ）
        bool append = false;      // 基準を「予約済みの進行の終わり」にする
        int session = -1, tag = -1;   // 進行のコード（tag はコードの番号）。単体の試聴は -1
    };

    struct Scheduled
    {
        Request request;
        juce::int64 at = 0;       // 鳴り始める時刻（clock と同じ、サンプル数）
    };

    struct Voice
    {
        bool active = false;
        Timbre timbre = Timbre::triangle;
        int midiNote = -1;            // MIDI 入力で鳴らしている音（試聴は -1）
        int owner = 0;                // startNote() で鳴らした音の印（0 は それ以外）
        bool liveRelease = false;     // 三角波を離したときもリリースで消す
        float velGain = 1.0f;
        juce::int64 startIn = 0;      // 鳴り始めまでのサンプル数
        juce::int64 age = 0;          // 鳴り始めてからのサンプル数
        juce::int64 length = 0;       // 押さえている長さ（この後リリース）
        juce::int64 fadeLeft = -1;    // 停止フェード中の残りサンプル（-1 はフェードなし）
        float gain = 0;               // 三角波・エレピの振幅
        float decayRate = 1.0f;       // 1サンプルあたりの減衰倍率
        float releaseRate = 1.0f;     // リリース中の減衰倍率
        float release = 1.0f;         // リリースの現在値

        double phase = 0, phaseInc = 0;               // 三角波・エレピのキャリア
        double modPhase = 0;                          // エレピのモジュレータ
        float modIndex = 0, modIndexDecay = 1.0f;

        std::array<double, maxPartials> pPhase {}, pInc {};   // ピアノ・オルガンの倍音
        std::array<float, maxPartials> pAmp {}, pDecay {};
        int numPartials = 0;
        juce::int64 attackSamples = 0;

        double phase2 = 0, phaseInc2 = 0;             // パッドの2本目（デチューン）
        float lpState = 0, lpCoeff = 1.0f;

        std::vector<float> delay;     // ギター（Karplus-Strong）の遅延線。prepare() で確保
        int writePos = 0, delayInt = 0;
        float delayFrac = 0, loss = 1.0f, prevTap = 0;
    };

    void handleRequest (const Request&);
    void startDue (juce::int64 now);
    void renderVoices (float* out, int from, int to);
    void startVoice (Voice&, int note, juce::int64 startIn, juce::int64 length, Timbre, double decayHintSeconds = 0);
    Voice& findFreeVoice();
    float renderSample (Voice&);

    double sampleRate = 44100.0;
    std::array<Voice, maxVoices> voices {};
    juce::Random random;

    juce::AbstractFifo fifo { 128 };
    std::array<Request, 128> requests {};

    // ここから下はオーディオスレッドだけが触る（position* は公開用）
    std::array<Scheduled, maxScheduled> scheduled {};
    int numScheduled = 0;
    juce::int64 clock = 0;          // render() で進めたサンプル数
    juce::int64 groupBase = 0;      // 今の予約グループの時刻の基準
    juce::int64 progressionEnd = 0; // 予約済みの進行が鳴り終わる時刻
    int lastSession = -1, lastIndex = -1;

    std::atomic<int> positionSession { -1 }, positionIndex { -1 };
    std::atomic<bool> positionPlaying { false };
};
