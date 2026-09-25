/* 試聴。プラグイン内では C++ 側の簡易シンセ（processBlock）で鳴らす。
   ブラウザで ui/ を直接開いたとき（開発用プレビュー）だけ WebAudio の三角波で代用する */
import {CHORD,voicing} from './theory.js';

const juce=window.__JUCE__?await import('./juce/index.js'):null;
const nativePlay=juce?juce.getNativeFunction('playChords'):null;

const SINGLE_DUR=1.1;

// 試聴の音色（MIDI 出力には影響しない）。id は C++ 側 PreviewSynth::Timbre に対応
export const TIMBRES=[
  {id:'triangle',name:'シンプル（三角波）'},
  {id:'piano',name:'ピアノ'},
  {id:'electricPiano',name:'エレピ'},
  {id:'guitar',name:'ギター'},
  {id:'organ',name:'オルガン（減衰なし）'},
  {id:'pad',name:'パッド（減衰なし）'}
];

// events: [{ch, start, dur}]（秒）。呼ぶたびにそれまでの試聴は止まる（C++ 側）
function play(events,timbre){
  if(nativePlay){
    nativePlay({timbre,chords:events.map(({ch,start,dur})=>
      ({root:ch.root,iv:CHORD[ch.q].iv,start,dur,...(ch.bass!=null?{bass:ch.bass}:{})}))})
      .catch(err=>console.error(err));
    return;
  }
  events.forEach(({ch,start,dur})=>webAudioChord(ch,start,dur));
}

// 試聴中の音と予約をすべて止める
const nativeStop=juce?juce.getNativeFunction('stopPreview'):null;
export function stopPreview(){
  if(nativeStop)nativeStop().catch(err=>console.error(err));
  else if(ac){ac.close();ac=null;}
}

export function playChord(ch,timbre){play([{ch,start:0,dur:SINGLE_DUR}],timbre);}

// 進行は MIDI と同じ長さ：各コードの拍数 × テンポ
export function playProgression(chords,timbre,bpm){
  const beat=60/bpm;let t=0;
  play(chords.map(ch=>{const dur=(ch.beats??4)*beat, e={ch,start:t,dur};t+=dur;return e;}),timbre);
}

let ac=null;
function webAudioChord(ch,when,dur){
  ac=ac||new (window.AudioContext||window.webkitAudioContext)();
  const t=ac.currentTime+when;
  for(const n of voicing(ch)){
    const o=ac.createOscillator(),g=ac.createGain();
    o.type='triangle';o.frequency.value=440*Math.pow(2,(n-69)/12);
    g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(.12,t+.02);g.gain.exponentialRampToValueAtTime(.001,t+dur);
    o.connect(g).connect(ac.destination);o.start(t);o.stop(t+dur+.05);
  }
}
