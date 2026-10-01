/* DAW（ホスト）の情報。プラグイン内でのみ使える。ブラウザ／Standalone では DAW 同期なし */
import {juce,onNative} from '../shared/ui/juce-bridge.js';   // JUCE の JS はプラグイン・Standalone の中でだけ読まれる
const nativeInfo=juce?juce.getNativeFunction('getHostInfo'):null;

// { standalone, bpm }。bpm は取得できていなければ 0
export async function getHostInfo(){
  if(!nativeInfo)return {standalone:true,bpm:0};
  try{return await nativeInfo();}catch(e){console.error(e);return {standalone:true,bpm:0};}
}

// MIDI キーボード（DAW から来る MIDI を含む）で鳴っている音が変わったときに呼ばれる：{ notes: [MIDI 番号…] }
export function onMidiNotes(cb){
  onNative('midiNotes',info=>cb(info));
}

// Standalone のメニューでテーマが選ばれたとき："light" / "dark" / "auto"
export function onSetTheme(cb){
  onNative('setTheme',name=>cb(name));
}
// 今のテーマを C++ に知らせる（メニューのチェック用）
const nativeReportTheme=juce?juce.getNativeFunction('reportTheme'):null;
export function reportTheme(name){if(nativeReportTheme)nativeReportTheme(name).catch(err=>console.error(err));}

// DAW のテンポが変わったときに呼ばれる
export function onHostTempo(cb){
  onNative('hostTempo',info=>cb(info));
}

// 進行の試聴で鳴っているコードが変わったときに呼ばれる：{ session, index, playing }
export function onPreviewPos(cb){
  onNative('previewPos',info=>cb(info));
}
