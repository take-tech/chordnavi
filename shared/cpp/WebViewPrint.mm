#include "WebViewPrint.h"

#if JUCE_MAC
#import <WebKit/WebKit.h>

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

    constexpr CGFloat pointsPerMm = 72.0 / 25.4;
}

namespace WebViewPrint
{
    bool run (juce::Component& component, const juce::String& jobTitle)
    {
        auto* peer = component.getPeer();
        if (peer == nullptr)
            return false;

        auto* webView = findWebView ((NSView*) peer->getNativeHandle());
        NSWindow* window = webView != nil ? webView.window : nil;
        if (window == nil)
            return false;

        if (@available (macOS 11.0, *))
        {
            NSPrintInfo* info = [[NSPrintInfo sharedPrintInfo] copy];
            // 余白はプロトタイプのプレビュー（上下 14mm・左右 12mm）に合わせる
            info.topMargin = info.bottomMargin = 14 * pointsPerMm;
            info.leftMargin = info.rightMargin = 12 * pointsPerMm;
            info.horizontalPagination = NSPrintingPaginationModeFit;
            info.verticalPagination = NSPrintingPaginationModeAutomatic;
            info.verticallyCentered = NO;
            info.horizontallyCentered = NO;

            NSPrintOperation* op = [webView printOperationWithPrintInfo: info];
            [info release];
            if (op == nil)
                return false;

            op.jobTitle = [NSString stringWithUTF8String: jobTitle.toRawUTF8()];
            op.showsPrintPanel = YES;
            op.showsProgressPanel = YES;
            // WKWebView の印刷は view の大きさが無いと白紙になるので、ウィンドウの大きさを与えてからシートで出す
            op.view.frame = webView.bounds;
            [op runOperationModalForWindow: (NSWindow* _Nonnull) window delegate: nil didRunSelector: nil contextInfo: nil];
            return true;
        }

        return false;
    }
}
#endif
