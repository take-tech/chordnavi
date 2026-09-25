# ChordNavi

ChordNavi は、五度圏・スケール・鍵盤・ギター指板・コード進行を1画面で確認し、コードや進行を **MIDI として DAW へドラッグ＆ドロップ**できるプラグインです。

![対応](https://img.shields.io/badge/macOS-11%2B-blue) ![形式](https://img.shields.io/badge/format-AU%20%7C%20VST3%20%7C%20Standalone-informational)

---

## 主な機能

| 機能 | 概要 |
|---|---|
| **五度圏** | クリックしたキーが上に来るよう回転。ダイアトニックの位置と度数を表示 |
| **鍵盤／五線譜** | 3オクターブの鍵盤と大譜表を切替。スケール音・コード構成音を色分け、押すと試聴 |
| **ギター指板** | 0〜15フレット。表示ルールは鍵盤と同じ、押すと試聴 |
| **スケール** | メジャー、各種マイナー、チャーチモード、ペンタ、ブルース、ホールトーン、ディミニッシュなど14種 |
| **ダイアトニックコード** | 4和音／3和音を切替。クリックで試聴、ドラッグで MIDI |
| **コード進行** | 王道・カノン・小室・丸サなど定番の進行と派生形、「その他」から追加の進行。ループ試聴、リズム½ |
| **コードの一時変更** | 進行のコードのルート・種類（7th・add9 など）を変更、1小節を2拍×2に分割・結合 |
| **コード判別** | 鍵盤・指板で音を選ぶとコード名の候補を表示（分数コード対応） |
| **MIDI 出力** | ドラッグ＆ドロップ、または「MIDI保存」。1コード＝1小節（分割時は2拍） |
| **試聴の音色** | シンプル／ピアノ／エレピ／ギター／オルガン／パッド |
| **テンポ** | DAW 上では DAW のテンポに同期（切替可） |

---

## 対応環境

- macOS 11 以降（Apple Silicon／Intel どちらも可）
- **AU**（Logic Pro、GarageBand など）
- **VST3**（Ableton Live、Cubase、Studio One、Bitwig、Reaper など）
- **Standalone**（DAW なしで単体起動）

---

## インストール

1. [Releases](../../releases) から `ChordNavi-<バージョン>-macOS.pkg` をダウンロードします。
2. `.pkg` を開いてインストールします。次の場所に入ります。
   - AU：`/Library/Audio/Plug-Ins/Components/ChordNavi.component`
   - VST3：`/Library/Audio/Plug-Ins/VST3/ChordNavi.vst3`
   - Standalone：`/Applications/ChordNavi.app`
3. DAW を起動し、プラグインを再スキャンします（Logic は起動時に自動で確認されます）。
4. **音源（インストゥルメント）** トラックに「ChordNavi」を挿します。

### 「開発元を確認できない」と表示されたとき

現在の配布版は Apple の公証を受けていないため、初回に警告が出ます。次のどちらかで一度だけ許可してください。

- `.pkg` を **右クリック（control＋クリック）→「開く」→「開く」**
- または、一度開こうとした後に **システム設定 →「プライバシーとセキュリティ」→「このまま開く」**

### アンインストール

次の3つを削除します。

```
/Library/Audio/Plug-Ins/Components/ChordNavi.component
/Library/Audio/Plug-Ins/VST3/ChordNavi.vst3
/Applications/ChordNavi.app
```

---

## 使い方のヒント

- コードのチップや「進行をドラッグ」を DAW の MIDI トラックへドラッグすると、MIDI クリップが置かれます。
- 試聴の音は、DAW がこのトラックの音声を処理しているときに鳴ります。鳴らないときはトラックを選択（録音待機）してください。
- 進行のチップをクリックすると、下のバーでルート・種類の変更や分割・結合ができます（一時的な変更で、進行を切り替えると元に戻ります）。

---

## ビルド方法（開発者向け）

必要なもの：CMake 3.22 以上、Xcode（コマンドラインツール）。JUCE 8 は CMake の FetchContent で自動取得します。

```bash
cmake -S . -B build-release -DCMAKE_BUILD_TYPE=Release
cmake --build build-release --config Release
./scripts/package_macos.sh          # build-release/packages/ に .pkg を作成
```

単体テスト：

```bash
cmake -S . -B build -DCMAKE_BUILD_TYPE=Debug
cmake --build build --target MidiExportTests
./build/MidiExportTests_artefacts/Debug/MidiExportTests
```

タグ `v*` を push すると GitHub Actions が `.pkg` をビルドして Release に添付します。

---

## ライセンス

JUCE 8 を使用しています。
