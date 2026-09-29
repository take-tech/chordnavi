#include "SketchEditor.h"
#include "WebResources.h"
#include "WebViewZoom.h"
#include "ChordSketchUIData.h"

namespace
{
    // ChordSketch の埋め込み UI（sketch/prototype と shared/ui と JUCE の JS）
    const WebResources::Table uiResources { ChordSketchUIData::namedResourceListSize, ChordSketchUIData::namedResourceList,
                                            ChordSketchUIData::originalFilenames, &ChordSketchUIData::getNamedResource };

    juce::WebBrowserComponent::Options webViewOptions()
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
                                   });
    }
}

SketchEditor::SketchEditor (SketchProcessor& p)
    : AudioProcessorEditor (&p), processorRef (p), webView (webViewOptions())
{
    addAndMakeVisible (webView);
    setResizable (true, true);
    setResizeLimits (960, 585, baseWidth * 2, baseHeight * 2);
    if (auto* c = getConstrainer())
        c->setFixedAspectRatio ((double) baseWidth / (double) baseHeight);
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
