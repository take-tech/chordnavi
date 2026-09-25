#include "PluginEditor.h"
#include "MidiExport.h"
#include "GodokenUIData.h"

namespace
{
    juce::String mimeTypeFor (const juce::String& fileName)
    {
        const auto ext = fileName.fromLastOccurrenceOf (".", false, true);
        if (ext == "html") return "text/html";
        if (ext == "js")   return "text/javascript";
        if (ext == "css")  return "text/css";
        if (ext == "json") return "application/json";
        if (ext == "svg")  return "image/svg+xml";
        return "application/octet-stream";
    }

    // URL のファイル名（basename）で埋め込みリソースを引く
    const char* findResource (const juce::String& fileName, int& size)
    {
        for (int i = 0; i < GodokenUIData::namedResourceListSize; ++i)
            if (fileName == GodokenUIData::originalFilenames[i])
                return GodokenUIData::getNamedResource (GodokenUIData::namedResourceList[i], size);

        size = 0;
        return nullptr;
    }

    std::vector<MidiExport::Chord> parseChords (const juce::var& list)
    {
        std::vector<MidiExport::Chord> chords;

        if (auto* arr = list.getArray())
        {
            for (const auto& c : *arr)
            {
                MidiExport::Chord chord;
                chord.root = juce::jlimit (0, 11, (int) c["root"]);

                if (c.hasProperty ("bass"))
                    chord.bass = juce::jlimit (0, 11, (int) c["bass"]);

                if (c.hasProperty ("beats"))
                    chord.beats = juce::jlimit (1, 16, (int) c["beats"]);

                if (auto* ivs = c["iv"].getArray())
                    for (const auto& iv : *ivs)
                        chord.intervals.push_back (juce::jlimit (0, 24, (int) iv));

                chords.push_back (std::move (chord));
            }
        }

        return chords;
    }

    PreviewSynth::Timbre timbreFromName (const juce::String& name)
    {
        return name == "piano"         ? PreviewSynth::Timbre::piano
             : name == "electricPiano" ? PreviewSynth::Timbre::electricPiano
             : name == "guitar"        ? PreviewSynth::Timbre::guitar
             : name == "organ"         ? PreviewSynth::Timbre::organ
             : name == "pad"           ? PreviewSynth::Timbre::pad
                                       : PreviewSynth::Timbre::triangle;
    }

    struct MidiRequest
    {
        std::vector<MidiExport::Chord> chords;
        double bpm = 120.0;
        juce::String name;
    };

    MidiRequest parseRequest (const juce::Array<juce::var>& args)
    {
        const auto request = args.isEmpty() ? juce::var() : args[0];
        MidiRequest r;
        r.chords = parseChords (request["chords"]);
        if (request.hasProperty ("bpm"))
            r.bpm = (double) request["bpm"];
        r.name = request["name"].toString();
        return r;
    }
}

GodokenEditor::GodokenEditor (GodokenProcessor& p)
    : AudioProcessorEditor (&p),
      processorRef (p),
      webView (juce::WebBrowserComponent::Options{}
                  #if JUCE_WINDOWS
                   // Windows は WebView2（Edge）を使う。データはプラグインの置き場所ではなく AppData に置く
                   .withBackend (juce::WebBrowserComponent::Options::Backend::webview2)
                   .withWinWebView2Options (juce::WebBrowserComponent::Options::WinWebView2{}
                       .withUserDataFolder (juce::File::getSpecialLocation (juce::File::userApplicationDataDirectory)
                                                .getChildFile ("ChordNavi").getChildFile ("WebView2")))
                  #endif
                   .withNativeIntegrationEnabled (true)
                   .withKeepPageLoadedWhenBrowserIsHidden()
                   .withResourceProvider ([this] (const auto& url) { return serveResource (url); })
                   .withNativeFunction ("startMidiDrag", [this] (const auto& args, auto completion)
                                        {
                                            startMidiDrag (args, std::move (completion));
                                        })
                   .withNativeFunction ("saveMidi", [this] (const auto& args, auto completion)
                                        {
                                            saveMidi (args, std::move (completion));
                                        })
                   .withNativeFunction ("playChords", [this] (const auto& args, auto completion)
                                        {
                                            playChords (args, std::move (completion));
                                        })
                   .withNativeFunction ("stopPreview", [this] (const auto&, auto completion)
                                        {
                                            completion (juce::var (processorRef.getPreviewSynth().stopAll()));
                                        })
                   .withNativeFunction ("playNotes", [this] (const auto& args, auto completion)
                                        {
                                            playNotes (args, std::move (completion));
                                        })
                   .withNativeFunction ("getHostInfo", [this] (const auto&, auto completion)
                                        {
                                            completion (hostInfo());
                                        })
                   // JS: saveState(json) — UI の状態を保存用に預ける／loadState() — 保存済みの状態（無ければ空文字列）
                   .withNativeFunction ("saveState", [this] (const auto& args, auto completion)
                                        {
                                            if (! args.isEmpty() && args[0].isString())
                                                processorRef.setUiState (args[0].toString());
                                            completion (juce::var (true));
                                        })
                   .withNativeFunction ("loadState", [this] (const auto&, auto completion)
                                        {
                                            completion (juce::var (processorRef.getUiState()));
                                        })
                   // JS: reportTheme(name) — 今のテーマを知らせる（Standalone のメニューのチェック用）
                   .withNativeFunction ("reportTheme", [this] (const auto& args, auto completion)
                                        {
                                            if (! args.isEmpty())
                                                processorRef.setUiTheme (args[0].toString());
                                            completion (juce::var (true));
                                        })
                   // JS: setMute(bool) — ChordNavi の音をすべて消す
                   .withNativeFunction ("setMute", [this] (const auto& args, auto completion)
                                        {
                                            processorRef.setMuted (! args.isEmpty() && (bool) args[0]);
                                            completion (juce::var (true));
                                        })
                   // JS: setTimbre(name) — MIDI キーボードで弾く音の音色
                   .withNativeFunction ("setTimbre", [this] (const auto& args, auto completion)
                                        {
                                            if (! args.isEmpty())
                                                processorRef.setLiveTimbre (timbreFromName (args[0].toString()));
                                            completion (juce::var (true));
                                        }))
{
    addAndMakeVisible (webView);

    setResizable (true, true);
    setResizeLimits (960, 585, baseWidth * 2, baseHeight * 2);
    if (auto* c = getConstrainer())
        c->setFixedAspectRatio ((double) baseWidth / (double) baseHeight);
    setSize (baseWidth, baseHeight);

    webView.goToURL (juce::WebBrowserComponent::getResourceProviderRoot());

    startTimerHz (30);   // MIDI 入力の表示（と DAW のテンポ）

    processorRef.addChangeListener (this);
}

GodokenEditor::~GodokenEditor()
{
    processorRef.removeChangeListener (this);
}

void GodokenEditor::changeListenerCallback (juce::ChangeBroadcaster*)
{
    webView.emitEventIfBrowserIsVisible ("stateRestored", juce::var (processorRef.getUiState()));
}

juce::var GodokenEditor::hostInfo() const
{
    auto* obj = new juce::DynamicObject();
    obj->setProperty ("standalone", processorRef.isStandalone());
    obj->setProperty ("bpm", processorRef.getHostBpm());
    return juce::var (obj);
}

void GodokenEditor::timerCallback()
{
    if (! processorRef.isStandalone())
    {
        const auto bpm = processorRef.getHostBpm();
        if (! juce::exactlyEqual (bpm, lastSentBpm))
        {
            lastSentBpm = bpm;
            webView.emitEventIfBrowserIsVisible ("hostTempo", hostInfo());
        }
    }

    auto notes = processorRef.getLiveNotes();
    if (notes != lastSentLiveNotes)
    {
        lastSentLiveNotes = notes;
        juce::Array<juce::var> list;
        for (auto n : notes) list.add (n);
        auto* obj = new juce::DynamicObject();
        obj->setProperty ("notes", list);
        webView.emitEventIfBrowserIsVisible ("midiNotes", juce::var (obj));
    }
}

void GodokenEditor::setTheme (const juce::String& name)
{
    processorRef.setUiTheme (name);
    webView.emitEventIfBrowserIsVisible ("setTheme", juce::var (name));
}

void GodokenEditor::resized()
{
    webView.setBounds (getLocalBounds());
}

std::optional<juce::WebBrowserComponent::Resource> GodokenEditor::serveResource (const juce::String& urlPath)
{
    auto path = urlPath.upToFirstOccurrenceOf ("?", false, false).trimCharactersAtStart ("/");
    if (path.isEmpty())
        path = "index.html";

    const auto fileName = path.fromLastOccurrenceOf ("/", false, false);

    int size = 0;
    if (auto* data = findResource (fileName, size); data != nullptr && size > 0)
    {
        std::vector<std::byte> bytes ((size_t) size);
        std::memcpy (bytes.data(), data, (size_t) size);
        return juce::WebBrowserComponent::Resource { std::move (bytes), mimeTypeFor (fileName) };
    }

    return std::nullopt;
}

void GodokenEditor::startMidiDrag (const juce::Array<juce::var>& args,
                                   juce::WebBrowserComponent::NativeFunctionCompletion completion)
{
    const auto request = parseRequest (args);

    if (request.chords.empty())
    {
        completion (juce::var ("error: no chords"));
        return;
    }

    const auto file = MidiExport::writeTempFile (request.chords, request.bpm, request.name);

    if (! file.existsAsFile())
    {
        completion (juce::var ("error: failed to write temp file"));
        return;
    }

    // マウスボタンが押されたままのこのタイミングで OS のファイルドラッグを開始する
    const bool started = juce::DragAndDropContainer::performExternalDragDropOfFiles (
        { file.getFullPathName() }, false, this);

    completion (juce::var (started ? "started:" + file.getFileName()
                                   : juce::String ("error: drag not started")));
}

void GodokenEditor::saveMidi (const juce::Array<juce::var>& args,
                              juce::WebBrowserComponent::NativeFunctionCompletion completion)
{
    const auto request = parseRequest (args);

    if (request.chords.empty())
    {
        completion (juce::var ("error: no chords"));
        return;
    }

    const auto initial = juce::File::getSpecialLocation (juce::File::userDesktopDirectory)
                             .getChildFile (MidiExport::safeFileName (request.name) + ".mid");

    fileChooser = std::make_unique<juce::FileChooser> ("MIDIファイルを保存", initial, "*.mid");

    const auto chooserFlags = juce::FileBrowserComponent::saveMode
                     | juce::FileBrowserComponent::canSelectFiles
                     | juce::FileBrowserComponent::warnAboutOverwriting;

    fileChooser->launchAsync (chooserFlags, [request, completion] (const juce::FileChooser& chooser)
    {
        auto file = chooser.getResult();

        if (file == juce::File())
        {
            completion (juce::var ("cancelled"));
            return;
        }

        file = file.withFileExtension ("mid");
        const auto data = MidiExport::buildMidi (request.chords, request.bpm);

        completion (juce::var (file.replaceWithData (data.getData(), data.getSize())
                                   ? "saved:" + file.getFullPathName()
                                   : juce::String ("error: failed to write file")));
    });
}

void GodokenEditor::playChords (const juce::Array<juce::var>& args,
                                juce::WebBrowserComponent::NativeFunctionCompletion completion)
{
    const auto request = args.isEmpty() ? juce::var() : args[0];
    const auto list    = request["chords"];
    const auto chords  = parseChords (list);

    const auto timbre = timbreFromName (request["timbre"].toString());

    // 各コードの開始時刻 start・長さ dur（秒）は JS 側でテンポと拍数から計算済み。
    // 新しい試聴を始めるときは、鳴っている音・予約中の音を止める（先頭のコードで一度だけ）
    int queued = 0;
    for (size_t i = 0; i < chords.size(); ++i)
    {
        const auto& c    = list[(int) i];
        const auto start = juce::jlimit (0.0, 120.0, (double) c.getProperty ("start", 0.0));
        const auto dur   = juce::jlimit (0.05, 10.0, (double) c.getProperty ("dur", 1.1));
        queued += processorRef.getPreviewSynth().queue (MidiExport::voicing (chords[i]), start, dur, timbre, i == 0) ? 1 : 0;
    }

    completion (juce::var (queued));
}

void GodokenEditor::playNotes (const juce::Array<juce::var>& args,
                               juce::WebBrowserComponent::NativeFunctionCompletion completion)
{
    const auto request = args.isEmpty() ? juce::var() : args[0];
    std::vector<int> notes;

    if (auto* arr = request["notes"].getArray())
        for (const auto& n : *arr)
            notes.push_back (juce::jlimit (0, 127, (int) n));

    const auto dur = juce::jlimit (0.05, 10.0, (double) request.getProperty ("dur", 1.0));
    completion (juce::var (processorRef.getPreviewSynth().queue (notes, 0.0, dur, timbreFromName (request["timbre"].toString()))));
}
