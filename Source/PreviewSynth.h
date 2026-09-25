#pragma once

#include <juce_audio_basics/juce_audio_basics.h>
#include <array>
#include <vector>

// 試聴用の簡易シンセ。三角波はプロトタイプの playChord() と同じ音色・エンベロープ。
// queue() はメッセージスレッド、render() はオーディオスレッドから呼ぶ（ロックフリーの単一生産者・単一消費者）
class PreviewSynth
{
public:
    enum class Timbre { triangle, piano, electricPiano, guitar, organ, pad };

    static constexpr int maxNotesPerChord = 8;
    static constexpr int maxVoices        = 64;
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

    // バッファを上書きで書き込む（全チャンネル同じ信号）
    void render (juce::AudioBuffer<float>& buffer);

    int getNumActiveVoices() const;

private:
    struct Request
    {
        std::array<int, maxNotesPerChord> notes {};
        int numNotes = 0;
        double delaySeconds = 0, durationSeconds = 0;
        Timbre timbre = Timbre::triangle;
        bool stopOthers = false;
    };

    struct Voice
    {
        bool active = false;
        Timbre timbre = Timbre::triangle;
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
    void startVoice (Voice&, int note, juce::int64 startIn, juce::int64 length, Timbre);
    Voice& findFreeVoice();
    float renderSample (Voice&);

    double sampleRate = 44100.0;
    std::array<Voice, maxVoices> voices {};
    juce::Random random;

    juce::AbstractFifo fifo { 64 };
    std::array<Request, 64> requests {};
};
