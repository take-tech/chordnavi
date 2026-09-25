#include "PluginProcessor.h"
#include "PluginEditor.h"
#include "PluginState.h"

GodokenProcessor::GodokenProcessor()
    : AudioProcessor (BusesProperties().withOutput ("Output", juce::AudioChannelSet::stereo(), true))
{
}

void GodokenProcessor::prepareToPlay (double sampleRate, int)
{
    previewSynth.prepare (sampleRate);
}

bool GodokenProcessor::isBusesLayoutSupported (const BusesLayout& layouts) const
{
    const auto& out = layouts.getMainOutputChannelSet();
    return out == juce::AudioChannelSet::mono() || out == juce::AudioChannelSet::stereo();
}

void GodokenProcessor::processBlock (juce::AudioBuffer<float>& buffer, juce::MidiBuffer& midiMessages)
{
    juce::ScopedNoDenormals noDenormals;

    if (auto* ph = getPlayHead())
        if (const auto position = ph->getPosition())
            if (const auto bpm = position->getBpm())
                hostBpm.store (*bpm);

    for (const auto meta : midiMessages)
        handleMidi (meta.getMessage());

    // 表示用：押している音とペダルで伸ばしている音
    juce::uint64 mask[2] {};
    for (int n = 0; n < 128; ++n)
        if (keyDown[(size_t) n] || sustained[(size_t) n])
            mask[n / 64] |= (juce::uint64) 1 << (n % 64);
    liveMask[0].store (mask[0]);
    liveMask[1].store (mask[1]);

    previewSynth.render (buffer);

    if (muted.load())
        buffer.clear();
}

void GodokenProcessor::handleMidi (const juce::MidiMessage& m)
{
    const auto timbre = (PreviewSynth::Timbre) liveTimbre.load();

    if (m.isNoteOn())
    {
        const auto n = (size_t) m.getNoteNumber();
        keyDown[n] = true;
        sustained[n] = false;
        previewSynth.noteOn (m.getNoteNumber(), m.getFloatVelocity(), timbre);
    }
    else if (m.isNoteOff())
    {
        const auto n = (size_t) m.getNoteNumber();
        keyDown[n] = false;
        if (sustainPedal) sustained[n] = true;
        else              previewSynth.noteOff (m.getNoteNumber());
    }
    else if (m.isSustainPedalOn())
    {
        sustainPedal = true;
    }
    else if (m.isSustainPedalOff())
    {
        sustainPedal = false;
        for (int n = 0; n < 128; ++n)
            if (sustained[(size_t) n]) { sustained[(size_t) n] = false; previewSynth.noteOff (n); }
    }
    else if (m.isAllNotesOff() || m.isAllSoundOff())
    {
        keyDown.fill (false);
        sustained.fill (false);
        previewSynth.allNotesOff();
    }
}

std::vector<int> GodokenProcessor::getLiveNotes() const
{
    std::vector<int> notes;
    for (int w = 0; w < 2; ++w)
    {
        const auto bits = liveMask[(size_t) w].load();
        for (int b = 0; b < 64; ++b)
            if (bits & ((juce::uint64) 1 << b))
                notes.push_back (w * 64 + b);
    }
    return notes;
}

void GodokenProcessor::getStateInformation (juce::MemoryBlock& destData)
{
    destData = PluginState::serialise (getUiState());
}

void GodokenProcessor::setStateInformation (const void* data, int sizeInBytes)
{
    const auto json = PluginState::deserialise (data, sizeInBytes);
    if (json.isEmpty())
        return;

    {
        const juce::ScopedLock sl (stateLock);
        uiState = json;
    }
    sendChangeMessage();   // 非同期でメッセージスレッドに届く
}

void GodokenProcessor::setUiState (const juce::String& json)
{
    const juce::ScopedLock sl (stateLock);
    uiState = json;
}

juce::String GodokenProcessor::getUiState() const
{
    const juce::ScopedLock sl (stateLock);
    return uiState;
}

juce::AudioProcessorEditor* GodokenProcessor::createEditor()
{
    return new GodokenEditor (*this);
}

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter()
{
    return new GodokenProcessor();
}
