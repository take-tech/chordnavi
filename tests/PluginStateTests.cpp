#include "PluginState.h"

class PluginStateTests : public juce::UnitTest
{
public:
    PluginStateTests() : juce::UnitTest ("PluginState", "Godoken") {}

    void runTest() override
    {
        beginTest ("Round trip keeps the UI JSON exactly (including Japanese and symbols)");
        {
            const auto json = juce::String::fromUTF8 (R"({"v":1,"idx":9,"mode":"minor","timbre":"organ","memo":"王道進行 F♯m7♭5"})");
            const auto block = PluginState::serialise (json);
            expect (block.getSize() > 0);
            expectEquals (PluginState::deserialise (block.getData(), (int) block.getSize()), json);
        }

        beginTest ("Empty state round-trips to empty");
        {
            const auto block = PluginState::serialise ({});
            expectEquals (PluginState::deserialise (block.getData(), (int) block.getSize()), juce::String());
        }

        beginTest ("Garbage or foreign data is ignored");
        {
            const char junk[] = "not a state at all";
            expectEquals (PluginState::deserialise (junk, (int) sizeof (junk)), juce::String());
            expectEquals (PluginState::deserialise (nullptr, 0), juce::String());

            juce::ValueTree other ("SomethingElse");
            other.setProperty ("ui", "{}", nullptr);
            juce::MemoryBlock mb;
            juce::MemoryOutputStream out (mb, false);
            other.writeToStream (out);
            out.flush();
            expectEquals (PluginState::deserialise (mb.getData(), (int) mb.getSize()), juce::String());
        }
    }
};

static PluginStateTests pluginStateTests;
