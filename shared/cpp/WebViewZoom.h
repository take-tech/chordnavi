#pragma once

#include <juce_gui_basics/juce_gui_basics.h>

// WebView のページのズーム（ChordNavi・ChordSketch で共通。macOS のみ、ほかは何もしない）。
// UI は 1280×780 の固定の画面を CSS で拡大縮小しているが、WKWebView では倍率が 1 でないと文字がにじむ。
// そこで WKWebView の pageZoom をウィンドウの大きさに合わせ、画面側からはいつも基準の大きさに見えるようにする
// （文字は WebView がその大きさで描くのでにじまない。座標の計算も変わらない）
namespace WebViewZoom
{
   #if JUCE_MAC
    // component のウィンドウの中の WKWebView の pageZoom を zoom にする（まだ画面に出ていなければ何もしない）
    void apply (juce::Component& component, double zoom);
   #else
    inline void apply (juce::Component&, double) {}
   #endif
}
