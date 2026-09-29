#include "WebResources.h"

// 埋め込み UI の配信（WebResources）：URL のファイル名で引く・? 以降を無視・空なら index.html・MIME
namespace
{
    const char* const names[]     = { "index_html", "theory_js", "style_css" };
    const char* const originals[] = { "index.html", "theory.js", "style.css" };
    const char indexData[] = "<html>", theoryData[] = "export{}", styleData[] = "a{}";

    const char* getNamed (const char* name, int& size)
    {
        const juce::String n (name);
        if (n == "index_html") { size = (int) sizeof (indexData) - 1;  return indexData; }
        if (n == "theory_js")  { size = (int) sizeof (theoryData) - 1; return theoryData; }
        if (n == "style_css")  { size = (int) sizeof (styleData) - 1;  return styleData; }
        size = 0;
        return nullptr;
    }

    const WebResources::Table table { 3, names, originals, &getNamed };

    juce::String text (const WebResources::File& f)
    {
        return juce::String::fromUTF8 (reinterpret_cast<const char*> (f.bytes.data()), (int) f.bytes.size());
    }
}

class WebResourcesTests : public juce::UnitTest
{
public:
    WebResourcesTests() : juce::UnitTest ("WebResources", "Godoken") {}

    void runTest() override
    {
        beginTest ("Empty path serves index.html");
        {
            auto f = WebResources::serve (table, "/");
            expect (f.has_value());
            expectEquals (text (*f), juce::String ("<html>"));
            expectEquals (f->mimeType, juce::String ("text/html"));
        }

        beginTest ("Folders are ignored and the query is dropped");
        {
            auto f = WebResources::serve (table, "/shared/ui/theory.js?v=2");
            expect (f.has_value());
            expectEquals (text (*f), juce::String ("export{}"));
            expectEquals (f->mimeType, juce::String ("text/javascript"));
        }

        beginTest ("Unknown files are not found");
        {
            expect (! WebResources::serve (table, "/missing.js").has_value());
            expect (! WebResources::serve (table, "/theory.js.map").has_value());
        }

        beginTest ("MIME types");
        {
            expectEquals (WebResources::mimeTypeFor ("style.css"), juce::String ("text/css"));
            expectEquals (WebResources::mimeTypeFor ("a.svg"), juce::String ("image/svg+xml"));
            expectEquals (WebResources::mimeTypeFor ("song.chordsketch"), juce::String ("application/octet-stream"));
        }
    }
};

static WebResourcesTests webResourcesTests;
