#include "PluginState.h"

namespace PluginState
{
namespace
{
    const juce::Identifier rootType { "GodokenState" };
    const juce::Identifier versionId { "version" };
    const juce::Identifier uiId { "ui" };
}

juce::MemoryBlock serialise (const juce::String& uiJson)
{
    juce::ValueTree tree (rootType);
    tree.setProperty (versionId, version, nullptr);
    tree.setProperty (uiId, uiJson, nullptr);

    juce::MemoryBlock block;
    juce::MemoryOutputStream out (block, false);
    tree.writeToStream (out);
    out.flush();
    return block;
}

juce::String deserialise (const void* data, int sizeInBytes)
{
    if (data == nullptr || sizeInBytes <= 0)
        return {};

    const auto tree = juce::ValueTree::readFromData (data, (size_t) sizeInBytes);
    if (! tree.isValid() || ! tree.hasType (rootType))
        return {};

    return tree.getProperty (uiId).toString();
}
}
