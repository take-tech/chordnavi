#include "WebViewZoom.h"

#if JUCE_MAC
#import <WebKit/WebKit.h>
#include <cmath>

namespace
{
    WKWebView* findWebView (NSView* view)
    {
        if ([view isKindOfClass: [WKWebView class]])
            return (WKWebView*) view;

        for (NSView* child in [view subviews])
            if (auto* found = findWebView (child))
                return found;

        return nil;
    }
}

namespace WebViewZoom
{
    void apply (juce::Component& component, double zoom)
    {
        auto* peer = component.getPeer();
        if (peer == nullptr || ! (zoom > 0.1))
            return;

        if (auto* webView = findWebView ((NSView*) peer->getNativeHandle()))
            if (@available (macOS 11.0, *))
                if (std::abs ((double) webView.pageZoom - zoom) > 1.0e-4)
                    webView.pageZoom = (CGFloat) zoom;
    }
}
#endif
