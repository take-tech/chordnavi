cmake_minimum_required(VERSION 3.22)

# macOS の設定は project() より前に置く（配布用に Intel / Apple Silicon 両対応のユニバーサルバイナリ）
set(CMAKE_OSX_DEPLOYMENT_TARGET "11.0" CACHE STRING "")
set(CMAKE_OSX_ARCHITECTURES "arm64;x86_64" CACHE STRING "")

project(ChordNavi VERSION 0.9.0)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# JUCE 8（ローカルに JUCE があれば -DFETCHCONTENT_SOURCE_DIR_JUCE=<path> で再利用可）
include(FetchContent)
FetchContent_Declare(
    JUCE
    GIT_REPOSITORY https://github.com/juce-framework/JUCE.git
    GIT_TAG        8.0.13
    GIT_SHALLOW    TRUE
    GIT_PROGRESS   TRUE
)
FetchContent_MakeAvailable(JUCE)

# ──────────────────────────────────────────────────────
# UI（ui/ 配下 + JUCE 付属の JS ブリッジ）をバイナリに埋め込む
# ──────────────────────────────────────────────────────
file(GLOB_RECURSE UI_FILES CONFIGURE_DEPENDS "${CMAKE_CURRENT_SOURCE_DIR}/ui/*")
set(JUCE_JS_DIR "${juce_SOURCE_DIR}/modules/juce_gui_extra/native/javascript")

juce_add_binary_data(GodokenUIData
    HEADER_NAME GodokenUIData.h
    NAMESPACE GodokenUIData
    SOURCES
        ${UI_FILES}
        "${JUCE_JS_DIR}/index.js"
        "${JUCE_JS_DIR}/check_native_interop.js"
)

# ──────────────────────────────────────────────────────
# Plugin Target
# ──────────────────────────────────────────────────────
juce_add_plugin(ChordNavi
    VERSION                     0.9.0
    COMPANY_NAME                Ranze
    PLUGIN_MANUFACTURER_CODE    Rnze
    PLUGIN_CODE                 Gdkn
    FORMATS                     VST3 AU Standalone
    PRODUCT_NAME                "ChordNavi"
    ICON_BIG                    "${CMAKE_CURRENT_SOURCE_DIR}/assets/icon/ChordNavi.png"   # 案 B（鍵盤）。元データは icon_B.svg
    IS_SYNTH                    TRUE
    NEEDS_MIDI_INPUT            TRUE
    NEEDS_MIDI_OUTPUT           FALSE
    IS_MIDI_EFFECT              FALSE
    EDITOR_WANTS_KEYBOARD_FOCUS TRUE
    VST3_CATEGORIES             "Instrument" "Tools"
    AU_MAIN_TYPE                kAudioUnitType_MusicDevice
)

target_sources(ChordNavi PRIVATE
    Source/PluginProcessor.cpp
    Source/PluginEditor.cpp
    Source/MidiExport.cpp
    Source/PreviewSynth.cpp
    Source/PluginState.cpp
    Source/StandaloneApp.cpp
)

target_compile_definitions(ChordNavi PUBLIC
    JUCE_USE_CUSTOM_PLUGIN_STANDALONE_APP=1   # Standalone は Source/StandaloneApp.cpp（ネイティブのタイトルバーとメニューバー）
    JUCE_WEB_BROWSER=1
    JUCE_USE_CURL=0
    JUCE_VST3_CAN_REPLACE_VST2=0
)

target_link_libraries(ChordNavi
    PRIVATE
        GodokenUIData
        juce::juce_audio_utils
        juce::juce_gui_extra
    PUBLIC
        juce::juce_recommended_config_flags
        juce::juce_recommended_lto_flags
        juce::juce_recommended_warning_flags
)

# ──────────────────────────────────────────────────────
# MIDI 生成の単体テスト
# ──────────────────────────────────────────────────────
enable_testing()

juce_add_console_app(MidiExportTests PRODUCT_NAME "MidiExportTests")

target_sources(MidiExportTests PRIVATE
    tests/MidiExportTests.cpp
    tests/PreviewSynthTests.cpp
    tests/PluginStateTests.cpp
    Source/MidiExport.cpp
    Source/PreviewSynth.cpp
    Source/PluginState.cpp
)

target_include_directories(MidiExportTests PRIVATE Source)

target_compile_definitions(MidiExportTests PRIVATE
    JUCE_USE_CURL=0
    JUCE_WEB_BROWSER=0
    JUCE_UNIT_TESTS=1
)

target_link_libraries(MidiExportTests
    PRIVATE
        juce::juce_audio_basics
        juce::juce_data_structures
    PUBLIC
        juce::juce_recommended_config_flags
        juce::juce_recommended_warning_flags
)

add_test(NAME MidiExportTests COMMAND MidiExportTests)
