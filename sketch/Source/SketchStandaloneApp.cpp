// ChordSketch の Standalone アプリ本体（JUCE 標準の StandaloneFilterApp の代わり。ChordNavi の Source/StandaloneApp.cpp と同じ作り）。
// ・macOS 標準のタイトルバー（左上の信号機ボタン）を使う
// ・画面上部のメニューバーに「オプション → オーディオ／MIDI の設定…」。テーマ・曲ファイルの保存／開くは画面の中にある
// CMake で JUCE_USE_CUSTOM_PLUGIN_STANDALONE_APP=1 を定義している

#include <juce_audio_utils/juce_audio_utils.h>

#if JucePlugin_Build_Standalone && JUCE_USE_CUSTOM_PLUGIN_STANDALONE_APP

#include <juce_audio_plugin_client/Standalone/juce_StandaloneFilterWindow.h>
#include "SketchEditor.h"

namespace
{
using namespace juce;

// コマンドライン（Windows のダブルクリック・macOS の「開く」。空白を含むパスは "" で囲まれる）から曲ファイルを取り出す
StringArray songFilesIn (const String& commandLine)
{
    StringArray out;
    for (auto token : StringArray::fromTokens (commandLine, true))
    {
        token = token.unquoted();
        if (File::isAbsolutePath (token))
            if (const File f (token); f.existsAsFile() && (f.hasFileExtension ("chordsketch") || f.hasFileExtension ("json")))
                out.add (f.getFullPathName());
    }
    return out;
}

//==============================================================================
// 縦横比・最小サイズを「中身（タイトルバーを除く）」に対してかける。
// ネイティブのタイトルバーでは checkBounds にタイトルバー込みの大きさが渡されるため
class ContentConstrainer final : public ComponentBoundsConstrainer
{
public:
    explicit ContentConstrainer (Component& windowToUse) : window (windowToUse) {}

    void checkBounds (Rectangle<int>& bounds, const Rectangle<int>& previousBounds, const Rectangle<int>& limits,
                      bool isStretchingTop, bool isStretchingLeft, bool isStretchingBottom, bool isStretchingRight) override
    {
        BorderSize<int> frame;
        if (auto* peer = window.getPeer())
            if (const auto size = peer->getFrameSizeIfPresent())
                frame = *size;

        // Windows ではウィンドウ内のメニューバーの分も除く
        if (auto* rw = dynamic_cast<ResizableWindow*> (&window))
            frame = BorderSize<int> (frame.getTop() + rw->getContentComponentBorder().getTop(), frame.getLeft(),
                                     frame.getBottom(), frame.getRight());

        auto content = frame.subtractedFrom (bounds);
        ComponentBoundsConstrainer::checkBounds (content, frame.subtractedFrom (previousBounds), limits,
                                                 isStretchingTop, isStretchingLeft, isStretchingBottom, isStretchingRight);
        bounds = frame.addedTo (content);
    }

private:
    Component& window;
};

//==============================================================================
class MainWindow final : public DocumentWindow
{
public:
    MainWindow (const String& name, StandalonePluginHolder& holderToUse)
        : DocumentWindow (name, Colour (0xffE7EAF0), DocumentWindow::allButtons),
          holder (holderToUse)
    {
        setUsingNativeTitleBar (true);
        setResizable (true, false);

        // エディタと同じ最小・最大サイズ（縦横比は固定しない。ネイティブのタイトルバーは大きさに含まれない）
        constrainer.setMinimumSize (960, 585);
        constrainer.setMaximumSize (SketchEditor::maxWidth, SketchEditor::maxHeight);
        setConstrainer (&constrainer);

        updateContent();
    }

    ~MainWindow() override
    {
        clearContentComponent();
    }

    void updateContent()
    {
        if (auto* editor = holder.processor->createEditorAndMakeActive())
            setContentOwned (editor, true);
    }

    void closeButtonPressed() override
    {
        JUCEApplication::getInstance()->systemRequestedQuit();
    }

private:
    StandalonePluginHolder& holder;
    ContentConstrainer constrainer { *this };

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (MainWindow)
};

//==============================================================================
// 画面上部のメニューバー：「オプション」メニュー（オーディオ／MIDI の設定）
class OptionsMenu final : public MenuBarModel
{
public:
    enum Item { audioSettings = 1 };

    std::function<void (int)> onItem;

    StringArray getMenuBarNames() override { return { String::fromUTF8 ("オプション") }; }

    PopupMenu getMenuForIndex (int, const String&) override
    {
        PopupMenu m;
        m.addItem (audioSettings, String::fromUTF8 ("オーディオ／MIDI の設定…"));
        return m;
    }

    void menuItemSelected (int itemId, int) override
    {
        if (onItem != nullptr)
            onItem (itemId);
    }
};

//==============================================================================
class ChordSketchStandaloneApp final : public JUCEApplication
{
public:
    ChordSketchStandaloneApp()
    {
        // JUCE 標準の Standalone と同じ保存場所（~/Library/Application Support/ChordSketch.settings）
        PropertiesFile::Options options;
        options.applicationName     = CharPointer_UTF8 (JucePlugin_Name);
        options.filenameSuffix      = ".settings";
        options.osxLibrarySubFolder = "Application Support";
        options.folderName          = "";
        appProperties.setStorageParameters (options);
    }

    const String getApplicationName() override           { return CharPointer_UTF8 (JucePlugin_Name); }
    const String getApplicationVersion() override        { return JucePlugin_VersionString; }
    bool moreThanOneInstanceAllowed() override           { return false; }

    // Finder でダブルクリック（macOS）、起動中にもう一度起動（Windows）：曲ファイルを新しいタブで開く
    void anotherInstanceStarted (const String& commandLine) override
    {
        openSongFiles (songFilesIn (commandLine));
        if (window != nullptr)
            window->toFront (true);
    }

    void openSongFiles (const StringArray& paths)
    {
        if (paths.isEmpty())
            return;
        if (auto* processor = holder != nullptr ? dynamic_cast<SketchProcessor*> (holder->processor.get()) : nullptr)
            processor->queueOpenFiles (paths);
        else
            pendingFiles.addArray (paths);   // まだ起動の途中
    }

    void initialise (const String& commandLine) override
    {
        // MIDI キーボードをつないだらすぐ使えるよう、MIDI 入力は自動で開く
        holder = std::make_unique<StandalonePluginHolder> (appProperties.getUserSettings(), false, String{}, nullptr,
                                                           Array<StandalonePluginHolder::PluginInOuts>{}, true);

        pendingFiles.addArray (songFilesIn (commandLine));   // Windows：ダブルクリックで起動したときのファイル
        openSongFiles (std::exchange (pendingFiles, {}));

        window = std::make_unique<MainWindow> (getApplicationName(), *holder);
        window->setVisible (true);
        // 画面に出した直後にネイティブのタイトルバーの分だけ中身が縮むので、中身を基準サイズに合わせ直す
        window->centreWithSize (SketchEditor::baseWidth, SketchEditor::baseHeight);

        menu.onItem = [this] (int item)
        {
            if (item == OptionsMenu::audioSettings)
                holder->showAudioSettingsDialog();
        };

       #if JUCE_MAC
        MenuBarModel::setMacMainMenu (&menu);
       #else
        // Windows：ウィンドウ上部のメニューバーに「オプション」を出す
        window->setMenuBar (&menu);
        window->centreWithSize (SketchEditor::baseWidth, SketchEditor::baseHeight + window->getContentComponentBorder().getTop());
       #endif
    }

    void shutdown() override
    {
       #if JUCE_MAC
        MenuBarModel::setMacMainMenu (nullptr);
       #else
        if (window != nullptr)
            window->setMenuBar (nullptr);
       #endif
        window = nullptr;
        holder = nullptr;
        appProperties.saveIfNeeded();
    }

    void systemRequestedQuit() override
    {
        if (holder != nullptr)
            holder->savePluginState();

        if (ModalComponentManager::getInstance()->cancelAllModalComponents())
        {
            Timer::callAfterDelay (100, []
            {
                if (auto* app = JUCEApplicationBase::getInstance())
                    app->systemRequestedQuit();
            });
        }
        else
        {
            quit();
        }
    }

private:
    ApplicationProperties appProperties;
    std::unique_ptr<StandalonePluginHolder> holder;
    std::unique_ptr<MainWindow> window;
    OptionsMenu menu;
    StringArray pendingFiles;
};
}

juce::JUCEApplicationBase* juce_CreateApplication();
juce::JUCEApplicationBase* juce_CreateApplication() { return new ChordSketchStandaloneApp(); }

#endif
