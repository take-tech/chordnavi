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

                if (auto* ivs = c["iv"].getArray())
                    for (const auto& iv : *ivs)
                        chord.intervals.push_back (juce::jlimit (0, 24, (int) iv));

                chords.push_back (std::move (chord));
            }
        }

        return chords;
    }

    struct MidiRequest
    {
        std::vector<MidiExport::Chord> chords;
        int bpm = 120;
        juce::String name;
    };

    MidiRequest parseRequest (const juce::Array<juce::var>& args)
    {
        const auto request = args.isEmpty() ? juce::var() : args[0];
        MidiRequest r;
        r.chords = parseChords (request["chords"]);
        if (request.hasProperty ("bpm"))
            r.bpm = (int) request["bpm"];
        r.name = request["name"].toString();
        return r;
    }
}

GodokenEditor::GodokenEditor (GodokenProcessor& p)
    : AudioProcessorEditor (&p),
      webView (juce::WebBrowserComponent::Options{}
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
                                        }))
{
    addAndMakeVisible (webView);

    setResizable (true, true);
    setResizeLimits (960, 585, baseWidth * 2, baseHeight * 2);
    if (auto* c = getConstrainer())
        c->setFixedAspectRatio ((double) baseWidth / (double) baseHeight);
    setSize (baseWidth, baseHeight);

    webView.goToURL (juce::WebBrowserComponent::getResourceProviderRoot());
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

    const auto flags = juce::FileBrowserComponent::saveMode
                     | juce::FileBrowserComponent::canSelectFiles
                     | juce::FileBrowserComponent::warnAboutOverwriting;

    fileChooser->launchAsync (flags, [request, completion] (const juce::FileChooser& chooser)
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
