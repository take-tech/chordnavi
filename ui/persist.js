/* 状態の保存・復元（C++ の getStateInformation／setStateInformation に預ける）。プラグイン内でのみ有効 */
const juce=window.__JUCE__?await import('./juce/index.js'):null;
const nativeSave=juce?juce.getNativeFunction('saveState'):null;
const nativeLoad=juce?juce.getNativeFunction('loadState'):null;

export const STATE_VERSION=1;

// 保存済みの状態（無い・壊れていれば null）
export async function loadState(){
  if(!nativeLoad)return null;
  try{const json=await nativeLoad();return json?JSON.parse(json):null;}
  catch(e){console.error(e);return null;}
}

// 変更が続くときにまとめて送る
let timer=null,last='';
export function saveState(obj){
  if(!nativeSave)return;
  clearTimeout(timer);
  timer=setTimeout(()=>{
    const json=JSON.stringify({v:STATE_VERSION,...obj});
    if(json===last)return;
    last=json;
    nativeSave(json).catch(err=>console.error(err));
  },200);
}

// DAW が状態を復元したとき（プロジェクトの読み込み・取り消しなど）
export function onStateRestored(cb){
  if(window.__JUCE__)window.__JUCE__.backend.addEventListener('stateRestored',json=>{
    try{cb(JSON.parse(json));}catch(e){console.error(e);}
  });
}
