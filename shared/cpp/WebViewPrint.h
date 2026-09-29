#pragma once

#include <juce_gui_basics/juce_gui_basics.h>

// WebView のページを印刷する（macOS のみ。JUCE の WKWebView は JS の print() を扱わないので、ネイティブの印刷画面を出す）。
// 印刷されるのはページの @media print の見た目。印刷画面の「PDF として保存」で PDF にもできる
namespace WebViewPrint
{
   #if JUCE_MAC
    // component のウィンドウの中の WKWebView の印刷画面を、ウィンドウのシートとして出す。
    // jobTitle は PDF として保存するときの初期のファイル名。WebView が見つからなければ false
    bool run (juce::Component& component, const juce::String& jobTitle);
   #else
    inline bool run (juce::Component&, const juce::String&) { return false; }
   #endif
}
