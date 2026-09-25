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
    bool acceptsMidi() const override { return true; }   // 音源（aumu）は MIDI 入力が必須。受けた MIDI は今は使わない
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

    // MIDI 入力で鳴っている音（押している音＋サステインペダルで伸ばしている音）。UI の表示用
    std::vector<int> getLiveNotes() const;
    // MIDI 入力を鳴らす音色（UI の音色メニューと同じ）
    void setLiveTimbre (PreviewSynth::Timbre t) { liveTimbre.store ((int) t); }

    // DAW のテンポ（取得できていなければ 0）。Standalone では常に 0
    double getHostBpm() const { return hostBpm.load(); }
    bool isStandalone() const { return wrapperType == wrapperType_Standalone; }

private:
    std::atomic<double> hostBpm { 0.0 };

    // MIDI 入力の状態（オーディオスレッドだけが書く。表示用の liveMask は UI から読む）
    std::array<bool, 128> keyDown {}, sustained {};
    bool sustainPedal = false;
    std::array<std::atomic<juce::uint64>, 2> liveMask {};
    std::atomic<int> liveTimbre { (int) PreviewSynth::Timbre::organ };
    void handleMidi (const juce::MidiMessage&);

    juce::CriticalSection stateLock;   // get/setStateInformation はメッセージスレッド以外から呼ばれることがある
    juce::String uiState;

    PreviewSynth previewSynth;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (GodokenProcessor)
};
