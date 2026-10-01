#pragma once

#include <juce_audio_processors/juce_audio_processors.h>
#include "PreviewSynth.h"
#include "SongPlayer.h"
#include <array>
#include <atomic>

// ChordSketch の本体（Standalone のみ）。試聴（曲は SongPlayer、単発のコードと MIDI 鍵盤は PreviewSynth）を鳴らす。
// 選んだオーディオ出力から鳴る（「オプション → オーディオ／MIDI の設定」）
class SketchProcessor : public juce::AudioProcessor
{
public:
    SketchProcessor();

    void prepareToPlay (double sampleRate, int samplesPerBlock) override;
    void releaseResources() override {}
    bool isBusesLayoutSupported (const BusesLayout&) const override;
    void processBlock (juce::AudioBuffer<float>&, juce::MidiBuffer&) override;

    juce::AudioProcessorEditor* createEditor() override;
    bool hasEditor() const override { return true; }

    const juce::String getName() const override { return JucePlugin_Name; }
    bool acceptsMidi() const override  { return true; }
    bool producesMidi() const override { return false; }
    bool isMidiEffect() const override { return false; }
    double getTailLengthSeconds() const override { return 0.0; }

    int getNumPrograms() override { return 1; }
    int getCurrentProgram() override { return 0; }
    void setCurrentProgram (int) override {}
    const juce::String getProgramName (int) override { return {}; }
    void changeProgramName (int, const juce::String&) override {}

    PreviewSynth& getSynth() { return synth; }
    SongPlayer& getSongPlayer() { return songPlayer; }

    // 押している鍵盤（ペダルで伸ばしている音は含めない。コード判別・ステップ入力用）
    std::vector<int> getHeldNotes() const;
    void setMuted (bool m) { muted.store (m); }
    void setLiveTimbre (PreviewSynth::Timbre t) { liveTimbre.store ((int) t); }

    // 画面の状態（JSON）を預かる（ChordNavi と同じ PluginState の形で保存）
    void getStateInformation (juce::MemoryBlock&) override;
    void setStateInformation (const void*, int) override;
    void setUiState (const juce::String& json);
    juce::String getUiState() const;

    // リアルタイム録音（メロディー）：録音中で曲を再生しているあいだ、鍵盤を押した・離した時刻（曲の位置の秒。カウントイン中は負）を記録する。
    // オーディオスレッドが書き、メッセージスレッドが takeRecEvents で取り出す（ロックフリーの単一生産者・単一消費者）。サステインペダルは見ない
    struct RecEvent { int session = -1; double seconds = 0; int note = 60; int velocity = 0; bool on = false; };
    void setRecording (bool r) { recording.store (r); }
    void takeRecEvents (std::vector<RecEvent>& out);

    // Finder・エクスプローラーから開いた曲ファイル（メッセージスレッドだけで使う）。
    // アプリが受け取って入れ、画面の準備ができたらエディタが取り出して JS に渡す
    void queueOpenFiles (const juce::StringArray& paths) { pendingOpenFiles.addArray (paths); }
    juce::StringArray takeOpenFiles() { auto out = pendingOpenFiles; pendingOpenFiles.clear(); return out; }

private:
    void handleMidi (const juce::MidiMessage&);

    PreviewSynth synth;
    SongPlayer songPlayer;

    // MIDI 入力の状態（オーディオスレッドだけが書く。heldMask は UI から読む）。ChordNavi の GodokenProcessor と同じ
    std::array<bool, 128> keyDown {}, sustained {};
    bool sustainPedal = false;
    std::array<std::atomic<juce::uint64>, 2> heldMask {};
    std::atomic<int> liveTimbre { (int) PreviewSynth::Timbre::piano };
    std::atomic<bool> muted { false };

    mutable juce::CriticalSection stateLock;
    juce::String uiState;
    juce::StringArray pendingOpenFiles;

    std::atomic<bool> recording { false };
    juce::AbstractFifo recFifo { 1024 };
    std::array<RecEvent, 1024> recEvents {};

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (SketchProcessor)
};
