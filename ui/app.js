import {
  MAJ_LABEL,MIN_LABEL,SIG,SCALES,PROGRESSIONS,DIATONIC,WHEEL_CELLS,
  mod12,tonicOf,isFlatKey,noteName,keyName as keyNameOf,degLabel,chordName as chordNameOf,chordDeg,
  chordPcs,scaleById,spellChordTone,variantsOf,chordAt,sameChord,voicing,keySignature,
  progressionChords,progressionDegrees,BEATS_PER_BAR,detectChords,VARIANT_FILE,
  CHORD,spellScaleTone,spellChordInterval,convertChordSize
} from './theory.js';
import {renderStaff} from './staff.js';
import {attachMidiDrag,saveMidi} from './midi.js';
import {playChord as play1,playProgression as playN,playNote,playNotes,stopPreview,TIMBRES} from './audio.js';
import {getHostInfo,onHostTempo} from './host.js';
import {loadState,saveState,onStateRestored} from './persist.js';

/* ---------- 状態 ---------- */
const state={idx:0,mode:'major',scale:'major',label:'name',view:'kb',dia:'7',sel:null,prog:{major:0,minor:0},vari:{major:0,minor:0},timbre:'organ',loop:false,syncTempo:false,half:false,pick:false};
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
const chordName=ch=>chordNameOf(ch,useFlat());
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
function el(tag,attrs={},parent){const e=document.createElementNS(NS,tag);for(const k in attrs)e.setAttribute(k,attrs[k]);if(parent)parent.appendChild(e);return e;}
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
  const o=el('path',{d:arc(R.o0,R.o1,a0,a1),fill:'#1E2742',stroke:'#E7EAF0','stroke-width':2,class:'wedge',tabindex:0,role:'button','aria-label':MAJ_LABEL[i]+' メジャー'},gWedges);
  const n=el('path',{d:arc(R.i0,R.i1,a0,a1),fill:'#39456B',stroke:'#E7EAF0','stroke-width':2,class:'wedge',tabindex:0,role:'button','aria-label':MIN_LABEL[i]+' マイナー'},gWedges);
  o.addEventListener('click',()=>setKey(i,'major'));
  n.addEventListener('click',()=>setKey(i,'minor'));
  for(const [node,m] of [[o,'major'],[n,'minor']])
    node.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();setKey(i,m);}});
  const long=i===6;
  const [ox,oy]=P(163,i*30), [ix,iy]=P(100,i*30);
  labelNodes.push({t:txt(gLabels,ox,oy,MAJ_LABEL[i],{fill:'#fff','font-size':long?13:22,'font-weight':700}),x:ox,y:oy});
  labelNodes.push({t:txt(gLabels,ix,iy,MIN_LABEL[i],{fill:'#fff','font-size':long?9:14,'font-weight':500}),x:ix,y:iy});
}
el('circle',{r:R.c,fill:'#F6F7FA',stroke:'#C9CFDC'},wheel);
const cKey=txt(wheel,0,-12,'',{fill:'#1E2742','font-size':26,'font-weight':900});
const cSig=txt(wheel,0,16,'',{fill:'#6A7390','font-size':11});
const cMode=txt(wheel,0,32,'',{fill:'#6A7390','font-size':11});
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
for(const s of SCALES){const o=document.createElement('option');o.value=s.id;o.textContent=s.name;scaleSel.appendChild(o);}
keySel.addEventListener('change',()=>{const [i,m]=keySel.value.split(':');setKey(+i,m);});
scaleSel.addEventListener('change',()=>{state.scale=scaleSel.value;render();});
function bindSeg(id,key,onChange){
  document.querySelectorAll(`#${id} button`).forEach(b=>b.addEventListener('click',()=>{
    state[key]=b.dataset.v;syncSeg(id,key);onChange();
  }));
}
const syncSeg=(id,key)=>document.querySelectorAll(`#${id} button`).forEach(x=>x.setAttribute('aria-pressed',x.dataset.v===state[key]));
bindSeg('labelSeg','label',()=>{renderKeyPanel();renderFretboard();});
bindSeg('viewSeg','view',()=>render());
// 選択中のコードも3和音／4和音の対応する和音に切り替えて、鍵盤・指板の着色に反映し、試聴する
bindSeg('diaSeg','dia',()=>{
  if(state.sel){state.sel=convertChordSize(state.sel,state.dia,state.mode);playChord(state.sel);}
  render();
});
document.getElementById('selClear').addEventListener('click',()=>{stopPlayback(true);state.sel=null;render();});
const timbreSel=document.getElementById('timbre');
for(const t of TIMBRES){const o=document.createElement('option');o.value=t.id;o.textContent=t.name;timbreSel.appendChild(o);}
timbreSel.value=state.timbre;
timbreSel.addEventListener('change',()=>{state.timbre=timbreSel.value;persist();});

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
  const name=inChord?spellChordTone(pc,sel.root,useFlat()):nn(pc);
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
    const pc=WPC[w%7], midi=BASE+Math.floor(w/7)*12+pc, {n,ds,on}=keyStyle(midi);
    el('rect',{x:w*W,y:0,width:W,height:H,fill:on?'#E4DDF5':n.inChord?'#F6D6DF':'#fff',stroke:'#1E2742','stroke-width':1,rx:3,'data-note':midi},g);
    if(ds){el('circle',{cx:w*W+W/2,cy:H-19,r:13,fill:ds.fill,opacity:ds.op},g);
      txt(g,w*W+W/2,H-19,n.label,{fill:'#fff','font-size':n.label.length>2?10:12,'font-weight':700,opacity:ds.op===1?1:.6});}
  }
  for(let o=0;o<octs;o++)for(const pc in BLK){
    const midi=BASE+o*12+(+pc), x=(o*7+BLK[pc]+1)*W-BW/2, {n,ds,on}=keyStyle(midi);
    el('rect',{x,y:0,width:BW,height:BH,fill:on?'#4B3590':n.inChord?'#8E2346':'#1E2742',rx:2,'data-note':midi},g);
    if(ds){el('circle',{cx:x+BW/2,cy:BH-14,r:10.5,fill:ds.fill,opacity:ds.op,stroke:'#fff','stroke-width':1.5},g);
      txt(g,x+BW/2,BH-14,n.label,{fill:'#fff','font-size':9,'font-weight':700,opacity:ds.op===1?1:.6});}
  }
}

// 1つの音（MIDI）の表示。コード判別中は選んだ音を紫、それ以外のスケール音を薄く
function keyStyle(midi){
  const n=noteInfo(mod12(midi));
  let ds=dotStyle(n);
  if(!state.pick)return {n,ds,on:false};
  if(isPicked(midi))return {n,ds:{fill:PICK_COLOR,op:1},on:true};
  return {n,ds:ds&&{...ds,op:.25},on:false};
}
// 指板の1マス：その弦で選んだ音は濃い紫、鍵盤で選んだ同じ高さの音は薄い紫
function fretStyle(s,midi){
  const st=keyStyle(midi);
  if(!state.pick||!st.on)return st;
  if(stringPick(s)===midi)return st;
  if(picks.has('kb:'+midi))return {...st,ds:{fill:PICK_COLOR,op:.4}};
  // 別の弦で選んだ音：このマスは通常の（薄い）表示
  const d=dotStyle(st.n);
  return {...st,ds:d&&{...d,op:.25},on:false};
}

/* ---------- 五線譜 ---------- */
function renderStaffView(){
  const svg=document.getElementById('staff'), t=tonic(), sig=keySignature(state.idx);
  if(state.pick){
    // コード判別：選んだ音を和音で表示（綴りは第1候補のコードから）
    const cand=detectChords(pickedNotes())[0];
    const spell=pc=>{
      if(cand){const iv=CHORD[cand.q].iv.find(i=>mod12(cand.root+i)===pc);
        const s=iv!=null&&spellChordInterval(cand.root,nn(cand.root),iv,cand.q);if(s)return s;}
      return nn(pc);
    };
    const notes=pickedNotes().sort((a,b)=>a-b).map(midi=>{const n=noteInfo(mod12(midi)),name=spell(mod12(midi));
      return {midi,name,label:state.label==='name'?name:n.label,fill:PICK_COLOR,op:1,col:0};});
    renderStaff(svg,{sig,notes,columns:1,labelSide:'right'});
    return;
  }
  if(shownChord()){
    // 選択中（試聴中は鳴っている）コード：MIDI と同じボイシングを和音で表示（綴りはコードの音程から）
    const ch=shownChord(), rootName=nn(ch.root), ivs=CHORD[ch.q].iv;
    const spell=pc=>{const iv=ivs.find(i=>mod12(ch.root+i)===pc);
      return (iv!=null&&spellChordInterval(ch.root,rootName,iv,ch.q))||noteInfo(pc).name;};
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
function renderFretboard(){
  const svg=document.getElementById('fb');svg.innerHTML='';
  const FR=15,FW=55,SS=26,L=60,T=14,strings=[4,11,7,2,9,4];
  const Wd=L+FR*FW+10,Hd=T+SS*5+36;
  svg.setAttribute('viewBox',`0 0 ${Wd} ${Hd}`);
  el('rect',{x:L,y:T-8,width:FR*FW,height:SS*5+16,fill:'#E9DCC6',rx:2},svg);
  for(const f of [3,5,7,9,15])el('circle',{cx:L+(f-.5)*FW,cy:T+SS*2.5,r:6,fill:'#CDBB9C'},svg);
  el('circle',{cx:L+11.5*FW,cy:T+SS*1.5,r:6,fill:'#CDBB9C'},svg);el('circle',{cx:L+11.5*FW,cy:T+SS*3.5,r:6,fill:'#CDBB9C'},svg);
  for(let f=0;f<=FR;f++){
    el('line',{x1:L+f*FW,y1:T-8,x2:L+f*FW,y2:T+SS*5+8,stroke:f===0?'#1E2742':'#9AA2B8','stroke-width':f===0?6:2},svg);
    if(f>0)txt(svg,L+(f-.5)*FW,T+SS*5+22,f,{fill:'#6A7390','font-size':12});
  }
  const OPEN=[64,59,55,50,45,40];   // 上が1弦＝E4
  strings.forEach((open,s)=>{
    const y=T+s*SS;
    el('line',{x1:L,y1:y,x2:L+FR*FW,y2:y,stroke:'#5B6275','stroke-width':1+s*.35},svg);
    txt(svg,13,y,(s+1)+'弦',{fill:'#6A7390','font-size':10});
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
document.getElementById('pickBtn').onclick=()=>{state.pick=!state.pick;if(state.pick)stopPlayback(true);render();};
document.getElementById('pickClear').onclick=()=>{picks.clear();render();};
document.getElementById('pickPlay').onclick=()=>{const ns=pickedNotes();if(ns.length)playNotes(ns,state.timbre);};
function renderPick(){
  const on=state.pick;
  document.getElementById('pickBtn').setAttribute('aria-pressed',on);
  document.getElementById('pickInfo').classList.toggle('on',on);
  document.getElementById('kbLegend').hidden=on;
  if(!on)return;
  const box=document.getElementById('pickResult');box.innerHTML='';
  const t=tonic();
  const cands=detectChords(pickedNotes()).map(c=>({...c,off:mod12(c.root-t),...(c.bass!=null?{boff:mod12(c.bass-t)}:{})}));
  if(!picks.size){box.textContent='音を選んでください';return;}
  if(!cands.length){box.textContent='該当なし';return;}
  cands.forEach((ch,i)=>{
    const b=document.createElement('button');b.className=i===0?'best':'';
    b.textContent=i===0?`${chordName(ch)}（${chordDeg(ch.off,ch.q,ch.boff)}）`:chordName(ch);
    b.title='クリックで試聴／DAWへドラッグでMIDI';
    b.onclick=()=>{playChord(ch);state.sel={...ch};};
    attachMidiDrag(b,()=>({name:chordName(ch),bpm:bpm(),chords:[{...ch,beats:BEATS_PER_BAR}]}));
    box.appendChild(b);
  });
}

/* ---------- コード進行 ---------- */
let progChords=[],progTitle='';
function renderProgs(){
  const list=PROGRESSIONS.filter(p=>p.mode===state.mode), cur=state.prog[state.mode];
  const pills=document.getElementById('pills');pills.innerHTML='';
  list.forEach((p,i)=>{const b=document.createElement('button');b.textContent=p.name;b.setAttribute('aria-pressed',i===cur);
    b.onclick=()=>{stopPlayback(true);state.prog[state.mode]=i;state.vari[state.mode]=0;state.sel=null;render();};pills.appendChild(b);});
  const p=list[cur], t=tonic(), vars=variantsOf(p), vi=Math.min(state.vari[state.mode],vars.length-1), v=vars[vi];
  const vbox=document.getElementById('variants');vbox.innerHTML='';
  if(vars.length>1){
    vbox.append('派生：');
    vars.forEach((x,i)=>{const b=document.createElement('button');b.textContent=x.name;b.setAttribute('aria-pressed',i===vi);
      b.onclick=()=>{stopPlayback(true);state.vari[state.mode]=i;state.sel=null;render();};vbox.appendChild(b);});
  }
  // リズム½：各コードの長さを半分に（1小節→2拍、2拍→1拍）
  const rate=state.half?.5:1;
  const chords=progressionChords(t,v.c).map(c=>({...c,beats:c.beats*rate}));
  // ファイル名は英字のみ（例：C_Canon_BassLine_half）
  const title=`${nn(t)}${state.mode==='minor'?'m':''}_${p.file}${vi>0?'_'+VARIANT_FILE[v.name]:''}${state.half?'_half':''}`;
  document.getElementById('progName').textContent=p.name+(vi>0?`（${v.name}）`:'');
  document.getElementById('progDeg').textContent=v.c.length>8?`${v.c.length}小節`:progressionDegrees(v.c);
  progChords=chords;progTitle=title;
  // 幅は拍数で決める（1小節＝4マス、2拍のコードは半分の幅）
  const box=document.getElementById('chips');box.innerHTML='';
  box.style.gridTemplateColumns=`repeat(${Math.min(8,Math.max(4,v.c.length))*BEATS_PER_BAR},1fr)`;
  chords.forEach((ch,i)=>{
    const chip=makeChip(ch);
    chip.style.gridColumn=`span ${(ch.beats??BEATS_PER_BAR)/rate}`;   // 幅は元の拍数の比率のまま
    if(playback&&playback.index===i)chip.classList.add('playing');
    box.appendChild(chip);
  });
}
function makeChip(ch){
  const b=document.createElement('button');b.className='chip';
  if(sameChord(state.sel,ch))b.classList.add('sel');
  b.innerHTML='<span class="n"></span><span class="d"></span>';
  b.querySelector('.n').textContent=chordName(ch);
  b.querySelector('.d').textContent=chordDeg(ch.off,ch.q,ch.boff);
  b.title='クリックで試聴／DAWへドラッグでMIDI';
  b.onclick=()=>{playChord(ch);state.sel={...ch};render();};
  // 単体のドラッグは拍数に関わらず1小節
  attachMidiDrag(b,()=>({name:chordName(ch),bpm:bpm(),chords:[{...ch,beats:BEATS_PER_BAR}]}));
  return b;
}
function renderDiatonic(){
  const box=document.getElementById('dia');box.innerHTML='';const t=tonic();
  for(const c of DIATONIC[state.dia][state.mode])box.appendChild(makeChip(chordAt(t,c)));
}
attachMidiDrag(document.getElementById('progDrag'),()=>({name:progTitle,bpm:bpm(),chords:progChords}));
// 試聴ボタンは再生中「停止」になる。ループ中は止めるまで繰り返す
document.getElementById('progPlay').onclick=()=>{
  if(playback){stopPlayback(true);render();}
  else playProgression(progChords);
};
document.getElementById('progLoop').onclick=()=>{state.loop=!state.loop;render();};
document.getElementById('progHalf').onclick=()=>{stopPlayback(true);state.half=!state.half;render();};
document.getElementById('progDl').onclick=()=>saveMidi({name:progTitle,bpm:bpm(),chords:progChords});

/* ---------- ウィンドウに合わせて拡縮 ---------- */
function fit(){
  const s=Math.min(innerWidth/1280,innerHeight/780);
  document.getElementById('stage').style.transform=`translate(-50%,-50%) scale(${s})`;
}
addEventListener('resize',fit);fit();

/* ---------- 全体描画 ---------- */
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
  document.getElementById('fbTitle').textContent=`ギター指板：${nn(tonic())} ${sc.name}`;
  const si=document.getElementById('selInfo');
  const shown=shownChord();
  if(shown&&!state.pick){si.classList.add('on');document.getElementById('selName').textContent=`${chordName(shown)}（${chordDeg(shown.off,shown.q,shown.boff)}）`;}
  else si.classList.remove('on');
  document.getElementById('progPlay').textContent=playback?'停止':'試聴';
  renderTempo();
  document.getElementById('progLoop').setAttribute('aria-pressed',state.loop);
  document.getElementById('progHalf').setAttribute('aria-pressed',state.half);
  renderPick();
  renderKeyPanel();renderFretboard();renderProgs();renderDiatonic();
  persist();
}
/* ---------- 状態の保存・復元 ---------- */
// 保存するのは設定や選択の状態だけ（選択中のコード・コード判別の音・再生状態は保存しない）
function persist(){
  saveState({idx:state.idx,mode:state.mode,scale:state.scale,label:state.label,view:state.view,dia:state.dia,
    prog:state.prog,vari:state.vari,timbre:state.timbre,loop:state.loop,half:state.half,
    syncTempo:!!state.syncTempo,bpm:inputBpm()});
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
  pick('timbre',oneOf(TIMBRES.map(t=>t.id)));
  pick('loop',bool);pick('half',bool);
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
  timbreSel.value=state.timbre;
  syncSeg('labelSeg','label');syncSeg('viewSeg','view');syncSeg('diaSeg','dia');
  // 五度圏はアニメーションせずにその位置へ
  cancelAnimationFrame(anim);rot=-state.idx*30;applyRot(rot);
  render();
}
onStateRestored(applySaved);

applyRot(0);
applySaved(await loadState());
render();
