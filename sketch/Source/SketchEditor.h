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
                     public juce::DragAndDropContainer,
                     private juce::Timer
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

    // 曲ファイル（.chordsketch。中身は JS が作る JSON）：
    //   songOpen() → { path, name, text }・songSaveAs({ name, text, path }) → { path, name }（どちらも取り消しは "cancelled"）
    //   songWrite({ path, text }) → true/false（上書き保存）
    void songOpen (juce::WebBrowserComponent::NativeFunctionCompletion completion);
    void songSaveAs (const juce::Array<juce::var>& args, juce::WebBrowserComponent::NativeFunctionCompletion completion);

    // JS: printPage({ title }) — コード譜を印刷（macOS の印刷画面。@media print の見た目）
        std::unique_ptr<juce::FileChooser> fileChooser;

    // 試聴（JS の player.js から）：
    //   songPlay({ notes:[開始秒, 長さ秒, 音, 強さ0〜1, …], melody:[同じ], drums:[開始秒, 種類, …], length, leadIn, loop, timbre, melodyTimbre, session })
    //   songUpdate({ …同じ（leadIn は使わない）})・songStop()・previewNotes({ notes, dur, timbre })・setMute(bool)・setTimbre(name)
    // 再生位置は "songPos" { session, seconds, playing }、押している鍵盤は "midiNotes" { notes } で 30Hz で JS に送る。
    // 録音（setRecording(bool)）中に弾いた鍵盤は "recNotes" { events:[session, 秒, 音, 強さ, 押した1/離した0, …] }
    void timerCallback() override;
    SongPlayer::Position lastSentPosition { -2, 0.0, false };
    // JS が takeOpenFiles() を呼んだら true（それより前に開いたファイルは、そのときにまとめて返す）。
    // その後に届いたファイルは "openFiles" [{ path, name, text }] で送る
    bool pageReady = false;
    std::vector<int> lastSentNotes;
    std::vector<SketchProcessor::RecEvent> recBuffer;   // 録音の出来事（タイマーで取り出して "recNotes" で送る）

    SketchProcessor& processorRef;
    SketchWebView webView;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (SketchEditor)
};
