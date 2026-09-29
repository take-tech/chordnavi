import {MAJ_LABEL,MIN_LABEL,SIG,WHEEL_CELLS,DIATONIC,CHORD,chordDeg,chordAt,chordName as chordNameOf,
  noteName,tonicOf,isFlatKey,keyName as keyNameOf,detectChords,mod12,PROGRESSIONS,variantsOf,progressionDegrees} from '../../ui/theory.js';
import {PPQ,METERS,SNAPS,snapTicks,barTicksOf,beatTicksOf,SECTION_COLORS,SECTION_PRESETS,PATTERNS,MIN_BPM,MAX_BPM,
  newSong,demoSong,newSection,newChord,cloneSection,timeline,placedChords,placeChord,removeChord,resizeChord,
  setSectionBars,insertBars,stretchChord,pruneMarks,insertProgression,setMark,rangeTicks,copyRange,pasteAt,renderSong,buildSmf,safeFileName,
  songTonic,songFlat,nameOf,tempoAt,voicingOf,patternById} from './song.js';
import * as player from './player.js';

/* ---------- 状態 ---------- */
const STORE='chordsketch.v1';
const UI_DEFAULT={snap:'beat',perRow:4,insLen:'bar',dia:'7',timbre:'piano',metro:'click',countIn:false,loop:false,keepNames:false,step:false,theme:'light',prog:{major:0,minor:13},progVar:0};
let song, ui={...UI_DEFAULT};
let tl;                     // timeline(song) のキャッシュ（changed() で更新）
let sel=null;               // 選択中のコード {si,id}
let cursor={gi:0,pos:0};    // 入力カーソル（曲の通しの小節番号・小節内 tick）
let range=null;             // 選択範囲 {from,to}（小節番号、to は含まない）
let clip=null;              // コピーしたコード
const undoStack=[],redoStack=[];

// 保存データの読み込み（形が合わなければ既定値）
function validSong(x){
  if(!x||!Array.isArray(x.sections)||!x.key||!Array.isArray(x.meter))return null;
  const s={...newSong(),...x};
  s.bpm=Math.min(MAX_BPM,Math.max(MIN_BPM,+s.bpm||120));
  if(!METERS.some(m=>m.join()===s.meter.join()))s.meter=[4,4];
  if(!(s.key.idx>=0&&s.key.idx<12)||!['major','minor'].includes(s.key.mode))s.key={idx:0,mode:'major'};
  if(!PATTERNS.some(p=>p.id===s.pattern))s.pattern='whole';
  s.octave=Math.max(-2,Math.min(2,s.octave|0));s.bassOctave=Math.max(-2,Math.min(2,s.bassOctave|0));
  s.sections=s.sections.filter(c=>c&&c.bars>0).map(c=>({...newSection(),...c,chords:(c.chords||[]).filter(ch=>ch&&CHORD[ch.q]&&ch.len>0),marks:c.marks||[]}));
  return s;
}
try{
  const saved=JSON.parse(localStorage.getItem(STORE)||'null');
  song=validSong(saved?.song);
  if(saved?.ui)for(const k in UI_DEFAULT)if(typeof saved.ui[k]===typeof UI_DEFAULT[k])ui[k]=saved.ui[k];
}catch{}
song=song||demoSong();
tl=timeline(song);

let saveTimer=0;
function persist(){clearTimeout(saveTimer);saveTimer=setTimeout(()=>localStorage.setItem(STORE,JSON.stringify({song,ui})),300);}
function snapshot(){undoStack.push(JSON.stringify(song));if(undoStack.length>300)undoStack.shift();redoStack.length=0;}
function commit(mut){snapshot();mut();changed();}
function changed(){tl=timeline(song);fixSelection();render();persist();player.refresh();}   // 再生中ならすぐ反映
function undo(){if(!undoStack.length)return;redoStack.push(JSON.stringify(song));song=JSON.parse(undoStack.pop());changed();}
function redo(){if(!redoStack.length)return;undoStack.push(JSON.stringify(song));song=JSON.parse(redoStack.pop());changed();}
function fixSelection(){
  if(sel&&!song.sections[sel.si]?.chords.some(c=>c.id===sel.id))sel=null;
  const n=tl.bars.length;
  if(cursor.gi>=n)cursor={gi:Math.max(0,n-1),pos:0};
  if(tl.bars[cursor.gi]&&cursor.pos>=tl.bars[cursor.gi].ticks)cursor.pos=0;
  if(range&&(range.from>=n||range.to>n))range=null;
}

/* ---------- 表記 ---------- */
const $=id=>document.getElementById(id);
const tonic=()=>songTonic(song);
const flat=()=>songFlat(song);
const nameOfItem=it=>chordNameOf(chordAt(tonic(),[it.off,it.q,it.boff]),flat(),tonic());
const degOfItem=it=>chordDeg(it.off,it.q,it.boff);
const chordOfItem=it=>chordAt(tonic(),[it.off,it.q,it.boff]);
const keyLabel=()=>keyNameOf(song.key.idx,song.key.mode);
const snapOf=meter=>snapTicks(ui.snap,meter);
function fmtLen(t,meter){
  const bt=beatTicksOf(meter), nb=t/bt, bars=Math.floor(nb/meter[0]+1e-9), rem=nb-bars*meter[0];
  const whole=Math.floor(rem+1e-9), half=rem-whole>.01;
  const beats=whole||half?(whole?`${whole}拍`:'')+(half?(whole?'半':'半拍'):''):'';
  return (bars?`${bars}小節`:'')+beats||'0';
}
function fmtPos(gi,pos){
  const b=tl.bars[gi];if(!b)return '';
  const bt=beatTicksOf(b.meter), k=pos/bt;
  return `${gi+1}小節 ${Math.floor(k)+1}拍目${k%1>.01?'の裏':''}`;
}
// コードの長さの上限：始まる小節の拍子で2小節
const MAX_BARS=2;
function maxLenAt(abs){const b=tl.bars.find(x=>abs>=x.start&&abs<x.start+x.ticks);return MAX_BARS*barTicksOf(b?b.meter:song.meter);}
function insLenTicks(meter){
  const B=barTicksOf(meter),b=beatTicksOf(meter);
  return {'2bar':B*2,bar:B,'2beat':b*2,beat:b,half:b/2}[ui.insLen]||B;
}
// コードの種類の並び（Object.keys だと '7' などの数字のキーが先に来るので明示する）
const QUALITIES=['','m','7','M7','m7','m7b5','dim','dim7','aug','sus4','7sus4','sus2','6','m6','mM7','add9','9','M9','m9','5'];
for(const q of Object.keys(CHORD))if(!QUALITIES.includes(q))QUALITIES.push(q);
const INS_LENS=[['2bar','2小節'],['bar','1小節'],['2beat','2拍'],['beat','1拍'],['half','半拍']];

/* ---------- SVG ---------- */
const NS='http://www.w3.org/2000/svg';
function el(tag,attrs={},parent){const e=document.createElementNS(NS,tag);for(const k in attrs){const v=attrs[k];if(typeof v==='string'&&v.startsWith('var('))e.style.setProperty(k,v);else e.setAttribute(k,v);}if(parent)parent.appendChild(e);return e;}
function txt(parent,x,y,s,attrs={}){const t=el('text',{x,y,'text-anchor':'middle','dominant-baseline':'central',...attrs},parent);t.textContent=s;return t;}
function h(tag,cls,text){const e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e;}

/* ---------- 五度圏（ChordNavi と同じ見た目・操作） ---------- */
const wheel=$('wheel');
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
  for(const [node,m] of [[o,'major'],[n,'minor']]){
    node.addEventListener('click',()=>setKey(i,m));
    node.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();setKey(i,m);}});
  }
  const long=i===6, [ox,oy]=P(163,i*30), [ix,iy]=P(100,i*30);
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
  for(const [rel,outer,deg,isT] of WHEEL_CELLS[song.key.mode]){
    const a=rel*30, r0=outer?R.o0:R.i0, r1=outer?R.o1:R.i1;
    el('path',{d:arc(r0,r1,a-15,a+15),fill:isT?'#E3A21A':'#2E8C80','fill-opacity':isT?.9:(rel===2?.35:.6)},gOverlay);
    const [x,y]=P(outer?134:80,a);
    txt(gStatic,x,y,deg,{fill:'#fff','font-size':outer?11:9,'font-weight':700,opacity:.95});
  }
}
let rot=0,anim=null;
function applyRot(r){
  const tr=`rotate(${r})`;gWedges.setAttribute('transform',tr);gLabels.setAttribute('transform',tr);
  for(const n of labelNodes)n.t.setAttribute('transform',`rotate(${-r},${n.x},${n.y})`);
}
function rotateTo(idx,instant){
  const target=-idx*30, d=((target-rot)%360+540)%360-180, from=rot, to=rot+d;
  const dur=instant||matchMedia('(prefers-reduced-motion: reduce)').matches?0:750, t0=performance.now();
  cancelAnimationFrame(anim);
  const step=now=>{const p=dur?Math.min(1,(now-t0)/dur):1, e=1-Math.pow(1-p,3);rot=from+(to-from)*e;applyRot(rot);if(p<1)anim=requestAnimationFrame(step);else rot=to;};
  anim=requestAnimationFrame(step);
}
// キーの変更：既定は度数を保って移調。「音名を保つ」ならコード名が変わらないよう度数を付け替える
function setKey(idx,mode){
  if(idx===song.key.idx&&mode===song.key.mode)return;
  const before=tonic();
  commit(()=>{
    song.key={idx,mode};
    if(ui.keepNames){
      const d=mod12(before-tonic());
      for(const s of song.sections)for(const c of s.chords){c.off=mod12(c.off+d);if(c.boff!=null)c.boff=mod12(c.boff+d);}
    }
  });
  rotateTo(idx);
}
const keySel=$('keySel');
for(const m of ['major','minor'])for(let i=0;i<12;i++){
  const o=h('option','',(m==='major'?MAJ_LABEL[i]+' メジャー':MIN_LABEL[i].replace(/m/g,'')+' マイナー')+'（'+SIG[i]+'）');
  o.value=i+':'+m;keySel.appendChild(o);
}
keySel.addEventListener('change',()=>{const [i,m]=keySel.value.split(':');setKey(+i,m);});

/* ---------- パレット（ダイアトニック・コードを作る） ---------- */
function paletteChip(item,key){
  const b=h('button','pchip');
  b.append(h('span','n',nameOfItem(item)),h('span','d',degOfItem(item)));
  if(key)b.append(h('span','k',key));
  b.title='クリックで試聴、ダブルクリックでカーソル位置に入力、シートへドラッグで配置';
  b.addEventListener('pointerdown',e=>startPaletteDrag(e,item));
  b.addEventListener('dblclick',()=>insertAtCursor(item));
  return b;
}
const diaItems=()=>DIATONIC[ui.dia][song.key.mode].map(([off,q])=>({off,q}));
function customItem(){
  const off=+$('bRoot').value, q=$('bQ').value, bv=$('bBass').value;
  return {off,q,...(bv!==''&&+bv!==off?{boff:+bv}:{})};
}
function renderPalette(){
  const dia=$('dia');dia.innerHTML='';
  diaItems().forEach((it,i)=>dia.appendChild(paletteChip(it,String(i+1))));
  // コードを作る：ルート・ベースの選択肢は今のキーの音名で
  for(const id of ['bRoot','bBass']){
    const s=$(id), v=s.value;s.innerHTML='';
    if(id==='bBass')s.appendChild(Object.assign(h('option','','ベース'),{value:''}));
    for(let off=0;off<12;off++)s.appendChild(Object.assign(h('option','',noteName(mod12(tonic()+off),flat())),{value:off}));
    s.value=v||(id==='bRoot'?'0':'');
  }
  const c=$('custom');c.innerHTML='';c.appendChild(paletteChip(customItem()));
  document.querySelectorAll('#diaSeg button').forEach(b=>b.setAttribute('aria-pressed',b.dataset.v===ui.dia));
}
for(const q of QUALITIES)$('bQ').appendChild(Object.assign(h('option','',q===''?'maj':CHORD[q].s),{value:q}));
for(const id of ['bRoot','bQ','bBass'])$(id).addEventListener('change',()=>{renderPalette();previewItem(customItem());});
document.querySelectorAll('#diaSeg button').forEach(b=>b.addEventListener('click',()=>{ui.dia=b.dataset.v;renderPalette();persist();}));

function previewItem(it){
  const {bass,upper}=voicingOf(song,chordOfItem(it));
  player.playNotes(song.bass?[bass,...upper]:upper,ui.timbre);
}
function insertAtCursor(it){
  const b=tl.bars[cursor.gi];if(!b)return;
  const len=insLenTicks(b.meter);let placed;
  commit(()=>{placed=placeChord(song,b.si,newChord(b.bar,cursor.pos,len,it.off,it.q,it.boff));if(placed)sel={si:b.si,id:placed.id};});
  if(placed){advanceCursor(b.start+cursor.pos+placed.len);previewItem(it);render();}
}
// 曲の中の tick → カーソル（最後の小節の終わりを越えたら最後の小節の頭）
function advanceCursor(abs){
  const b=tl.bars.find(x=>abs>=x.start&&abs<x.start+x.ticks);
  cursor=b?{gi:b.gi,pos:abs-b.start}:{gi:Math.max(0,tl.bars.length-1),pos:0};
  scrollToBar(cursor.gi);
}

/* ---------- 定番コード進行（ChordNavi の PROGRESSIONS） ---------- */
const progSel=$('progSel'), progVar=$('progVar');
const curProg=()=>{const p=PROGRESSIONS[ui.prog[song.key.mode]];return p&&p.mode===song.key.mode?p:PROGRESSIONS.find(x=>x.mode===song.key.mode);};
const curBars=()=>{const v=variantsOf(curProg());return (v[ui.progVar]||v[0]).c;};
function renderProg(){
  const mode=song.key.mode, p=curProg();
  progSel.innerHTML='';
  for(const [extra,label] of [[false,'定番'],[true,'その他']]){
    const g=h('optgroup');g.label=label;
    PROGRESSIONS.forEach((x,i)=>{if(x.mode===mode&&!!x.extra===extra)g.appendChild(Object.assign(h('option','',x.name),{value:i}));});
    progSel.appendChild(g);
  }
  progSel.value=PROGRESSIONS.indexOf(p);
  progVar.innerHTML='';
  variantsOf(p).forEach((v,i)=>progVar.appendChild(Object.assign(h('option','',v.name),{value:i})));
  if(ui.progVar>=variantsOf(p).length)ui.progVar=0;
  progVar.value=ui.progVar;
  const bars=curBars(), names=$('progNames');
  names.textContent=bars.map(bar=>(Array.isArray(bar[0])?bar:[bar]).map(([off,q,boff])=>nameOfItem({off,q,boff})).join('・')).join(' – ');
  names.title=progressionDegrees(bars);
  $('progPlay').textContent=progPreview&&player.isPlaying()?'停止':'試聴';
  $('progIns').title=`${fmtPos(cursor.gi,0).split(' ')[0]}から${bars.length}小節を上書きで入れる（1コード＝1小節）`;
}
progSel.addEventListener('change',()=>{ui.prog[song.key.mode]=+progSel.value;ui.progVar=0;stopProgPreview();renderProg();persist();});
progVar.addEventListener('change',()=>{ui.progVar=+progVar.value;stopProgPreview();renderProg();persist();});
// 試聴：曲の設定（パターン・オクターブ・音色）で、カーソル位置のテンポ・拍子で鳴らす
let progPreview=false;
function stopProgPreview(){if(progPreview){player.stop();progPreview=false;render();}}
$('progPlay').onclick=()=>{
  if(progPreview&&player.isPlaying()){stopProgPreview();return;}
  const b=tl.bars[cursor.gi], bars=curBars();
  const tmp={...structuredClone(song),bpm:Math.round(tempoAt(tl.tempos,b?b.start:0)),meter:b?b.meter:song.meter,sections:[newSection('p',0,bars.length)]};
  insertProgression(tmp,0,bars);
  playTick=null;playingId=null;progPreview=true;
  player.play({render:()=>renderSong(tmp),loop:()=>false,countIn:false,metronome:()=>'off',timbre:()=>ui.timbre,
    onPos:()=>{},onEnd:()=>{progPreview=false;render();}});
  render();
};
$('progIns').onclick=()=>{
  stopProgPreview();
  const gi=cursor.gi;let r;
  commit(()=>{r=insertProgression(song,gi,curBars());});
  if(!r)return;
  sel=null;range=r;cursor={gi:Math.min(r.to,tl.bars.length-1),pos:0};
  if(r.to>=tl.bars.length)cursor={gi:r.from,pos:0};
  render();scrollToBar(r.from);
};

/* ---------- パレットからのドラッグ ---------- */
const ghost=$('ghost');
function startPaletteDrag(e,item){
  if(e.button!==0)return;
  e.preventDefault();
  const x0=e.clientX,y0=e.clientY;let dragging=false,target=null;
  const move=ev=>{
    if(!dragging&&Math.hypot(ev.clientX-x0,ev.clientY-y0)<4)return;
    dragging=true;
    ghost.hidden=false;ghost.textContent=nameOfItem(item);
    ghost.style.left=ev.clientX+10+'px';ghost.style.top=ev.clientY+8+'px';
    const hit=hitBar(ev.clientX,ev.clientY);
    if(!hit){target=null;showDrop(null);return;}
    const pos=Math.floor(hit.tick/snapOf(hit.b.meter))*snapOf(hit.b.meter);
    target={gi:hit.b.gi,pos};showDrop(hit.b.gi,pos,insLenTicks(hit.b.meter));
  };
  const up=()=>{
    removeEventListener('pointermove',move);removeEventListener('pointerup',up);
    ghost.hidden=true;showDrop(null);
    if(!dragging){previewItem(item);return;}
    if(!target)return;
    cursor=target;insertAtCursor(item);
  };
  addEventListener('pointermove',move);addEventListener('pointerup',up);
}

/* ---------- シート ---------- */
const sheet=$('sheet');
function hitBar(x,y){
  const bar=document.elementFromPoint(x,y)?.closest('.bar');
  if(!bar||!sheet.contains(bar))return null;
  const b=tl.bars[+bar.dataset.gi];if(!b)return null;
  const r=bar.querySelector('.lane').getBoundingClientRect();
  return {b,tick:Math.max(0,Math.min(.9999,(x-r.left)/r.width))*b.ticks,el:bar};
}
const barEl=gi=>sheet.querySelector(`.bar[data-gi="${gi}"]`);
function showDrop(gi,pos,len){
  sheet.querySelectorAll('.drop').forEach(x=>x.remove());
  if(gi==null)return;
  const b=tl.bars[gi], lane=barEl(gi)?.querySelector('.lane');if(!lane)return;
  const d=h('div','drop');d.style.left=pos/b.ticks*100+'%';d.style.width=Math.min(len,b.ticks-pos)/b.ticks*100+'%';
  lane.appendChild(d);
}
function scrollToBar(gi){
  const e=barEl(gi);if(!e)return;
  const r=e.getBoundingClientRect(), s=sheet.getBoundingClientRect();
  if(r.top<s.top+4||r.bottom>s.bottom-4)e.scrollIntoView({block:'nearest'});
}

function renderSheet(){
  const scroll=sheet.scrollTop;
  sheet.innerHTML='';
  const pcs=placedChords(song,tl), laneW=(sheet.clientWidth-40)/ui.perRow;
  song.sections.forEach((s,si)=>{
    const {from,to}=tl.secRanges[si], color=SECTION_COLORS[s.color%SECTION_COLORS.length];
    const sec=h('section','sec');sec.style.setProperty('--c',color);sec.dataset.si=si;
    if(range&&range.from===from&&range.to===to)sec.classList.add('selected');
    sec.appendChild(sectionHead(s,si));
    const rows=h('div','rows');
    for(let r=from;r<to;r+=ui.perRow){
      const row=h('div','row');row.style.gridTemplateColumns=`repeat(${ui.perRow},minmax(0,1fr))`;
      for(let gi=r;gi<Math.min(r+ui.perRow,to);gi++)row.appendChild(barCell(tl.bars[gi],gi===Math.min(r+ui.perRow,to)-1,gi===tl.bars.length-1));
      rows.appendChild(row);
    }
    sec.appendChild(rows);sheet.appendChild(sec);
  });
  // コードのブロック（小節をまたぐコードは小節ごとに分けて描く）
  for(const p of pcs){
    let first=true;
    for(const b of tl.bars){
      if(b.start+b.ticks<=p.start)continue;
      if(b.start>=p.end)break;
      const s=Math.max(p.start,b.start), e=Math.min(p.end,b.start+b.ticks), lane=barEl(b.gi)?.querySelector('.lane');
      if(!lane)continue;
      const blk=h('div','blk'+(first?'':' cont')+(p.end>b.start+b.ticks?' more':''));
      blk.dataset.si=p.si;blk.dataset.id=p.c.id;
      blk.style.left=(s-b.start)/b.ticks*100+'%';blk.style.width=`calc(${(e-s)/b.ticks*100}% - 2px)`;
      const w=(e-s)/b.ticks*laneW;
      if(w<46)blk.classList.add('narrow');
      if(first&&(p.start-b.start)%beatTicksOf(b.meter)!==0)blk.classList.add('anti');   // 拍の裏から始まるコード（食い）
      if(sel&&sel.id===p.c.id)blk.classList.add('sel');
      if(playingId===p.c.id)blk.classList.add('playing');
      blk.append(h('span','n',first?nameOf(song,p.c):w>30?nameOf(song,p.c):''),h('span','d',first?degOfItem(p.c):''));
      blk.title=`${nameOf(song,p.c)}（${degOfItem(p.c)}）${fmtLen(p.end-p.start,b.meter)}　パターン：${patternById(p.pattern).name}${p.c.pattern?'（このコードだけ）':''}`;
      if(first&&p.c.pattern){const t=h('span','ptag',patternById(p.c.pattern).short);t.title='このコードだけのパターン：'+patternById(p.c.pattern).name;blk.appendChild(t);blk.classList.add('haspat');}
      if(e===p.end)blk.appendChild(h('div','rs'));
      lane.appendChild(blk);
      first=false;
    }
  }
  // カーソル・再生位置
  const cb=tl.bars[cursor.gi], cl=barEl(cursor.gi)?.querySelector('.lane');
  if(cb&&cl&&!player.isPlaying()){const c=h('div','cursor');c.style.left=cursor.pos/cb.ticks*100+'%';cl.appendChild(c);}
  placePlayhead();
  // セクションの追加：名前は自由に入力（定番名のボタンは入力欄に入れるだけ。候補は入力欄の一覧にも出る）
  const add=h('div','add-sec');
  const nm=h('input','add-name');nm.placeholder='セクション名（例：Aメロ、2番サビ、Solo）';nm.maxLength=30;
  nm.setAttribute('list','secNames');nm.setAttribute('aria-label','追加するセクションの名前');
  const bars=h('input','');bars.type='number';bars.min=1;bars.max=128;bars.value=8;bars.style.width='46px';bars.title='小節数';
  const go=h('button','add-go','＋ 追加');
  const addSection=()=>{
    const name=nm.value.trim();
    if(!name){nm.focus();return;}
    const pr=SECTION_PRESETS.find(p=>p.name===name);
    // 定番の名前ならその色、それ以外は直前のセクションの次の色
    const color=pr?pr.color:((song.sections.at(-1)?.color??-1)+1)%SECTION_COLORS.length;
    commit(()=>song.sections.push(newSection(name,color,Math.max(1,Math.min(128,Math.round(+bars.value)||8)))));
    sheet.scrollTop=sheet.scrollHeight;
    sheet.querySelector('.add-name')?.focus();
  };
  go.onclick=addSection;
  nm.addEventListener('keydown',e=>{e.stopPropagation();if(e.key==='Enter')addSection();});
  bars.addEventListener('keydown',e=>{e.stopPropagation();if(e.key==='Enter')addSection();});
  add.append(h('span','lbl','セクションを追加'),nm,bars,h('span','lbl','小節'),go);
  const presets=h('div','add-presets');
  for(const pr of SECTION_PRESETS){
    const b=h('button','',pr.name);b.style.color=SECTION_COLORS[pr.color];b.title='名前を入力欄に入れる';
    b.onclick=()=>{nm.value=pr.name;nm.focus();};
    presets.appendChild(b);
  }
  add.appendChild(presets);
  sheet.appendChild(add);
  if(!song.sections.length)sheet.prepend(h('div','empty','セクションがありません。下の欄に名前を入れて追加してください。'));
  sheet.scrollTop=scroll;
}
function barCell(b,rowEnd,songEnd){
  const bar=h('div','bar'+(rowEnd?' last':'')+(songEnd?' sec-end':''));bar.dataset.gi=b.gi;
  if(range&&b.gi>=range.from&&b.gi<range.to)bar.classList.add('insel');
  const no=h('div','bar-no',String(b.gi+1));no.title='クリック・ドラッグで小節を選択、ダブルクリックでテンポ・拍子を変更';
  const sec=song.sections[b.si];
  for(const m of sec.marks.filter(m=>m.bar===b.bar).sort((x,y)=>(y.meter?1:0)-(x.meter?1:0)||(x.pos||0)-(y.pos||0))){
    if(m.meter)no.appendChild(Object.assign(h('span','mark meter',m.meter.join('/')),{title:'拍子の変更（クリックで編集）'}));
    if(m.bpm){const t=h('span','mark tempo',`♩=${m.bpm}${m.pos?' @'+(m.pos/beatTicksOf(b.meter)+1)+'拍':''}`);t.title='テンポの変更（クリックで編集）';t.dataset.pos=m.pos||0;no.appendChild(t);}
  }
  if(b.gi===0){no.appendChild(Object.assign(h('span','mark meter',song.meter.join('/')),{title:'曲の拍子（上の「拍子」で変更）'}));no.appendChild(Object.assign(h('span','mark tempo',`♩=${song.bpm}`),{title:'曲のテンポ（上の「♩=」で変更）'}));}
  const lane=h('div','lane');
  const bt=beatTicksOf(b.meter);
  for(let t=bt/2;t<b.ticks;t+=bt/2){
    const l=h('div',t%bt===0?'beat':'half');l.style.left=t/b.ticks*100+'%';lane.appendChild(l);
  }
  bar.append(no,lane);
  return bar;
}
function sectionHead(s,si){
  const head=h('div','sec-head');
  const sw=h('button','sec-sw');sw.title='色を選ぶ';sw.setAttribute('aria-label','セクションの色を選ぶ');
  sw.onclick=()=>openColorPop(si,sw);
  const name=h('input','sec-name');name.value=s.name;name.setAttribute('list','secNames');name.setAttribute('aria-label','セクション名');
  name.addEventListener('change',()=>commit(()=>{
    s.name=name.value.trim()||'セクション';
    const pr=SECTION_PRESETS.find(p=>p.name===s.name);if(pr)s.color=pr.color;   // 定番の名前なら色も合わせる
  }));
  name.addEventListener('keydown',e=>{if(e.key==='Enter')name.blur();e.stopPropagation();});
  const nb=h('input','');nb.type='number';nb.min=1;nb.max=128;nb.value=s.bars;nb.style.width='46px';nb.title='小節数';
  nb.addEventListener('change',()=>commit(()=>setSectionBars(song,si,Math.round(+nb.value)||s.bars)));
  nb.addEventListener('keydown',e=>e.stopPropagation());
  const pat=h('select','pat'+(s.pattern?' over':''));pat.title='このセクションの MIDI パターン';
  pat.appendChild(Object.assign(h('option','','パターン：曲と同じ'),{value:''}));
  for(const p of PATTERNS)pat.appendChild(Object.assign(h('option','',p.name),{value:p.id}));
  pat.value=s.pattern||'';
  pat.addEventListener('change',()=>commit(()=>{s.pattern=pat.value||null;}));
  const {from,to}=tl.secRanges[si];
  const pick=h('button','','範囲');pick.title='このセクションを選択';
  pick.onclick=()=>{range={from,to};sel=null;cursor={gi:from,pos:0};render();};
  const drag=midiHandle(()=>({from,to}),()=>sectionFileLabel(s,si));drag.textContent='⠿ MIDI';drag.title='このセクションを DAW へドラッグ';
  const dup=h('button','','複製');dup.onclick=()=>commit(()=>song.sections.splice(si+1,0,cloneSection(s)));
  const up=h('button','','↑');up.title='前へ';up.disabled=si===0;
  up.onclick=()=>commit(()=>{[song.sections[si-1],song.sections[si]]=[song.sections[si],song.sections[si-1]];});
  const down=h('button','','↓');down.title='後ろへ';down.disabled=si===song.sections.length-1;
  down.onclick=()=>commit(()=>{[song.sections[si+1],song.sections[si]]=[song.sections[si],song.sections[si+1]];});
  const del=h('button','','削除');del.onclick=()=>commit(()=>song.sections.splice(si,1));
  head.append(sw,name,nb,h('span','n','小節'),pat,pick,drag,dup,up,down,del);
  return head;
}

/* ---------- シートの操作 ---------- */
sheet.addEventListener('pointerdown',e=>{
  if(e.button!==0||e.target.closest('.sec-head,.add-sec'))return;
  const mark=e.target.closest('.mark'), blk=e.target.closest('.blk'), no=e.target.closest('.bar-no'), lane=e.target.closest('.lane');
  const bar=e.target.closest('.bar');
  if(mark&&bar){e.preventDefault();const gi=+bar.dataset.gi;openMarkPop(gi,mark.classList.contains('tempo')?+(mark.dataset.pos||0):0,mark);return;}
  if(blk){e.preventDefault();sheet.focus({preventScroll:true});startBlockDrag(e,blk);return;}
  if(no&&bar){e.preventDefault();sheet.focus({preventScroll:true});startRangeDrag(e,+bar.dataset.gi,true);return;}
  if(lane&&bar){e.preventDefault();sheet.focus({preventScroll:true});startRangeDrag(e,+bar.dataset.gi,false);}
});
// ダブルクリックは自前で判定する（1回目のクリックでシートを描き直すため、dblclick イベントは要素に届かない）
let lastNo={gi:-1,t:0};
const rangeLabel=r=>r.to-r.from===1?`${r.from+1}小節`:`${r.from+1}〜${r.to}小節`;
// 空いたところ：クリックでカーソル、横にドラッグで小節の範囲を選ぶ（Shift で範囲を広げる）。小節番号は押しただけで小節を選ぶ
function startRangeDrag(e,gi,onNumber){
  if(onNumber){
    const now=performance.now();
    if(lastNo.gi===gi&&now-lastNo.t<400){lastNo={gi:-1,t:0};openMarkPop(gi,0,e.target.closest('.bar-no'));return;}
    lastNo={gi,t:now};
  }
  const hit=hitBar(e.clientX,e.clientY);
  const anchor=e.shiftKey&&(range||cursor)?(range?range.anchor??range.from:cursor.gi):gi;
  sel=null;
  if(!onNumber&&hit&&!e.shiftKey){
    const st=snapOf(hit.b.meter);cursor={gi,pos:Math.min(hit.b.ticks-st,Math.round(hit.tick/st)*st)};range=null;
  }
  if(onNumber||e.shiftKey)range={from:Math.min(anchor,gi),to:Math.max(anchor,gi)+1,anchor};
  render();
  const move=ev=>{
    const hh=hitBar(ev.clientX,ev.clientY);if(!hh)return;
    const g=hh.b.gi;
    if(!onNumber&&!e.shiftKey&&g===gi&&!range)return;
    const nr={from:Math.min(anchor,g),to:Math.max(anchor,g)+1,anchor};
    if(!range||nr.from!==range.from||nr.to!==range.to){range=nr;cursor={gi:nr.from,pos:0};render();}
  };
  const up=()=>{removeEventListener('pointermove',move);removeEventListener('pointerup',up);};
  addEventListener('pointermove',move);addEventListener('pointerup',up);
}
// ブロック：クリックで選択＋試聴、ドラッグで移動（Alt でコピー）、右端で長さ
function startBlockDrag(e,blkEl){
  const si=+blkEl.dataset.si, id=blkEl.dataset.id, c=song.sections[si].chords.find(x=>x.id===id);if(!c)return;
  const p=placedChords(song,tl).find(x=>x.c.id===id);if(!p)return;
  const resizing=e.target.classList.contains('rs');
  const hit0=hitBar(e.clientX,e.clientY), grab=hit0?hit0.b.start+hit0.tick-p.start:0;
  const x0=e.clientX,y0=e.clientY;let moved=false,target=null;
  sel={si,id};range=null;cursor={gi:tl.bars.find(b=>p.start>=b.start&&p.start<b.start+b.ticks).gi,pos:0};
  cursor.pos=p.start-tl.bars[cursor.gi].start;
  render();
  // 長さの変更：伸ばした先のコードは上書きするので、動かすたびにドラッグ前の状態からやり直す（縮め直すと戻る）
  const base=resizing?JSON.stringify(song):null, maxLen=maxLenAt(p.start);
  if(resizing)snapshot();
  const move=ev=>{
    if(!moved&&Math.hypot(ev.clientX-x0,ev.clientY-y0)<4)return;
    moved=true;
    const hit=hitBar(ev.clientX,ev.clientY);
    if(resizing){
      if(!hit)return;
      const st=snapOf(hit.b.meter), end=hit.b.start+Math.max(st,Math.round(hit.tick/st)*st);
      song=JSON.parse(base);stretchChord(song,si,id,end-p.start,st,maxLen);
      tl=timeline(song);render();
      return;
    }
    ghost.hidden=false;ghost.textContent=nameOf(song,c)+(ev.altKey?'（コピー）':'');
    ghost.style.left=ev.clientX+10+'px';ghost.style.top=ev.clientY+8+'px';
    if(!hit){target=null;showDrop(null);return;}
    let abs=hit.b.start+hit.tick-grab;
    let b=tl.bars.find(x=>abs>=x.start&&abs<x.start+x.ticks)||(abs<0?tl.bars[0]:tl.bars.at(-1));
    const st=snapOf(b.meter);let pos=Math.round(Math.max(0,abs-b.start)/st)*st;
    if(pos>=b.ticks){if(tl.bars[b.gi+1]){b=tl.bars[b.gi+1];pos=0;}else pos=b.ticks-st;}
    target={gi:b.gi,pos,copy:ev.altKey};showDrop(b.gi,pos,p.end-p.start);
  };
  const up=()=>{
    removeEventListener('pointermove',move);removeEventListener('pointerup',up);
    ghost.hidden=true;showDrop(null);
    if(resizing){if(moved){changed();previewSel();}else undoStack.pop();return;}
    if(!moved){previewItem(c);return;}
    if(!target)return;
    const b=tl.bars[target.gi];
    commit(()=>{
      if(!target.copy)removeChord(song,si,id);
      const placed=placeChord(song,b.si,{...c,id:target.copy?newChord(0,0,0,0,'').id:c.id,bar:b.bar,pos:target.pos,len:p.end-p.start});
      if(placed)sel={si:b.si,id:placed.id};
    });
    cursor={gi:target.gi,pos:target.pos};render();
  };
  addEventListener('pointermove',move);addEventListener('pointerup',up);
}

/* ---------- テンポ・拍子の変更（ポップアップ） ---------- */
const pop=$('pop');
function openMarkPop(gi,pos,anchor){
  const b=tl.bars[gi];if(!b)return;
  const sec=song.sections[b.si], atStart=gi===0&&pos===0;
  const tm=sec.marks.find(m=>m.bar===b.bar&&m.bpm&&(m.pos||0)===pos), mm=sec.marks.find(m=>m.bar===b.bar&&m.meter);
  pop.innerHTML='';
  pop.appendChild(h('h4','',`${fmtPos(gi,pos)}からの変更`));
  const bpm=h('input','');bpm.type='number';bpm.min=MIN_BPM;bpm.max=MAX_BPM;
  bpm.value=atStart?song.bpm:tm?.bpm??'';bpm.placeholder=String(Math.round(tempoAt(tl.tempos,b.start+pos)));
  const posSel=h('select','');
  const bt=beatTicksOf(b.meter);
  for(let t=0;t<b.ticks;t+=bt/2)posSel.appendChild(Object.assign(h('option','',`${Math.floor(t/bt)+1}拍目${t%bt?'の裏':''}`),{value:t}));
  posSel.value=pos;posSel.disabled=atStart;
  const met=h('select','');met.appendChild(Object.assign(h('option','','変更なし'),{value:''}));
  for(const m of METERS)met.appendChild(Object.assign(h('option','',m.join('/')),{value:m.join('/')}));
  met.value=atStart?song.meter.join('/'):mm?mm.meter.join('/'):'';
  pop.append(h('span','lbl','テンポ ♩='),bpm,h('span','lbl','位置'),posSel,h('span','lbl','拍子（小節の頭）'),met);
  pop.appendChild(h('p','note','テンポは半拍単位の位置で、拍子は小節の頭で変えられます。空欄・「変更なし」にすると外します。直前と同じ値にしたときもタグは消えます。'));
  const btns=h('div','btns');
  const ok=h('button','tg','適用');ok.setAttribute('aria-pressed','true');
  const cancel=h('button','','閉じる');
  ok.onclick=()=>{
    const v=Math.round(+bpm.value), m=met.value?met.value.split('/').map(Number):null, p=+posSel.value;
    commit(()=>{
      if(atStart){if(v)song.bpm=Math.min(MAX_BPM,Math.max(MIN_BPM,v));if(m)song.meter=m;pruneMarks(song);return;}
      if(tm&&(tm.pos||0)!==p)setMark(song,b.si,b.bar,tm.pos||0,{bpm:null,meter:mm?.meter});
      setMark(song,b.si,b.bar,p,{bpm:v||null,meter:m});
      pruneMarks(song);   // 直前と同じ値になった変更点はタグごと消す
    });
    closePop();
  };
  cancel.onclick=closePop;
  btns.append(cancel,ok);pop.appendChild(btns);
  pop.hidden=false;
  const r=anchor.getBoundingClientRect();
  pop.style.left=Math.min(innerWidth-pop.offsetWidth-8,r.left)+'px';pop.style.top=Math.min(innerHeight-pop.offsetHeight-8,r.bottom+4)+'px';
  bpm.focus();
  pop.onkeydown=e=>{e.stopPropagation();if(e.key==='Enter')ok.click();if(e.key==='Escape')closePop();};
}
// セクションの色：パレットから選ぶ
const COLOR_NAMES=['グレー','グリーン','ブルー','ローズ','イエロー','パープル','オレンジ','オリーブ'];
function openColorPop(si,anchor){
  const s=song.sections[si];
  pop.innerHTML='';pop.appendChild(h('h4','',`「${s.name}」の色`));
  const grid=h('div','swatches');
  SECTION_COLORS.forEach((col,i)=>{
    const b=h('button','');b.style.background=col;b.title=COLOR_NAMES[i];b.setAttribute('aria-label',COLOR_NAMES[i]);
    b.setAttribute('aria-pressed',i===s.color%SECTION_COLORS.length);
    b.onclick=()=>{pop.hidden=true;if(i!==s.color)commit(()=>{song.sections[si].color=i;});};
    grid.appendChild(b);
  });
  pop.appendChild(grid);
  pop.hidden=false;
  const r=anchor.getBoundingClientRect();
  pop.style.left=Math.min(innerWidth-pop.offsetWidth-8,r.left)+'px';pop.style.top=Math.min(innerHeight-pop.offsetHeight-8,r.bottom+4)+'px';
  pop.onkeydown=e=>{e.stopPropagation();if(e.key==='Escape')closePop();};
  grid.querySelector('[aria-pressed=true]')?.focus();
}
function closePop(){pop.hidden=true;sheet.focus({preventScroll:true});}
addEventListener('pointerdown',e=>{if(!pop.hidden&&!pop.contains(e.target)&&!e.target.closest('.bar-no,.sec-sw'))pop.hidden=true;},true);

/* ---------- 下のバー ---------- */
function renderFooter(){
  const f=$('footer');f.innerHTML='';
  const keys=h('span','keys');
  const p=sel&&placedChords(song,tl).find(x=>x.c.id===sel.id);
  if(p){
    const c=p.c, b=tl.bars.find(x=>p.start>=x.start&&p.start<x.start+x.ticks);
    const edit=mut=>commit(()=>{const cc=song.sections[sel.si].chords.find(x=>x.id===sel.id);mut(cc);});
    const root=h('select','');for(let off=0;off<12;off++)root.appendChild(Object.assign(h('option','',noteName(mod12(tonic()+off),flat())),{value:off}));
    root.value=c.off;root.onchange=()=>{const d=+root.value-c.off;edit(cc=>{cc.off=+root.value;if(cc.boff!=null)cc.boff=mod12(cc.boff+d);});previewSel();};
    const q=h('select','');for(const k of QUALITIES)q.appendChild(Object.assign(h('option','',k===''?'（メジャー）':CHORD[k].s),{value:k}));
    q.value=c.q;q.onchange=()=>{edit(cc=>{cc.q=q.value;});previewSel();};
    const bass=h('select','');bass.appendChild(Object.assign(h('option','','なし'),{value:''}));
    for(let off=0;off<12;off++)bass.appendChild(Object.assign(h('option','',noteName(mod12(tonic()+off),flat())),{value:off}));
    bass.value=c.boff??'';bass.onchange=()=>{edit(cc=>{if(bass.value===''||+bass.value===cc.off)delete cc.boff;else cc.boff=+bass.value;});previewSel();};
    const st=snapOf(b.meter);
    const minus=h('button','','−'),plus=h('button','','＋');
    const max=maxLenAt(p.start);
    minus.onclick=()=>commit(()=>stretchChord(song,sel.si,sel.id,p.end-p.start-st,st,max));
    plus.onclick=()=>commit(()=>stretchChord(song,sel.si,sel.id,p.end-p.start+st,st,max));
    minus.disabled=p.end-p.start<=st;plus.disabled=p.end-p.start>=max;
    const dup=h('button','','複製');dup.onclick=duplicateSel;
    const del=h('button','','削除');del.onclick=deleteSel;
    // このコードだけのパターン（空＝セクション（なければ曲）と同じ）
    const secPat=song.sections[sel.si].pattern||song.pattern;
    const pat=h('select','blk-pat'+(c.pattern?' over':''));pat.title='このコードだけの MIDI パターン';
    pat.appendChild(Object.assign(h('option','',`セクションと同じ（${patternById(secPat).short}）`),{value:''}));
    for(const x of PATTERNS)pat.appendChild(Object.assign(h('option','',x.name),{value:x.id}));
    pat.value=c.pattern||'';
    pat.onchange=()=>edit(cc=>{if(pat.value)cc.pattern=pat.value;else delete cc.pattern;});
    f.append(h('b','who',nameOf(song,c)),h('span','',degOfItem(c)),h('span','sep'),'ルート',root,'種類',q,'ベース',bass,h('span','sep'),
      '長さ',minus,h('b','',fmtLen(p.end-p.start,b.meter)),plus,h('span','sep'),'パターン',pat,dup,del);
    keys.innerHTML='<kbd>←</kbd><kbd>→</kbd>移動 <kbd>⇧</kbd>+<kbd>←</kbd><kbd>→</kbd>長さ <kbd>↑</kbd><kbd>↓</kbd>半音 <kbd>⌫</kbd>削除 <kbd>Alt</kbd>+ドラッグでコピー';
  }else if(range){
    const n=range.to-range.from;
    const loop=h('button','','この範囲をループ再生');loop.onclick=()=>{ui.loop=true;render();startPlay();};
    const copy=h('button','','コピー');copy.onclick=copySel;
    const clear=h('button','','コードを消す');clear.onclick=deleteSel;
    const ins=h('button','','前に小節を挿入');ins.onclick=()=>insertBarsAtCursor(n);
    const rm=h('button','','小節を削除');rm.onclick=()=>deleteRangeBars();
    f.append(h('b','',rangeLabel(range)),h('span','',`（${n}小節）を選択`),loop,copy,clear,ins,rm);
    keys.innerHTML='<kbd>⌘C</kbd>コピー <kbd>⌘V</kbd>貼り付け <kbd>⌫</kbd>コードを消す <kbd>Esc</kbd>解除';
  }else{
    const b=tl.bars[cursor.gi];
    const markBtn=h('button','','テンポ・拍子を変更…');markBtn.onclick=()=>openMarkPop(cursor.gi,cursor.pos,markBtn);
    const ins=h('button','','小節を挿入');ins.onclick=()=>insertBarsAtCursor(1);
    const rm=h('button','','この小節を削除');rm.onclick=()=>{range={from:cursor.gi,to:cursor.gi+1};deleteRangeBars();};
    const paste=h('button','','貼り付け');paste.disabled=!clip;paste.onclick=pasteSel;
    f.append('カーソル',h('b','',b?fmtPos(cursor.gi,cursor.pos):'—'),markBtn,ins,rm,paste);
    keys.innerHTML='<kbd>1</kbd>〜<kbd>7</kbd>ダイアトニックを入力 <kbd>←</kbd><kbd>→</kbd>カーソル <kbd>Space</kbd>再生 <kbd>⌘A</kbd>全選択';
  }
  f.appendChild(keys);
}
function previewSel(){const p=sel&&song.sections[sel.si]?.chords.find(x=>x.id===sel.id);if(p)previewItem(p);}
function deleteSel(){
  if(sel){commit(()=>removeChord(song,sel.si,sel.id));sel=null;render();return;}
  if(range){
    const r=rangeTicks(tl,range);
    commit(()=>{for(const p of placedChords(song,tl))if(p.start>=r.from&&p.start<r.to)removeChord(song,p.si,p.c.id);});
  }
}
function duplicateSel(){
  const p=sel&&placedChords(song,tl).find(x=>x.c.id===sel.id);if(!p)return;
  const b=tl.bars.find(x=>p.end>=x.start&&p.end<x.start+x.ticks);
  if(!b||b.si!==p.si)return;
  let placed;commit(()=>{placed=placeChord(song,b.si,{...newChord(b.bar,p.end-b.start,p.end-p.start,p.c.off,p.c.q,p.c.boff),...(p.c.pattern?{pattern:p.c.pattern}:{})});});
  if(placed){sel={si:b.si,id:placed.id};render();}
}
function copySel(){
  if(range)clip=copyRange(song,range);
  else if(sel){const p=placedChords(song,tl).find(x=>x.c.id===sel.id);if(p)clip={len:p.end-p.start,chords:[{at:0,len:p.end-p.start,off:p.c.off,q:p.c.q,boff:p.c.boff,pattern:p.c.pattern}]};}
  render();
}
function pasteSel(){
  if(!clip)return;
  const b=tl.bars[range?range.from:cursor.gi];if(!b)return;
  const origin=b.start+(range?0:cursor.pos);
  commit(()=>pasteAt(song,origin,clip));
  advanceCursor(origin+clip.len);range=null;render();
}
function insertBarsAtCursor(n){
  const b=tl.bars[range?range.from:cursor.gi];if(!b)return;
  commit(()=>insertBars(song,b.si,b.bar,n));
}
function deleteRangeBars(){
  if(!range)return;
  const bars=tl.bars.slice(range.from,range.to);
  commit(()=>{
    // セクションごとに後ろから消す（1小節は残す）
    for(const si of [...new Set(bars.map(b=>b.si))].reverse()){
      const own=bars.filter(b=>b.si===si);
      insertBars(song,si,own[0].bar,-Math.min(own.length,song.sections[si].bars-1));
    }
  });
  range=null;render();
}

/* ---------- キーボード ---------- */
addEventListener('keydown',e=>{
  if(e.target.closest?.('input,select,textarea')&&e.key!=='Escape')return;
  const mod=e.metaKey||e.ctrlKey, k=e.key.toLowerCase();
  if(mod&&k==='z'){e.preventDefault();e.shiftKey?redo():undo();return;}
  if(mod&&k==='y'){e.preventDefault();redo();return;}
  if(mod&&k==='a'){e.preventDefault();range={from:0,to:tl.bars.length,anchor:0};sel=null;render();return;}
  if(mod&&k==='c'){e.preventDefault();copySel();return;}
  if(mod&&k==='x'){e.preventDefault();copySel();deleteSel();return;}
  if(mod&&k==='v'){e.preventDefault();pasteSel();return;}
  if(mod&&k==='d'){e.preventDefault();duplicateSel();return;}
  if(mod)return;
  if(e.key===' '){e.preventDefault();togglePlay();return;}
  if(k==='m'){e.preventDefault();toggleMute();return;}
  if(e.key==='Escape'&&!$('printWrap').hidden){$('printWrap').hidden=true;return;}
  if(!$('printWrap').hidden)return;
  if(e.key==='Escape'){sel=null;range=null;pop.hidden=true;render();return;}
  if(e.key==='Home'){cursor={gi:0,pos:0};sel=null;range=null;render();scrollToBar(0);return;}
  if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();deleteSel();return;}
  if(/^[1-7]$/.test(e.key)){e.preventDefault();sel=null;range=null;insertAtCursor(diaItems()[+e.key-1]);return;}
  if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();arrow(e.key==='ArrowRight'?1:-1,e.shiftKey);return;}
  if((e.key==='ArrowUp'||e.key==='ArrowDown')&&sel){
    e.preventDefault();const d=e.key==='ArrowUp'?1:-1;
    commit(()=>{const c=song.sections[sel.si].chords.find(x=>x.id===sel.id);c.off=mod12(c.off+d);if(c.boff!=null)c.boff=mod12(c.boff+d);});
    previewSel();
  }
});
function arrow(dir,shift){
  const b=tl.bars[cursor.gi];if(!b)return;
  const st=snapOf(b.meter);
  if(sel){
    const p=placedChords(song,tl).find(x=>x.c.id===sel.id);if(!p)return;
    if(shift){commit(()=>stretchChord(song,sel.si,sel.id,p.end-p.start+dir*st,st,maxLenAt(p.start)));return;}
    const abs=p.start+dir*st, nb=tl.bars.find(x=>abs>=x.start&&abs<x.start+x.ticks);
    if(!nb)return;
    const c=song.sections[sel.si].chords.find(x=>x.id===sel.id);
    commit(()=>{removeChord(song,sel.si,sel.id);const placed=placeChord(song,nb.si,{...c,bar:nb.bar,pos:abs-nb.start,len:p.end-p.start});if(placed)sel={si:nb.si,id:placed.id};});
    return;
  }
  range=null;
  const abs=b.start+cursor.pos+dir*st;
  if(abs<0)return;
  advanceCursor(Math.min(abs,tl.total-1));render();
}

/* ---------- 再生 ---------- */
let playFrom=0, playingId=null, playTick=null, lastPos='';
function playRange(){
  if(range)return range;
  return {from:cursor.gi,to:tl.bars.length};
}
function startPlay(){
  if(!tl.bars.length)return;
  progPreview=false;
  const r=playRange();
  playFrom=rangeTicks(tl,r).from;
  player.play({
    render:()=>renderSong(song,rangeTicks(tl,r)),
    loop:()=>ui.loop, countIn:ui.countIn, metronome:()=>ui.metro, timbre:()=>ui.timbre,
    onPos:(t,counting)=>onPos(t==null?null:playFrom+t,counting),
    onEnd:()=>{playTick=null;playingId=null;render();}
  });
  render();
}
function togglePlay(){if(player.isPlaying()){player.stop();progPreview=false;playTick=null;playingId=null;render();}else startPlay();}
function onPos(abs,counting){
  const disp=$('posDisp');
  disp.classList.toggle('count',!!counting);
  if(abs==null){if(lastPos!=='count'){disp.textContent='カウント';lastPos='count';}return;}
  playTick=abs;
  const b=tl.bars.find(x=>abs>=x.start&&abs<x.start+x.ticks)||tl.bars.at(-1);
  const s=`${b.gi+1} : ${Math.floor((abs-b.start)/beatTicksOf(b.meter))+1}`;
  if(s!==lastPos){disp.textContent=s;lastPos=s;scrollToBar(b.gi);}
  const p=placedChords(song,tl).find(x=>abs>=x.start&&abs<x.end);
  const id=p?.c.id??null;
  if(id!==playingId){
    playingId=id;
    sheet.querySelectorAll('.blk.playing').forEach(x=>x.classList.remove('playing'));
    if(id)sheet.querySelectorAll(`.blk[data-id="${id}"]`).forEach(x=>x.classList.add('playing'));
  }
  placePlayhead();
}
const playhead=h('div','playhead');
function placePlayhead(){
  if(playTick==null||!player.isPlaying()){playhead.remove();return;}
  const b=tl.bars.find(x=>playTick>=x.start&&playTick<x.start+x.ticks);
  const lane=b&&barEl(b.gi)?.querySelector('.lane');
  if(!lane){playhead.remove();return;}
  if(playhead.parentNode!==lane)lane.appendChild(playhead);
  playhead.style.left=(playTick-b.start)/b.ticks*100+'%';
}
$('playBtn').onclick=togglePlay;
$('toStart').onclick=()=>{const was=player.isPlaying();player.stop();cursor={gi:0,pos:0};range=null;sel=null;playTick=null;render();scrollToBar(0);if(was)startPlay();};

/* ---------- MIDI の書き出し・ドラッグ ---------- */
const SECTION_FILE={'Intro':'Intro','Aメロ':'Verse','Bメロ':'PreChorus','サビ':'Chorus','間奏':'Interlude','Cメロ':'Bridge','落ちサビ':'QuietChorus','Outro':'Outro'};
const ascii=s=>{const t=safeFileName(s);return t==='ChordSketch'&&!/ChordSketch/.test(s)?'':t;};
function sectionFileLabel(s,si){return SECTION_FILE[s.name]||ascii(s.name)||`Section${si+1}`;}
function fileName(label){
  const key=safeFileName(keyLabel().split('/')[0]), title=ascii(song.title);
  return [key,title,label].filter(Boolean).join('_')+'.mid';
}
function currentExport(){
  if(range){
    const si=song.sections.findIndex((s,i)=>tl.secRanges[i].from===range.from&&tl.secRanges[i].to===range.to);
    return {r:range,si,label:si>=0?sectionFileLabel(song.sections[si],si):`Bar${range.from+1}-${range.to}`};
  }
  return {r:{from:0,to:tl.bars.length},si:-1,label:'Song'};
}
function smfFor(r,label){return buildSmf(renderSong(song,rangeTicks(tl,r)),`${song.title} ${label}`);}
const b64=bytes=>{let s='';for(const x of bytes)s+=String.fromCharCode(x);return btoa(s);};
// ブラウザ確認用：Chrome の DownloadURL でデスクトップ・DAW へドラッグ（プラグインでは C++ の外部ドラッグに置き換える）
function midiHandle(getRange,getLabel){
  const b=h('button','handle');b.draggable=true;
  b.addEventListener('dragstart',e=>{
    const label=getLabel(), name=fileName(label);
    e.dataTransfer.setData('DownloadURL',`audio/midi:${name}:data:audio/midi;base64,${b64(smfFor(getRange(),label))}`);
    e.dataTransfer.effectAllowed='copy';
  });
  return b;
}
const dragSel=$('dragSel');
dragSel.addEventListener('dragstart',e=>{
  const {r,label}=currentExport(), name=fileName(label);
  e.dataTransfer.setData('DownloadURL',`audio/midi:${name}:data:audio/midi;base64,${b64(smfFor(r,label))}`);
  e.dataTransfer.effectAllowed='copy';
});
$('saveMidi').onclick=()=>{const {r,label}=currentExport();download(new Blob([smfFor(r,label)],{type:'audio/midi'}),fileName(label));};
function download(blob,name){
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}

/* ---------- ファイル ---------- */
const fileMenu=$('fileMenu');
$('fileBtn').onclick=e=>{e.stopPropagation();fileMenu.hidden=!fileMenu.hidden;};
addEventListener('click',()=>{fileMenu.hidden=true;});
fileMenu.addEventListener('click',e=>{
  const act=e.target.dataset.act;if(!act)return;
  if(act==='new')replaceSong(newSong());
  if(act==='demo')replaceSong(demoSong());
  if(act==='open')$('fileInput').click();
  if(act==='save')download(new Blob([JSON.stringify({app:'ChordSketch',v:1,song},null,1)],{type:'application/json'}),(ascii(song.title)||'song')+'.chordsketch');
});
$('fileInput').addEventListener('change',async e=>{
  const f=e.target.files[0];e.target.value='';if(!f)return;
  try{const s=validSong(JSON.parse(await f.text()).song);if(!s)throw 0;replaceSong(s);}
  catch{alert('ChordSketch の曲ファイルとして読み込めませんでした。');}
});
function replaceSong(s){
  player.stop();commit(()=>{song=s;});sel=null;range=null;cursor={gi:0,pos:0};rotateTo(song.key.idx,true);render();
}

/* ---------- コード譜（印刷／PDF） ---------- */
function buildPrint(){
  const pr=$('print');pr.innerHTML='';
  pr.appendChild(h('h2','',song.title));
  pr.appendChild(h('div','meta',`Key: ${keyLabel()}（${song.key.mode==='major'?'メジャー':'マイナー'}）　♩=${song.bpm}　${song.meter.join('/')}`));
  const pcs=placedChords(song,tl);
  song.sections.forEach((s,si)=>{
    const {from,to}=tl.secRanges[si];
    const ps=h('div','psec');ps.style.setProperty('--c',SECTION_COLORS[s.color%SECTION_COLORS.length]);
    ps.appendChild(h('div','plabel',s.name));
    for(let r=from;r<to;r+=4){
      const row=h('div','prow');
      for(let gi=r;gi<Math.min(r+4,to);gi++){
        const b=tl.bars[gi], cell=h('div','pbar'+(gi===Math.min(r+4,to)-1?' end':'')+(gi===tl.bars.length-1?' final':''));
        const marks=s.marks.filter(m=>m.bar===b.bar).sort((x,y)=>(y.meter?1:0)-(x.meter?1:0)).map(m=>m.meter?m.meter.join('/'):`♩=${m.bpm}`);
        if(marks.length)cell.appendChild(h('span','pm',marks.join('  ')));
        if(gi===r)cell.appendChild(h('span','pn',String(gi+1)));
        const inBar=pcs.filter(p=>p.end>b.start&&p.start<b.start+b.ticks);
        for(const p of inBar){
          const cont=p.start<b.start;
          if(cont&&inBar.length>1)continue;   // 小節の途中で変わるなら前からの続きは書かない
          // 小節の終わり近く（食い）から始まるコードは、はみ出さないよう右端にそろえる
          const frac=Math.max(0,(p.start-b.start)/b.ticks), place=x=>{if(frac>.7){x.style.right='1mm';x.classList.add('late');}else x.style.left=frac*100+'%';};
          const c=h('span','pc'+(cont?' cont':''),nameOf(song,p.c));place(c);cell.appendChild(c);
          if($('prDeg').checked&&!cont){const d=h('span','pd',degOfItem(p.c));place(d);cell.appendChild(d);}
        }
        row.appendChild(cell);
      }
      ps.appendChild(row);
    }
    pr.appendChild(ps);
  });
}
$('printBtn').onclick=()=>{buildPrint();$('printWrap').hidden=false;};
$('prDeg').onchange=buildPrint;
$('prClose').onclick=()=>{$('printWrap').hidden=true;};
// PDF のファイル名は document.title になる
$('prGo').onclick=()=>{const t=document.title;document.title=song.title||'ChordSketch';print();document.title=t;};

/* ---------- MIDI 鍵盤（Web MIDI。プラグインでは C++ から midiNotes で届く） ---------- */
const held=new Set();let peak=[];
function setMidiStatus(s,on){const e=$('midiSt');e.textContent=s;e.classList.toggle('on',!!on);}
if(navigator.requestMIDIAccess){
  navigator.requestMIDIAccess().then(acc=>{
    const bind=()=>{
      let n=0;for(const inp of acc.inputs.values()){inp.onmidimessage=onMidi;n++;}
      setMidiStatus(n?`${n}台 接続中`:'未接続',n>0);
    };
    bind();acc.onstatechange=bind;
  },()=>setMidiStatus('使えません'));
}else setMidiStatus('このブラウザは非対応');
function onMidi({data:[st,d1,d2]}){
  const t=st&0xf0;
  if(t===0x90&&d2>0){held.add(d1);player.noteOn(d1,d2,ui.timbre);if(held.size>=peak.length)peak=[...held];}
  else if(t===0x80||t===0x90){
    held.delete(d1);player.noteOff(d1);
    if(!held.size){
      if(ui.step&&peak.length>=2){const d=detectChords(peak,1)[0];if(d)insertAtCursor({off:mod12(d.root-tonic()),q:d.q,...(d.bass!=null?{boff:mod12(d.bass-tonic())}:{})});}
      peak=[];
    }
  }else return;
  renderLive();
}
// 開発用：MIDI 機器なしで確認するときにコンソールから MIDI メッセージを流し込む（例：__midi([0x90,60,100])）
window.__midi=data=>onMidi({data});
function renderLive(){
  const box=$('live');box.innerHTML='';
  const notes=[...held].sort((a,b)=>a-b);
  if(!notes.length){box.appendChild(h('span','muted',ui.step?'コードを弾いて離すとカーソルの位置に入ります':'MIDI 鍵盤で弾くとコード名を表示'));return;}
  const found=detectChords(notes,4), fl=flat(), t=tonic();
  if(found.length){
    box.appendChild(h('b','',chordNameOf(found[0],fl,t)));
    if(found.length>1)box.appendChild(h('span','alt',found.slice(1).map(c=>chordNameOf(c,fl,t)).join(' ／ ')));
  }else box.appendChild(h('span','muted','（コードとして判別できません）'));
  box.appendChild(h('span','notes',notes.map(n=>noteName(n,fl)+(Math.floor(n/12)-1)).join(' ')));
}

/* ---------- 上部・ツールバーのコントロール ---------- */
for(const m of METERS)$('meter').appendChild(Object.assign(h('option','',m.join('/')),{value:m.join('/')}));
for(const m of player.METRONOMES)$('metro').appendChild(Object.assign(h('option','',m.name),{value:m.id}));
for(const t of player.TIMBRES)$('timbre').appendChild(Object.assign(h('option','',t.name),{value:t.id}));
for(const p of PATTERNS)$('pattern').appendChild(Object.assign(h('option','',p.name),{value:p.id}));
for(const [v,n] of INS_LENS)$('insLen').appendChild(Object.assign(h('option','',n),{value:v}));
for(const p of SECTION_PRESETS)$('secNames').appendChild(Object.assign(h('option'),{value:p.name}));
$('title').addEventListener('change',e=>commit(()=>{song.title=e.target.value.trim()||'無題';}));
$('title').addEventListener('keydown',e=>{if(e.key==='Enter')e.target.blur();});
$('bpm').addEventListener('change',e=>commit(()=>{song.bpm=Math.min(MAX_BPM,Math.max(MIN_BPM,Math.round(+e.target.value)||120));pruneMarks(song);}));
$('meter').addEventListener('change',e=>commit(()=>{song.meter=e.target.value.split('/').map(Number);pruneMarks(song);}));
$('pattern').addEventListener('change',e=>commit(()=>{song.pattern=e.target.value;}));
const uiSet=(k,v)=>{ui[k]=v;render();persist();};
$('metro').addEventListener('change',e=>{uiSet('metro',e.target.value);player.refresh();});
$('timbre').addEventListener('change',e=>{uiSet('timbre',e.target.value);player.refresh();});
$('insLen').addEventListener('change',e=>uiSet('insLen',e.target.value));
$('countIn').onclick=()=>uiSet('countIn',!ui.countIn);
// ミュートは保存しない（開き直すと音が出る状態に戻る）
let muted=false;
function toggleMute(){muted=!muted;player.setMuted(muted);$('muteBtn').setAttribute('aria-pressed',muted);}
$('muteBtn').onclick=toggleMute;
$('loopBtn').onclick=()=>uiSet('loop',!ui.loop);
$('stepBtn').onclick=()=>{uiSet('step',!ui.step);renderLive();};
$('keepNames').onclick=()=>uiSet('keepNames',!ui.keepNames);
$('bassBtn').onclick=()=>commit(()=>{song.bass=!song.bass;});
document.querySelectorAll('#snapSeg button').forEach(b=>b.onclick=()=>uiSet('snap',b.dataset.v));
document.querySelectorAll('#rowSeg button').forEach(b=>b.onclick=()=>uiSet('perRow',+b.dataset.v));
$('undo').onclick=undo;$('redo').onclick=redo;
function octControl(id,key){
  const box=$(id);box.innerHTML='';
  const minus=h('button','','−'),val=h('span','',''),plus=h('button','','＋');
  minus.onclick=()=>commit(()=>{song[key]=Math.max(-2,song[key]-1);});
  plus.onclick=()=>commit(()=>{song[key]=Math.min(2,song[key]+1);});
  box.append(minus,val,plus);
  return ()=>{val.textContent=(song[key]>0?'+':'')+song[key];minus.disabled=song[key]<=-2;plus.disabled=song[key]>=2;};
}
const renderOctUp=octControl('octUp','octave'), renderOctBass=octControl('octBass','bassOctave');
$('octUp').title='上声のオクターブ（0 = ルートが C3〜B3）';$('octBass').title='ベースのオクターブ（0 = C2〜B2）';

/* ---------- テーマ ---------- */
const THEMES=['light','dark','auto'], THEME_NAME={light:'☀',dark:'☾',auto:'◐'};
const dark=matchMedia('(prefers-color-scheme: dark)');
function applyTheme(){
  const t=ui.theme==='auto'?(dark.matches?'dark':'light'):ui.theme;
  document.documentElement.dataset.theme=t;$('themeBtn').textContent=THEME_NAME[ui.theme];
}
$('themeBtn').onclick=()=>{ui.theme=THEMES[(THEMES.indexOf(ui.theme)+1)%3];applyTheme();persist();};
dark.addEventListener('change',applyTheme);

/* ---------- 描画 ---------- */
function render(){
  const pressed=(id,on)=>$(id).setAttribute('aria-pressed',!!on);
  $('title').value=song.title;$('bpm').value=song.bpm;$('meter').value=song.meter.join('/');
  $('metro').value=ui.metro;$('timbre').value=ui.timbre;$('pattern').value=song.pattern;$('insLen').value=ui.insLen;
  pressed('countIn',ui.countIn);pressed('loopBtn',ui.loop);pressed('stepBtn',ui.step);pressed('keepNames',ui.keepNames);pressed('bassBtn',song.bass);
  document.querySelectorAll('#snapSeg button').forEach(b=>b.setAttribute('aria-pressed',b.dataset.v===ui.snap));
  document.querySelectorAll('#rowSeg button').forEach(b=>b.setAttribute('aria-pressed',+b.dataset.v===ui.perRow));
  const playing=player.isPlaying(), pb=$('playBtn');
  pb.textContent=playing?'■':'▶';pb.setAttribute('aria-label',playing?'停止':'再生');pb.classList.toggle('on',playing);
  if(!playing){$('posDisp').textContent=`${cursor.gi+1} : ${Math.floor(cursor.pos/beatTicksOf(tl.bars[cursor.gi]?.meter||song.meter))+1}`;$('posDisp').classList.remove('count');lastPos='';}
  $('undo').disabled=!undoStack.length;$('redo').disabled=!redoStack.length;
  keySel.value=song.key.idx+':'+song.key.mode;
  cKey.textContent=keyLabel();cSig.textContent=SIG[song.key.idx];cMode.textContent=song.key.mode==='major'?'メジャー':'マイナー';
  drawOverlay();
  renderOctUp();renderOctBass();
  const over=song.sections.filter(x=>x.pattern).map(x=>x.name);
  $('outInfo').textContent=over.length?`パターンを変えているセクション：${over.join('・')}`:'';
  const ex=currentExport();
  $('dragLabel').textContent=!range?'曲全体':ex.si>=0?`「${song.sections[ex.si].name}」`:rangeLabel(range);
  renderPalette();renderProg();renderSheet();renderFooter();
}

/* ---------- 画面の拡大縮小（スクロールなし、ChordNavi と同じ） ---------- */
function fit(){
  const s=Math.min(innerWidth/1280,innerHeight/780);
  $('stage').style.transform=`translate(-50%,-50%) scale(${s})`;
}
addEventListener('resize',()=>{fit();renderSheet();});
fit();applyTheme();rotateTo(song.key.idx,true);render();renderLive();
