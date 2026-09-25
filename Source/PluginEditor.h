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
                      public juce::DragAndDropContainer
{
public:
    static constexpr int baseWidth  = 1280;
    static constexpr int baseHeight = 780;

    explicit GodokenEditor (GodokenProcessor&);
    ~GodokenEditor() override = default;

    void resized() override;

private:
    std::optional<juce::WebBrowserComponent::Resource> serveResource (const juce::String& urlPath);

    // JS: startMidiDrag({ name, bpm, chords: [{ root, iv: [...] }] })
    void startMidiDrag (const juce::Array<juce::var>& args,
                        juce::WebBrowserComponent::NativeFunctionCompletion completion);

    GodokenWebView webView;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (GodokenEditor)
};
