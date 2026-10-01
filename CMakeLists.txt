cmake_minimum_required(VERSION 3.22)

# macOS の設定は project() より前に置く（配布用に Intel / Apple Silicon 両対応のユニバーサルバイナリ）
set(CMAKE_OSX_DEPLOYMENT_TARGET "11.0" CACHE STRING "")
set(CMAKE_OSX_ARCHITECTURES "arm64;x86_64" CACHE STRING "")

project(ChordNavi VERSION 1.0.8)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# ソースに日本語（UTF-8）を含むので、MSVC にも UTF-8 として読ませる
if(MSVC)
    add_compile_options(/utf-8)
endif()

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
# ChordNavi・ChordSketch で共通の C++（shared/cpp）。
# JUCE の部品を 2 回リンクしないよう、ソースを使う側（プラグイン・テスト）でコンパイルする INTERFACE ライブラリにする
# ──────────────────────────────────────────────────────
add_library(RanzeShared INTERFACE)
target_sources(RanzeShared INTERFACE
    ${CMAKE_CURRENT_SOURCE_DIR}/shared/cpp/MidiExport.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/shared/cpp/PreviewSynth.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/shared/cpp/PluginState.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/shared/cpp/WebResources.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/shared/cpp/SongPlayer.cpp
)
target_include_directories(RanzeShared INTERFACE ${CMAKE_CURRENT_SOURCE_DIR}/shared/cpp)

# 埋め込む UI はファイル名（basename）で配信する（shared/cpp/WebResources）。同じ名前のファイルが 2 つあったらビルドを止める
function(ranze_check_unique_names)
    set(seen "")
    foreach(f IN LISTS ARGN)
        get_filename_component(n "${f}" NAME)
        if(n IN_LIST seen)
            message(FATAL_ERROR "埋め込む UI に同じ名前のファイルがあります：${n}（${f}）。WebView はファイル名で配信するので名前を変えてください")
        endif()
        list(APPEND seen "${n}")
    endforeach()
endfunction()

# ──────────────────────────────────────────────────────
# UI（ui/ ＋ 共通の shared/ui/ ＋ JUCE 付属の JS ブリッジ）をバイナリに埋め込む
# ──────────────────────────────────────────────────────
file(GLOB_RECURSE UI_FILES CONFIGURE_DEPENDS "${CMAKE_CURRENT_SOURCE_DIR}/ui/*")
file(GLOB_RECURSE SHARED_UI_FILES CONFIGURE_DEPENDS "${CMAKE_CURRENT_SOURCE_DIR}/shared/ui/*")
set(JUCE_JS_DIR "${juce_SOURCE_DIR}/modules/juce_gui_extra/native/javascript")
set(CHORDNAVI_UI_FILES
    ${UI_FILES}
    ${SHARED_UI_FILES}
    "${JUCE_JS_DIR}/index.js"
    "${JUCE_JS_DIR}/check_native_interop.js"
)
ranze_check_unique_names(${CHORDNAVI_UI_FILES})

juce_add_binary_data(GodokenUIData
    HEADER_NAME GodokenUIData.h
    NAMESPACE GodokenUIData
    SOURCES ${CHORDNAVI_UI_FILES}
)

# ──────────────────────────────────────────────────────
# Plugin Target
# ──────────────────────────────────────────────────────
juce_add_plugin(ChordNavi
    VERSION                     ${PROJECT_VERSION}   # project() のバージョンにそろえる
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
    NEEDS_WEBVIEW2              TRUE   # Windows：WebView2 を静的リンク（macOS では無視される）
)

target_sources(ChordNavi PRIVATE
    Source/PluginProcessor.cpp
    Source/PluginEditor.cpp
    Source/StandaloneApp.cpp
)

if(WIN32)
    # Windows では JS ⇔ C++ 連携に WebView2（Edge）が必要。WebView2Loader.dll を配らなくて済むよう静的リンク
    target_compile_definitions(ChordNavi PUBLIC JUCE_USE_WIN_WEBVIEW2_WITH_STATIC_LINKING=1)
endif()

target_compile_definitions(ChordNavi PUBLIC
    JUCE_USE_CUSTOM_PLUGIN_STANDALONE_APP=1   # Standalone は Source/StandaloneApp.cpp（ネイティブのタイトルバーとメニューバー）
    JUCE_WEB_BROWSER=1
    JUCE_USE_CURL=0
    JUCE_VST3_CAN_REPLACE_VST2=0
)

target_link_libraries(ChordNavi
    PRIVATE
        RanzeShared
        GodokenUIData
        juce::juce_audio_utils
        juce::juce_gui_extra
    PUBLIC
        juce::juce_recommended_config_flags
        juce::juce_recommended_lto_flags
        juce::juce_recommended_warning_flags
)

# ──────────────────────────────────────────────────────
# ChordSketch（1曲単位のコード譜と MIDI を作る派生アプリ。Standalone のみ。仕様は sketch/CLAUDE.md）
# UI は sketch/prototype をそのまま埋め込む（テスト用の .mjs は入れない）
# ──────────────────────────────────────────────────────
file(GLOB SKETCH_UI_FILES CONFIGURE_DEPENDS
    "${CMAKE_CURRENT_SOURCE_DIR}/sketch/prototype/*.html"
    "${CMAKE_CURRENT_SOURCE_DIR}/sketch/prototype/*.js"
    "${CMAKE_CURRENT_SOURCE_DIR}/sketch/prototype/*.css")
set(CHORDSKETCH_UI_FILES
    ${SKETCH_UI_FILES}
    ${SHARED_UI_FILES}
    "${JUCE_JS_DIR}/index.js"
    "${JUCE_JS_DIR}/check_native_interop.js"
)
ranze_check_unique_names(${CHORDSKETCH_UI_FILES})

juce_add_binary_data(ChordSketchUIData
    HEADER_NAME ChordSketchUIData.h
    NAMESPACE ChordSketchUIData
    SOURCES ${CHORDSKETCH_UI_FILES}
)

juce_add_plugin(ChordSketch
    VERSION                     0.1.0
    COMPANY_NAME                Ranze
    PLUGIN_MANUFACTURER_CODE    Rnze
    PLUGIN_CODE                 Cdsk
    FORMATS                     Standalone
    PRODUCT_NAME                "ChordSketch"
    BUNDLE_ID                   com.ranze.chordsketch
    ICON_BIG                    "${CMAKE_CURRENT_SOURCE_DIR}/sketch/assets/icon/ChordSketch.png"   # 案 B（五度圏＋タイムライン）。元データは icon_B.svg
    IS_SYNTH                    TRUE
    NEEDS_MIDI_INPUT            TRUE
    NEEDS_MIDI_OUTPUT           FALSE
    IS_MIDI_EFFECT              FALSE
    EDITOR_WANTS_KEYBOARD_FOCUS TRUE
    NEEDS_WEBVIEW2              TRUE
    DOCUMENT_EXTENSIONS         chordsketch   # Finder でダブルクリックしたら開く（Windows はインストーラーで登録）
)

target_sources(ChordSketch PRIVATE
    sketch/Source/SketchProcessor.cpp
    sketch/Source/SketchEditor.cpp
    sketch/Source/SketchStandaloneApp.cpp
)
if(APPLE)
    # WebView のページのズーム（文字がにじまないように）と印刷（GUI を使うのでテストの RanzeShared には入れない）
    target_sources(ChordSketch PRIVATE shared/cpp/WebViewZoom.mm shared/cpp/WebViewPrint.mm)
endif()

if(WIN32)
    target_compile_definitions(ChordSketch PUBLIC JUCE_USE_WIN_WEBVIEW2_WITH_STATIC_LINKING=1)
endif()

target_compile_definitions(ChordSketch PUBLIC
    JUCE_USE_CUSTOM_PLUGIN_STANDALONE_APP=1   # sketch/Source/SketchStandaloneApp.cpp（ネイティブのタイトルバーとメニューバー）
    JUCE_WEB_BROWSER=1
    JUCE_USE_CURL=0
    JUCE_VST3_CAN_REPLACE_VST2=0
)

target_link_libraries(ChordSketch
    PRIVATE
        RanzeShared
        ChordSketchUIData
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
    tests/WebResourcesTests.cpp
    tests/SongPlayerTests.cpp
)

target_compile_definitions(MidiExportTests PRIVATE
    JUCE_USE_CURL=0
    JUCE_WEB_BROWSER=0
    JUCE_UNIT_TESTS=1
)

target_link_libraries(MidiExportTests
    PRIVATE
        RanzeShared
        juce::juce_audio_basics
        juce::juce_data_structures
    PUBLIC
        juce::juce_recommended_config_flags
        juce::juce_recommended_warning_flags
)

add_test(NAME MidiExportTests COMMAND MidiExportTests)
