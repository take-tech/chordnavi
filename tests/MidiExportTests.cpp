#include "MidiExport.h"
#include <juce_audio_basics/juce_audio_basics.h>

namespace
{
    std::vector<juce::uint8> toBytes (const juce::MemoryBlock& mb)
    {
        auto* p = static_cast<const juce::uint8*> (mb.getData());
        return { p, p + mb.getSize() };
    }

    const MidiExport::Chord cMajor { 0, { 0, 4, 7 } };
    const MidiExport::Chord fM7    { 5, { 0, 4, 7, 11 } };
}

class MidiExportTests : public juce::UnitTest
{
public:
    MidiExportTests() : juce::UnitTest ("MidiExport") {}

    void runTest() override
    {
        beginTest ("Header: MThd, format 0, 1 track, 480 PPQ");
        {
            const auto b = toBytes (MidiExport::buildMidi ({ cMajor }, 120));
            expect (b.size() > 22);
            expect (std::equal (b.begin(), b.begin() + 14,
                                std::vector<juce::uint8> { 'M','T','h','d', 0,0,0,6, 0,0, 0,1, 0x01,0xE0 }.begin()));
            expect (std::equal (b.begin() + 14, b.begin() + 18, std::vector<juce::uint8> { 'M','T','r','k' }.begin()));

            const auto trackLen = (size_t) ((b[18] << 24) | (b[19] << 16) | (b[20] << 8) | b[21]);
            expectEquals ((int) trackLen, (int) b.size() - 22);
        }

        beginTest ("Tempo and time signature meta events");
        {
            const auto b = toBytes (MidiExport::buildMidi ({ cMajor }, 120));
            // 120bpm = 500000us = 0x07A120
            const std::vector<juce::uint8> expected { 0,0xFF,0x51,3,0x07,0xA1,0x20, 0,0xFF,0x58,4,4,2,24,8 };
            expect (std::equal (expected.begin(), expected.end(), b.begin() + 22));

            const auto b40 = toBytes (MidiExport::buildMidi ({ cMajor }, 10));  // 40 にクランプ → 1500000us
            expectEquals ((int) b40[26], 0x16); expectEquals ((int) b40[27], 0xE3); expectEquals ((int) b40[28], 0x60);
        }

        beginTest ("End of track");
        {
            const auto b = toBytes (MidiExport::buildMidi ({ cMajor }, 120));
            expect (std::equal (b.end() - 4, b.end(), std::vector<juce::uint8> { 0,0xFF,0x2F,0 }.begin()));
        }

        beginTest ("Voicing: bass C2-B2, upper voice from C3-B3");
        {
            expect (MidiExport::voicing (cMajor) == std::vector<int> { 36, 48, 52, 55 });
            expect (MidiExport::voicing (fM7)    == std::vector<int> { 41, 53, 57, 60, 64 });
            expect (MidiExport::voicing ({ 11, { 0, 3, 7 } }) == std::vector<int> { 47, 59, 62, 66 });
        }

        beginTest ("Delta times, note on/off pairing (parsed with juce::MidiFile)");
        {
            const auto mb = MidiExport::buildMidi ({ cMajor, fM7 }, 120);
            juce::MemoryInputStream in (mb, false);
            juce::MidiFile mf;
            expect (mf.readFrom (in));
            expectEquals (mf.getNumTracks(), 1);
            expectEquals ((int) mf.getTimeFormat(), 480);

            auto seq = *mf.getTrack (0);
            seq.updateMatchedPairs();

            int ons = 0;
            for (auto* e : seq)
            {
                const auto& m = e->message;
                if (! m.isNoteOn()) continue;
                ++ons;
                expectEquals ((int) m.getVelocity(), 90);
                expect (e->noteOffObject != nullptr);

                const auto start = m.getTimeStamp();
                expect (start == 0.0 || start == 1920.0);
                expectEquals (e->noteOffObject->message.getTimeStamp(), start + 1910.0);
            }
            expectEquals (ons, 4 + 5);
        }

        beginTest ("Repeated chord does not overlap");
        {
            const auto mb = MidiExport::buildMidi ({ cMajor, cMajor }, 120);
            juce::MemoryInputStream in (mb, false);
            juce::MidiFile mf;
            expect (mf.readFrom (in));
            for (auto* e : *mf.getTrack (0))
            {
                const auto t = e->message.getTimeStamp();
                if (e->message.isNoteOn())  expect (t == 0.0 || t == 1920.0);
                if (e->message.isNoteOff()) expect (t == 1910.0 || t == 3830.0);
            }
        }

        beginTest ("Large delta uses multi-byte VLQ");
        {
            // 1コード目の on(0) → off(1910) のデルタ 1910 = 0x8E 0x76
            const auto b = toBytes (MidiExport::buildMidi ({ cMajor }, 120));
            const std::vector<juce::uint8> pattern { 0x8E, 0x76, 0x80 };
            expect (std::search (b.begin(), b.end(), pattern.begin(), pattern.end()) != b.end());
        }

        beginTest ("Safe file names");
        {
            expectEquals (MidiExport::safeFileName (juce::String::fromUTF8 ("F♯m7♭5")), juce::String ("F#m7b5"));
            expectEquals (MidiExport::safeFileName (juce::String::fromUTF8 ("C_王道進行")), juce::String::fromUTF8 ("C_王道進行"));
            expectEquals (MidiExport::safeFileName ("../etc/passwd"), juce::String ("___etc_passwd"));
            expectEquals (MidiExport::safeFileName (juce::String::fromUTF8 ("I–V–VIm–IV")), juce::String ("I_V_VIm_IV"));
        }
    }
};

static MidiExportTests midiExportTests;

int main()
{
    juce::UnitTestRunner runner;
    runner.runTests ({ &midiExportTests });

    for (int i = 0; i < runner.getNumResults(); ++i)
        if (runner.getResult (i)->failures > 0)
            return 1;

    return 0;
}
