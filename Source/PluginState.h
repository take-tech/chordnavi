#pragma once

#include <juce_data_structures/juce_data_structures.h>

// プラグインの保存データ。UI の状態（JSON 文字列）をそのまま持つ。
// 形式：ValueTree「GodokenState」（version, ui）を ValueTree のバイナリ形式で書き出したもの
namespace PluginState
{
    constexpr int version = 1;

    juce::MemoryBlock serialise (const juce::String& uiJson);

    // 壊れている・別のデータなら空文字列
    juce::String deserialise (const void* data, int sizeInBytes);
}
