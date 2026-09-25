#pragma once

#include <juce_audio_basics/juce_audio_basics.h>
#include <array>

// 試聴用の簡易シンセ（三角波＋エンベロープ）。音色・エンベロープはプロトタイプの playChord() と同じ。
// queue() はメッセージスレッド、render() はオーディオスレッドから呼ぶ（ロックフリーの単一生産者・単一消費者）
class PreviewSynth
{
public:
    static constexpr int maxNotesPerChord = 8;
    static constexpr int maxVoices        = 64;
    static constexpr float peakGain       = 0.12f;
    static constexpr double attackSeconds = 0.02;

    void prepare (double sampleRate);

    // MIDI ノート番号のリストを、delaySeconds 後に durationSeconds の長さで鳴らす。キューが満杯なら false
    bool queue (const std::vector<int>& notes, double delaySeconds, double durationSeconds);

    // バッファに加算せず上書きで書き込む（全チャンネル同じ信号）
    void render (juce::AudioBuffer<float>& buffer);

    int getNumActiveVoices() const;

private:
    struct Request
    {
        std::array<int, maxNotesPerChord> notes {};
        int numNotes = 0;
        double delaySeconds = 0, durationSeconds = 0;
    };

    struct Voice
    {
        bool active = false;
        double phase = 0, phaseInc = 0;
        juce::int64 startIn = 0;      // 鳴り始めまでのサンプル数
        juce::int64 age = 0;          // 鳴り始めてからのサンプル数
        juce::int64 length = 0;
        float decayRate = 1.0f;       // 1サンプルあたりの減衰倍率
        float gain = 0;
    };

    void startVoices (const Request&);

    double sampleRate = 44100.0;
    std::array<Voice, maxVoices> voices {};

    juce::AbstractFifo fifo { 64 };
    std::array<Request, 64> requests {};
};
