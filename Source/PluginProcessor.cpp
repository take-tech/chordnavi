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

    if (auto* playHead = getPlayHead())
        if (const auto position = playHead->getPosition())
            if (const auto bpm = position->getBpm())
                hostBpm.store (*bpm);

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
