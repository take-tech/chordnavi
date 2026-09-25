#include "PluginProcessor.h"
#include "PluginEditor.h"

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
    previewSynth.render (buffer);
}

juce::AudioProcessorEditor* GodokenProcessor::createEditor()
{
    return new GodokenEditor (*this);
}

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter()
{
    return new GodokenProcessor();
}
