/* DAW（ホスト）の情報。プラグイン内でのみ使える。ブラウザ／Standalone では DAW 同期なし */
const juce=window.__JUCE__?await import('./juce/index.js'):null;
const nativeInfo=juce?juce.getNativeFunction('getHostInfo'):null;

// { standalone, bpm }。bpm は取得できていなければ 0
export async function getHostInfo(){
  if(!nativeInfo)return {standalone:true,bpm:0};
  try{return await nativeInfo();}catch(e){console.error(e);return {standalone:true,bpm:0};}
}

// MIDI キーボード（DAW から来る MIDI を含む）で鳴っている音が変わったときに呼ばれる：{ notes: [MIDI 番号…] }
export function onMidiNotes(cb){
  if(window.__JUCE__)window.__JUCE__.backend.addEventListener('midiNotes',info=>cb(info));
}

// DAW のテンポが変わったときに呼ばれる
export function onHostTempo(cb){
  if(window.__JUCE__)window.__JUCE__.backend.addEventListener('hostTempo',info=>cb(info));
}
