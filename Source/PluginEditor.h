#pragma once

#include "PluginProcessor.h"
#include <juce_gui_extra/juce_gui_extra.h>

// ResourceProvider 以外への遷移をブロックする WebView
class GodokenWebView : public juce::WebBrowserComponent
{
public:
    using juce::WebBrowserComponent::WebBrowserComponent;

    bool pageAboutToLoad (const juce::String& newURL) override
    {
        return newURL.startsWith (juce::WebBrowserComponent::getResourceProviderRoot());
    }
};

class GodokenEditor : public juce::AudioProcessorEditor,
                      public juce::DragAndDropContainer,
                      private juce::Timer,
                      private juce::ChangeListener
{
public:
    static constexpr int baseWidth  = 1280;
    static constexpr int baseHeight = 780;

    explicit GodokenEditor (GodokenProcessor&);
    ~GodokenEditor() override;

    void resized() override;

private:
    std::optional<juce::WebBrowserComponent::Resource> serveResource (const juce::String& urlPath);

    // JS: startMidiDrag({ name, bpm, chords: [{ root, iv: [...] }] })
    void startMidiDrag (const juce::Array<juce::var>& args,
                        juce::WebBrowserComponent::NativeFunctionCompletion completion);

    // JS: saveMidi({ name, bpm, chords }) — ネイティブの保存ダイアログで .mid を保存
    void saveMidi (const juce::Array<juce::var>& args,
                   juce::WebBrowserComponent::NativeFunctionCompletion completion);

    // JS: playChords({ chords: [{ root, iv, bass?, start, dur }], timbre }) — 各コードを start 秒後に dur 秒鳴らす。
    // 呼ぶたびにそれまでの試聴は止める
    void playChords (const juce::Array<juce::var>& args,
                     juce::WebBrowserComponent::NativeFunctionCompletion completion);

    // JS: playNotes({ notes: [midi...], dur, timbre }) — 鍵盤・指板のクリック。他の試聴は止めない
    void playNotes (const juce::Array<juce::var>& args,
                    juce::WebBrowserComponent::NativeFunctionCompletion completion);

    // DAW が状態を復元したら JS へ "stateRestored" イベントで送る
    void changeListenerCallback (juce::ChangeBroadcaster*) override;

    // DAW のテンポが変わったら "hostTempo"、MIDI 入力の音が変わったら "midiNotes" を JS へ送る
    void timerCallback() override;
    juce::var hostInfo() const;
    double lastSentBpm = -1.0;
    std::vector<int> lastSentLiveNotes;

    GodokenProcessor& processorRef;
    std::unique_ptr<juce::FileChooser> fileChooser;
    GodokenWebView webView;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (GodokenEditor)
};
