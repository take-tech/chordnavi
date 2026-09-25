// Standalone 版のアプリ本体（JUCE 標準の StandaloneFilterApp の代わり）。
// ・macOS 標準のタイトルバー（左上の信号機ボタン）を使う
// ・オプション（オーディオ設定・状態の保存／読み込み・初期化）は画面上部のメニューバーに置く
// CMake で JUCE_USE_CUSTOM_PLUGIN_STANDALONE_APP=1 を定義している。VST3／AU には影響しない。

#include <juce_audio_utils/juce_audio_utils.h>

#if JucePlugin_Build_Standalone && JUCE_USE_CUSTOM_PLUGIN_STANDALONE_APP

#include <juce_audio_plugin_client/Standalone/juce_StandaloneFilterWindow.h>
#include "PluginEditor.h"

namespace
{
using namespace juce;

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

        // エディタと同じ縦横比・最小サイズ（ネイティブのタイトルバーは大きさに含まれない）
        constrainer.setFixedAspectRatio ((double) GodokenEditor::baseWidth / (double) GodokenEditor::baseHeight);
        constrainer.setMinimumSize (960, 585);
        constrainer.setMaximumSize (GodokenEditor::baseWidth * 2, GodokenEditor::baseHeight * 2);
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

    void resetToDefaultState()
    {
        holder.stopPlaying();
        clearContentComponent();
        holder.deletePlugin();

        if (auto* props = holder.settings.get())
            props->removeValue ("filterState");

        holder.createPlugin();
        updateContent();
        holder.startPlaying();
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
// 画面上部のメニューバー：「オプション」メニュー
class OptionsMenu final : public MenuBarModel
{
public:
    enum Item
    {
        audioSettings = 1,
        saveState,
        loadState,
        resetState
    };

    std::function<void (int)> onItem;

    StringArray getMenuBarNames() override { return { String::fromUTF8 ("オプション") }; }

    PopupMenu getMenuForIndex (int, const String&) override
    {
        PopupMenu m;
        m.addItem (audioSettings, String::fromUTF8 ("オーディオ／MIDI の設定…"));
        m.addSeparator();
        m.addItem (saveState, String::fromUTF8 ("状態を保存…"));
        m.addItem (loadState, String::fromUTF8 ("状態を読み込む…"));
        m.addSeparator();
        m.addItem (resetState, String::fromUTF8 ("初期状態に戻す"));
        return m;
    }

    void menuItemSelected (int itemId, int) override
    {
        if (onItem != nullptr)
            onItem (itemId);
    }
};

//==============================================================================
class ChordNaviStandaloneApp final : public JUCEApplication
{
public:
    ChordNaviStandaloneApp()
    {
        // JUCE 標準の Standalone と同じ保存場所（~/Library/Application Support/ChordNavi.settings）
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
    void anotherInstanceStarted (const String&) override {}

    void initialise (const String&) override
    {
        // MIDI キーボードをつないだらすぐ使えるよう、MIDI 入力は自動で開く
        holder = std::make_unique<StandalonePluginHolder> (appProperties.getUserSettings(), false, String{}, nullptr,
                                                           Array<StandalonePluginHolder::PluginInOuts>{}, true);

        window = std::make_unique<MainWindow> (getApplicationName(), *holder);
        window->setVisible (true);
        // 画面に出した直後にネイティブのタイトルバーの分だけ中身が縮むので、中身を基準サイズに合わせ直す
        window->centreWithSize (GodokenEditor::baseWidth, GodokenEditor::baseHeight);

        menu.onItem = [this] (int item)
        {
            switch (item)
            {
                case OptionsMenu::audioSettings: holder->showAudioSettingsDialog(); break;
                case OptionsMenu::saveState:     holder->askUserToSaveState();      break;
                case OptionsMenu::loadState:     holder->askUserToLoadState();      break;
                case OptionsMenu::resetState:    window->resetToDefaultState();     break;
                default: break;
            }
        };

       #if JUCE_MAC
        MenuBarModel::setMacMainMenu (&menu);
       #else
        // Windows：ウィンドウ上部のメニューバーに「オプション」を出す
        window->setMenuBar (&menu);
        window->centreWithSize (GodokenEditor::baseWidth, GodokenEditor::baseHeight + window->getContentComponentBorder().getTop());
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
};
}

juce::JUCEApplicationBase* juce_CreateApplication();
juce::JUCEApplicationBase* juce_CreateApplication() { return new ChordNaviStandaloneApp(); }

#endif
