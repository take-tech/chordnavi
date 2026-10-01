import {
  MAJ_LABEL,MIN_LABEL,SIG,SCALES,PROGRESSIONS,DIATONIC,
  mod12,tonicOf,isFlatKey,noteName,keyName as keyNameOf,degLabel,chordName as chordNameOf,chordDeg,chordRootName,
  chordPcs,scaleById,spellChordTone,variantsOf,chordAt,sameChord,voicing,keySignature,
  progressionChords,progressionDegrees,BEATS_PER_BAR,detectChords,VARIANT_FILE,
  CONFORM_SCALES,conformBars,diatonicOf,
  CHORD,spellScaleTone,spellChordInterval,convertChordSize
} from '../shared/ui/theory.js';
import {renderStaff} from './staff.js';
import {threePositions,nearestVoicing,TAB_AREAS,OPEN_MIDI} from '../shared/ui/guitar.js';
import {createWheel} from '../shared/ui/wheel.js';
import {attachMidiDrag,saveMidi} from './midi.js';
import {playChord as play1,playProgression as playN,playNote,playNotes,stopPreview,setLiveTimbre,setMuted,nativeClock,TIMBRES} from './audio.js';
import {getHostInfo,onHostTempo,onMidiNotes,onPreviewPos,onSetTheme,reportTheme} from './host.js';
import {loadState,saveState,onStateRestored} from './persist.js';

/* ---------- 状態 ---------- */
const state={idx:0,mode:'major',scale:'major',label:'name',view:'kb',dia:'7',sel:null,prog:{major:0,minor:0},vari:{major:0,minor:0},timbre:'organ',loop:false,syncTempo:false,half:false,pick:false,editIdx:null,fbView:'fb',tabArea:'low',tuning:null,conform:false,theme:'light'};
// ギターのチューニング：開放弦の音（MIDI）の並び。添字 0＝1弦（いちばん高い弦）。null はレギュラー（6弦）
const tuningStrings=()=>state.tuning||OPEN_MIDI;
const octName=m=>noteName(mod12(m),isFlatKey(state.idx))+(Math.floor(m/12)-1);
// 「スケールに沿う」が効いているか（対象の 7 音のスケールのときだけ）
const conformOn=()=>state.conform&&CONFORM_SCALES.includes(state.scale);
const conformed=(bars,mode=state.mode)=>conformOn()?conformBars(bars,mode,state.scale):bars;
// コード判別で選んだ音。キーは 'kb:<MIDI>'（鍵盤）または 's<弦番号>'（指板：1本の弦に1音）、値は MIDI
const picks=new Map();
const pickedNotes=()=>[...new Set(picks.values())];
const isPicked=midi=>[...picks.values()].includes(midi);
const stringPick=s=>picks.get('s'+s);
const MAX_PICK=8, PICK_COLOR='var(--pick)';
const tonic=()=>tonicOf(state.idx,state.mode);
const playChord=ch=>{stopPlayback(false);play1(ch,state.timbre);};

/* ---------- 進行の試聴と、鳴っているコードの表示 ---------- */
// playback: { chords, index, timers }。index は今鳴っているコード（-1 は鳴る前）
// プラグイン内では C++ の時計に合わせる（sessions：1周ごとの番号 → その周のコード、last：最後に予約した周）
let playback=null, sessionSeq=0;
function playProgression(chords){
  stopPlayback(false);
  if(nativeClock){
    const session=++sessionSeq;
    playback={chords,index:-1,timers:[],sessions:new Map([[session,chords]]),last:session};
    playN(chords,state.timbre,bpm(),{session});
    return;
  }
  // ブラウザで確認するとき：画面のタイマーで表示とループを進める
  const beat=60/bpm(), timers=[];
  playback={chords,index:-1,timers};
  let t=0;
  chords.forEach((ch,i)=>{
    timers.push(setTimeout(()=>{playback.index=i;render();},t*1000));
    t+=(ch.beats??BEATS_PER_BAR)*beat;
  });
  // 最後まで鳴ったら、ループ中は頭から（テンポ・音色の変更はここで反映）
  timers.push(setTimeout(()=>{
    if(state.loop)playProgression(progChords);
    else{playback=null;render();}
  },t*1000));
  playN(chords,state.timbre,bpm());
}
// プラグイン内：C++ から今鳴っているコードが届く（音と同じ時計）。
// ループは、最後のコードが鳴り始めたら次の1周を「今の周の直後から」予約する（すき間なくつながる。テンポ・音色の変更はここで反映）
onPreviewPos(({session,index,playing})=>{
  if(!playback||!playback.sessions)return;
  const chords=playback.sessions.get(session);
  if(!chords)return;                       // 前に止めた試聴の知らせ
  if(!playing){if(session===playback.last){playback=null;render();}return;}
  if(index<0)return;
  for(const k of playback.sessions.keys())if(k<session)playback.sessions.delete(k);
  if(chords!==playback.chords||index!==playback.index){playback.chords=chords;playback.index=index;render();}
  if(state.loop&&session===playback.last&&index===chords.length-1){
    const next=++sessionSeq;
    playback.sessions.set(next,progChords);playback.last=next;
    playN(progChords,state.timbre,bpm(),{session:next,append:true});
  }
});
// 表示を止める（silence なら音も止める）。キー・進行を変えたときは音も止めて表示とずれないようにする
function stopPlayback(silence){
  if(!playback)return;
  playback.timers.forEach(clearTimeout);playback=null;
  if(silence)stopPreview();
}
// 鍵盤・指板・五線譜に表示するコード：試聴中は鳴っているコード、それ以外は選択中のコード
// コード判別中は選んだ音だけを表示する
const shownChord=()=>state.pick?null:playback&&playback.index>=0?playback.chords[playback.index]:state.sel;
const useFlat=()=>isFlatKey(state.idx);
const nn=pc=>noteName(pc,useFlat());
const scaleObj=()=>scaleById(state.scale);
const keyName=()=>keyNameOf(state.idx,state.mode);
const chordName=ch=>chordNameOf(ch,useFlat(),tonic());
const rootName=ch=>chordRootName(ch,useFlat(),tonic());
/* ---------- テンポ（DAW 同期） ---------- */
// DAW 上では既定で DAW のテンポに合わせる。Standalone・ブラウザでは同期ボタン自体を出さない
let hostBpm=0;
const inputBpm=()=>Math.min(240,Math.max(40,Math.round(+document.getElementById('bpm').value)||120));
const syncing=()=>state.syncTempo&&hostBpm>0;
const bpm=()=>syncing()?Math.min(300,Math.max(20,hostBpm)):inputBpm();
const host=await getHostInfo();
if(!host.standalone){
  hostBpm=host.bpm||0;
  state.syncTempo=true;
  document.getElementById('bpmSync').hidden=false;
  onHostTempo(info=>{hostBpm=info.bpm||0;renderTempo();});
}
document.getElementById('bpmSync').onclick=()=>{state.syncTempo=!state.syncTempo;renderTempo();};
function renderTempo(){
  const input=document.getElementById('bpm'), btn=document.getElementById('bpmSync');
  btn.setAttribute('aria-pressed',!!state.syncTempo);
  btn.title=state.syncTempo&&!hostBpm?'DAWのテンポをまだ取得できていません（DAWで再生すると取得されます）':'DAWのテンポに合わせる';
  input.disabled=syncing();
  if(syncing())input.value=Math.round(hostBpm*10)/10;
}
// 範囲外・空欄の入力は確定時に 40〜240 に丸めて表示し直す
document.getElementById('bpm').addEventListener('change',e=>{e.target.value=inputBpm();persist();});

const NS='http://www.w3.org/2000/svg';
// 色に var(--…) を渡したときは style で指定する（テーマを切り替えると描き直さずに色が変わる）
function el(tag,attrs={},parent){const e=document.createElementNS(NS,tag);for(const k in attrs){const v=attrs[k];if(typeof v==='string'&&v.startsWith('var('))e.style.setProperty(k,v);else e.setAttribute(k,v);}if(parent)parent.appendChild(e);return e;}
function txt(parent,x,y,s,attrs={}){const t=el('text',{x,y,'text-anchor':'middle','dominant-baseline':'central',...attrs},parent);t.textContent=s;return t;}

/* ---------- 五度圏（shared/ui/wheel.js。ChordSketch と共通） ---------- */
const wheel=createWheel(document.getElementById('wheel'),{onSelect:(i,m)=>setKey(i,m)});
const {key:cKey,sig:cSig,mode:cMode}=wheel.center;
const drawOverlay=()=>wheel.setOverlay(state.mode);
const rotateTo=idx=>wheel.rotateTo(idx);

/* ---------- コントロール ---------- */
const keySel=document.getElementById('keySel'), scaleSel=document.getElementById('scaleSel');
for(const m of ['major','minor'])for(let i=0;i<12;i++){
  const o=document.createElement('option');o.value=i+':'+m;
  o.textContent=(m==='major'?MAJ_LABEL[i]+' メジャー':MIN_LABEL[i].replace(/m/g,'')+' マイナー')+'（'+SIG[i]+'）';
  keySel.appendChild(o);
}
// スケールとコードトーンをグループに分けて並べる
for(const [group,label] of [[undefined,'スケール'],['chord','コードトーン（主音がルート）']]){
  const g=document.createElement('optgroup');g.label=label;
  for(const s of SCALES.filter(x=>x.group===group)){const o=document.createElement('option');o.value=s.id;o.textContent=s.name;g.appendChild(o);}
  scaleSel.appendChild(g);
}
keySel.addEventListener('change',()=>{const [i,m]=keySel.value.split(':');setKey(+i,m);});
scaleSel.addEventListener('change',()=>{state.scale=scaleSel.value;render();});
function bindSeg(id,key,onChange){
  document.querySelectorAll(`#${id} button`).forEach(b=>b.addEventListener('click',()=>{
    state[key]=b.dataset.v;syncSeg(id,key);onChange();
  }));
}
const syncSeg=(id,key)=>document.querySelectorAll(`#${id} button`).forEach(x=>x.setAttribute('aria-pressed',x.dataset.v===state[key]));
bindSeg('labelSeg','label',()=>{renderKeyPanel();renderFretPanel();});
bindSeg('viewSeg','view',()=>render());
bindSeg('fbViewSeg','fbView',()=>render());

/* ---------- テーマ（ライト／ダーク／自動＝OS の外観に合わせる）とスキン ---------- */
// タイトルの右の歯車のボタンのメニューで切り替える（Standalone はメニューの「オプション → テーマ」でも）。
// スキンは明るい／暗い土台（data-theme）の上に data-skin で色と素材を上書きする（ChordSketch と同じ考え方）
const THEMES={light:{base:'light',label:'☀ ライト'},dark:{base:'dark',label:'☾ ダーク'},auto:{base:null,label:'◐ 自動'},
  kawaii:{base:'light',skin:'kawaii',label:'Kawaii'},cyber:{base:'dark',skin:'cyber',label:'Cyber'},modern:{base:'light',skin:'modern',label:'Modern'},
  luxury:{base:'dark',skin:'luxury',label:'Luxury'},old:{base:'light',skin:'old',label:'Old'}};
const darkQuery=matchMedia('(prefers-color-scheme: dark)');
const themeBtn=document.getElementById('themeBtn'), themePop=document.getElementById('themePop');
function applyTheme(){
  const th=THEMES[state.theme]||THEMES.light, base=th.base||(darkQuery.matches?'dark':'light');
  document.documentElement.dataset.theme=base;
  if(th.skin)document.documentElement.dataset.skin=th.skin;else delete document.documentElement.dataset.skin;
  themeBtn.title=`設定（テーマ：${th.label}）`;
  themePop.querySelectorAll('button').forEach(b=>b.setAttribute('aria-checked',b.dataset.v===state.theme));
  reportTheme(state.theme);
}
function setTheme(name){if(!(name in THEMES))return;state.theme=name;applyTheme();persist();render();}
darkQuery.addEventListener('change',()=>{if(state.theme==='auto')applyTheme();});
for(const [id,th] of Object.entries(THEMES)){
  const b=document.createElement('button');b.dataset.v=id;b.textContent=th.label;b.setAttribute('role','menuitemradio');
  b.onclick=()=>{themePop.hidden=true;themeBtn.setAttribute('aria-expanded','false');setTheme(id);};
  if(id==='kawaii')themePop.append(Object.assign(document.createElement('div'),{className:'menu-sep'}));
  themePop.append(b);
}
themePop.prepend(Object.assign(document.createElement('span'),{className:'menu-lbl',textContent:'テーマ'}));
themeBtn.onclick=e=>{e.stopPropagation();themePop.hidden=!themePop.hidden;themeBtn.setAttribute('aria-expanded',!themePop.hidden);};
document.addEventListener('pointerdown',e=>{if(!themePop.hidden&&!e.target.closest('#themePop,#themeBtn')){themePop.hidden=true;themeBtn.setAttribute('aria-expanded','false');}});
onSetTheme(setTheme);
bindSeg('tabAreaSeg','tabArea',()=>render());
// 選択中のコードも3和音／4和音の対応する和音に切り替えて、鍵盤・指板の着色に反映し、試聴する
bindSeg('diaSeg','dia',()=>{
  if(state.sel){
    if(conformOn()){
      // スケールのダイアトニックから同じ度数の和音を探す（無ければそのまま）
      const it=diatonicOf(state.scale,state.dia==='3'?3:4).find(([off])=>off===state.sel.off);
      if(it)state.sel={...chordAt(tonic(),it),...(state.sel.bass!=null?{bass:state.sel.bass,boff:state.sel.boff}:{})};
    }else state.sel=convertChordSize(state.sel,state.dia,state.mode);
    playChord(state.sel);
  }
  render();
});
document.getElementById('selClear').addEventListener('click',()=>{stopPlayback(true);state.sel=null;state.editIdx=null;render();});
const timbreSel=document.getElementById('timbre');
for(const t of TIMBRES){const o=document.createElement('option');o.value=t.id;o.textContent=t.name;timbreSel.appendChild(o);}
timbreSel.value=state.timbre;
timbreSel.addEventListener('change',()=>{state.timbre=timbreSel.value;setLiveTimbre(state.timbre);persist();});

function setKey(i,m){
  if(m!==state.mode){state.scale=m==='major'?'major':'nminor';}
  stopPlayback(true);
  state.idx=i;state.mode=m;state.sel=null;
  rotateTo(i);render();
}

/* ---------- 音の表示ヘルパー ---------- */
function noteInfo(pc){
  const t=tonic(), sc=scaleObj(), iv=mod12(pc-t);
  const inScale=sc.iv.includes(iv);
  const sel=shownChord(), pcs=sel?chordPcs(sel):null;
  const inChord=pcs?pcs.includes(pc):false;
  const chordRoot=sel&&pc===sel.root;
  const name=inChord?spellChordTone(pc,sel.root,useFlat(),rootName(sel)):nn(pc);
  const label=state.label==='name'?name:(inChord&&!inScale?degLabel(iv,null):degLabel(iv,sc));
  return {iv,inScale,inChord,chordRoot,isRoot:iv===0,name,label,chordMode:!!pcs};
}
function dotStyle(n){
  if(n.chordMode){
    if(n.inChord)return {fill:n.chordRoot?'var(--chord-root)':'var(--chord)',op:1};
    if(n.inScale)return {fill:n.isRoot?'var(--root)':'var(--tone)',op:.25};
    return null;
  }
  if(!n.inScale)return null;
  return {fill:n.isRoot?'var(--root)':'var(--tone)',op:1};
}

/* ---------- 鍵盤 ---------- */
function renderKeyboard(){
  const svg=document.getElementById('kb');svg.innerHTML='';
  const W=40,H=118,BW=24,BH=74,octs=3,whites=octs*7+1;
  svg.setAttribute('viewBox',`0 0 ${whites*W+2} ${H+2}`);

  const WPC=[0,2,4,5,7,9,11], BLK={1:0,3:1,6:3,8:4,10:5}, BASE=48;   // 左端 C3
  const g=el('g',{transform:'translate(1,1)'},svg);
  for(let w=0;w<whites;w++){
    const pc=WPC[w%7], midi=BASE+Math.floor(w/7)*12+pc, {n,ds,on,live}=keyStyle(midi);
    el('rect',{x:w*W,y:0,width:W,height:H,fill:live?'var(--key-live)':on?'var(--key-pick)':n.inChord?'var(--key-chord)':'var(--key-white)',stroke:'var(--key-line)','stroke-width':1,rx:3,'data-note':midi},g);
    if(ds){el('circle',{cx:w*W+W/2,cy:H-19,r:13,fill:ds.fill,opacity:ds.op},g);
      txt(g,w*W+W/2,H-19,n.label,{fill:'#fff','font-size':n.label.length>2?10:12,'font-weight':700,opacity:ds.op===1?1:.6});}
  }
  for(let o=0;o<octs;o++)for(const pc in BLK){
    const midi=BASE+o*12+(+pc), x=(o*7+BLK[pc]+1)*W-BW/2, {n,ds,on,live}=keyStyle(midi);
    el('rect',{x,y:0,width:BW,height:BH,fill:live?'var(--live-deep)':on?'var(--pick-deep)':n.inChord?'var(--chord-root)':'var(--key-black)',rx:2,'data-note':midi},g);
    if(ds){el('circle',{cx:x+BW/2,cy:BH-14,r:10.5,fill:ds.fill,opacity:ds.op,stroke:'#fff','stroke-width':1.5},g);
      txt(g,x+BW/2,BH-14,n.label,{fill:'#fff','font-size':9,'font-weight':700,opacity:ds.op===1?1:.6});}
  }
}

// 1つの音（MIDI）の表示。コード判別中は選んだ音を紫、それ以外のスケール音を薄く
/* ---------- MIDI キーボード入力 ---------- */
// 弾いている音（MIDI 番号）。表示できる範囲の外の音はオクターブを折り返して見せる
let liveNotes=[];
const LIVE_COLOR='var(--live)';
const KB_RANGE=[48,84];   // 鍵盤 C3〜C6
// 指板：いちばん低い開放弦〜いちばん高い弦の 15 フレット（レギュラーなら E2〜G5）
const fbRange=()=>{const t=tuningStrings();return [Math.min(...t),Math.max(...t)+15];};
const fold=(n,[lo,hi])=>{while(n<lo)n+=12;while(n>hi)n-=12;return n;};
let liveKb=new Set(), liveFb=new Set();
onMidiNotes(info=>{
  liveNotes=[...(info.notes||[])].sort((a,b)=>a-b);
  liveKb=new Set(liveNotes.map(n=>fold(n,KB_RANGE)));
  liveFb=new Set(liveNotes.map(n=>fold(n,fbRange())));
  // 弾くたびに全体は描き直さず、鍵盤・指板・五線譜と見出しだけ
  renderKeyPanel();renderFretPanel();renderLive();
});

// 1つの音（MIDI）の表示。MIDI で弾いている音は青、コード判別中は選んだ音を紫。それぞれのとき他のスケール音は薄く
function keyStyle(midi,where='kb'){
  const n=noteInfo(mod12(midi));
  let ds=dotStyle(n);
  if(liveNotes.length){
    if((where==='kb'?liveKb:liveFb).has(midi))return {n,ds:{fill:LIVE_COLOR,op:1},on:true,live:true};
    return {n,ds:ds&&{...ds,op:.25},on:false};
  }
  if(!state.pick)return {n,ds,on:false};
  if(isPicked(midi))return {n,ds:{fill:PICK_COLOR,op:1},on:true};
  return {n,ds:ds&&{...ds,op:.25},on:false};
}
// 指板の1マス：その弦で選んだ音は濃い紫、鍵盤で選んだ同じ高さの音は薄い紫
function fretStyle(s,midi){
  const st=keyStyle(midi,'fb');
  if(st.live||!state.pick||!st.on)return st;
  if(stringPick(s)===midi)return st;
  if(picks.has('kb:'+midi))return {...st,ds:{fill:PICK_COLOR,op:.4}};
  // 別の弦で選んだ音：このマスは通常の（薄い）表示
  const d=dotStyle(st.n);
  return {...st,ds:d&&{...d,op:.25},on:false};
}

/* ---------- 五線譜 ---------- */
function renderStaffView(){
  const svg=document.getElementById('staff'), t=tonic(), sig=keySignature(state.idx);
  if(liveNotes.length||state.pick){
    // MIDI で弾いている音／コード判別で選んだ音を和音で表示（綴りは第1候補のコードから）
    const staffNotes=liveNotes.length?liveNotes:pickedNotes(), color=liveNotes.length?LIVE_COLOR:PICK_COLOR;
    const cand=detectChords(staffNotes)[0];
    const spell=pc=>{
      if(cand){const iv=CHORD[cand.q].iv.find(i=>mod12(cand.root+i)===pc);
        const s=iv!=null&&spellChordInterval(cand.root,nn(cand.root),iv,cand.q);if(s)return s;}
      return nn(pc);
    };
    const notes=[...staffNotes].sort((a,b)=>a-b).map(midi=>{const n=noteInfo(mod12(midi)),name=spell(mod12(midi));
      return {midi,name,label:state.label==='name'?name:n.label,fill:color,op:1,col:0};});
    renderStaff(svg,{sig,notes,columns:1,labelSide:'right'});
    return;
  }
  if(shownChord()){
    // 選択中（試聴中は鳴っている）コード：MIDI と同じボイシングを和音で表示（綴りはコードの音程から）
    const ch=shownChord(), rn=rootName(ch), ivs=CHORD[ch.q].iv;
    const spell=pc=>{const iv=ivs.find(i=>mod12(ch.root+i)===pc);
      return (iv!=null&&spellChordInterval(ch.root,rn,iv,ch.q))||noteInfo(pc).name;};
    const notes=voicing(ch).map(midi=>{
      const pc=mod12(midi), n=noteInfo(pc), ds=dotStyle(n), name=spell(pc);
      return {midi,name,label:state.label==='name'?name:n.label,fill:ds.fill,op:ds.op,col:0};
    });
    renderStaff(svg,{sig,notes,columns:1,labelSide:'right'});
    return;
  }
  // スケール：ト音記号上に主音から1オクターブ上の主音まで
  // 綴りは度数から（例：F♯メジャーの7度は E♯）
  const sc=scaleObj(), ivs=[...sc.iv,12], tonicName=nn(t);
  const notes=ivs.map((iv,col)=>{
    const pc=mod12(t+iv), n=noteInfo(pc), ds=dotStyle(n);
    const name=spellScaleTone(pc,tonicName,degLabel(iv%12,sc))||n.name;
    return {midi:60+t+iv,name,label:state.label==='name'?name:n.label,fill:ds.fill,op:ds.op,col,clef:'treble'};
  });
  renderStaff(svg,{sig,notes,columns:ivs.length});
}
function renderKeyPanel(){
  const staff=state.view==='staff';
  // SVG 要素には hidden プロパティが無いので属性で切り替える
  document.getElementById('kb').toggleAttribute('hidden',staff);
  document.getElementById('staff').toggleAttribute('hidden',!staff);
  if(staff)renderStaffView();else renderKeyboard();
}

/* ---------- ギターのチューニング ---------- */
// 指板の左の弦の欄の − ＋ で弦ごとに半音ずつ（23〜76）。弦の数は見出しの右（増やすといちばん低い弦の 4 度下に足す、減らすといちばん低い弦を外す）
const TUNE_MIN=23, TUNE_MAX=76;
const STANDARD={6:OPEN_MIDI,7:[...OPEN_MIDI,35],8:[...OPEN_MIDI,35,30]};
const sameArr=(a,b)=>a.length===b.length&&a.every((x,i)=>x===b[i]);
// 弦の数ごとのレギュラーと同じなら、6弦のレギュラーは null で持つ
function setTuning(t){
  state.tuning=sameArr(t,OPEN_MIDI)?null:t;
  for(const k of [...picks.keys()])if(k.startsWith('s'))picks.delete(k);   // 指板で選んだ音（弦ごと）は外す
  render();
}
function tuneString(s,d){
  const t=[...tuningStrings()];t[s]=Math.min(TUNE_MAX,Math.max(TUNE_MIN,t[s]+d));
  setTuning(t);playNote(t[s],state.timbre);
}
function setStringCount(n){
  let t=[...tuningStrings()];
  while(t.length<n)t.push(Math.max(TUNE_MIN,t[t.length-1]-5));
  t=t.slice(0,n);setTuning(t);
}
document.querySelectorAll('#stringSeg button').forEach(b=>b.addEventListener('click',()=>setStringCount(+b.dataset.v)));
document.getElementById('tuneReset').onclick=()=>setTuning([...STANDARD[tuningStrings().length]]);
function syncTuning(){
  const t=tuningStrings();
  document.querySelectorAll('#stringSeg button').forEach(b=>b.setAttribute('aria-pressed',+b.dataset.v===t.length));
  document.getElementById('tuneReset').disabled=sameArr(t,STANDARD[t.length]);
}

/* ---------- 指板 ---------- */
/* ---------- TAB譜 ---------- */
// 選んだコード：3ポジション（6弦・5弦・4弦ルート）。選んでいない・試聴中：進行を選んだエリア（ロー／ミドル／ハイ）で
function tabColumns(){
  const ch=playback||state.pick?null:state.sel;
  if(ch)return {mode:'chord',cols:threePositions(ch,tuningStrings()).map(v=>({title:chordName(ch),
    sub:`${v.bassString+1}弦ルート・${v.open||!v.lo?'開放':v.lo+'フレット'}`,v}))};
  let prev=null;
  return {mode:'prog',cols:progChords.map((c,i)=>{const v=nearestVoicing(c,TAB_AREAS[state.tabArea],prev,tuningStrings());prev=v;
    return {title:chordName(c),sub:'',v,playing:!!playback&&playback.index===i};})};
}
function renderTab(){
  const svg=document.getElementById('tab');svg.innerHTML='';
  // 弦の本数が変わっても高さは同じ（線の間隔を詰める）
  const NS=tuningStrings().length, W=895,H=180,L=50,R=885,TOP=46,GAP=100/(NS-1), BOT=TOP+100;
  svg.setAttribute('viewBox',`0 0 ${W} ${H}`);
  const {mode,cols}=tabColumns();
  for(let s=0;s<NS;s++)el('line',{x1:L,y1:TOP+s*GAP,x2:R,y2:TOP+s*GAP,stroke:'var(--faint)','stroke-width':1.2},svg);
  ['T','A','B'].forEach((c,i)=>txt(svg,26,TOP+18+i*32,c,{fill:'var(--ink)','font-size':15,'font-weight':900}));
  el('line',{x1:L,y1:TOP,x2:L,y2:BOT,stroke:'var(--ink)','stroke-width':2},svg);
  el('line',{x1:R,y1:TOP,x2:R,y2:BOT,stroke:'var(--ink)','stroke-width':2},svg);
  if(!cols.length){txt(svg,W/2,TOP+50,'このコードの形が見つかりません',{fill:'var(--muted)','font-size':13});return;}
  const cw=(R-L)/cols.length, small=cols.length>8;
  cols.forEach((c,i)=>{
    const x0=L+i*cw, cx=x0+cw/2;
    const g=el('g',{class:'col'},svg);
    el('rect',{class:'colbg',x:x0,y:0,width:cw,height:H,fill:c.playing?'var(--chord-tint)':'transparent'},g);
    if(i>0)el('line',{x1:x0,y1:TOP,x2:x0,y2:BOT,stroke:mode==='prog'?'var(--ink)':'var(--line)','stroke-width':mode==='prog'?1.2:1},g);
    txt(g,cx,14,c.title,{fill:c.playing?'var(--chord)':'var(--ink)','font-size':small?11:14,'font-weight':700});
    if(c.sub)txt(g,cx,30,c.sub,{fill:'var(--muted)','font-size':10});
    if(!c.v)return;
    const fs=Math.min(small?12:14,GAP*.75), bh=Math.min(16,GAP-1);
    for(let s=0;s<NS;s++){
      const f=c.v.frets[s], y=TOP+s*GAP;
      if(f==null){txt(g,cx,y,'×',{fill:'var(--faint2)','font-size':10});continue;}
      const label=String(f);
      el('rect',{x:cx-(label.length>1?10:7),y:y-bh/2,width:label.length>1?20:14,height:bh,fill:c.playing?'var(--chord-tint)':'var(--panel)'},g);
      txt(g,cx,y,label,{fill:s===c.v.bassString?'var(--root)':'var(--ink)','font-size':fs,'font-weight':700});
    }
    if(mode==='chord')txt(g,cx,H-12,'クリックで試聴',{fill:'var(--faint)','font-size':9});
    g.addEventListener('pointerdown',e=>{e.preventDefault();playNotes(c.v.notes,state.timbre);});
  });
}
/* ---------- コード図（横向き：上が1弦、左がナット側） ---------- */
function renderChart(){
  const svg=document.getElementById('tab');svg.innerHTML='';
  const W=895,H=180,L=20,R=885;
  svg.setAttribute('viewBox',`0 0 ${W} ${H}`);
  const {mode,cols}=tabColumns();
  if(!cols.length){txt(svg,W/2,H/2,'このコードの形が見つかりません',{fill:'var(--muted)','font-size':13});return;}
  const cw=(R-L)/cols.length, small=cols.length>8;
  // 表示するフレット数・弦の間隔・1フレットの幅（コードが少ないほど大きく描く）
  const NS=tuningStrings().length, FRETS=4, SG=95/(NS-1);   // 弦の本数が変わっても高さは同じ
  const top=mode==='chord'?44:38;
  const fw=Math.min(mode==='chord'?42:small?14:34,(cw-(small?14:40))/FRETS);
  cols.forEach((c,i)=>{
    const x0=L+i*cw, cx=x0+cw/2, g=el('g',{class:'col'},svg);
    el('rect',{class:'colbg',x:x0,y:0,width:cw,height:H,fill:c.playing?'var(--chord-tint)':'transparent'},g);
    txt(g,cx,14,c.title,{fill:c.playing?'var(--chord)':'var(--ink)','font-size':small?11:14,'font-weight':700});
    if(c.sub)txt(g,cx,30,c.sub,{fill:'var(--muted)','font-size':10});
    if(!c.v)return;
    const v=c.v, fretted=v.frets.filter(f=>f!=null&&f>0);
    const lo=fretted.length?Math.min(...fretted):1, hi=fretted.length?Math.max(...fretted):1;
    const start=hi<=FRETS?1:lo;                        // ローポジションはナットから
    const gx=cx-fw*FRETS/2+(small?3:6), sy=s=>top+s*SG;
    // 地・フレット・弦（6弦ほど太く）
    const last=NS-1;
    el('rect',{x:gx,y:sy(0),width:fw*FRETS,height:sy(last)-sy(0),fill:'var(--card)'},g);
    for(let k=0;k<=FRETS;k++)el('line',{x1:gx+k*fw,y1:sy(0),x2:gx+k*fw,y2:sy(last),stroke:k===0&&start===1?'var(--ink)':'var(--faint)',
      'stroke-width':k===0&&start===1?(small?3:5):1.2},g);
    for(let s=0;s<NS;s++)el('line',{x1:gx,y1:sy(s),x2:gx+fw*FRETS,y2:sy(s),stroke:'var(--string)','stroke-width':.8+s*1.4/last},g);
    if(start>1)txt(g,gx+fw/2,sy(last)+(small?11:14),`${start}fr`,{fill:'var(--ink)','font-size':small?9:12,'font-weight':700});
    // 開放（○）・ミュート（×）
    for(let s=0;s<NS;s++){
      const f=v.frets[s], x=gx-(small?6:9);
      if(f==null)txt(g,x,sy(s),'×',{fill:'var(--muted)','font-size':small?9:11});
      else if(f===0)el('circle',{cx:x,cy:sy(s),r:small?2.6:3.5,fill:'none',stroke:'var(--ink)','stroke-width':1.2},g);
    }
    const fx=f=>gx+(f-start+.5)*fw, r=Math.min(fw*.36,SG*.36);
    // セーハ：一番低いフレットを 2 本以上の弦で押さえるときは太い棒でつなぐ
    const atLo=[];v.frets.forEach((f,s)=>{if(f===lo&&f>0)atLo.push(s);});
    const barre=atLo.length>=2;
    if(barre){
      const s0=Math.min(...atLo), s1=Math.max(...atLo);
      el('rect',{x:fx(lo)-r,y:sy(s0)-r,width:r*2,height:sy(s1)-sy(s0)+r*2,rx:r,fill:'var(--ink)'},g);
    }
    v.frets.forEach((f,s)=>{
      if(f==null||f===0||(barre&&f===lo&&s!==v.bassString))return;
      el('circle',{cx:fx(f),cy:sy(s),r,fill:s===v.bassString?'var(--root)':'var(--ink)',stroke:s===v.bassString&&barre&&f===lo?'var(--card)':'none','stroke-width':1},g);
    });
    if(mode==='chord')txt(g,cx,H-8,'クリックで試聴',{fill:'var(--faint)','font-size':9});
    g.addEventListener('pointerdown',e=>{e.preventDefault();playNotes(v.notes,state.timbre);});
  });
}

function renderFretPanel(){
  const tab=state.fbView!=='fb';
  document.getElementById('fb').toggleAttribute('hidden',tab);
  document.getElementById('tab').toggleAttribute('hidden',!tab);
  const showArea=tab&&!(state.sel&&!playback&&!state.pick);
  document.getElementById('tabAreaSeg').toggleAttribute('hidden',!showArea);
  document.getElementById('fbLegend').textContent=tab?'上が1弦・オレンジはベース（最低音）':'上が1弦';
  syncTuning();
  // 見出し（進行名は renderProgs の後で確定している）
  const label=state.fbView==='chart'?'コード図':'TAB';
  document.getElementById('fbTitle').textContent=tab
    ?(state.sel&&!playback&&!state.pick?`${label}：${chordName(state.sel)} の3ポジション`:`${label}：${document.getElementById('progName').textContent||'コード進行'}`)
    :`ギター指板：${nn(tonic())} ${scaleObj().name}`;
  if(state.fbView==='chart')renderChart();else if(tab)renderTab();else renderFretboard();
}

function renderFretboard(){
  const svg=document.getElementById('fb');svg.innerHTML='';
  // 弦の本数が変わっても高さは同じ（6弦の 26 の間隔を詰める。丸も小さく）
  const OPEN=tuningStrings(), NS=OPEN.length, H5=26*5;
  // 左の弦の欄：− 開放弦の音名 ＋（押すと半音ずつ変える）
  const FR=15,L=118,FW=(895-10-L)/FR,SS=H5/(NS-1),T=14, R=Math.min(12,SS*.46), mid=T+H5/2;
  const Wd=L+FR*FW+10,Hd=T+H5+36;
  svg.setAttribute('viewBox',`0 0 ${Wd} ${Hd}`);
  el('rect',{x:L,y:T-8,width:FR*FW,height:H5+16,fill:'var(--wood)',rx:2},svg);
  for(const f of [3,5,7,9,15])el('circle',{cx:L+(f-.5)*FW,cy:mid,r:6,fill:'var(--inlay)'},svg);
  el('circle',{cx:L+11.5*FW,cy:mid-26,r:6,fill:'var(--inlay)'},svg);el('circle',{cx:L+11.5*FW,cy:mid+26,r:6,fill:'var(--inlay)'},svg);
  for(let f=0;f<=FR;f++){
    el('line',{x1:L+f*FW,y1:T-8,x2:L+f*FW,y2:T+H5+8,stroke:f===0?'var(--nut)':'var(--fret)','stroke-width':f===0?6:2},svg);
    if(f>0)txt(svg,L+(f-.5)*FW,T+H5+22,f,{fill:'var(--muted)','font-size':12});
  }
  OPEN.forEach((open,s)=>{
    const y=T+s*SS;
    el('line',{x1:L,y1:y,x2:L+FR*FW,y2:y,stroke:'var(--string)','stroke-width':1+s*1.75/(NS-1)},svg);
    const fs=NS>6?10:11, bh=Math.min(22,SS-2);
    txt(svg,12,y,'−',{fill:'var(--ink2)','font-size':14,'font-weight':700});
    txt(svg,40,y,noteName(mod12(open),isFlatKey(state.idx)),{fill:'var(--ink)','font-size':fs+1,'font-weight':700});   // 音名だけ（オクターブは − ＋ のツールチップに）
    txt(svg,68,y,'＋',{fill:'var(--ink2)','font-size':12,'font-weight':700});
    el('rect',{class:'tune',x:1,y:y-bh/2,width:22,height:bh,rx:3,'data-tune':-1,'data-string':s},svg).append(Object.assign(document.createElementNS('http://www.w3.org/2000/svg','title'),{textContent:`${s+1}弦（${octName(open)}）を半音下げる`}));
    el('rect',{class:'tune',x:57,y:y-bh/2,width:22,height:bh,rx:3,'data-tune':1,'data-string':s},svg).append(Object.assign(document.createElementNS('http://www.w3.org/2000/svg','title'),{textContent:`${s+1}弦（${octName(open)}）を半音上げる`}));
    for(let f=0;f<=FR;f++){
      const {n,ds}=fretStyle(s,OPEN[s]+f); if(!ds)continue;
      const x=f===0?L-18:L+(f-.5)*FW, k=R/12;
      el('circle',{cx:x,cy:y,r:R,fill:ds.fill,opacity:ds.op,stroke:'#fff','stroke-width':1.5},svg);
      txt(svg,x,y,n.label,{fill:'#fff','font-size':(n.label.length>2?9:11)*Math.max(k,.85),'font-weight':700,opacity:ds.op===1?1:.6});
    }
  });
  // クリック判定用の透明な枠（弦×フレット）
  OPEN.forEach((open,s)=>{
    for(let f=0;f<=FR;f++){
      const x0=f===0?L-32:L+(f-1)*FW, w=f===0?32:FW;
      el('rect',{class:'hit',x:x0,y:T+s*SS-SS/2,width:w,height:SS,'data-note':open+f,'data-string':s},svg);
    }
  });
}

// 鍵盤・指板を押したらその音を鳴らす。コード判別中は音の選択／解除
for(const id of ['kb','fb'])
  document.getElementById(id).addEventListener('pointerdown',e=>{
    const tune=e.target.dataset&&e.target.dataset.tune;
    if(tune!=null){e.preventDefault();tuneString(+e.target.dataset.string,+tune);return;}
    const note=e.target.dataset&&e.target.dataset.note;
    if(note==null)return;
    e.preventDefault();
    const midi=+note, str=e.target.dataset.string;
    if(!state.pick){playNote(midi,state.timbre);return;}
    if(str!=null)pickOnString(+str,midi);else pickOnKeyboard(midi);
    render();
  });

/* ---------- コード判別 ---------- */
const canAdd=midi=>isPicked(midi)||pickedNotes().length<MAX_PICK;
// 鍵盤：選んでいる高さなら（指板で選んだものも含めて）外す。それ以外は追加
function pickOnKeyboard(midi){
  if(isPicked(midi)){for(const [k,v] of picks)if(v===midi)picks.delete(k);return;}
  if(!canAdd(midi))return;
  picks.set('kb:'+midi,midi);playNote(midi,state.timbre);
}
// 指板：1本の弦に1音。同じマスなら外し、同じ弦の別のフレットなら置き換える
function pickOnString(s,midi){
  const key='s'+s;
  if(picks.get(key)===midi){picks.delete(key);return;}
  const prev=picks.get(key);
  picks.delete(key);
  if(!canAdd(midi)){if(prev!=null)picks.set(key,prev);return;}
  picks.set(key,midi);playNote(midi,state.timbre);
}
// オフにしたら選んだ音は消す（次にオンにしたときは空から始める）
document.getElementById('pickBtn').onclick=()=>{state.pick=!state.pick;if(state.pick)stopPlayback(true);else picks.clear();render();};
document.getElementById('pickClear').onclick=()=>{picks.clear();render();};
document.getElementById('pickPlay').onclick=()=>{const ns=pickedNotes();if(ns.length)playNotes(ns,state.timbre);};
// 鍵盤の凡例：MIDI 入力・コード判別・コードの構成音の表示中は隠す（見出しのスケール名を隠さないため）
function syncKbLegend(){
  document.getElementById('kbLegend').hidden=liveNotes.length>0||state.pick||document.getElementById('selInfo').classList.contains('on');
}
// MIDI で弾いている音のコード名（見出しに出す）
function renderLive(){
  const box=document.getElementById('liveInfo'), on=liveNotes.length>0;
  box.classList.toggle('on',on);
  syncKbLegend();
  if(!on)return;
  const t=tonic();
  const cands=detectChords(liveNotes).map(c=>({...c,off:mod12(c.root-t),...(c.bass!=null?{boff:mod12(c.bass-t)}:{})}));
  const res=document.getElementById('liveResult');
  res.textContent=cands.length
    ?cands.slice(0,3).map((c,i)=>i===0?`${chordName(c)}（${chordDeg(c.off,c.q,c.boff)}）`:chordName(c)).join(' / ')
    :liveNotes.map(n=>nn(n)).join(' ');
}
function renderPick(){
  const on=state.pick;
  document.getElementById('pickBtn').setAttribute('aria-pressed',on);
  const clear=document.getElementById('pickClear');
  clear.hidden=!on;clear.disabled=!picks.size;
  document.getElementById('pickInfo').classList.toggle('on',on);
  syncKbLegend();
  if(!on)return;
  const box=document.getElementById('pickResult');box.innerHTML='';
  const t=tonic();
  const cands=detectChords(pickedNotes()).map(c=>({...c,off:mod12(c.root-t),...(c.bass!=null?{boff:mod12(c.bass-t)}:{})}));
  if(!picks.size){box.textContent='音を選んでください';return;}
  if(!cands.length){box.textContent='該当なし';return;}
  cands.forEach((ch,i)=>{
    const b=document.createElement('button');b.className=i===0?'best':'';
    b.textContent=i===0?`${chordName(ch)}（${chordDeg(ch.off,ch.q,ch.boff,ch.deg)}）`:chordName(ch);
    b.title='クリックで試聴／DAWへドラッグでMIDI';
    b.onclick=()=>{playChord(ch);state.sel={...ch};};
    attachMidiDrag(b,()=>({name:chordName(ch),bpm:bpm(),chords:[{...ch,beats:BEATS_PER_BAR}]}));
    box.appendChild(b);
  });
}

/* ---------- コード進行 ---------- */
let progChords=[],progTitle='';
// 一時的なコードの変更：{ key: どの進行か, bars: 変更後の小節の並び（変更なしは null） }。
// 1小節のコードの分割（2拍×2）・結合もここに入る。進行・派生を切り替えると消える（保存しない）
const edits={key:null,bars:null};
const isSplitBar=bar=>Array.isArray(bar[0]);
const barItemsOf=bar=>isSplitBar(bar)?bar:[bar];
const clone=x=>JSON.parse(JSON.stringify(x));
const sameJSON=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const EDIT_QUALITIES=['','m','7','M7','m7','6','m6','add9','sus2','sus4','7sus4','9','M9','m9','mM7','dim','dim7','m7b5','aug'];
function selectProgression(i){
  stopPlayback(true);state.prog[state.mode]=i;state.vari[state.mode]=0;state.sel=null;closeMore();render();
}
function renderProgs(){
  const list=PROGRESSIONS.filter(p=>p.mode===state.mode), cur=state.prog[state.mode];
  const pills=document.getElementById('pills');pills.innerHTML='';
  list.forEach((p,i)=>{if(p.extra)return;const b=document.createElement('button');b.textContent=p.name;b.setAttribute('aria-pressed',i===cur);
    b.onclick=()=>selectProgression(i);pills.appendChild(b);});
  // 「その他」：一覧から選ぶ
  const more=document.createElement('button');more.id='moreBtn';
  more.textContent=list[cur].extra?`その他：${list[cur].name}`:'その他…';
  more.setAttribute('aria-pressed',!!list[cur].extra);
  more.onclick=()=>toggleMore(list);
  pills.appendChild(more);
  const p=list[cur], t=tonic(), vars=variantsOf(p), vi=Math.min(state.vari[state.mode],vars.length-1), v=vars[vi];
  const vc=conformed(v.c);   // 「スケールに沿う」を当てた元の進行
  const ekey=`${state.mode}:${cur}:${vi}:${conformOn()?state.scale:''}`;
  if(edits.key!==ekey){edits.key=ekey;edits.bars=null;state.editIdx=null;}
  const bars=edits.bars??vc, edited=!!edits.bars;
  // コード番号 → 小節の位置（b 小節目の k 番目）
  const where=bars.flatMap((bar,b)=>barItemsOf(bar).map((_,k)=>({b,k})));
  const vbox=document.getElementById('variants');vbox.innerHTML='';
  if(vars.length>1){
    vbox.append('派生：');
    vars.forEach((x,i)=>{const b=document.createElement('button');b.textContent=x.name;b.setAttribute('aria-pressed',i===vi);
      b.onclick=()=>{stopPlayback(true);state.vari[state.mode]=i;state.sel=null;render();};vbox.appendChild(b);});
  }
  // リズム½：各コードの長さを半分に（1小節→2拍、2拍→1拍）
  const rate=state.half?.5:1;
  const chords=progressionChords(t,bars).map((c,i)=>({...c,beats:c.beats*rate,...(sameJSON(bars[where[i].b],vc[where[i].b])?{}:{edited:true})}));
  // ファイル名は英字のみ（例：C_Canon_BassLine_half、変更ありは _custom）
  const scaleTag=conformOn()&&state.scale!==(state.mode==='major'?'major':'nminor')?'_'+state.scale:'';
  const title=`${nn(t)}${state.mode==='minor'?'m':''}_${p.file}${vi>0?'_'+VARIANT_FILE[v.name]:''}${scaleTag}${state.half?'_half':''}${edited?'_custom':''}`;
  const nameEl=document.getElementById('progName'), degEl=document.getElementById('progDeg');
  nameEl.textContent=nameEl.title=p.name+(vi>0?`（${v.name}）`:'')+(edited?'＊':'');
  degEl.textContent=progressionDegrees(bars);
  degEl.title=progressionDegrees(bars);
  progChords=chords;progTitle=title;
  // 幅は拍数で決める（1小節＝4マス、2拍のコードは半分の幅）
  const box=document.getElementById('chips');box.innerHTML='';
  // minmax(0,1fr)：チップの文字幅で列が広がって画面からはみ出さないように
  box.style.gridTemplateColumns=`repeat(${Math.min(8,Math.max(4,v.c.length))*BEATS_PER_BAR},minmax(0,1fr))`;
  chords.forEach((ch,i)=>{
    const chip=makeChip(ch,i);
    if(ch.edited)chip.classList.add('edited');
    if(state.editIdx===i)chip.classList.add('editing');
    const span=(ch.beats??BEATS_PER_BAR)/rate;
    chip.style.gridColumn=`span ${span}`;   // 幅は元の拍数の比率のまま
    if(span<BEATS_PER_BAR&&v.c.length>4)chip.classList.add('narrow');   // 5小節以上で2拍のチップは幅が狭いので文字を小さく
    if(playback&&playback.index===i)chip.classList.add('playing');
    box.appendChild(chip);
  });
  renderEditBar(chords,{t,orig:vc,bars,where});
}

// 選んだ進行のコードのルート・種類を変え、1小節のコードを分割・結合するバー（ヒントの位置に出す）
function renderEditBar(chords,{t,orig,bars,where}){
  const bar=document.getElementById('editBar'), i=state.editIdx, ch=i!=null&&chords[i];
  document.getElementById('hint').hidden=!!ch;
  bar.classList.toggle('on',!!ch);
  bar.innerHTML='';
  if(!ch)return;
  const {b,k}=where[i], split=isSplitBar(bars[b]);
  // 小節の並びを書き換える（元と同じになったら変更なしに戻す）。newIdx は書き換え後に選ぶコード
  const update=(fn,newIdx)=>{
    const next=clone(bars);fn(next);
    edits.bars=sameJSON(next,orig)?null:next;
    const nb=edits.bars??orig, items=nb.flatMap(barItemsOf), c={...chordAt(t,items[newIdx])};
    playChord(c);state.sel=c;state.editIdx=newIdx;render();
  };
  const setItem=([off,q,boff])=>{
    const it=boff!=null?[off,q,boff]:[off,q];
    update(nb=>{if(split)nb[b][k]=it;else nb[b]=it;},i);
  };
  // ルート：主音から半音ずつ12音。分数コードはベースとの距離を保つ
  const root=document.createElement('select');root.title='ルート';
  for(let off=0;off<12;off++){const op=document.createElement('option');op.value=off;op.textContent=rootName({root:mod12(t+off),off});root.appendChild(op);}
  root.value=ch.off;
  root.onchange=()=>{const off=+root.value;setItem([off,ch.q,ch.boff!=null?mod12(ch.boff+off-ch.off):undefined]);};
  bar.appendChild(root);
  // ベース：分数コード・オンコード（例：C/E、D/G）。「なし」かルートと同じ音ならベース指定なし
  const slash=document.createElement('span');slash.className='slash';slash.textContent='/';bar.appendChild(slash);
  const bass=document.createElement('select');bass.title='ベース（分数コード・オンコード）';
  const none=document.createElement('option');none.value='';none.textContent='なし';bass.appendChild(none);
  for(let off=0;off<12;off++){const op=document.createElement('option');op.value=off;op.textContent=rootName({root:mod12(t+off),off});bass.appendChild(op);}
  bass.value=ch.boff!=null?String(ch.boff):'';
  bass.onchange=()=>{const b=bass.value===''?undefined:+bass.value;setItem([ch.off,ch.q,b===ch.off?undefined:b]);};
  bar.appendChild(bass);
  // 種類：1行に収めるため種類名だけ（例：add9）
  for(const q of EDIT_QUALITIES){
    const b=document.createElement('button');
    b.textContent=q===''?'maj':CHORD[q].s;
    b.title=chordName({...ch,q});
    b.setAttribute('aria-pressed',ch.q===q);
    b.onclick=()=>setItem([ch.off,q,ch.boff]);
    bar.appendChild(b);
  }
  const tail=document.createElement('span');tail.className='tail';
  // 分割：1小節のコード → 同じコードを2拍×2に。結合：分割された小節 → 選んだほうのコードで1小節に
  const first=where.findIndex(w=>w.b===b);
  const tool=document.createElement('button');tool.className='tool';
  if(!split){
    tool.textContent='✂ 分割';tool.title='この小節を2拍ずつの2コードに分ける';
    tool.onclick=()=>update(nb=>{nb[b]=[clone(nb[b]),clone(nb[b])];},i);
  }else{
    tool.textContent='結合';tool.title='この小節を選んでいるコード1つ（1小節）にする';
    tool.onclick=()=>update(nb=>{nb[b]=clone(nb[b][k]);},first);
  }
  tail.appendChild(tool);
  if(!sameJSON(bars[b],orig[b])){
    const undo=document.createElement('button');undo.textContent='戻す';undo.title='この小節を元に戻す';
    // 元に戻した後は、その小節の先頭のコードを選ぶ
    undo.onclick=()=>update(nb=>{nb[b]=clone(orig[b]);},first);
    tail.appendChild(undo);
  }
  const close=document.createElement('button');close.textContent='閉じる';
  close.onclick=()=>{state.editIdx=null;render();};
  tail.appendChild(close);
  bar.appendChild(tail);
}

// 「その他」の一覧
function toggleMore(list){
  const pop=document.getElementById('morePop');
  if(!pop.hidden){closeMore();return;}
  pop.innerHTML='';
  const t=tonic(), cur=state.prog[state.mode];
  list.forEach((p,i)=>{
    if(!p.extra)return;
    const b=document.createElement('button');b.setAttribute('aria-pressed',i===cur);
    b.innerHTML='<span class="n"></span><span class="d"></span>';
    b.querySelector('.n').textContent=p.name;
    b.querySelector('.d').textContent=progressionChords(t,conformed(p.c)).map(c=>chordName(c)).join(' – ');
    b.title=p.name;
    b.onclick=()=>selectProgression(i);
    pop.appendChild(b);
  });
  pop.hidden=false;
}
function closeMore(){document.getElementById('morePop').hidden=true;}
addEventListener('pointerdown',e=>{
  const pop=document.getElementById('morePop');
  if(!pop.hidden&&!pop.contains(e.target)&&e.target.id!=='moreBtn')closeMore();
});
addEventListener('keydown',e=>{if(e.key==='Escape')closeMore();});

function makeChip(ch,progIndex=null){
  const b=document.createElement('button');b.className='chip';
  if(sameChord(state.sel,ch))b.classList.add('sel');
  b.innerHTML='<span class="n"></span><span class="d"></span>';
  b.querySelector('.n').textContent=chordName(ch);
  b.querySelector('.d').textContent=chordDeg(ch.off,ch.q,ch.boff,ch.deg);
  b.title='クリックで試聴／DAWへドラッグでMIDI';
  // 進行のチップを選ぶと、そのコードの種類を変えるバーが出る
  b.onclick=()=>{playChord(ch);state.sel={...ch};state.editIdx=progIndex;render();};
  // 単体のドラッグは拍数に関わらず1小節
  attachMidiDrag(b,()=>({name:chordName(ch),bpm:bpm(),chords:[{...ch,beats:BEATS_PER_BAR}]}));
  return b;
}
function renderDiatonic(){
  const box=document.getElementById('dia');box.innerHTML='';const t=tonic();
  const items=conformOn()?diatonicOf(state.scale,state.dia==='3'?3:4):DIATONIC[state.dia][state.mode];
  for(const c of items)box.appendChild(makeChip(chordAt(t,c)));
}
attachMidiDrag(document.getElementById('progDrag'),()=>({name:progTitle,bpm:bpm(),chords:progChords}));
// 試聴ボタンは再生中「停止」になる。ループ中は止めるまで繰り返す
document.getElementById('progPlay').onclick=()=>{
  if(playback){stopPlayback(true);render();}
  else playProgression(progChords);
};
document.getElementById('progLoop').onclick=()=>{state.loop=!state.loop;render();};
// ミュート（保存しない：開き直したら音が出る状態から）
let isMuted=false;
document.getElementById('muteBtn').onclick=()=>{
  isMuted=!isMuted;setMuted(isMuted);
  document.getElementById('muteBtn').setAttribute('aria-pressed',isMuted);
};
// Space キーで試聴／停止（試聴ボタンと同じ）。入力欄・選択メニュー・五度圏のキー操作中は横取りしない。
// ボタンにフォーカスがあるときの「Space でそのボタンを押す」動作は止めて、試聴を優先する
document.addEventListener('keydown',e=>{
  if(e.code!=='Space'&&e.key!==' ')return;
  const t=e.target;
  if(t.closest&&(t.closest('input,select,textarea')||t.closest('.wedge')))return;
  e.preventDefault();
  if(e.repeat)return;
  document.getElementById('progPlay').click();
},true);
document.addEventListener('keyup',e=>{
  if((e.code==='Space'||e.key===' ')&&e.target.closest&&e.target.closest('button'))e.preventDefault();
},true);
document.getElementById('progHalf').onclick=()=>{stopPlayback(true);state.half=!state.half;render();};
document.getElementById('conformBtn').onclick=()=>{stopPlayback(true);state.conform=!state.conform;state.sel=null;render();};
document.getElementById('progDl').onclick=()=>saveMidi({name:progTitle,bpm:bpm(),chords:progChords});

/* ---------- ウィンドウに合わせて拡縮 ---------- */
function fit(){
  const s=Math.min(innerWidth/1280,innerHeight/780);
  document.getElementById('stage').style.transform=`translate(-50%,-50%) scale(${s})`;
}
addEventListener('resize',fit);fit();

/* ---------- 全体描画 ---------- */
// チップのコード名が入りきらないときは、切り捨てずに文字を小さくして収める（最小 9px）
function fitChipNames(){
  for(const n of document.querySelectorAll('#dia .chip .n, #chips .chip .n')){
    n.style.fontSize='';
    let size=parseFloat(getComputedStyle(n).fontSize);
    while(n.scrollWidth>n.clientWidth+1&&size>9){size-=.5;n.style.fontSize=size+'px';}
  }
}

function render(){
  keySel.value=state.idx+':'+state.mode;scaleSel.value=state.scale;
  cKey.textContent=keyName().replace('/',' / ');
  cKey.setAttribute('font-size',state.idx===6?15:26);
  cSig.textContent=SIG[state.idx];
  cMode.textContent=state.mode==='major'?'メジャーキー':'マイナーキー';
  drawOverlay();
  const sc=scaleObj(), notes=sc.iv.map(i=>nn(tonic()+i)).join(' ');
  document.getElementById('kbTitle').textContent=`${state.view==='staff'?'五線譜':'鍵盤'}：${nn(tonic())} ${sc.name}`;
  document.getElementById('scaleNotes').textContent=notes;

  const si=document.getElementById('selInfo');
  const shown=shownChord();
  if(shown&&!state.pick){si.classList.add('on');document.getElementById('selName').textContent=`${chordName(shown)}（${chordDeg(shown.off,shown.q,shown.boff,shown.deg)}）`;}
  else si.classList.remove('on');
  syncKbLegend();
  document.getElementById('progPlay').textContent=playback?'停止':'試聴';
  renderTempo();
  document.getElementById('progLoop').setAttribute('aria-pressed',state.loop);
  document.getElementById('progHalf').setAttribute('aria-pressed',state.half);
  const cb=document.getElementById('conformBtn'), usable=CONFORM_SCALES.includes(state.scale);
  cb.disabled=!usable;cb.setAttribute('aria-pressed',conformOn());
  cb.title=usable?'コードの機能はそのまま、構成音を選んだスケールの音にする（キーの外から借りたコードは元のまま）'
                 :'このスケールでは使えません（メジャー・各マイナー・チャーチモードのみ）';
  renderPick();
  // 進行のコード（progChords）を先に作ってから TAB譜を描く
  renderKeyPanel();renderProgs();renderFretPanel();renderDiatonic();
  fitChipNames();
  persist();
}
/* ---------- 状態の保存・復元 ---------- */
// 保存するのは設定や選択の状態だけ（選択中のコード・コード判別の音・再生状態は保存しない）
function persist(){
  saveState({idx:state.idx,mode:state.mode,scale:state.scale,label:state.label,view:state.view,dia:state.dia,
    prog:state.prog,vari:state.vari,timbre:state.timbre,loop:state.loop,half:state.half,
    syncTempo:!!state.syncTempo,bpm:inputBpm(),fbView:state.fbView,tabArea:state.tabArea,tuning:state.tuning,conform:state.conform,theme:state.theme});
}
// 読み込んだ値は1つずつ確かめてから使う（古い・壊れたデータでも落ちないように）
function applySaved(saved){
  if(!saved||typeof saved!=='object')return;
  const pick=(key,ok)=>{if(key in saved&&ok(saved[key]))state[key]=saved[key];};
  const oneOf=list=>v=>list.includes(v);
  const bool=v=>typeof v==='boolean';
  pick('idx',v=>Number.isInteger(v)&&v>=0&&v<12);
  pick('mode',oneOf(['major','minor']));
  pick('scale',v=>!!scaleById(v));
  pick('label',oneOf(['name','degree']));
  pick('view',oneOf(['kb','staff']));
  pick('dia',oneOf(['7','3']));
  pick('fbView',oneOf(['fb','chart','tab']));
  pick('tabArea',oneOf(Object.keys(TAB_AREAS)));
  pick('tuning',v=>v===null||Array.isArray(v)&&v.length>=6&&v.length<=8&&v.every(m=>Number.isInteger(m)&&m>=TUNE_MIN&&m<=TUNE_MAX));
  pick('timbre',oneOf(TIMBRES.map(t=>t.id)));
  pick('loop',bool);pick('half',bool);pick('conform',bool);
  pick('theme',v=>typeof v==='string'&&v in THEMES);
  if(!host.standalone)pick('syncTempo',bool);
  for(const key of ['prog','vari'])
    for(const m of ['major','minor']){
      const v=saved[key]&&saved[key][m];
      if(Number.isInteger(v)&&v>=0)state[key][m]=v;
    }
  // 進行・派生の番号は範囲内に収める
  for(const m of ['major','minor']){
    const list=PROGRESSIONS.filter(p=>p.mode===m);
    state.prog[m]=Math.min(state.prog[m],list.length-1);
    state.vari[m]=Math.min(state.vari[m],variantsOf(list[state.prog[m]]).length-1);
  }
  if(Number.isFinite(saved.bpm))document.getElementById('bpm').value=Math.min(240,Math.max(40,Math.round(saved.bpm)));
  state.sel=null;picks.clear();state.pick=false;
  stopPlayback(true);
  timbreSel.value=state.timbre;setLiveTimbre(state.timbre);
  syncSeg('labelSeg','label');syncSeg('viewSeg','view');syncSeg('diaSeg','dia');applyTheme();syncSeg('fbViewSeg','fbView');syncSeg('tabAreaSeg','tabArea');
  // 五度圏はアニメーションせずにその位置へ
  wheel.setRotation(state.idx);
  render();
}
onStateRestored(applySaved);

wheel.setRotation(0);
applySaved(await loadState());
applyTheme();   // 保存された状態が無いとき（初めて開いたとき）もテーマを当てる
setLiveTimbre(state.timbre);
render();
