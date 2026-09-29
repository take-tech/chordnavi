/* JUCE（WebBrowserComponent）との橋渡し（ChordNavi・ChordSketch で共通）。
   プラグイン・Standalone の中でだけ JUCE の JS（juce/index.js）を読む。ブラウザで確認するときは使えない（null・何もしない） */
export const juce=window.__JUCE__?await import('./juce/index.js'):null;
export const hasNative=!!juce;
// ネイティブ関数（無ければ null）
export const nativeFn=name=>juce?juce.getNativeFunction(name):null;
// C++ から届くイベント
export function onNative(name,cb){if(window.__JUCE__)window.__JUCE__.backend.addEventListener(name,cb);}
