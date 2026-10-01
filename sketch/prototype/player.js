/* ChordSketch：試聴。
   ・JUCE 版：曲全体の「音の予定表」（秒）を C++ の SongPlayer に渡して鳴らす（ループ・差し替え・ドラムも C++）。位置は "songPos" で届く
   ・ブラウザ：WebAudio。先読みスケジューラで 25ms ごとに少し先までの音を予約する。ループは周の終わりで曲データを読み直す */
import {tickToSec,secToTick,meterAt,barTicksOf,beatTicksOf,tempoAt} from './song.js';
import {hasNative,nativeFn,onNative} from '../../shared/ui/juce-bridge.js';

// 音色：JUCE 版は C++ の 8 種類（ChordNavi の 6 種類＋矩形波・リード）、ブラウザは WebAudio の 6 種類。
// 矩形波・リードはメロディー向け（コードにも選べる）
export const TIMBRES=hasNative?[
  {id:'piano',name:'ピアノ'},{id:'electricPiano',name:'エレピ'},{id:'guitar',name:'ギター'},
  {id:'organ',name:'オルガン'},{id:'pad',name:'パッド'},{id:'square',name:'矩形波'},{id:'lead',name:'リード'},{id:'triangle',name:'シンプル（三角波）'}
]:[
  {id:'piano',name:'ピアノ'},{id:'square',name:'矩形波'},{id:'lead',name:'リード'},{id:'triangle',name:'シンプル（三角波）'},{id:'organ',name:'オルガン'},{id:'pad',name:'パッド'}
];
const nSongPlay=nativeFn('songPlay'), nSongUpdate=nativeFn('songUpdate'), nSongStop=nativeFn('songStop');
const nPreview=nativeFn('previewNotes'), nMute=nativeFn('setMute'), nTimbre=nativeFn('setTimbre');
const DRUM_ID={kick:0,snare:1,hat:2,hatAcc:3,click:4,clickHi:5};   // C++ の SongPlayer::Drum の順
const nativeErr=err=>console.error(err);
export const METRONOMES=[
  {id:'off',name:'メトロノームなし'},{id:'click',name:'♪ クリック'},{id:'8beat',name:'♪ 8ビート'},{id:'16beat',name:'♪ 16ビート'},{id:'shuffle',name:'♪ シャッフル'},{id:'four',name:'♪ 4つ打ち（EDM）'}
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
  }else if(timbre==='square'){
    // 矩形波：伸ばしている間は減らさず、離したら少しだけ余韻（release）
    osc('square',hz(n),.5);
    const lp=a.createBiquadFilter();lp.type='lowpass';lp.frequency.value=6000;g.connect(lp);out=lp;
    g.gain.setValueAtTime(0,when);g.gain.linearRampToValueAtTime(amp*.55,when+.003);release=.12;
  }else if(timbre==='lead'){
    // のこぎり波2本（少しずらす）＋ローパス。立ち上がりは速く、伸ばしている間はあまり減らない
    osc('sawtooth',hz(n),.45,-5);osc('sawtooth',hz(n),.45,5);osc('square',hz(n)/2,.12);
    const lp=a.createBiquadFilter();lp.type='lowpass';lp.Q.value=2;
    lp.frequency.setValueAtTime(900,when);lp.frequency.linearRampToValueAtTime(3200,when+.03);lp.frequency.setTargetAtTime(1800,when+.03,.25);
    g.connect(lp);out=lp;
    g.gain.setValueAtTime(0,when);g.gain.linearRampToValueAtTime(amp*.75,when+.008);g.gain.setTargetAtTime(amp*.6,when+.008,.3);release=.07;
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

// 拍子の大きな拍（パルス）：6/8・9/8・12/8 は付点4分（8分×3）ずつ、ほかは拍（分母の音符）ずつ
export function pulsesOf([n,d]){
  const compound=d===8&&n%3===0&&n>3, size=compound?3:1;
  return {P:n/size,size,compound};
}
// キック（K）とスネア（S）の並び：2つずつ K S、奇数なら最後を3つ K S S（3/4 は K S S のワルツ、5/4 は K S K S S）
export function backbeat(P){
  if(P<=1)return ['K'];
  const out=[];let left=P;
  while(left>0){if(left===3){out.push('K','S','S');left-=3;}else{out.push('K','S');left-=2;}}
  return out;
}
// 1小節のドラム：[拍の位置（拍子の分母の音符が1）, 種類]。3拍子系（3/4・6/8・9/8…）も大きな拍ごとに組み立てる
export function barDrums(kind,meter){
  const out=[], {P,size,compound}=pulsesOf(meter);
  if(kind==='click'){for(let k=0;k<meter[0];k++)out.push([k,k===0?'clickHi':'click']);return out;}
  // 4つ打ち（EDM）：大きな拍ごとにキック、2つ目ごとにクラップ（スネア）、裏にハイハット
  if(kind==='four'){
    const {P,size}=pulsesOf(meter);
    for(let p=0;p<P;p++){
      const at=p*size;
      out.push([at,'kick']);
      if(p%2===1)out.push([at,'snare']);
      out.push([at+size/2,'hatAcc']);
    }
    return out;
  }
  const bb=backbeat(P);
  for(let p=0;p<P;p++){
    const at=p*size;
    out.push([at,bb[p]==='K'?'kick':'snare']);
    if(kind==='shuffle'){
      // 4分系は3連でハネる。6/8 などはもともと3連なので、1つ目と3つ目で刻む
      if(compound)out.push([at,'hatAcc'],[at+2,'hat']);else out.push([at,'hatAcc'],[at+2/3,'hat']);
      continue;
    }
    const sub=kind==='16beat'?(compound?6:4):(compound?3:2);   // 大きな拍を何分割して刻むか
    for(let i=0;i<sub;i++)out.push([at+i*size/sub,i===0?'hatAcc':'hat']);
  }
  // 4拍子の8ビート・16ビートは、今までどおりキックを足す
  if(!compound&&P===4){
    if(kind==='8beat')out.push([2.5,'kick']);
    if(kind==='16beat')out.push([1.75,'kick'],[2.5,'kick']);
  }
  return out;
}
// 範囲の中のドラム（tick）。範囲は小節の頭から始まる
function drumHits(kind,r){
  if(kind==='off')return [];
  const out=[];
  for(let t=0;t<r.length;){
    const m=meterAt(r.meters,t), bt=beatTicksOf(m);
    for(const [x,k] of barDrums(kind,m))out.push({t:t+x*bt,drum:k});
    t+=barTicksOf(m);
  }
  return out.filter(h=>h.t<r.length);
}

/* ---------- JUCE 版の再生（C++ の SongPlayer） ---------- */
let nativeSession=0;
// 範囲の音（tick）→ C++ に渡す予定表（秒。数を平らに並べる：ノートは [開始, 長さ, 音, 強さ]、ドラムは [開始, 種類]）
function nativePayload(r,opts){
  const notes=[], drums=[];
  for(const n of r.notes){
    const s=tickToSec(r.tempos,n.t), e=tickToSec(r.tempos,n.t+n.d);
    notes.push(+s.toFixed(5),+(e-s).toFixed(5),n.n,+(n.v/127).toFixed(3));
  }
  const melody=[];
  for(const n of r.melody||[]){
    const s=tickToSec(r.tempos,n.t), e=tickToSec(r.tempos,n.t+n.d);
    melody.push(+s.toFixed(5),+(e-s).toFixed(5),n.n,+(n.v/127).toFixed(3));
  }
  for(const h of drumHits(opts.metronome(),r))drums.push(+tickToSec(r.tempos,h.t).toFixed(5),DRUM_ID[h.drum]);
  return {notes,melody,drums,length:tickToSec(r.tempos,r.length),loop:!!opts.loop(),timbre:opts.timbre(),
          melodyTimbre:(opts.melodyTimbre||opts.timbre)(),session:run.session};
}
function playNative(opts){
  const r=opts.render();
  run={native:true,opts,r,dur:tickToSec(r.tempos,r.length),session:++nativeSession,count:null,lead:0,last:null};
  const p=nativePayload(r,opts);
  if(opts.countIn){   // カウントイン：曲の頭より前（負の時刻）のクリック。小節の頭は高い音
    const bars=opts.countIn===true?1:opts.countIn, m=r.meters[0].meter, beat=60/tempoAt(r.tempos,0)*beatTicksOf(m)/480, n=m[0]*bars;
    run.lead=beat*n;run.count={beat,n};
    const pre=[];for(let k=0;k<n;k++)pre.push(+(-run.lead+k*beat).toFixed(5),k%m[0]===0?DRUM_ID.clickHi:DRUM_ID.click);
    p.drums=[...pre,...p.drums];p.leadIn=run.lead;
  }
  run.last={seconds:-run.lead,at:performance.now(),playing:true};
  nSongPlay(p).catch(nativeErr);
  run.raf=requestAnimationFrame(pos);
}
// C++ から届く再生位置（30Hz）。自分の再生の知らせだけを使う。止まったら終わり
onNative('songPos',p=>{
  if(!run||!run.native||p.session!==run.session)return;
  run.last={seconds:p.seconds,at:performance.now(),playing:p.playing};
  if(!p.playing){const cb=run.opts.onEnd;stop();cb&&cb();}
});

/* ---------- 再生 ---------- */
// opts：render()→{notes,melody,tempos,meters,length}（範囲の頭が 0）、loop、countIn、metronome()、timbre()、melodyTimbre()、onPos(tick|null, countIn?)、onEnd()
let run=null;
export const isPlaying=()=>!!run;
// 録音用：今の再生の番号（JUCE 版。C++ の recNotes の session と比べる）と、曲の頭からの秒（ブラウザ。周の頭が 0、カウントイン中は負）
export const playSession=()=>run?.native?run.session:null;
export function songSeconds(){
  if(!run)return null;
  if(run.native){const L=run.last;return L.seconds+(L.playing?(performance.now()-L.at)/1000:0);}
  return ac.currentTime-run.start;
}
// 周の長さ（秒）
export const passSeconds=()=>run?(run.native?run.dur:run.data?.dur):null;
export function play(opts){
  stop();
  if(hasNative){playNative(opts);return;}
  const a=ctx();a.resume();
  const bus=a.createGain();bus.connect(master);
  const r0=opts.render();
  let lead=0, count=null;
  if(opts.countIn){   // カウントイン：countIn 小節（1 か 2）のクリック（範囲の頭のテンポ・拍子）。小節の頭は高い音
    const bars=opts.countIn===true?1:opts.countIn, m=r0.meters[0].meter, bpm=tempoAt(r0.tempos,0), beat=60/bpm*beatTicksOf(m)/480;
    const n=m[0]*bars;lead=beat*n;
    for(let k=0;k<n;k++)drum(k%m[0]===0?'clickHi':'click',a.currentTime+.08+k*beat,bus);
    count={start:a.currentTime+.08,beat,n};
  }
  run={opts,bus,start:a.currentTime+.08+lead,data:null,idx:0,voices:new Set(),horizon:0,count};
  load(r0);
  run.timer=setInterval(tick,25);
  run.raf=requestAnimationFrame(pos);
  tick();
}
function load(r){
  const events=[...r.notes.map(n=>({...n,sec:tickToSec(r.tempos,n.t),end:tickToSec(r.tempos,n.t+n.d)})),
    ...(r.melody||[]).map(n=>({...n,mel:true,sec:tickToSec(r.tempos,n.t),end:tickToSec(r.tempos,n.t+n.d)})),
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
  const tim=e.mel?(run.opts.melodyTimbre||run.opts.timbre)():run.opts.timbre();
  const v={end,stop:voice(e.n,e.v,when,end-when,tim,run.bus)};
  run.voices.add(v);
}
/* 再生中の変更（音色・メトロノーム・パターン・コードの編集など）をすぐ反映する。
   予約済みの少し先（horizon）から後ろを作り直す。鳴っている音は horizon で離し、
   その時点でまだ続くはずの新しい音は horizon から鳴らす（全音符の途中で変えても音が途切れない） */
export function refresh(){
  if(!run)return;
  if(run.native){   // JUCE 版：作り直した予定表で差し替える（位置はそのまま、鳴っているはずの音は C++ が鳴らし直す）
    run.r=run.opts.render();run.dur=tickToSec(run.r.tempos,run.r.length);
    nSongUpdate(nativePayload(run.r,run.opts)).catch(nativeErr);
    return;
  }
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
  if(run.native){
    // 届いた位置のあいだは経過時間で補う（線がなめらかに動くように）
    const L=run.last;let t=L.seconds+(L.playing?(performance.now()-L.at)/1000:0);
    if(t>=0)t=Math.min(t,run.dur);
    const c=run.count, cnt=t<0&&c?{beat:Math.max(0,Math.min(c.n-1,Math.floor((t+run.lead)/c.beat))),n:c.n}:null;
    run.opts.onPos(t<0?null:secToTick(run.r.tempos,t),t<0,cnt);
    run.raf=requestAnimationFrame(pos);
    return;
  }
  const t=ac.currentTime-run.start;
  // カウントイン中は何拍目か（0 から。鳴る前は -1）と拍の数を渡す
  const c=run.count, cnt=t<0&&c?{beat:Math.min(c.n-1,Math.floor((ac.currentTime-c.start)/c.beat)),n:c.n}:null;
  run.opts.onPos(t<0?null:secToTick(run.data.r.tempos,Math.min(t,run.data.dur)),t<0,cnt);
  run.raf=requestAnimationFrame(pos);
}
export function stop(){
  if(!run)return;
  if(run.native){cancelAnimationFrame(run.raf);nSongStop().catch(nativeErr);run=null;return;}
  clearInterval(run.timer);cancelAnimationFrame(run.raf);
  const bus=run.bus, t=ac.currentTime;
  bus.gain.setTargetAtTime(0,t,.01);setTimeout(()=>bus.disconnect(),200);
  run=null;
}

// ミュート：出力をすべて無音にする（試聴・メトロノーム・MIDI 鍵盤。再生と表示は進んだまま）
export function setMuted(on){
  muted=!!on;
  if(nMute){nMute(muted).catch(nativeErr);return;}
  if(master)master.gain.setTargetAtTime(muted?0:LEVEL,ac.currentTime,.01);
}

/* ---------- 単発（コードのクリック、MIDI 鍵盤） ---------- */
export function playNotes(notes,timbre,dur=1.1){
  if(nPreview){nPreview({notes,dur,timbre}).catch(nativeErr);return;}
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
// MIDI 鍵盤で弾く音の音色（JUCE 版：C++ で鳴らす）
export function setLiveTimbre(timbre){if(nTimbre)nTimbre(timbre).catch(nativeErr);}
