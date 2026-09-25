/* 試聴。プラグイン内では C++ 側の簡易シンセ（processBlock）で鳴らす。
   ブラウザで ui/ を直接開いたとき（開発用プレビュー）だけ WebAudio で代用する */
import {CHORD,voicing} from './theory.js';

const juce=window.__JUCE__?await import('./juce/index.js'):null;
const nativePlay=juce?juce.getNativeFunction('playChords'):null;

const SINGLE_DUR=1.1, PROG_STEP=0.9;

function play(chords,interval,duration){
  if(nativePlay){
    nativePlay({interval,duration,
      chords:chords.map(ch=>({root:ch.root,iv:CHORD[ch.q].iv,...(ch.bass!=null?{bass:ch.bass}:{})}))})
      .catch(err=>console.error(err));
    return;
  }
  chords.forEach((ch,i)=>webAudioChord(ch,i*interval,duration));
}

export function playChord(ch){play([ch],PROG_STEP,SINGLE_DUR);}
export function playProgression(chords){play(chords,PROG_STEP,PROG_STEP);}

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
