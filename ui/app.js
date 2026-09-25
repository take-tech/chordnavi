import {
  MAJ_LABEL,MIN_LABEL,SIG,SCALES,PROGRESSIONS,DIATONIC,WHEEL_CELLS,
  mod12,tonicOf,isFlatKey,noteName,keyName as keyNameOf,degLabel,chordName as chordNameOf,chordDeg,
  chordPcs,scaleById,spellChordTone,variantsOf,chordAt,sameChord,voicing,keySignature,
  CHORD,spellScaleTone,spellChordInterval
} from './theory.js';
import {renderStaff} from './staff.js';
import {attachMidiDrag,saveMidi} from './midi.js';
import {playChord,playProgression} from './audio.js';

/* ---------- 状態 ---------- */
const state={idx:0,mode:'major',scale:'major',label:'name',view:'kb',dia:'7',sel:null,prog:{major:0,minor:0},vari:{major:0,minor:0}};
const tonic=()=>tonicOf(state.idx,state.mode);
const useFlat=()=>isFlatKey(state.idx);
const nn=pc=>noteName(pc,useFlat());
const scaleObj=()=>scaleById(state.scale);
const keyName=()=>keyNameOf(state.idx,state.mode);
const chordName=ch=>chordNameOf(ch,useFlat());
const bpm=()=>Math.min(240,Math.max(40,+document.getElementById('bpm').value||120));

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
bindSeg('diaSeg','dia',()=>renderDiatonic());
document.getElementById('selClear').addEventListener('click',()=>{state.sel=null;render();});

function setKey(i,m){
  if(m!==state.mode){state.scale=m==='major'?'major':'nminor';}
  state.idx=i;state.mode=m;state.sel=null;
  rotateTo(i);render();
}

/* ---------- 音の表示ヘルパー ---------- */
function noteInfo(pc){
  const t=tonic(), sc=scaleObj(), iv=mod12(pc-t);
  const inScale=sc.iv.includes(iv);
  const pcs=state.sel?chordPcs(state.sel):null;
  const inChord=pcs?pcs.includes(pc):false;
  const chordRoot=state.sel&&pc===state.sel.root;
  const name=inChord?spellChordTone(pc,state.sel.root,useFlat()):nn(pc);
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

  const WPC=[0,2,4,5,7,9,11], BLK={1:0,3:1,6:3,8:4,10:5};
  const g=el('g',{transform:'translate(1,1)'},svg);
  for(let w=0;w<whites;w++){
    const pc=WPC[w%7], n=noteInfo(pc), ds=dotStyle(n);
    el('rect',{x:w*W,y:0,width:W,height:H,fill:n.inChord?'#F6D6DF':'#fff',stroke:'#1E2742','stroke-width':1,rx:3},g);
    if(ds){el('circle',{cx:w*W+W/2,cy:H-19,r:13,fill:ds.fill,opacity:ds.op},g);
      txt(g,w*W+W/2,H-19,n.label,{fill:'#fff','font-size':n.label.length>2?10:12,'font-weight':700,opacity:ds.op===1?1:.6});}
  }
  for(let o=0;o<octs;o++)for(const pc in BLK){
    const x=(o*7+BLK[pc]+1)*W-BW/2, n=noteInfo(+pc), ds=dotStyle(n);
    el('rect',{x,y:0,width:BW,height:BH,fill:n.inChord?'#8E2346':'#1E2742',rx:2},g);
    if(ds){el('circle',{cx:x+BW/2,cy:BH-14,r:10.5,fill:ds.fill,opacity:ds.op,stroke:'#fff','stroke-width':1.5},g);
      txt(g,x+BW/2,BH-14,n.label,{fill:'#fff','font-size':9,'font-weight':700,opacity:ds.op===1?1:.6});}
  }
}

/* ---------- 五線譜 ---------- */
function renderStaffView(){
  const svg=document.getElementById('staff'), t=tonic(), sig=keySignature(state.idx);
  if(state.sel){
    // 選択中のコード：MIDI と同じボイシングを和音で表示（綴りはコードの音程から）
    const ch=state.sel, rootName=nn(ch.root), ivs=CHORD[ch.q].iv;
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
  strings.forEach((open,s)=>{
    const y=T+s*SS;
    el('line',{x1:L,y1:y,x2:L+FR*FW,y2:y,stroke:'#5B6275','stroke-width':1+s*.35},svg);
    txt(svg,13,y,(s+1)+'弦',{fill:'#6A7390','font-size':10});
    for(let f=0;f<=FR;f++){
      const pc=(open+f)%12, n=noteInfo(pc), ds=dotStyle(n); if(!ds)continue;
      const x=f===0?L-18:L+(f-.5)*FW;
      el('circle',{cx:x,cy:y,r:12,fill:ds.fill,opacity:ds.op,stroke:'#fff','stroke-width':1.5},svg);
      txt(svg,x,y,n.label,{fill:'#fff','font-size':n.label.length>2?9:11,'font-weight':700,opacity:ds.op===1?1:.6});
    }
  });
}

/* ---------- コード進行 ---------- */
let progChords=[],progTitle='';
function renderProgs(){
  const list=PROGRESSIONS.filter(p=>p.mode===state.mode), cur=state.prog[state.mode];
  const pills=document.getElementById('pills');pills.innerHTML='';
  list.forEach((p,i)=>{const b=document.createElement('button');b.textContent=p.name;b.setAttribute('aria-pressed',i===cur);
    b.onclick=()=>{state.prog[state.mode]=i;state.vari[state.mode]=0;state.sel=null;render();};pills.appendChild(b);});
  const p=list[cur], t=tonic(), vars=variantsOf(p), vi=Math.min(state.vari[state.mode],vars.length-1), v=vars[vi];
  const vbox=document.getElementById('variants');vbox.innerHTML='';
  if(vars.length>1){
    vbox.append('派生：');
    vars.forEach((x,i)=>{const b=document.createElement('button');b.textContent=x.name;b.setAttribute('aria-pressed',i===vi);
      b.onclick=()=>{state.vari[state.mode]=i;state.sel=null;render();};vbox.appendChild(b);});
  }
  const chords=v.c.map(c=>chordAt(t,c));
  const title=`${nn(t)}${state.mode==='minor'?'m':''}_${p.name}${vi>0?'_'+v.name:''}`;
  document.getElementById('progName').textContent=p.name+(vi>0?`（${v.name}）`:'');
  document.getElementById('progDeg').textContent=v.c.length>8?`${v.c.length}小節`:v.c.map(([o,q,bo])=>chordDeg(o,q,bo)).join(' – ');
  progChords=chords;progTitle=title;
  const box=document.getElementById('chips');box.innerHTML='';
  // 9コード以上（12小節ブルース等）は派生形の行ぶんの高さを空けるため1行に並べる
  const dense=chords.length>8;
  box.classList.toggle('dense',dense);
  box.style.gridTemplateColumns=`repeat(${dense?chords.length:Math.max(4,chords.length)},1fr)`;
  chords.forEach(ch=>box.appendChild(makeChip(ch)));
}
function makeChip(ch){
  const b=document.createElement('button');b.className='chip';
  if(sameChord(state.sel,ch))b.classList.add('sel');
  b.innerHTML='<span class="n"></span><span class="d"></span>';
  b.querySelector('.n').textContent=chordName(ch);
  b.querySelector('.d').textContent=chordDeg(ch.off,ch.q,ch.boff);
  b.title='クリックで試聴／DAWへドラッグでMIDI';
  b.onclick=()=>{playChord(ch);state.sel={...ch};render();};
  attachMidiDrag(b,()=>({name:chordName(ch),bpm:bpm(),chords:[ch]}));
  return b;
}
function renderDiatonic(){
  const box=document.getElementById('dia');box.innerHTML='';const t=tonic();
  for(const c of DIATONIC[state.dia][state.mode])box.appendChild(makeChip(chordAt(t,c)));
}
attachMidiDrag(document.getElementById('progDrag'),()=>({name:progTitle,bpm:bpm(),chords:progChords}));
document.getElementById('progPlay').onclick=()=>playProgression(progChords);
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
  if(state.sel){si.classList.add('on');document.getElementById('selName').textContent=`${chordName(state.sel)}（${chordDeg(state.sel.off,state.sel.q,state.sel.boff)}）`;}
  else si.classList.remove('on');
  renderKeyPanel();renderFretboard();renderProgs();renderDiatonic();
}
applyRot(0);render();
