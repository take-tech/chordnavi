#include "SketchProcessor.h"
#include "SketchEditor.h"
#include "PluginState.h"

SketchProcessor::SketchProcessor()
    : AudioProcessor (BusesProperties().withOutput ("Output", juce::AudioChannelSet::stereo(), true))
{
}

void SketchProcessor::prepareToPlay (double sampleRate, int)
{
    synth.prepare (sampleRate);
    songPlayer.prepare (sampleRate);
}

bool SketchProcessor::isBusesLayoutSupported (const BusesLayout& layouts) const
{
    const auto& out = layouts.getMainOutputChannelSet();
    return out == juce::AudioChannelSet::stereo() || out == juce::AudioChannelSet::mono();
}

void SketchProcessor::processBlock (juce::AudioBuffer<float>& buffer, juce::MidiBuffer& midiMessages)
{
    juce::ScopedNoDenormals noDenormals;

    // 録音の時刻：このブロックの頭の曲の位置（前のブロックの終わり）＋ブロックの中での位置
    const auto songPos = songPlayer.getPosition();
    const auto sr = getSampleRate() > 0 ? getSampleRate() : 44100.0;
    const bool rec = recording.load() && songPos.playing;

    for (const auto meta : midiMessages)
    {
        const auto m = meta.getMessage();
        handleMidi (m);
        if (rec && (m.isNoteOn() || m.isNoteOff()))
        {
            const auto scope = recFifo.write (1);
            if (scope.blockSize1 > 0)
                recEvents[(size_t) scope.startIndex1] = { songPos.session, songPos.seconds + meta.samplePosition / sr,
                                                          m.getNoteNumber(), m.isNoteOn() ? (int) m.getVelocity() : 0, m.isNoteOn() };
        }
    }

    juce::uint64 mask[2] {};
    for (int n = 0; n < 128; ++n)
        if (keyDown[(size_t) n])
            mask[n / 64] |= (juce::uint64) 1 << (n % 64);
    heldMask[0].store (mask[0]);
    heldMask[1].store (mask[1]);

    // 曲の音を PreviewSynth に予約 → シンセを書く → ドラムを足す
    songPlayer.scheduleBlock (synth, buffer.getNumSamples());
    synth.render (buffer);
    songPlayer.renderDrums (buffer);

    if (muted.load())
        buffer.clear();
}

void SketchProcessor::handleMidi (const juce::MidiMessage& m)
{
    const auto timbre = (PreviewSynth::Timbre) liveTimbre.load();

    if (m.isNoteOn())
    {
        const auto n = (size_t) m.getNoteNumber();
        keyDown[n] = true;
        sustained[n] = false;
        synth.noteOn (m.getNoteNumber(), m.getFloatVelocity(), timbre);
    }
    else if (m.isNoteOff())
    {
        const auto n = (size_t) m.getNoteNumber();
        keyDown[n] = false;
        if (sustainPedal) sustained[n] = true;
        else              synth.noteOff (m.getNoteNumber());
    }
    else if (m.isSustainPedalOn())
    {
        sustainPedal = true;
    }
    else if (m.isSustainPedalOff())
    {
        sustainPedal = false;
        for (int n = 0; n < 128; ++n)
            if (sustained[(size_t) n]) { sustained[(size_t) n] = false; synth.noteOff (n); }
    }
    else if (m.isAllNotesOff() || m.isAllSoundOff())
    {
        keyDown.fill (false);
        sustained.fill (false);
        synth.allNotesOff();
    }
}

void SketchProcessor::takeRecEvents (std::vector<RecEvent>& out)
{
    const auto scope = recFifo.read (recFifo.getNumReady());
    for (int i = 0; i < scope.blockSize1; ++i) out.push_back (recEvents[(size_t) (scope.startIndex1 + i)]);
    for (int i = 0; i < scope.blockSize2; ++i) out.push_back (recEvents[(size_t) (scope.startIndex2 + i)]);
}

std::vector<int> SketchProcessor::getHeldNotes() const
{
    std::vector<int> notes;
    for (int n = 0; n < 128; ++n)
        if ((heldMask[(size_t) (n / 64)].load() >> (n % 64)) & 1)
            notes.push_back (n);
    return notes;
}

juce::AudioProcessorEditor* SketchProcessor::createEditor()
{
    return new SketchEditor (*this);
}

void SketchProcessor::getStateInformation (juce::MemoryBlock& dest)
{
    dest = PluginState::serialise (getUiState());
}

void SketchProcessor::setStateInformation (const void* data, int size)
{
    setUiState (PluginState::deserialise (data, size));
}

void SketchProcessor::setUiState (const juce::String& json)
{
    const juce::ScopedLock sl (stateLock);
    uiState = json;
}

juce::String SketchProcessor::getUiState() const
{
    const juce::ScopedLock sl (stateLock);
    return uiState;
}

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter()
{
    return new SketchProcessor();
}
