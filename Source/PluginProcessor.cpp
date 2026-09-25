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

void GodokenProcessor::processBlock (juce::AudioBuffer<float>& buffer, juce::MidiBuffer&)
{
    juce::ScopedNoDenormals noDenormals;

    if (auto* ph = getPlayHead())
        if (const auto position = ph->getPosition())
            if (const auto bpm = position->getBpm())
                hostBpm.store (*bpm);

    previewSynth.render (buffer);
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
