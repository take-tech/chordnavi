#pragma once

#include <juce_audio_processors/juce_audio_processors.h>
#include "PreviewSynth.h"

// setStateInformation で状態が差し替わったら ChangeBroadcaster で開いているエディタへ知らせる
class GodokenProcessor : public juce::AudioProcessor,
                         public juce::ChangeBroadcaster
{
public:
    GodokenProcessor();
    ~GodokenProcessor() override = default;

    void prepareToPlay (double sampleRate, int samplesPerBlock) override;
    void releaseResources() override {}
    bool isBusesLayoutSupported (const BusesLayout& layouts) const override;
    void processBlock (juce::AudioBuffer<float>&, juce::MidiBuffer&) override;
    using AudioProcessor::processBlock;

    juce::AudioProcessorEditor* createEditor() override;
    bool hasEditor() const override { return true; }

    const juce::String getName() const override { return JucePlugin_Name; }
    bool acceptsMidi() const override { return false; }
    bool producesMidi() const override { return false; }
    bool isMidiEffect() const override { return false; }
    double getTailLengthSeconds() const override { return 0.0; }

    int getNumPrograms() override { return 1; }
    int getCurrentProgram() override { return 0; }
    void setCurrentProgram (int) override {}
    const juce::String getProgramName (int) override { return {}; }
    void changeProgramName (int, const juce::String&) override {}

    void getStateInformation (juce::MemoryBlock&) override;
    void setStateInformation (const void*, int) override;

    // UI の状態（JSON 文字列）。UI が変わるたびにエディタから送られる
    void setUiState (const juce::String& json);
    juce::String getUiState() const;

    // 試聴（メッセージスレッドから呼ぶ）
    PreviewSynth& getPreviewSynth() { return previewSynth; }

    // DAW のテンポ（取得できていなければ 0）。Standalone では常に 0
    double getHostBpm() const { return hostBpm.load(); }
    bool isStandalone() const { return wrapperType == wrapperType_Standalone; }

private:
    std::atomic<double> hostBpm { 0.0 };

    juce::CriticalSection stateLock;   // get/setStateInformation はメッセージスレッド以外から呼ばれることがある
    juce::String uiState;

    PreviewSynth previewSynth;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (GodokenProcessor)
};
