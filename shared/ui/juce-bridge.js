/* JUCE（WebBrowserComponent）との橋渡し（ChordNavi・ChordSketch で共通）。
   プラグイン・Standalone の中でだけ JUCE の JS（juce/index.js）を読む。ブラウザ・Node（単体テスト）では使えない（null・何もしない） */
const bridge=typeof window!=='undefined'?window.__JUCE__:undefined;
export const juce=bridge?await import('./juce/index.js'):null;
export const hasNative=!!juce;
// ネイティブ関数（無ければ null）
export const nativeFn=name=>juce?juce.getNativeFunction(name):null;
// C++ から届くイベント
export function onNative(name,cb){if(bridge)bridge.backend.addEventListener(name,cb);}
