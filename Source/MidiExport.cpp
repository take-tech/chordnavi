#include "MidiExport.h"

#include <algorithm>

namespace MidiExport
{
namespace
{
    struct Event
    {
        int tick;
        bool isOn;
        juce::uint8 bytes[3];
    };

    void appendVlq (std::vector<juce::uint8>& out, juce::uint32 value)
    {
        juce::uint8 buf[4];
        int n = 0;
        buf[n++] = (juce::uint8) (value & 0x7f);

        while ((value >>= 7) != 0)
            buf[n++] = (juce::uint8) ((value & 0x7f) | 0x80);

        while (n > 0)
            out.push_back (buf[--n]);
    }

    void appendBigEndian (std::vector<juce::uint8>& out, juce::uint32 value, int numBytes)
    {
        for (int i = numBytes - 1; i >= 0; --i)
            out.push_back ((juce::uint8) ((value >> (8 * i)) & 0xff));
    }
}

std::vector<int> voicing (const Chord& chord)
{
    const int root = ((chord.root % 12) + 12) % 12;
    const int bass = chord.bass >= 0 ? chord.bass % 12 : root;
    std::vector<int> notes { 36 + bass };

    for (auto iv : chord.intervals)
        notes.push_back (48 + root + iv);

    return notes;
}

juce::MemoryBlock buildMidi (const std::vector<Chord>& chords, int bpm)
{
    bpm = juce::jlimit (minBpm, maxBpm, bpm);
    const auto usPerQuarter = (juce::uint32) juce::roundToInt (60000000.0 / bpm);

    std::vector<Event> events;

    int t = 0;
    for (const auto& chord : chords)
    {
        const int length = juce::jlimit (1, 16, chord.beats) * ppq;

        for (auto note : voicing (chord))
        {
            const auto n = (juce::uint8) juce::jlimit (0, 127, note);
            events.push_back ({ t, true, { 0x90, n, (juce::uint8) velocity } });
            events.push_back ({ t + length - 10, false, { 0x80, n, 0 } });
        }

        t += length;
    }

    // 同じ時刻ではノートオフを先に
    std::stable_sort (events.begin(), events.end(), [] (const Event& a, const Event& b)
    {
        if (a.tick != b.tick) return a.tick < b.tick;
        return ! a.isOn && b.isOn;
    });

    std::vector<juce::uint8> track {
        0x00, 0xFF, 0x51, 0x03,
        (juce::uint8) ((usPerQuarter >> 16) & 0xff),
        (juce::uint8) ((usPerQuarter >> 8) & 0xff),
        (juce::uint8) (usPerQuarter & 0xff),
        0x00, 0xFF, 0x58, 0x04, 4, 2, 24, 8
    };

    int last = 0;
    for (const auto& e : events)
    {
        appendVlq (track, (juce::uint32) (e.tick - last));
        track.insert (track.end(), e.bytes, e.bytes + 3);
        last = e.tick;
    }

    track.insert (track.end(), { 0x00, 0xFF, 0x2F, 0x00 });

    std::vector<juce::uint8> file { 'M', 'T', 'h', 'd', 0, 0, 0, 6, 0, 0, 0, 1 };
    appendBigEndian (file, (juce::uint32) ppq, 2);
    file.insert (file.end(), { 'M', 'T', 'r', 'k' });
    appendBigEndian (file, (juce::uint32) track.size(), 4);
    file.insert (file.end(), track.begin(), track.end());

    return { file.data(), file.size() };
}

juce::String safeFileName (const juce::String& name)
{
    const auto replaced = name.replace (juce::String::fromUTF8 ("♯"), "#")
                              .replace (juce::String::fromUTF8 ("♭"), "b");
    juce::String out;

    for (auto c : replaced)
    {
        const bool ok = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')
                        || c == '_' || c == '#' || c == '-'
                        || (c >= 0x3040 && c <= 0x30ff)   // ひらがな・カタカナ
                        || (c >= 0x4e00 && c <= 0x9fff);  // 漢字（例：C_王道進行）
        out += ok ? c : juce::juce_wchar ('_');
    }

    return out.isEmpty() ? juce::String ("chord") : out;
}

juce::File writeTempFile (const std::vector<Chord>& chords, int bpm, const juce::String& name)
{
    auto dir = juce::File::getSpecialLocation (juce::File::tempDirectory).getChildFile ("GodokenNavigator");

    if (! dir.createDirectory())
        return {};

    auto file = dir.getChildFile (safeFileName (name) + ".mid");
    const auto data = buildMidi (chords, bpm);

    if (! file.replaceWithData (data.getData(), data.getSize()))
        return {};

    return file;
}
}
