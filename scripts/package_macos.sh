#!/usr/bin/env bash
# ChordNavi の macOS 用インストーラー（.pkg）を作る。
#   VST3 → /Library/Audio/Plug-Ins/VST3、AU → /Library/Audio/Plug-Ins/Components、Standalone → /Applications
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
IDENTIFIER="com.ranze.chordnavi.pkg"
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

rm -rf "${PAYLOAD_DIR}" "${PACKAGE_DIR}"
mkdir -p "${PAYLOAD_DIR}/Library/Audio/Plug-Ins/VST3"
mkdir -p "${PAYLOAD_DIR}/Library/Audio/Plug-Ins/Components"
mkdir -p "${PAYLOAD_DIR}/Applications"
mkdir -p "${PACKAGE_DIR}"

ditto --noextattr --noqtn "${VST3_SOURCE}" "${PAYLOAD_DIR}/Library/Audio/Plug-Ins/VST3/ChordNavi.vst3"
ditto --noextattr --noqtn "${AU_SOURCE}"   "${PAYLOAD_DIR}/Library/Audio/Plug-Ins/Components/ChordNavi.component"
ditto --noextattr --noqtn "${APP_SOURCE}"  "${PAYLOAD_DIR}/Applications/ChordNavi.app"

app_sign_identity="${MACOS_APP_SIGN_IDENTITY:-"-"}"
codesign_options=(--force --deep --sign "${app_sign_identity}")

if [[ "${app_sign_identity}" != "-" ]]; then
    codesign_options+=(--options runtime --timestamp)
fi

codesign "${codesign_options[@]}" "${PAYLOAD_DIR}/Library/Audio/Plug-Ins/VST3/ChordNavi.vst3"
codesign "${codesign_options[@]}" "${PAYLOAD_DIR}/Library/Audio/Plug-Ins/Components/ChordNavi.component"
codesign "${codesign_options[@]}" "${PAYLOAD_DIR}/Applications/ChordNavi.app"

# 既に別の場所（~/Library など）に同じバンドルがあると、pkgbuild の既定ではそちらを上書きしてしまう。
# 必ず決まった場所に入るよう、再配置（relocation）を無効にする
COMPONENT_PLIST="${BUILD_DIR}/pkg-components.plist"
pkgbuild --analyze --root "${PAYLOAD_DIR}" "${COMPONENT_PLIST}"
count="$(/usr/libexec/PlistBuddy -c "Print" "${COMPONENT_PLIST}" | grep -c "RootRelativeBundlePath")"
for ((i = 0; i < count; i++)); do
    /usr/libexec/PlistBuddy -c "Delete :${i}:BundleIsRelocatable" "${COMPONENT_PLIST}" 2>/dev/null || true
    /usr/libexec/PlistBuddy -c "Add :${i}:BundleIsRelocatable bool false" "${COMPONENT_PLIST}"
done

pkgbuild_args=(
    --root "${PAYLOAD_DIR}"
    --component-plist "${COMPONENT_PLIST}"
    --identifier "${IDENTIFIER}"
    --version "${VERSION}"
    --install-location "/"
    --ownership recommended
)

if [[ -n "${MACOS_INSTALLER_SIGN_IDENTITY}" ]]; then
    pkgbuild_args+=(--sign "${MACOS_INSTALLER_SIGN_IDENTITY}")
fi

pkgbuild "${pkgbuild_args[@]}" "${PKG_OUTPUT}"

if [[ -n "${MACOS_NOTARY_APPLE_ID}" && -n "${MACOS_NOTARY_PASSWORD}" && -n "${MACOS_NOTARY_TEAM_ID}" ]]; then
    xcrun notarytool submit "${PKG_OUTPUT}" \
        --apple-id "${MACOS_NOTARY_APPLE_ID}" \
        --password "${MACOS_NOTARY_PASSWORD}" \
        --team-id "${MACOS_NOTARY_TEAM_ID}" \
        --wait

    xcrun stapler staple "${PKG_OUTPUT}"
fi

echo "Created ${PKG_OUTPUT}"
