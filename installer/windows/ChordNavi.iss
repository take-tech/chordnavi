; ChordNavi の Windows 用インストーラー（Inno Setup 6）
;   VST3       → C:\Program Files\Common Files\VST3\ChordNavi.vst3
;   Standalone → C:\Program Files\ChordNavi\ChordNavi.exe（スタートメニューにショートカット）
; ビルド済みの場所は環境変数 CHORDNAVI_VST3_DIR / CHORDNAVI_APP_EXE で渡す（GitHub Actions から）

#define MyAppName "ChordNavi"
#define MyAppVersion GetEnv("CHORDNAVI_VERSION")
#if MyAppVersion == ""
#define MyAppVersion "1.0.2"
#endif
#define MyAppPublisher "Ranze"
#define MyAppURL "https://github.com/take-tech/chordnavi"
#define SourceVst3 GetEnv("CHORDNAVI_VST3_DIR")
#if SourceVst3 == ""
#define SourceVst3 "..\\..\\build\\ChordNavi_artefacts\\Release\\VST3\\ChordNavi.vst3"
#endif
#define SourceApp GetEnv("CHORDNAVI_APP_EXE")
#if SourceApp == ""
#define SourceApp "..\\..\\build\\ChordNavi_artefacts\\Release\\Standalone\\ChordNavi.exe"
#endif

[Setup]
AppId={{C26DA975-1FCB-4A91-8648-B7BB70F8914B}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
DefaultDirName={autopf}\{#MyAppName}
DisableDirPage=yes
DisableProgramGroupPage=yes
OutputBaseFilename=ChordNavi-{#MyAppVersion}-Windows-x64-Setup
OutputDir=..\..\build\packages
Compression=lzma2
SolidCompression=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=admin
UninstallDisplayName={#MyAppName}
UninstallDisplayIcon={app}\ChordNavi.exe

[Languages]
Name: "japanese"; MessagesFile: "compiler:Languages\Japanese.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
Source: "{#SourceVst3}\*"; DestDir: "{commoncf64}\VST3\ChordNavi.vst3"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#SourceApp}"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\{#MyAppName}"; Filename: "{app}\ChordNavi.exe"

[InstallDelete]
Type: filesandordirs; Name: "{commoncf64}\VST3\ChordNavi.vst3"

[UninstallDelete]
Type: filesandordirs; Name: "{commoncf64}\VST3\ChordNavi.vst3"

[Code]
// 画面表示に Microsoft Edge WebView2 ランタイムが必要（Windows 11 と、更新済みの Windows 10 には入っている）
function WebView2Installed(): Boolean;
var
  Version: String;
begin
  Result := RegQueryStringValue(HKLM, 'SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Version)
         or RegQueryStringValue(HKCU, 'Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Version);
  Result := Result and (Version <> '') and (Version <> '0.0.0.0');
end;

function InitializeSetup(): Boolean;
begin
  Result := True;
  if not WebView2Installed() then
    MsgBox('ChordNavi の画面表示には「Microsoft Edge WebView2 ランタイム」が必要ですが、見つかりませんでした。' + #13#10 +
           'インストール後、Microsoft のサイトから WebView2 ランタイム（Evergreen）を入れてください。' + #13#10#13#10 +
           'https://developer.microsoft.com/microsoft-edge/webview2/', mbInformation, MB_OK);
end;
