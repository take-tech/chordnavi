#pragma once

#include "SketchProcessor.h"
#include <juce_gui_extra/juce_gui_extra.h>

// 埋め込みの UI（ResourceProvider）以外への遷移をブロックする WebView
class SketchWebView : public juce::WebBrowserComponent
{
public:
    using juce::WebBrowserComponent::WebBrowserComponent;

    bool pageAboutToLoad (const juce::String& newURL) override
    {
        return newURL.startsWith (juce::WebBrowserComponent::getResourceProviderRoot());
    }
};

// ChordSketch の画面：sketch/prototype の UI を WebView で表示する。
// ネイティブ関数（MIDI ドラッグ・保存・試聴など）は JUCE 化の 3 以降で足す
class SketchEditor : public juce::AudioProcessorEditor,
                     public juce::DragAndDropContainer
{
public:
    static constexpr int baseWidth  = 1280;
    static constexpr int baseHeight = 780;

    explicit SketchEditor (SketchProcessor&);
    ~SketchEditor() override = default;

    void resized() override;
    void parentHierarchyChanged() override { updateZoom(); }

private:
    // WebView のページのズームをウィンドウの大きさに合わせる（macOS。文字がにじまないように）
    void updateZoom();

    SketchProcessor& processorRef;
    SketchWebView webView;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (SketchEditor)
};
