/* MIDI 関連の C++ 連携。MIDI の生成とファイル書き出しは C++（MidiExport）側で行う */
import {CHORD} from './theory.js';

// プラグイン内（WebBrowserComponent）でのみ JUCE ブリッジを読み込む
const juce=window.__JUCE__?await import('./juce/index.js'):null;
const native=name=>juce?juce.getNativeFunction(name):(...a)=>{console.warn(`native ${name} は使えません`,a);return Promise.resolve(null);};
const nativeStartDrag=native('startMidiDrag');
const nativeSave=native('saveMidi');

// { name, bpm, chords:[{root,q,bass?}] } → C++ へ渡す形式
function toRequest({name,bpm,chords}){
  return {name,bpm,chords:chords.map(ch=>({root:ch.root,iv:CHORD[ch.q].iv,...(ch.bass!=null?{bass:ch.bass}:{})}))};
}

// mousedown ＋ 数px の移動で OS のファイルドラッグを開始する。
// ドラッグした場合は直後の click を抑止する（クリック＝試聴と区別するため）
const DRAG_THRESHOLD=4;
let pending=null, suppressClickUntil=0;

addEventListener('mousemove',e=>{
  if(!pending)return;
  if((e.buttons&1)===0){pending=null;return;}
  if(Math.hypot(e.clientX-pending.x,e.clientY-pending.y)<DRAG_THRESHOLD)return;
  const {getRequest}=pending;pending=null;
  suppressClickUntil=performance.now()+500;
  nativeStartDrag(toRequest(getRequest())).catch(err=>console.error(err));
});
addEventListener('mouseup',()=>{pending=null;});
addEventListener('click',e=>{
  if(performance.now()<suppressClickUntil){e.stopPropagation();e.preventDefault();suppressClickUntil=0;}
},true);

export function attachMidiDrag(node,getRequest){
  node.draggable=false;
  node.addEventListener('mousedown',e=>{
    if(e.button!==0)return;
    e.preventDefault();
    pending={x:e.clientX,y:e.clientY,getRequest};
  });
}

// ネイティブの保存ダイアログで .mid を保存
export function saveMidi(req){
  return nativeSave(toRequest(req));
}
