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
