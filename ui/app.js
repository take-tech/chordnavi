import {
  MAJ_LABEL,MIN_LABEL,SIG,SCALES,PROGRESSIONS,DIATONIC,WHEEL_CELLS,
  mod12,tonicOf,isFlatKey,noteName,keyName as keyNameOf,degLabel,chordName as chordNameOf,chordDeg,chordRootName,
  chordPcs,scaleById,spellChordTone,variantsOf,chordAt,sameChord,voicing,keySignature,
  progressionChords,progressionDegrees,BEATS_PER_BAR,detectChords,VARIANT_FILE,
  CONFORM_SCALES,conformBars,diatonicOf,
  CHORD,spellScaleTone,spellChordInterval,convertChordSize
} from './theory.js';
import {renderStaff} from './staff.js';
import {threePositions,nearestVoicing,TAB_AREAS} from './guitar.js';
import {attachMidiDrag,saveMidi} from './midi.js';
import {playChord as play1,playProgression as playN,playNote,playNotes,stopPreview,setLiveTimbre,TIMBRES} from './audio.js';
import {getHostInfo,onHostTempo,onMidiNotes,onSetTheme,reportTheme} from './host.js';
import {loadState,saveState,onStateRestored} from './persist.js';

/* ---------- 状態 ---------- */
const state={idx:0,mode:'major',scale:'major',label:'name',view:'kb',dia:'7',sel:null,prog:{major:0,minor:0},vari:{major:0,minor:0},timbre:'organ',loop:false,syncTempo:false,half:false,pick:false,editIdx:null,fbView:'fb',tabArea:'low',conform:false,theme:'light'};
// 「スケールに沿う」が効いているか（対象の 7 音のスケールのときだけ）
const conformOn=()=>state.conform&&CONFORM_SCALES.includes(state.scale);
const conformed=(bars,mode=state.mode)=>conformOn()?conformBars(bars,mode,state.scale):bars;
// コード判別で選んだ音。キーは 'kb:<MIDI>'（鍵盤）または 's<弦番号>'（指板：1本の弦に1音）、値は MIDI
const picks=new Map();
const pickedNotes=()=>[...new Set(picks.values())];
const isPicked=midi=>[...picks.values()].includes(midi);
const stringPick=s=>picks.get('s'+s);
const MAX_PICK=8, PICK_COLOR='#6B4FBB';
const tonic=()=>tonicOf(state.idx,state.mode);
const playChord=ch=>{stopPlayback(false);play1(ch,state.timbre);};

/* ---------- 進行の試聴と、鳴っているコードの表示 ---------- */
// playback: { chords, index, timers }。index は今鳴っているコード（-1 は鳴る前）
let playback=null;
function playProgression(chords){
  stopPlayback(false);
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
  document.getElementById('themeBtn').hidden=false;   // DAW 上はメニューが無いのでタイトル横にボタン
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

/* ---------- 五度圏 ---------- */
const wheel=document.getElementById('wheel');
const P=(r,a)=>[r*Math.sin(a*Math.PI/180),-r*Math.cos(a*Math.PI/180)];
function arc(r0,r1,a0,a1){
  const [x0,y0]=P(r1,a0),[x1,y1]=P(r1,a1),[x2,y2]=P(r0,a1),[x3,y3]=P(r0,a0);
  return `M${x0},${y0}A${r1},${r1} 0 0 1 ${x1},${y1}L${x2},${y2}A${r0},${r0} 0 0 0 ${x3},${y3}Z`;
}
const R={c:66,i0:68,i1:118,o0:120,o1:192};
const gWedges=el('g',{},wheel), gOverlay=el('g',{'pointer-events':'none'},wheel), gLabels=el('g',{'pointer-events':'none'},wheel), gStatic=el('g',{'pointer-events':'none'},wheel);
const labelNodes=[];

for(let i=0;i<12;i++){
  const a0=i*30-15,a1=i*30+15;
  const o=el('path',{d:arc(R.o0,R.o1,a0,a1),fill:'var(--wheel-outer)',stroke:'var(--bg)','stroke-width':2,class:'wedge',tabindex:0,role:'button','aria-label':MAJ_LABEL[i]+' メジャー'},gWedges);
  const n=el('path',{d:arc(R.i0,R.i1,a0,a1),fill:'var(--wheel-inner)',stroke:'var(--bg)','stroke-width':2,class:'wedge',tabindex:0,role:'button','aria-label':MIN_LABEL[i]+' マイナー'},gWedges);
  o.addEventListener('click',()=>setKey(i,'major'));
  n.addEventListener('click',()=>setKey(i,'minor'));
  for(const [node,m] of [[o,'major'],[n,'minor']])
    node.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();setKey(i,m);}});
  const long=i===6;
  const [ox,oy]=P(163,i*30), [ix,iy]=P(100,i*30);
  labelNodes.push({t:txt(gLabels,ox,oy,MAJ_LABEL[i],{fill:'#fff','font-size':long?13:22,'font-weight':700}),x:ox,y:oy});
  labelNodes.push({t:txt(gLabels,ix,iy,MIN_LABEL[i],{fill:'#fff','font-size':long?9:14,'font-weight':500}),x:ix,y:iy});
}
el('circle',{r:R.c,fill:'var(--panel)',stroke:'var(--line)'},wheel);
const cKey=txt(wheel,0,-12,'',{fill:'var(--ink)','font-size':26,'font-weight':900});
const cSig=txt(wheel,0,16,'',{fill:'var(--muted)','font-size':11});
const cMode=txt(wheel,0,32,'',{fill:'var(--muted)','font-size':11});
el('path',{d:'M-9,-212 L9,-212 L0,-197 Z',fill:'#E3A21A'},wheel);

function drawOverlay(){
  gOverlay.innerHTML='';gStatic.innerHTML='';
  for(const [rel,outer,deg,isT] of WHEEL_CELLS[state.mode]){
    const a=rel*30, r0=outer?R.o0:R.i0, r1=outer?R.o1:R.i1;
    el('path',{d:arc(r0,r1,a-15,a+15),fill:isT?'#E3A21A':'#2E8C80','fill-opacity':isT?.9:(rel===2?.35:.6)},gOverlay);
    const [x,y]=P(outer?134:80,a);
    txt(gStatic,x,y,deg,{fill:'#fff','font-size':outer?11:9,'font-weight':700,opacity:.95});
  }
}

let rot=0,anim=null;
function applyRot(r){
  const tr=`rotate(${r})`;
  gWedges.setAttribute('transform',tr);gLabels.setAttribute('transform',tr);
  for(const n of labelNodes)n.t.setAttribute('transform',`rotate(${-r},${n.x},${n.y})`);
}
function rotateTo(idx){
  const target=-idx*30;
  const d=((target-rot)%360+540)%360-180;
  const from=rot,to=rot+d,dur=matchMedia('(prefers-reduced-motion: reduce)').matches?0:750,t0=performance.now();
  cancelAnimationFrame(anim);
  const step=now=>{
    const p=dur?Math.min(1,(now-t0)/dur):1, e=1-Math.pow(1-p,3);
    rot=from+(to-from)*e;applyRot(rot);
    if(p<1)anim=requestAnimationFrame(step);else rot=to;
  };
  anim=requestAnimationFrame(step);
}

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

/* ---------- テーマ（ライト／ダーク／自動＝OS の外観に合わせる） ---------- */
// Standalone はメニューの「オプション → テーマ」、DAW 上はタイトル横のボタンで切り替える
const THEMES=['light','dark','auto'], THEME_LABEL={light:'☀ ライト',dark:'☾ ダーク',auto:'◐ 自動'};
const darkQuery=matchMedia('(prefers-color-scheme: dark)');
function applyTheme(){
  const dark=state.theme==='dark'||(state.theme==='auto'&&darkQuery.matches);
  document.documentElement.dataset.theme=dark?'dark':'light';
  document.getElementById('themeBtn').textContent=THEME_LABEL[state.theme];
  reportTheme(state.theme);
}
function setTheme(name){if(!THEMES.includes(name))return;state.theme=name;applyTheme();persist();}
darkQuery.addEventListener('change',()=>{if(state.theme==='auto')applyTheme();});
document.getElementById('themeBtn').onclick=()=>setTheme(THEMES[(THEMES.indexOf(state.theme)+1)%THEMES.length]);
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
    if(n.inChord)return {fill:n.chordRoot?'#8E2346':'#C4456A',op:1};
    if(n.inScale)return {fill:n.isRoot?'#E3A21A':'#2E8C80',op:.25};
    return null;
  }
  if(!n.inScale)return null;
  return {fill:n.isRoot?'#E3A21A':'#2E8C80',op:1};
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
    el('rect',{x,y:0,width:BW,height:BH,fill:live?'#1F4FA8':on?'#4B3590':n.inChord?'#8E2346':'var(--key-black)',rx:2,'data-note':midi},g);
    if(ds){el('circle',{cx:x+BW/2,cy:BH-14,r:10.5,fill:ds.fill,opacity:ds.op,stroke:'#fff','stroke-width':1.5},g);
      txt(g,x+BW/2,BH-14,n.label,{fill:'#fff','font-size':9,'font-weight':700,opacity:ds.op===1?1:.6});}
  }
}

// 1つの音（MIDI）の表示。コード判別中は選んだ音を紫、それ以外のスケール音を薄く
/* ---------- MIDI キーボード入力 ---------- */
// 弾いている音（MIDI 番号）。表示できる範囲の外の音はオクターブを折り返して見せる
let liveNotes=[];
const LIVE_COLOR='#2F6FD6';
const KB_RANGE=[48,84], FB_RANGE=[40,79];   // 鍵盤 C3〜C6、指板 E2〜G5
const fold=(n,[lo,hi])=>{while(n<lo)n+=12;while(n>hi)n-=12;return n;};
let liveKb=new Set(), liveFb=new Set();
onMidiNotes(info=>{
  liveNotes=[...(info.notes||[])].sort((a,b)=>a-b);
  liveKb=new Set(liveNotes.map(n=>fold(n,KB_RANGE)));
  liveFb=new Set(liveNotes.map(n=>fold(n,FB_RANGE)));
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

/* ---------- 指板 ---------- */
/* ---------- TAB譜 ---------- */
// 選んだコード：3ポジション（6弦・5弦・4弦ルート）。選んでいない・試聴中：進行を選んだエリア（ロー／ミドル／ハイ）で
function tabColumns(){
  const ch=playback||state.pick?null:state.sel;
  if(ch)return {mode:'chord',cols:threePositions(ch).map(v=>({title:chordName(ch),
    sub:`${v.bassString+1}弦ルート・${v.open||!v.lo?'開放':v.lo+'フレット'}`,v}))};
  let prev=null;
  return {mode:'prog',cols:progChords.map((c,i)=>{const v=nearestVoicing(c,TAB_AREAS[state.tabArea],prev);prev=v;
    return {title:chordName(c),sub:'',v,playing:!!playback&&playback.index===i};})};
}
function renderTab(){
  const svg=document.getElementById('tab');svg.innerHTML='';
  const W=895,H=180,L=50,R=885,TOP=46,GAP=20;
  svg.setAttribute('viewBox',`0 0 ${W} ${H}`);
  const {mode,cols}=tabColumns();
  for(let s=0;s<6;s++)el('line',{x1:L,y1:TOP+s*GAP,x2:R,y2:TOP+s*GAP,stroke:'var(--faint)','stroke-width':1.2},svg);
  ['T','A','B'].forEach((c,i)=>txt(svg,26,TOP+18+i*32,c,{fill:'var(--ink)','font-size':15,'font-weight':900}));
  el('line',{x1:L,y1:TOP,x2:L,y2:TOP+5*GAP,stroke:'var(--ink)','stroke-width':2},svg);
  el('line',{x1:R,y1:TOP,x2:R,y2:TOP+5*GAP,stroke:'var(--ink)','stroke-width':2},svg);
  if(!cols.length){txt(svg,W/2,TOP+2.5*GAP,'このコードの形が見つかりません',{fill:'var(--muted)','font-size':13});return;}
  const cw=(R-L)/cols.length, small=cols.length>8;
  cols.forEach((c,i)=>{
    const x0=L+i*cw, cx=x0+cw/2;
    const g=el('g',{class:'col'},svg);
    el('rect',{class:'colbg',x:x0,y:0,width:cw,height:H,fill:c.playing?'var(--chord-tint)':'transparent'},g);
    if(i>0)el('line',{x1:x0,y1:TOP,x2:x0,y2:TOP+5*GAP,stroke:mode==='prog'?'var(--ink)':'var(--line)','stroke-width':mode==='prog'?1.2:1},g);
    txt(g,cx,14,c.title,{fill:c.playing?'#C4456A':'var(--ink)','font-size':small?11:14,'font-weight':700});
    if(c.sub)txt(g,cx,30,c.sub,{fill:'var(--muted)','font-size':10});
    if(!c.v)return;
    for(let s=0;s<6;s++){
      const f=c.v.frets[s], y=TOP+s*GAP;
      if(f==null){txt(g,cx,y,'×',{fill:'var(--faint2)','font-size':10});continue;}
      const label=String(f);
      el('rect',{x:cx-(label.length>1?10:7),y:y-8,width:label.length>1?20:14,height:16,fill:c.playing?'var(--chord-tint)':'var(--panel)'},g);
      txt(g,cx,y,label,{fill:s===c.v.bassString?'#E3A21A':'var(--ink)','font-size':small?12:14,'font-weight':700});
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
  const FRETS=4, SG=19;
  const top=mode==='chord'?44:38;
  const fw=Math.min(mode==='chord'?42:small?14:34,(cw-(small?14:40))/FRETS);
  cols.forEach((c,i)=>{
    const x0=L+i*cw, cx=x0+cw/2, g=el('g',{class:'col'},svg);
    el('rect',{class:'colbg',x:x0,y:0,width:cw,height:H,fill:c.playing?'var(--chord-tint)':'transparent'},g);
    txt(g,cx,14,c.title,{fill:c.playing?'#C4456A':'var(--ink)','font-size':small?11:14,'font-weight':700});
    if(c.sub)txt(g,cx,30,c.sub,{fill:'var(--muted)','font-size':10});
    if(!c.v)return;
    const v=c.v, fretted=v.frets.filter(f=>f!=null&&f>0);
    const lo=fretted.length?Math.min(...fretted):1, hi=fretted.length?Math.max(...fretted):1;
    const start=hi<=FRETS?1:lo;                        // ローポジションはナットから
    const gx=cx-fw*FRETS/2+(small?3:6), sy=s=>top+s*SG;
    // 地・フレット・弦（6弦ほど太く）
    el('rect',{x:gx,y:sy(0),width:fw*FRETS,height:sy(5)-sy(0),fill:'var(--card)'},g);
    for(let k=0;k<=FRETS;k++)el('line',{x1:gx+k*fw,y1:sy(0),x2:gx+k*fw,y2:sy(5),stroke:k===0&&start===1?'var(--ink)':'var(--faint)',
      'stroke-width':k===0&&start===1?(small?3:5):1.2},g);
    for(let s=0;s<6;s++)el('line',{x1:gx,y1:sy(s),x2:gx+fw*FRETS,y2:sy(s),stroke:'var(--string)','stroke-width':.8+s*.28},g);
    if(start>1)txt(g,gx+fw/2,sy(5)+(small?11:14),`${start}fr`,{fill:'var(--ink)','font-size':small?9:12,'font-weight':700});
    // 開放（○）・ミュート（×）
    for(let s=0;s<6;s++){
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
      el('circle',{cx:fx(f),cy:sy(s),r,fill:s===v.bassString?'#E3A21A':'var(--ink)',stroke:s===v.bassString&&barre&&f===lo?'var(--card)':'none','stroke-width':1},g);
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
  document.getElementById('fbLegend').textContent=tab?'上が1弦・オレンジはベース（最低音）':'レギュラーチューニング・上が1弦';
  // 見出し（進行名は renderProgs の後で確定している）
  const label=state.fbView==='chart'?'コード図':'TAB';
  document.getElementById('fbTitle').textContent=tab
    ?(state.sel&&!playback&&!state.pick?`${label}：${chordName(state.sel)} の3ポジション`:`${label}：${document.getElementById('progName').textContent||'コード進行'}`)
    :`ギター指板：${nn(tonic())} ${scaleObj().name}`;
  if(state.fbView==='chart')renderChart();else if(tab)renderTab();else renderFretboard();
}

function renderFretboard(){
  const svg=document.getElementById('fb');svg.innerHTML='';
  const FR=15,FW=55,SS=26,L=60,T=14,strings=[4,11,7,2,9,4];
  const Wd=L+FR*FW+10,Hd=T+SS*5+36;
  svg.setAttribute('viewBox',`0 0 ${Wd} ${Hd}`);
  el('rect',{x:L,y:T-8,width:FR*FW,height:SS*5+16,fill:'var(--wood)',rx:2},svg);
  for(const f of [3,5,7,9,15])el('circle',{cx:L+(f-.5)*FW,cy:T+SS*2.5,r:6,fill:'var(--inlay)'},svg);
  el('circle',{cx:L+11.5*FW,cy:T+SS*1.5,r:6,fill:'var(--inlay)'},svg);el('circle',{cx:L+11.5*FW,cy:T+SS*3.5,r:6,fill:'var(--inlay)'},svg);
  for(let f=0;f<=FR;f++){
    el('line',{x1:L+f*FW,y1:T-8,x2:L+f*FW,y2:T+SS*5+8,stroke:f===0?'var(--nut)':'var(--fret)','stroke-width':f===0?6:2},svg);
    if(f>0)txt(svg,L+(f-.5)*FW,T+SS*5+22,f,{fill:'var(--muted)','font-size':12});
  }
  const OPEN=[64,59,55,50,45,40];   // 上が1弦＝E4
  strings.forEach((open,s)=>{
    const y=T+s*SS;
    el('line',{x1:L,y1:y,x2:L+FR*FW,y2:y,stroke:'var(--string)','stroke-width':1+s*.35},svg);
    txt(svg,13,y,(s+1)+'弦',{fill:'var(--muted)','font-size':10});
    for(let f=0;f<=FR;f++){
      const {n,ds}=fretStyle(s,OPEN[s]+f); if(!ds)continue;
      const x=f===0?L-18:L+(f-.5)*FW;
      el('circle',{cx:x,cy:y,r:12,fill:ds.fill,opacity:ds.op,stroke:'#fff','stroke-width':1.5},svg);
      txt(svg,x,y,n.label,{fill:'#fff','font-size':n.label.length>2?9:11,'font-weight':700,opacity:ds.op===1?1:.6});
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
// MIDI で弾いている音のコード名（見出しに出す）
function renderLive(){
  const box=document.getElementById('liveInfo'), on=liveNotes.length>0;
  box.classList.toggle('on',on);
  document.getElementById('kbLegend').hidden=on||state.pick;
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
  document.getElementById('kbLegend').hidden=on||liveNotes.length>0;
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
  // 1行に収まらない長い進行は、ディグリーを進行名の下の行に出す（その分ヒントを隠す）
  const detail=document.querySelector('.detail');
  detail.classList.remove('longdeg');
  if(degEl.scrollWidth>degEl.clientWidth+1)detail.classList.add('longdeg');
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
  document.getElementById('hint').hidden=!!ch||document.querySelector('.detail').classList.contains('longdeg');
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
    syncTempo:!!state.syncTempo,bpm:inputBpm(),fbView:state.fbView,tabArea:state.tabArea,conform:state.conform,theme:state.theme});
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
  pick('timbre',oneOf(TIMBRES.map(t=>t.id)));
  pick('loop',bool);pick('half',bool);pick('conform',bool);
  pick('theme',oneOf(['light','dark','auto']));
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
  cancelAnimationFrame(anim);rot=-state.idx*30;applyRot(rot);
  render();
}
onStateRestored(applySaved);

applyRot(0);
applySaved(await loadState());
applyTheme();   // 保存された状態が無いとき（初めて開いたとき）もテーマを当てる
setLiveTimbre(state.timbre);
render();
