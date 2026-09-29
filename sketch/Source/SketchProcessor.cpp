#include "SketchProcessor.h"
#include "SketchEditor.h"
#include "PluginState.h"

SketchProcessor::SketchProcessor()
    : AudioProcessor (BusesProperties().withOutput ("Output", juce::AudioChannelSet::stereo(), true))
{
}

void SketchProcessor::prepareToPlay (double, int) {}

bool SketchProcessor::isBusesLayoutSupported (const BusesLayout& layouts) const
{
    const auto& out = layouts.getMainOutputChannelSet();
    return out == juce::AudioChannelSet::stereo() || out == juce::AudioChannelSet::mono();
}

void SketchProcessor::processBlock (juce::AudioBuffer<float>& buffer, juce::MidiBuffer&)
{
    juce::ScopedNoDenormals noDenormals;
    buffer.clear();
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
