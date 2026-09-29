#!/usr/bin/env bash
# ChordSketch の macOS 用インストーラー（.pkg）を作る。Standalone（ChordSketch.app）を /Applications に入れる。
# （ChordNavi は scripts/package_macos.sh。署名・公証の環境変数は同じ）
# 先に Release ビルドしておくこと：
#   cmake -S . -B build-release -DCMAKE_BUILD_TYPE=Release && cmake --build build-release --config Release --target ChordSketch_Standalone
# バージョンは CMake の juce_add_plugin(ChordSketch VERSION …)、または環境変数 CHORDSKETCH_VERSION
# 署名・公証は環境変数があるときだけ行う（無ければ ad-hoc 署名の未公証 .pkg）
set -euo pipefail

# 拡張属性（._ ファイル）をパッケージに入れない
export COPYFILE_DISABLE=1

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_DIR="${BUILD_DIR:-${ROOT_DIR}/build-release}"
ARTIFACTS_DIR="${BUILD_DIR}/ChordSketch_artefacts"
PACKAGE_DIR="${BUILD_DIR}/packages"
WORK_DIR="${BUILD_DIR}/sketch-pkg"
IDENTIFIER="com.ranze.chordsketch.app"
DEFAULT_VERSION="$(sed -n '/^juce_add_plugin(ChordSketch/,/^)/s/^ *VERSION *\([0-9.]*\).*/\1/p' "${ROOT_DIR}/CMakeLists.txt")"
VERSION="${CHORDSKETCH_VERSION:-}"
VERSION="${VERSION:-${DEFAULT_VERSION}}"
MACOS_APP_SIGN_IDENTITY="${MACOS_APP_SIGN_IDENTITY:-}"
MACOS_INSTALLER_SIGN_IDENTITY="${MACOS_INSTALLER_SIGN_IDENTITY:-}"
MACOS_NOTARY_APPLE_ID="${MACOS_NOTARY_APPLE_ID:-}"
MACOS_NOTARY_PASSWORD="${MACOS_NOTARY_PASSWORD:-}"
MACOS_NOTARY_TEAM_ID="${MACOS_NOTARY_TEAM_ID:-}"

PKG_OUTPUT="${PACKAGE_DIR}/ChordSketch-${VERSION}-macOS.pkg"

APP_SOURCE="$(find "${ARTIFACTS_DIR}" -type d -name "ChordSketch.app" -path "*Release*" 2>/dev/null | head -n 1)"
if [[ ! -d "${APP_SOURCE}" ]]; then
    echo "Missing Release ChordSketch.app under: ${ARTIFACTS_DIR}" >&2
    echo "Run: cmake --build build-release --config Release --target ChordSketch_Standalone" >&2
    exit 1
fi

rm -rf "${WORK_DIR}" "${PKG_OUTPUT}"
mkdir -p "${PACKAGE_DIR}" "${WORK_DIR}/root/Applications"

APP="${WORK_DIR}/root/Applications/ChordSketch.app"
ditto --noextattr --noqtn "${APP_SOURCE}" "${APP}"

app_sign_identity="${MACOS_APP_SIGN_IDENTITY:-"-"}"
codesign_options=(--force --deep --sign "${app_sign_identity}")
if [[ "${app_sign_identity}" != "-" ]]; then
    codesign_options+=(--options runtime --timestamp)
fi
codesign "${codesign_options[@]}" "${APP}"

# 既に別の場所に同じアプリがあると、pkgbuild の既定ではそちらを上書きしてしまう。必ず /Applications に入るよう再配置を無効にする
PLIST="${WORK_DIR}/components.plist"
pkgbuild --analyze --root "${WORK_DIR}/root" "${PLIST}"
count="$(/usr/libexec/PlistBuddy -c "Print" "${PLIST}" | grep -c "RootRelativeBundlePath")"
for ((i = 0; i < count; i++)); do
    /usr/libexec/PlistBuddy -c "Delete :${i}:BundleIsRelocatable" "${PLIST}" 2>/dev/null || true
    /usr/libexec/PlistBuddy -c "Add :${i}:BundleIsRelocatable bool false" "${PLIST}"
done

pkgbuild --root "${WORK_DIR}/root" \
         --component-plist "${PLIST}" \
         --identifier "${IDENTIFIER}" \
         --version "${VERSION}" \
         --install-location "/" \
         --ownership recommended \
         "${WORK_DIR}/ChordSketch-app.pkg"

DISTRIBUTION="${WORK_DIR}/distribution.xml"
cat > "${DISTRIBUTION}" <<XML
<?xml version="1.0" encoding="utf-8"?>
<installer-gui-script minSpecVersion="2">
    <title>ChordSketch ${VERSION}</title>
    <options customize="never" require-scripts="false" hostArchitectures="arm64,x86_64"/>
    <domains enable_localSystem="true"/>
    <allowed-os-versions><os-version min="11.0"/></allowed-os-versions>
    <choices-outline>
        <line choice="app"/>
    </choices-outline>
    <choice id="app" title="ChordSketch" description="/Applications に入ります。">
        <pkg-ref id="${IDENTIFIER}"/>
    </choice>
    <pkg-ref id="${IDENTIFIER}" version="${VERSION}" onConclusion="none">ChordSketch-app.pkg</pkg-ref>
</installer-gui-script>
XML

productbuild_args=(--distribution "${DISTRIBUTION}" --package-path "${WORK_DIR}")
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
