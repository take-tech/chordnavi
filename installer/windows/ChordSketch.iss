; ChordSketch の Windows 用インストーラー（Inno Setup 6。ChordNavi は ChordNavi.iss）
;   Standalone → C:\Program Files\ChordSketch\ChordSketch.exe（スタートメニューにショートカット）
;   .chordsketch をダブルクリックしたら ChordSketch で開く（起動中なら新しいタブ）
; ビルド済みの場所は環境変数 CHORDSKETCH_APP_EXE で渡す（GitHub Actions から）

#define MyAppName "ChordSketch"
#define MyAppVersion GetEnv("CHORDSKETCH_VERSION")
#if MyAppVersion == ""
#define MyAppVersion "0.9.0"
#endif
#define MyAppPublisher "Ranze"
#define MyAppURL "https://github.com/take-tech/chordnavi"
#define SourceApp GetEnv("CHORDSKETCH_APP_EXE")
#if SourceApp == ""
#define SourceApp "..\\..\\build\\ChordSketch_artefacts\\Release\\Standalone\\ChordSketch.exe"
#endif

[Setup]
AppId={{9BF847D5-0D6B-47CD-85C8-74D52ECA083C}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
DefaultDirName={autopf}\{#MyAppName}
DisableDirPage=yes
DisableProgramGroupPage=yes
OutputBaseFilename=ChordSketch-{#MyAppVersion}-Windows-x64-Setup
OutputDir=..\..\build\packages
Compression=lzma2
SolidCompression=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=admin
ChangesAssociations=yes
UninstallDisplayName={#MyAppName}
UninstallDisplayIcon={app}\ChordSketch.exe

[Languages]
Name: "japanese"; MessagesFile: "compiler:Languages\Japanese.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
Source: "{#SourceApp}"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\{#MyAppName}"; Filename: "{app}\ChordSketch.exe"

[Registry]
; .chordsketch（曲ファイル）を ChordSketch に関連付ける。アンインストールで消す
Root: HKA; Subkey: "Software\Classes\.chordsketch"; ValueType: string; ValueName: ""; ValueData: "ChordSketch.Song"; Flags: uninsdeletevalue
Root: HKA; Subkey: "Software\Classes\ChordSketch.Song"; ValueType: string; ValueName: ""; ValueData: "ChordSketch の曲"; Flags: uninsdeletekey
Root: HKA; Subkey: "Software\Classes\ChordSketch.Song\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\ChordSketch.exe,0"
Root: HKA; Subkey: "Software\Classes\ChordSketch.Song\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\ChordSketch.exe"" ""%1"""

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
    MsgBox('ChordSketch の画面表示には「Microsoft Edge WebView2 ランタイム」が必要ですが、見つかりませんでした。' + #13#10 +
           'インストール後、Microsoft のサイトから WebView2 ランタイム（Evergreen）を入れてください。' + #13#10#13#10 +
           'https://developer.microsoft.com/microsoft-edge/webview2/', mbInformation, MB_OK);
end;
