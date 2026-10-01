#pragma once

#include <juce_core/juce_core.h>
#include <optional>
#include <vector>

// WebView に埋め込みの UI ファイルを渡す（ChordNavi・ChordSketch で共通）。
// juce_add_binary_data で埋め込んだファイルを、URL のファイル名（basename）で引く。
// フォルダは見ないので、同じ製品に同じ名前のファイルを 2 つ入れない（CMake の ranze_check_unique_names で確かめる）
namespace WebResources
{
    // 製品ごとの埋め込みデータ（BinaryData の namedResourceList・originalFilenames・getNamedResource）
    struct Table
    {
        int size = 0;
        const char* const* names = nullptr;
        const char* const* originalFilenames = nullptr;
        const char* (*getNamedResource) (const char*, int&) = nullptr;
    };

    struct File
    {
        std::vector<std::byte> bytes;
        juce::String mimeType;
    };

    juce::String mimeTypeFor (const juce::String& fileName);

    // "/shared/ui/theory.js?x=1" → theory.js。空（"/"）なら index.html。見つからなければ nullopt
    std::optional<File> serve (const Table& table, const juce::String& urlPath);
}
