#pragma once

#include <juce_audio_processors/juce_audio_processors.h>

// ChordSketch の本体（Standalone のみ）。今は無音を出すだけ。
// 試聴（C++ のシンセ）・MIDI 入力の表示は、JUCE 化の 4〜5 で PreviewSynth などとつなぐ
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

    // 画面の状態（JSON）を預かる（ChordNavi と同じ PluginState の形で保存）
    void getStateInformation (juce::MemoryBlock&) override;
    void setStateInformation (const void*, int) override;
    void setUiState (const juce::String& json);
    juce::String getUiState() const;

private:
    mutable juce::CriticalSection stateLock;
    juce::String uiState;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (SketchProcessor)
};
