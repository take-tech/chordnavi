/* 試聴（暫定：WebAudio）。マイルストーン5で C++ 側の簡易シンセに置き換える */
import {CHORD} from './theory.js';

function voicing(ch){
  const base=48+ch.root; // C3〜B3
  return [36+ch.root,...CHORD[ch.q].iv.map(i=>base+i)];
}

let ac=null;
export function playChord(ch,when=0,dur=1.1){
  ac=ac||new (window.AudioContext||window.webkitAudioContext)();
  const t=ac.currentTime+when;
  for(const n of voicing(ch)){
    const o=ac.createOscillator(),g=ac.createGain();
    o.type='triangle';o.frequency.value=440*Math.pow(2,(n-69)/12);
    g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(.12,t+.02);g.gain.exponentialRampToValueAtTime(.001,t+dur);
    o.connect(g).connect(ac.destination);o.start(t);o.stop(t+dur+.05);
  }
}

export function playProgression(chords){
  chords.forEach((c,i)=>playChord(c,i*0.9,0.9));
}
