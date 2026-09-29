#include "SketchEditor.h"
#include "WebResources.h"
#include "WebViewZoom.h"
#include "MidiExport.h"
#include "ChordSketchUIData.h"
#include <cstring>

namespace
{
    // ChordSketch の埋め込み UI（sketch/prototype と shared/ui と JUCE の JS）
    const WebResources::Table uiResources { ChordSketchUIData::namedResourceListSize, ChordSketchUIData::namedResourceList,
                                            ChordSketchUIData::originalFilenames, &ChordSketchUIData::getNamedResource };

    // JS から { name, data(base64) } を受け取る
    struct MidiBytes { juce::String name; juce::MemoryBlock data; };

    MidiBytes parseMidiBytes (const juce::Array<juce::var>& args)
    {
        MidiBytes out;
        if (args.isEmpty())
            return out;
        out.name = args[0].getProperty ("name", "ChordSketch").toString();
        juce::MemoryOutputStream stream;
        if (juce::Base64::convertFromBase64 (stream, args[0].getProperty ("data", "").toString()))
            out.data = stream.getMemoryBlock();
        return out;
    }

    PreviewSynth::Timbre timbreFromName (const juce::String& name)
    {
        if (name == "piano")         return PreviewSynth::Timbre::piano;
        if (name == "electricPiano") return PreviewSynth::Timbre::electricPiano;
        if (name == "guitar")        return PreviewSynth::Timbre::guitar;
        if (name == "organ")         return PreviewSynth::Timbre::organ;
        if (name == "pad")           return PreviewSynth::Timbre::pad;
        return PreviewSynth::Timbre::triangle;
    }

    // JS の予定表（数を平らに並べた配列）→ SongPlayer::Song
    SongPlayer::Song parseSong (const juce::var& o)
    {
        SongPlayer::Song song;
        if (auto* n = o.getProperty ("notes", {}).getArray())
            for (int i = 0; i + 3 < n->size(); i += 4)
                song.notes.push_back ({ juce::jmax (0.0, (double) (*n)[i]), juce::jlimit (0.001, 600.0, (double) (*n)[i + 1]),
                                        juce::jlimit (0, 127, (int) (*n)[i + 2]), juce::jlimit (0.0f, 1.0f, (float) (double) (*n)[i + 3]) });
        if (auto* d = o.getProperty ("drums", {}).getArray())
            for (int i = 0; i + 1 < d->size(); i += 2)
                song.drums.push_back ({ (double) (*d)[i], (SongPlayer::Drum) juce::jlimit (0, 5, (int) (*d)[i + 1]) });
        const auto byStart = [] (const auto& a, const auto& b) { return a.start < b.start; };
        std::stable_sort (song.notes.begin(), song.notes.end(), byStart);
        std::stable_sort (song.drums.begin(), song.drums.end(), byStart);
        song.length  = juce::jlimit (0.0, 36000.0, (double) o.getProperty ("length", 0.0));
        song.leadIn  = juce::jlimit (0.0, 30.0, (double) o.getProperty ("leadIn", 0.0));
        song.loop    = (bool) o.getProperty ("loop", false);
        song.timbre  = timbreFromName (o.getProperty ("timbre", "piano").toString());
        song.session = (int) o.getProperty ("session", -1);
        return song;
    }

    const juce::String songExtension = ".chordsketch";
    constexpr juce::int64 maxSongBytes = 16 * 1024 * 1024;   // 曲ファイル・セッションとして読む上限

    // 開いているタブの自動保存（JS の persist()）。macOS は ~/Library/Application Support/ChordSketch、Windows は AppData の ChordSketch
    juce::File sessionFile()
    {
        auto dir = juce::File::getSpecialLocation (juce::File::userApplicationDataDirectory);
       #if JUCE_MAC
        dir = dir.getChildFile ("Application Support");
       #endif
        return dir.getChildFile ("ChordSketch").getChildFile ("session.json");
    }

    // 一時ファイルに書いてから置き換える（書いている途中で落ちても元のファイルが残る）
    bool writeTextSafely (const juce::File& file, const juce::String& text)
    {
        if (! file.getParentDirectory().createDirectory())
            return false;
        juce::TemporaryFile temp (file);
        return temp.getFile().replaceWithText (text, false, false, "\n") && temp.overwriteTargetFileWithTemporary();
    }

    juce::String readTextFile (const juce::File& file)
    {
        if (! file.existsAsFile() || file.getSize() > maxSongBytes)
            return {};
        return file.loadFileAsString();
    }

    juce::var fileResult (const juce::File& file, const juce::String& text = {})
    {
        auto* o = new juce::DynamicObject();
        o->setProperty ("path", file.getFullPathName());
        o->setProperty ("name", file.getFileName());
        if (text.isNotEmpty())
            o->setProperty ("text", text);
        return juce::var (o);
    }

    // SMF のヘッダ（MThd）で始まるか
    bool looksLikeMidi (const juce::MemoryBlock& data)
    {
        return data.getSize() >= 14 && std::memcmp (data.getData(), "MThd", 4) == 0;
    }
}

juce::WebBrowserComponent::Options SketchEditor::makeOptions()
{
    return juce::WebBrowserComponent::Options{}
       #if JUCE_WINDOWS
        .withBackend (juce::WebBrowserComponent::Options::Backend::webview2)
        .withWinWebView2Options (juce::WebBrowserComponent::Options::WinWebView2{}
                                     .withUserDataFolder (juce::File::getSpecialLocation (juce::File::userApplicationDataDirectory)
                                                              .getChildFile ("ChordSketch").getChildFile ("WebView2")))
       #endif
        .withNativeIntegrationEnabled (true)
        .withKeepPageLoadedWhenBrowserIsHidden()
        .withResourceProvider ([] (const auto& url) -> std::optional<juce::WebBrowserComponent::Resource>
                               {
                                   if (auto file = WebResources::serve (uiResources, url))
                                       return juce::WebBrowserComponent::Resource { std::move (file->bytes), file->mimeType };
                                   return std::nullopt;
                               })
        .withNativeFunction ("startMidiDragBytes", [this] (const auto& args, auto completion)
                             {
                                 startMidiDragBytes (args, std::move (completion));
                             })
        .withNativeFunction ("saveMidiBytes", [this] (const auto& args, auto completion)
                             {
                                 saveMidiBytes (args, std::move (completion));
                             })
        .withNativeFunction ("songOpen", [this] (const auto&, auto completion)
                             {
                                 songOpen (std::move (completion));
                             })
        .withNativeFunction ("songSaveAs", [this] (const auto& args, auto completion)
                             {
                                 songSaveAs (args, std::move (completion));
                             })
        .withNativeFunction ("songWrite", [] (const auto& args, auto completion)
                             {
                                 const auto path = args.isEmpty() ? juce::String() : args[0].getProperty ("path", "").toString();
                                 const auto text = args.isEmpty() ? juce::String() : args[0].getProperty ("text", "").toString();
                                 completion (juce::var (juce::File::isAbsolutePath (path) && text.isNotEmpty()
                                                        && writeTextSafely (juce::File (path), text)));
                             })
        .withNativeFunction ("loadSession", [] (const auto&, auto completion)
                             {
                                 completion (juce::var (readTextFile (sessionFile())));
                             })
        .withNativeFunction ("saveSession", [] (const auto& args, auto completion)
                             {
                                 const auto text = args.isEmpty() ? juce::String() : args[0].toString();
                                 completion (juce::var (text.isNotEmpty() && writeTextSafely (sessionFile(), text)));
                             })
        .withNativeFunction ("songPlay", [this] (const auto& args, auto completion)
                             {
                                 if (! args.isEmpty()) processorRef.getSongPlayer().play (parseSong (args[0]));
                                 completion (juce::var (true));
                             })
        .withNativeFunction ("songUpdate", [this] (const auto& args, auto completion)
                             {
                                 if (! args.isEmpty()) processorRef.getSongPlayer().update (parseSong (args[0]));
                                 completion (juce::var (true));
                             })
        .withNativeFunction ("songStop", [this] (const auto&, auto completion)
                             {
                                 processorRef.getSongPlayer().stop();
                                 completion (juce::var (true));
                             })
        .withNativeFunction ("previewNotes", [this] (const auto& args, auto completion)
                             {
                                 // パレットのコードのクリックなど：単発で鳴らす（曲の試聴は止めない）
                                 std::vector<int> notes;
                                 if (! args.isEmpty())
                                     if (auto* a = args[0].getProperty ("notes", {}).getArray())
                                         for (const auto& v : *a) notes.push_back (juce::jlimit (0, 127, (int) v));
                                 const auto dur = args.isEmpty() ? 1.1 : juce::jlimit (0.05, 10.0, (double) args[0].getProperty ("dur", 1.1));
                                 const auto timbre = timbreFromName (args.isEmpty() ? juce::String() : args[0].getProperty ("timbre", "piano").toString());
                                 completion (juce::var (! notes.empty() && processorRef.getSynth().queue (notes, 0.0, dur, timbre, false)));
                             })
        .withNativeFunction ("setMute", [this] (const auto& args, auto completion)
                             {
                                 processorRef.setMuted (! args.isEmpty() && (bool) args[0]);
                                 completion (juce::var (true));
                             })
        .withNativeFunction ("setTimbre", [this] (const auto& args, auto completion)
                             {
                                 // MIDI 鍵盤で弾く音の音色
                                 if (! args.isEmpty()) processorRef.setLiveTimbre (timbreFromName (args[0].toString()));
                                 completion (juce::var (true));
                             });
}

SketchEditor::SketchEditor (SketchProcessor& p)
    : AudioProcessorEditor (&p), processorRef (p), webView (makeOptions())
{
    addAndMakeVisible (webView);
    // 縦横比は固定しない：縦長にすると画面が縦に伸びてシートが広がる（横長は左右に余白。UI 側の fit()）
    setResizable (true, true);
    setResizeLimits (960, 585, maxWidth, maxHeight);
    setSize (baseWidth, baseHeight);
    webView.goToURL (juce::WebBrowserComponent::getResourceProviderRoot());
    startTimerHz (30);   // 再生位置と押している鍵盤
}

void SketchEditor::timerCallback()
{
    const auto p = processorRef.getSongPlayer().getPosition();
    if (p.session != lastSentPosition.session || p.playing != lastSentPosition.playing
        || std::abs (p.seconds - lastSentPosition.seconds) > 1.0e-4)
    {
        lastSentPosition = p;
        auto* o = new juce::DynamicObject();
        o->setProperty ("session", p.session);
        o->setProperty ("seconds", p.seconds);
        o->setProperty ("playing", p.playing);
        webView.emitEventIfBrowserIsVisible ("songPos", juce::var (o));
    }

    const auto notes = processorRef.getHeldNotes();
    if (notes != lastSentNotes)
    {
        lastSentNotes = notes;
        juce::Array<juce::var> list;
        for (auto n : notes) list.add (n);
        auto* o = new juce::DynamicObject();
        o->setProperty ("notes", list);
        webView.emitEventIfBrowserIsVisible ("midiNotes", juce::var (o));
    }
}

void SketchEditor::resized()
{
    webView.setBounds (getLocalBounds());
    updateZoom();
}

void SketchEditor::updateZoom()
{
    const auto zoom = juce::jmin (getWidth() / (double) baseWidth, getHeight() / (double) baseHeight);
    WebViewZoom::apply (*this, zoom);
    // 画面に出た直後は WKWebView がまだできていないことがあるので、少し後にもう一度
    juce::Component::SafePointer<SketchEditor> self (this);
    juce::Timer::callAfterDelay (200, [self, zoom] { if (self != nullptr) WebViewZoom::apply (*self, zoom); });
}

void SketchEditor::startMidiDragBytes (const juce::Array<juce::var>& args,
                                       juce::WebBrowserComponent::NativeFunctionCompletion completion)
{
    const auto midi = parseMidiBytes (args);
    if (! looksLikeMidi (midi.data))
    {
        completion (juce::var ("error: no midi"));
        return;
    }

    const auto file = MidiExport::writeTempBytes (midi.data, midi.name, "ChordSketch");
    if (! file.existsAsFile())
    {
        completion (juce::var ("error: failed to write temp file"));
        return;
    }

    const bool started = juce::DragAndDropContainer::performExternalDragDropOfFiles ({ file.getFullPathName() }, false, this);
    completion (juce::var (started ? "started:" + file.getFileName() : juce::String ("error: drag not started")));
}

void SketchEditor::saveMidiBytes (const juce::Array<juce::var>& args,
                                  juce::WebBrowserComponent::NativeFunctionCompletion completion)
{
    const auto midi = parseMidiBytes (args);
    if (! looksLikeMidi (midi.data))
    {
        completion (juce::var ("error: no midi"));
        return;
    }

    const auto initial = MidiExport::withExtensionIfMissing (
        juce::File::getSpecialLocation (juce::File::userDesktopDirectory).getChildFile (midi.name), "mid");

    fileChooser = std::make_unique<juce::FileChooser> (juce::String::fromUTF8 ("MIDIファイルを保存"), initial, "*.mid");
    const auto flags = juce::FileBrowserComponent::saveMode | juce::FileBrowserComponent::canSelectFiles
                     | juce::FileBrowserComponent::warnAboutOverwriting;

    fileChooser->launchAsync (flags, [data = midi.data, completion] (const juce::FileChooser& chooser)
    {
        auto file = chooser.getResult();
        if (file == juce::File())
        {
            completion (juce::var ("cancelled"));
            return;
        }

        file = MidiExport::withExtensionIfMissing (file, "mid");
        completion (juce::var (file.replaceWithData (data.getData(), data.getSize())
                                   ? "saved:" + file.getFullPathName()
                                   : juce::String ("error: failed to write file")));
    });
}

void SketchEditor::songOpen (juce::WebBrowserComponent::NativeFunctionCompletion completion)
{
    fileChooser = std::make_unique<juce::FileChooser> (juce::String::fromUTF8 ("曲を開く"),
                                                       juce::File::getSpecialLocation (juce::File::userDocumentsDirectory),
                                                       "*" + songExtension + ";*.json");
    const auto flags = juce::FileBrowserComponent::openMode | juce::FileBrowserComponent::canSelectFiles;

    fileChooser->launchAsync (flags, [completion] (const juce::FileChooser& chooser)
    {
        const auto file = chooser.getResult();
        if (file == juce::File())
        {
            completion (juce::var ("cancelled"));
            return;
        }
        const auto text = readTextFile (file);
        completion (text.isEmpty() ? juce::var ("error: failed to read file") : fileResult (file, text));
    });
}

void SketchEditor::songSaveAs (const juce::Array<juce::var>& args,
                               juce::WebBrowserComponent::NativeFunctionCompletion completion)
{
    const auto name = args.isEmpty() ? juce::String() : args[0].getProperty ("name", "").toString();
    const auto text = args.isEmpty() ? juce::String() : args[0].getProperty ("text", "").toString();
    const auto path = args.isEmpty() ? juce::String() : args[0].getProperty ("path", "").toString();
    if (text.isEmpty())
    {
        completion (juce::var ("error: no data"));
        return;
    }

    // 前に保存したファイルがあればその隣、無ければ書類フォルダ
    const auto dir = juce::File::isAbsolutePath (path) ? juce::File (path).getParentDirectory()
                                                       : juce::File::getSpecialLocation (juce::File::userDocumentsDirectory);
    const auto initial = MidiExport::withExtensionIfMissing (dir.getChildFile (MidiExport::safeFileName (name.isEmpty() ? "song" : name)),
                                                             songExtension.substring (1));

    fileChooser = std::make_unique<juce::FileChooser> (juce::String::fromUTF8 ("曲を保存"), initial, "*" + songExtension);
    const auto flags = juce::FileBrowserComponent::saveMode | juce::FileBrowserComponent::canSelectFiles
                     | juce::FileBrowserComponent::warnAboutOverwriting;

    fileChooser->launchAsync (flags, [text, completion] (const juce::FileChooser& chooser)
    {
        auto file = chooser.getResult();
        if (file == juce::File())
        {
            completion (juce::var ("cancelled"));
            return;
        }
        file = MidiExport::withExtensionIfMissing (file, songExtension.substring (1));
        completion (writeTextSafely (file, text) ? fileResult (file) : juce::var ("error: failed to write file"));
    });
}
