/* ChordSketch：ブラウザでの試聴（WebAudio）。プラグインでは C++ の PreviewSynth に置き換える
   先読みスケジューラ：25ms ごとに少し先までの音を予約する。ループは周の終わりで曲データを読み直す（編集がすぐ反映される） */
import {tickToSec,secToTick,meterAt,barTicksOf,beatTicksOf,tempoAt} from './song.js';

export const TIMBRES=[
  {id:'piano',name:'ピアノ'},{id:'triangle',name:'シンプル（三角波）'},{id:'organ',name:'オルガン'},{id:'pad',name:'パッド'}
];
export const METRONOMES=[
  {id:'off',name:'メトロノームなし'},{id:'click',name:'♪ クリック'},{id:'8beat',name:'♪ 8ビート'},{id:'16beat',name:'♪ 16ビート'},{id:'shuffle',name:'♪ シャッフル'}
];

let ac=null, master=null, noise=null, muted=false;
const LEVEL=.8;
function ctx(){
  if(ac)return ac;
  ac=new (window.AudioContext||window.webkitAudioContext)();
  const comp=ac.createDynamicsCompressor();comp.threshold.value=-10;comp.ratio.value=4;
  master=ac.createGain();master.gain.value=muted?0:LEVEL;master.connect(comp).connect(ac.destination);
  noise=ac.createBuffer(1,ac.sampleRate,ac.sampleRate);
  const d=noise.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=Math.random()*2-1;
  return ac;
}
const hz=n=>440*Math.pow(2,(n-69)/12);

/* ---------- 音色 ---------- */
// when・dur は秒。dur が null なら止めるまで鳴らす（MIDI 鍵盤）。戻り値は止める関数
function voice(n,v,when,dur,timbre,dest=master){
  const a=ctx(), g=a.createGain(), amp=.16*(v/100), oscs=[];
  const osc=(type,f,gain=1,detune=0)=>{const o=a.createOscillator(),og=a.createGain();o.type=type;o.frequency.value=f;o.detune.value=detune;og.gain.value=gain;o.connect(og).connect(g);oscs.push(o);return o;};
  let out=g, release=.08;
  if(timbre==='piano'){
    osc('triangle',hz(n));osc('sine',hz(n)*2,.35);osc('sine',hz(n)*3,.12);
    g.gain.setValueAtTime(0,when);g.gain.linearRampToValueAtTime(amp*1.3,when+.005);
    g.gain.setTargetAtTime(amp*.25,when+.005,n>60?.35:.6);release=.12;
  }else if(timbre==='organ'){
    osc('sine',hz(n),.8);osc('sine',hz(n)*2,.5);osc('sine',hz(n)*4,.15);osc('sine',hz(n)/2,.3);
    g.gain.setValueAtTime(0,when);g.gain.linearRampToValueAtTime(amp*.7,when+.01);release=.04;
  }else if(timbre==='pad'){
    osc('sawtooth',hz(n),.35,-7);osc('sawtooth',hz(n),.35,7);
    const lp=a.createBiquadFilter();lp.type='lowpass';lp.frequency.value=1400;g.connect(lp);out=lp;
    g.gain.setValueAtTime(0,when);g.gain.linearRampToValueAtTime(amp*.8,when+.25);release=.4;
  }else{
    osc('triangle',hz(n));
    g.gain.setValueAtTime(0,when);g.gain.linearRampToValueAtTime(amp,when+.02);
    g.gain.setTargetAtTime(amp*.5,when+.02,.5);
  }
  if(out===g)g.connect(dest);else out.connect(dest);
  oscs.forEach(o=>o.start(when));
  const stop=t=>{
    t=Math.max(t,a.currentTime);
    g.gain.cancelScheduledValues(t);g.gain.setTargetAtTime(0,t,release/3);
    oscs.forEach(o=>{try{o.stop(t+release*2);}catch{}});
  };
  if(dur!=null)stop(when+dur);
  return stop;
}

/* ---------- ドラム・クリック ---------- */
function drum(kind,when,dest=master){
  const a=ctx(), g=a.createGain();g.connect(dest);
  if(kind==='click'||kind==='clickHi'){
    const o=a.createOscillator();o.type='square';o.frequency.value=kind==='clickHi'?1760:1175;
    g.gain.setValueAtTime(.12,when);g.gain.exponentialRampToValueAtTime(.001,when+.035);
    o.connect(g);o.start(when);o.stop(when+.05);return;
  }
  if(kind==='kick'){
    const o=a.createOscillator();o.frequency.setValueAtTime(140,when);o.frequency.exponentialRampToValueAtTime(45,when+.12);
    g.gain.setValueAtTime(.7,when);g.gain.exponentialRampToValueAtTime(.001,when+.32);
    o.connect(g);o.start(when);o.stop(when+.35);return;
  }
  const src=a.createBufferSource();src.buffer=noise;
  const f=a.createBiquadFilter();
  if(kind==='snare'){
    f.type='bandpass';f.frequency.value=1800;f.Q.value=.7;
    g.gain.setValueAtTime(.35,when);g.gain.exponentialRampToValueAtTime(.001,when+.16);
    const o=a.createOscillator(),og=a.createGain();o.frequency.value=190;og.gain.setValueAtTime(.25,when);og.gain.exponentialRampToValueAtTime(.001,when+.08);
    o.connect(og).connect(dest);o.start(when);o.stop(when+.1);
  }else{
    f.type='highpass';f.frequency.value=7000;
    g.gain.setValueAtTime(kind==='hatAcc'?.16:.09,when);g.gain.exponentialRampToValueAtTime(.001,when+.045);
  }
  src.connect(f).connect(g);src.start(when,Math.random()*.5);src.stop(when+.2);
}

// 1小節のドラム：[拍の位置（拍単位）, 種類]。拍は拍子の分母の音符（6/8 なら8分）
function barDrums(kind,beats){
  const out=[];
  for(let k=0;k<beats;k++){
    if(kind==='click'){out.push([k,k===0?'clickHi':'click']);continue;}
    const kick=k===0||(k===2&&beats>=4), snare=k%2===1;
    if(kick)out.push([k,'kick']);
    if(snare)out.push([k,'snare']);
    if(kind==='8beat'){out.push([k,'hatAcc'],[k+.5,'hat']);if(k===2&&beats>=4)out.push([k+.5,'kick']);}
    if(kind==='16beat'){[0,.25,.5,.75].forEach(x=>out.push([k+x,x===0?'hatAcc':'hat']));if(k===1)out.push([k+.75,'kick']);if(k===2&&beats>=4)out.push([k+.5,'kick']);}
    if(kind==='shuffle'){out.push([k,'hatAcc'],[k+2/3,'hat']);}
  }
  return out;
}
// 範囲の中のドラム（tick）。範囲は小節の頭から始まる
function drumHits(kind,r){
  if(kind==='off')return [];
  const out=[];
  for(let t=0;t<r.length;){
    const m=meterAt(r.meters,t), bt=beatTicksOf(m);
    for(const [x,k] of barDrums(kind,m[0]))out.push({t:t+x*bt,drum:k});
    t+=barTicksOf(m);
  }
  return out.filter(h=>h.t<r.length);
}

/* ---------- 再生 ---------- */
// opts：render()→{notes,tempos,meters,length}（範囲の頭が 0）、loop、countIn、metronome()、timbre()、onPos(tick|null, countIn?)、onEnd()
let run=null;
export const isPlaying=()=>!!run;
export function play(opts){
  stop();
  const a=ctx();a.resume();
  const bus=a.createGain();bus.connect(master);
  const r0=opts.render();
  let lead=0, count=null;
  if(opts.countIn){   // カウントイン：1小節のクリック（範囲の頭のテンポ・拍子）
    const m=r0.meters[0].meter, bpm=tempoAt(r0.tempos,0), beat=60/bpm*beatTicksOf(m)/480;
    lead=beat*m[0];
    for(let k=0;k<m[0];k++)drum(k===0?'clickHi':'click',a.currentTime+.08+k*beat,bus);
    count={start:a.currentTime+.08,beat,n:m[0]};
  }
  run={opts,bus,start:a.currentTime+.08+lead,data:null,idx:0,voices:new Set(),horizon:0,count};
  load(r0);
  run.timer=setInterval(tick,25);
  run.raf=requestAnimationFrame(pos);
  tick();
}
function load(r){
  const events=[...r.notes.map(n=>({...n,sec:tickToSec(r.tempos,n.t),end:tickToSec(r.tempos,n.t+n.d)})),
    ...drumHits(run.opts.metronome(),r).map(h=>({...h,sec:tickToSec(r.tempos,h.t)}))].sort((x,y)=>x.sec-y.sec);
  run.data={r,events,dur:tickToSec(r.tempos,r.length)};run.idx=0;
}
function tick(){
  if(!run)return;
  const a=ac, ahead=a.currentTime+.15, {events,dur}=run.data;
  for(const v of run.voices)if(v.end<a.currentTime)run.voices.delete(v);
  while(run.idx<events.length&&run.start+events[run.idx].sec<ahead){
    const e=events[run.idx++], when=run.start+e.sec;
    if(when<a.currentTime-.05)continue;
    if(e.drum)drum(e.drum,when,run.bus);
    else startVoice(e,when,run.start+e.end);
  }
  run.horizon=Math.max(run.horizon,ahead);
  if(run.idx>=events.length&&run.start+dur<ahead){
    if(run.opts.loop()){run.start+=dur;load(run.opts.render());}
    else if(a.currentTime>=run.start+dur){const cb=run.opts.onEnd;stop();cb&&cb();}
  }
}
// 予約した音は止められるように覚えておく（再生中の変更で差し替えるため）
function startVoice(e,when,end){
  const v={end,stop:voice(e.n,e.v,when,end-when,run.opts.timbre(),run.bus)};
  run.voices.add(v);
}
/* 再生中の変更（音色・メトロノーム・パターン・コードの編集など）をすぐ反映する。
   予約済みの少し先（horizon）から後ろを作り直す。鳴っている音は horizon で離し、
   その時点でまだ続くはずの新しい音は horizon から鳴らす（全音符の途中で変えても音が途切れない） */
export function refresh(){
  if(!run)return;
  const a=ac, H=Math.max(run.horizon,a.currentTime+.02);
  for(const v of run.voices)if(v.end>H){v.stop(H);run.voices.delete(v);}
  load(run.opts.render());
  const t=H-run.start, {events}=run.data;
  run.idx=events.findIndex(e=>run.start+e.sec>=H);
  if(run.idx<0)run.idx=events.length;
  if(t>0)for(const e of events.slice(0,run.idx))if(!e.drum&&e.end>t+.02)startVoice(e,H,run.start+e.end);
}
function pos(){
  if(!run)return;
  const t=ac.currentTime-run.start;
  // カウントイン中は何拍目か（0 から。鳴る前は -1）と拍の数を渡す
  const c=run.count, cnt=t<0&&c?{beat:Math.min(c.n-1,Math.floor((ac.currentTime-c.start)/c.beat)),n:c.n}:null;
  run.opts.onPos(t<0?null:secToTick(run.data.r.tempos,Math.min(t,run.data.dur)),t<0,cnt);
  run.raf=requestAnimationFrame(pos);
}
export function stop(){
  if(!run)return;
  clearInterval(run.timer);cancelAnimationFrame(run.raf);
  const bus=run.bus, t=ac.currentTime;
  bus.gain.setTargetAtTime(0,t,.01);setTimeout(()=>bus.disconnect(),200);
  run=null;
}

// ミュート：出力をすべて無音にする（試聴・メトロノーム・MIDI 鍵盤。再生と表示は進んだまま）
export function setMuted(on){
  muted=!!on;
  if(master)master.gain.setTargetAtTime(muted?0:LEVEL,ac.currentTime,.01);
}

/* ---------- 単発（コードのクリック、MIDI 鍵盤） ---------- */
export function playNotes(notes,timbre,dur=1.1){
  const a=ctx();a.resume();
  notes.forEach(n=>voice(n,90,a.currentTime+.01,dur,timbre));
}
const live=new Map();
export function noteOn(n,v,timbre){
  const a=ctx();a.resume();
  live.get(n)?.();
  live.set(n,voice(n,v,a.currentTime,null,timbre));
}
export function noteOff(n){live.get(n)?.(ac.currentTime);live.delete(n);}
