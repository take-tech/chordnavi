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
    static constexpr int maxWidth   = baseWidth * 2;
    static constexpr int maxHeight  = baseHeight * 3;   // 縦長にしてシートを広げられるように

    explicit SketchEditor (SketchProcessor&);
    ~SketchEditor() override = default;

    void resized() override;
    void parentHierarchyChanged() override { updateZoom(); }

private:
    // WebView のページのズームをウィンドウの大きさに合わせる（macOS。文字がにじまないように）
    void updateZoom();

    juce::WebBrowserComponent::Options makeOptions();

    // JS: startMidiDragBytes({ name, data }) — data は SMF の base64（JS の song.js が作る）。
    // 一時ファイルに書いて、マウスボタンが押されたままのこのタイミングで OS のファイルドラッグを始める
    void startMidiDragBytes (const juce::Array<juce::var>& args,
                             juce::WebBrowserComponent::NativeFunctionCompletion completion);

    // JS: saveMidiBytes({ name, data }) — 保存ダイアログで .mid を保存（拡張子が無ければ付ける）
    void saveMidiBytes (const juce::Array<juce::var>& args,
                        juce::WebBrowserComponent::NativeFunctionCompletion completion);

    std::unique_ptr<juce::FileChooser> fileChooser;

    SketchProcessor& processorRef;
    SketchWebView webView;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (SketchEditor)
};
