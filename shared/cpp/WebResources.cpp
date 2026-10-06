#include "WebResources.h"
#include <cstring>

namespace WebResources
{
    juce::String mimeTypeFor (const juce::String& fileName)
    {
        const auto ext = fileName.fromLastOccurrenceOf (".", false, true);
        if (ext == "html") return "text/html";
        if (ext == "js")   return "text/javascript";
        if (ext == "css")  return "text/css";
        if (ext == "json") return "application/json";
        if (ext == "svg")  return "image/svg+xml";
        if (ext == "woff2") return "font/woff2";
        return "application/octet-stream";
    }

    std::optional<File> serve (const Table& table, const juce::String& urlPath)
    {
        auto path = urlPath.upToFirstOccurrenceOf ("?", false, false).trimCharactersAtStart ("/");
        if (path.isEmpty())
            path = "index.html";

        const auto fileName = path.fromLastOccurrenceOf ("/", false, false);

        for (int i = 0; i < table.size; ++i)
        {
            if (fileName != table.originalFilenames[i])
                continue;

            int size = 0;
            const auto* data = table.getNamedResource (table.names[i], size);
            if (data == nullptr || size <= 0)
                return std::nullopt;

            File file { std::vector<std::byte> ((size_t) size), mimeTypeFor (fileName) };
            std::memcpy (file.bytes.data(), data, (size_t) size);
            return file;
        }
        return std::nullopt;
    }
}
