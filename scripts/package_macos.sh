#!/usr/bin/env bash
# ChordNavi の macOS 用インストーラー（.pkg）を作る。
#   VST3 → /Library/Audio/Plug-Ins/VST3、AU → /Library/Audio/Plug-Ins/Components、Standalone → /Applications
# 形式ごとに部品の pkg を作り、productbuild で1つにまとめる（インストール時の「カスタマイズ」でどれを入れるか選べる）
# 先に Release ビルドしておくこと：
#   cmake -S . -B build-release -DCMAKE_BUILD_TYPE=Release && cmake --build build-release --config Release
# 署名・公証は環境変数があるときだけ行う（無ければ ad-hoc 署名の未公証 .pkg）
set -euo pipefail

# 拡張属性（._ ファイル）をパッケージに入れない
export COPYFILE_DISABLE=1

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_DIR="${BUILD_DIR:-${ROOT_DIR}/build-release}"
ARTIFACTS_DIR="${BUILD_DIR}/ChordNavi_artefacts"
PACKAGE_DIR="${BUILD_DIR}/packages"
PAYLOAD_DIR="${BUILD_DIR}/pkg-payload"
IDENTIFIER_PREFIX="com.ranze.chordnavi"
COMPONENT_PKG_DIR="${BUILD_DIR}/pkg-components"
DEFAULT_VERSION="$(sed -n 's/^project(ChordNavi VERSION \([0-9.]*\)).*/\1/p' "${ROOT_DIR}/CMakeLists.txt")"
VERSION="${CHORDNAVI_VERSION:-}"
VERSION="${VERSION:-${DEFAULT_VERSION}}"
MACOS_APP_SIGN_IDENTITY="${MACOS_APP_SIGN_IDENTITY:-}"
MACOS_INSTALLER_SIGN_IDENTITY="${MACOS_INSTALLER_SIGN_IDENTITY:-}"
MACOS_NOTARY_APPLE_ID="${MACOS_NOTARY_APPLE_ID:-}"
MACOS_NOTARY_PASSWORD="${MACOS_NOTARY_PASSWORD:-}"
MACOS_NOTARY_TEAM_ID="${MACOS_NOTARY_TEAM_ID:-}"

PKG_OUTPUT="${PACKAGE_DIR}/ChordNavi-${VERSION}-macOS.pkg"

find_bundle() {
    find "${ARTIFACTS_DIR}" -type d -name "$1" -path "*Release*" | head -n 1
}

VST3_SOURCE="$(find_bundle "ChordNavi.vst3")"
AU_SOURCE="$(find_bundle "ChordNavi.component")"
APP_SOURCE="$(find_bundle "ChordNavi.app")"

for bundle in "${VST3_SOURCE}" "${AU_SOURCE}" "${APP_SOURCE}"; do
    if [[ ! -d "${bundle}" ]]; then
        echo "Missing Release bundles under: ${ARTIFACTS_DIR}" >&2
        echo "Run: cmake --build build-release --config Release" >&2
        exit 1
    fi
done

rm -rf "${PAYLOAD_DIR}" "${PACKAGE_DIR}" "${COMPONENT_PKG_DIR}"
mkdir -p "${PACKAGE_DIR}" "${COMPONENT_PKG_DIR}"

app_sign_identity="${MACOS_APP_SIGN_IDENTITY:-"-"}"
codesign_options=(--force --deep --sign "${app_sign_identity}")

if [[ "${app_sign_identity}" != "-" ]]; then
    codesign_options+=(--options runtime --timestamp)
fi

# 部品の pkg を1つ作る：<名前> <元のバンドル> <入れる場所（/ からの相対）>
build_component() {
    local name="$1" source="$2" dest="$3"
    local root="${PAYLOAD_DIR}/${name}"
    mkdir -p "${root}/${dest}"
    ditto --noextattr --noqtn "${source}" "${root}/${dest}/$(basename "${source}")"
    codesign "${codesign_options[@]}" "${root}/${dest}/$(basename "${source}")"

    # 既に別の場所（~/Library など）に同じバンドルがあると、pkgbuild の既定ではそちらを上書きしてしまう。
    # 必ず決まった場所に入るよう、再配置（relocation）を無効にする
    local plist="${PAYLOAD_DIR}/${name}-components.plist"
    pkgbuild --analyze --root "${root}" "${plist}"
    local count i
    count="$(/usr/libexec/PlistBuddy -c "Print" "${plist}" | grep -c "RootRelativeBundlePath")"
    for ((i = 0; i < count; i++)); do
        /usr/libexec/PlistBuddy -c "Delete :${i}:BundleIsRelocatable" "${plist}" 2>/dev/null || true
        /usr/libexec/PlistBuddy -c "Add :${i}:BundleIsRelocatable bool false" "${plist}"
    done

    pkgbuild --root "${root}" \
             --component-plist "${plist}" \
             --identifier "${IDENTIFIER_PREFIX}.${name}" \
             --version "${VERSION}" \
             --install-location "/" \
             --ownership recommended \
             "${COMPONENT_PKG_DIR}/ChordNavi-${name}.pkg"
}

build_component au   "${AU_SOURCE}"   "Library/Audio/Plug-Ins/Components"
build_component vst3 "${VST3_SOURCE}" "Library/Audio/Plug-Ins/VST3"
build_component app  "${APP_SOURCE}"  "Applications"

# インストーラーの画面：「カスタマイズ」で AU・VST3・Standalone を選ぶ（既定はすべて）
DISTRIBUTION="${PAYLOAD_DIR}/distribution.xml"
cat > "${DISTRIBUTION}" <<XML
<?xml version="1.0" encoding="utf-8"?>
<installer-gui-script minSpecVersion="2">
    <title>ChordNavi ${VERSION}</title>
    <options customize="always" require-scripts="false" hostArchitectures="arm64,x86_64"/>
    <domains enable_localSystem="true"/>
    <allowed-os-versions><os-version min="11.0"/></allowed-os-versions>
    <choices-outline>
        <line choice="au"/>
        <line choice="vst3"/>
        <line choice="app"/>
    </choices-outline>
    <choice id="au" title="AU（Audio Unit）" start_selected="true"
            description="Logic Pro・GarageBand など用。/Library/Audio/Plug-Ins/Components に入ります。">
        <pkg-ref id="${IDENTIFIER_PREFIX}.au"/>
    </choice>
    <choice id="vst3" title="VST3" start_selected="true"
            description="Ableton Live・Cubase・Studio One・Bitwig・Reaper・FL Studio など用。/Library/Audio/Plug-Ins/VST3 に入ります。">
        <pkg-ref id="${IDENTIFIER_PREFIX}.vst3"/>
    </choice>
    <choice id="app" title="Standalone（単体アプリ）" start_selected="true"
            description="DAW なしで使えるアプリ。/Applications に入ります。">
        <pkg-ref id="${IDENTIFIER_PREFIX}.app"/>
    </choice>
    <pkg-ref id="${IDENTIFIER_PREFIX}.au"   version="${VERSION}" onConclusion="none">ChordNavi-au.pkg</pkg-ref>
    <pkg-ref id="${IDENTIFIER_PREFIX}.vst3" version="${VERSION}" onConclusion="none">ChordNavi-vst3.pkg</pkg-ref>
    <pkg-ref id="${IDENTIFIER_PREFIX}.app"  version="${VERSION}" onConclusion="none">ChordNavi-app.pkg</pkg-ref>
</installer-gui-script>
XML

productbuild_args=(
    --distribution "${DISTRIBUTION}"
    --package-path "${COMPONENT_PKG_DIR}"
)

if [[ -n "${MACOS_INSTALLER_SIGN_IDENTITY}" ]]; then
    productbuild_args+=(--sign "${MACOS_INSTALLER_SIGN_IDENTITY}")
fi

productbuild "${productbuild_args[@]}" "${PKG_OUTPUT}"

if [[ -n "${MACOS_NOTARY_APPLE_ID}" && -n "${MACOS_NOTARY_PASSWORD}" && -n "${MACOS_NOTARY_TEAM_ID}" ]]; then
    xcrun notarytool submit "${PKG_OUTPUT}" \
        --apple-id "${MACOS_NOTARY_APPLE_ID}" \
        --password "${MACOS_NOTARY_PASSWORD}" \
        --team-id "${MACOS_NOTARY_TEAM_ID}" \
        --wait

    xcrun stapler staple "${PKG_OUTPUT}"
fi

echo "Created ${PKG_OUTPUT}"
