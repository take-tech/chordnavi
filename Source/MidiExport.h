#pragma once

#include <juce_core/juce_core.h>
#include <vector>

// コード列 → SMF（フォーマット0）生成。仕様は CLAUDE.md「MIDI 仕様」とプロトタイプの buildMidi() に準拠。
namespace MidiExport
{
    constexpr int ppq      = 480;
    constexpr int barTicks = ppq * 4;   // 4/4。既定は 1コード＝1小節
    constexpr int velocity = 90;
    constexpr double minBpm = 20.0;    // UI の入力は 40〜240。DAW 同期ではその外も来るので広めに受ける
    constexpr double maxBpm = 300.0;

    struct Chord
    {
        int root = 0;                 // ピッチクラス 0〜11
        std::vector<int> intervals;   // ルートからの半音数（例：M7 = 0,4,7,11）
        int bass = -1;                // 分数コードのベース（ピッチクラス）。-1 ならルート
        int beats = 4;                // 長さ（拍）。1小節に2コードなら 2
    };

    // ベース＝ルート（分数コードは指定音）を C2〜B2、上声＝ルートを C3〜B3 に置いてコードトーンを積む
    std::vector<int> voicing (const Chord& chord);

    juce::MemoryBlock buildMidi (const std::vector<Chord>& chords, double bpm);

    // ♯→#、♭→b に置換し、ファイル名に使えない文字を _ にする（プロトタイプの safe() と同じ）
    juce::String safeFileName (const juce::String& name);

    // 一時フォルダに <safeName>.mid を書き出して返す。失敗時は存在しない File を返す
    juce::File writeTempFile (const std::vector<Chord>& chords, double bpm, const juce::String& name);
}
