import {MAJ_LABEL,MIN_LABEL,SIG,DIATONIC,CHORD,chordDeg,chordAt,chordName as chordNameOf,
  noteName,tonicOf,isFlatKey,keyName as keyNameOf,detectChords,mod12,PROGRESSIONS,variantsOf,progressionDegrees,
  CONFORM_SCALES,conformBars,diatonicOf,scaleById,chordPcs} from '../../shared/ui/theory.js';
import {createWheel} from '../../shared/ui/wheel.js';
import {PPQ,METERS,SNAPS,snapTicks,barTicksOf,beatTicksOf,SECTION_COLORS,SECTION_PRESETS,PATTERNS,MIN_BPM,MAX_BPM,
  newSong,demoSong,newSection,newChord,cloneSection,timeline,placedChords,placeChord,removeChord,resizeChord,
  setSectionBars,insertBars,appendSectionFrom,stretchChord,stretchChordStart,pruneMarks,mergeSections,splitSection,insertProgression,setMark,rangeTicks,copyRange,pasteAt,renderSong,buildSmf,safeFileName,
  songTonic,songFlat,nameOf,tempoAt,PATTERN_GROUPS,NEW_TITLE,SKETCH_SCALES,keyScale,defaultScale,meterAt,tickToSec,withExtension,keyTonic,sameKey,setKeyMark,keyRegion,transposeBars,voicingOf,patternById,VOICINGS,GUITAR_AREAS,melodyBase,addNote,secToTick} from './song.js';
import {createRoll,M_SNAPS,M_LENS} from './roll.js';
import * as player from './player.js';
import {hasNative,nativeFn,onNative} from '../../shared/ui/juce-bridge.js';

/* ---------- 状態 ---------- */
const STORE='chordsketch.v1';
const UI_DEFAULT={snap:'beat',perRow:4,insLen:'bar',dia:'7',timbre:'piano',metro:'click',metroOn:true,countIn:false,countBars:1,loop:false,keepNames:false,step:false,theme:'light',prog:{major:0,minor:13},progVar:0,
  // メロディー（ピアノロール）：表示・スナップ・入力の長さ・横の拡大・音色・鳴らすもの・ガイド、MIDI に入れるもの
  view:'chords',mSnap:'8',mLen:'8',mZoom:1,mTimbre:'square',hearChords:true,hearMelody:true,guideChord:true,guideScale:true,midiParts:'both',mTimbreSet:false,mTool:'draw'};
let song, ui={...UI_DEFAULT};
let tl;                     // timeline(song) のキャッシュ（changed() で更新）
let sel=null;               // 選択中のコード {si,id}
let cursor={gi:0,pos:0};    // 入力カーソル（曲の通しの小節番号・小節内 tick）
let range=null;             // 選択範囲 {from,to}（小節番号、to は含まない）
let clip=null;              // コピーしたコード
let undoStack=[],redoStack=[];
// タブ（Standalone・ブラウザ版だけ。プラグイン版は TABS=false にして1曲だけにする）。
// 表示中の曲の状態は上の変数（song・undoStack・sel…）をそのまま使い、切り替えるときに docs と入れ替える
const TABS=true;
let docs=[], active=0;

// 保存データの読み込み（形が合わなければ既定値）
function validSong(x){
  if(!x||!Array.isArray(x.sections)||!x.key||!Array.isArray(x.meter))return null;
  const s={...newSong(),...x};
  s.bpm=Math.min(MAX_BPM,Math.max(MIN_BPM,+s.bpm||120));
  if(!METERS.some(m=>m.join()===s.meter.join()))s.meter=[4,4];
  if(!(s.key.idx>=0&&s.key.idx<12)||!['major','minor'].includes(s.key.mode))s.key={idx:0,mode:'major'};
  if(s.key.scale&&!SKETCH_SCALES.some(x=>x.id===s.key.scale))delete s.key.scale;
  if(!PATTERNS.some(p=>p.id===s.pattern))s.pattern='whole';
  if(!VOICINGS.some(v=>v.id===s.voicing))s.voicing='piano';
  if(!GUITAR_AREAS.some(v=>v.id===s.guitarArea))s.guitarArea='low';
  s.octave=Math.max(-2,Math.min(2,s.octave|0));s.bassOctave=Math.max(-2,Math.min(2,s.bassOctave|0));
  s.sections=s.sections.filter(c=>c&&c.bars>0).map(c=>({...newSection(),...c,chords:(c.chords||[]).filter(ch=>ch&&CHORD[ch.q]&&ch.len>0),
    melody:(c.melody||[]).filter(n=>n&&n.len>0&&Number.isFinite(n.p)&&n.bar>=0).map(n=>({...n,v:Math.max(1,Math.min(127,n.v|0||100))})),marks:(c.marks||[]).filter(m=>!m.key||(m.key.idx>=0&&m.key.idx<12&&['major','minor'].includes(m.key.mode)))}));
  return s;
}
// 自動保存の読み書き。JUCE 版はネイティブのファイル（Application Support の ChordSketch/session.json）、ブラウザは localStorage
const nativeSession={load:nativeFn('loadSession'),save:nativeFn('saveSession')};
async function readSaved(){
  if(nativeSession.load){try{const t=await nativeSession.load();if(t)return JSON.parse(t);}catch(e){console.error(e);}}
  return JSON.parse(localStorage.getItem(STORE)||'null');   // ブラウザ、または JUCE 版で session.json がまだ無いとき（前の版は WebView の localStorage に保存していた）
}
const str=v=>typeof v==='string'?v:'';
try{
  const saved=await readSaved();
  // path は JUCE 版で保存したファイル（上書き保存の書き込み先）。ブラウザでは書き込み先を覚えておけない
  if(Array.isArray(saved?.docs))docs=saved.docs.map(d=>({song:validSong(d.song),file:str(d.file),handle:hasNative&&str(d.path)?d.path:null,dirty:!!d.dirty})).filter(d=>d.song);
  else if(saved?.song){const s=validSong(saved.song);if(s)docs=[{song:s,file:saved.ui?.songFile||''}];}   // 前の保存形式（曲1つ）
  active=Math.max(0,Math.min(docs.length-1,saved?.active|0));
  song=docs[active]?.song;
  if(saved?.ui)for(const k in UI_DEFAULT)if(typeof saved.ui[k]===typeof UI_DEFAULT[k])ui[k]=saved.ui[k];
}catch{}
// 前の保存形式：metro が 'off' ならメトロノームはオフ（種類はクリック）
if(ui.metro==='off'){ui.metro='click';ui.metroOn=false;}
// メロディーの既定の音色をリードから矩形波に変えた（2026-10-01）。前の既定のままなら矩形波にする（一度だけ）
if(!ui.mTimbreSet){if(ui.mTimbre==='lead')ui.mTimbre='square';ui.mTimbreSet=true;}
song=song||demoSong();
if(!docs.length)docs=[{song,file:''}];
docs[active].song=song;
tl=timeline(song);

let saveTimer=0;
// 自動保存：開いているタブを全部（表示中のタブは今の song・ファイル名）
function persist(){clearTimeout(saveTimer);saveTimer=setTimeout(()=>{
  const all=docs.map((d,i)=>i===active?{song,file:songFile,path:pathOf(fileHandle),dirty}:{song:d.song,file:d.file||'',path:pathOf(d.handle),dirty:!!d.dirty});
  const json=JSON.stringify({docs:all,active,ui});
  if(nativeSession.save)nativeSession.save(json).catch(e=>console.error(e));else localStorage.setItem(STORE,json);
},300);}
function snapshot(){undoStack.push(JSON.stringify(song));if(undoStack.length>300)undoStack.shift();redoStack.length=0;}
function commit(mut){snapshot();mut();changed();}
function changed(){tl=timeline(song);fixSelection();render();persist();player.refresh();markDirty();}   // 再生中ならすぐ反映
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
// 五度圏・パレット・コード作成・MIDI 入力は、カーソルのある場所のキー（途中で転調していればそのキー）
const curKey=()=>tl.bars[cursor.gi]?.key||song.key;
const tonic=()=>keyTonic(curKey());
const flat=()=>isFlatKey(curKey().idx);
const nameOfItem=it=>chordNameOf(chordAt(tonic(),[it.off,it.q,it.boff,it.deg]),flat(),tonic());
const degOfItem=it=>chordDeg(it.off,it.q,it.boff,it.deg);
const chordOfItem=(it,key=curKey())=>chordAt(keyTonic(key),[it.off,it.q,it.boff,it.deg]);
// カーソルのある場所のスケール。7音のスケールならダイアトニック・プリセットをそのスケールで作り直す
const curScale=()=>keyScale(curKey());
const scaleConforms=()=>CONFORM_SCALES.includes(curScale());
const keyLabel=(key=curKey())=>keyNameOf(key.idx,key.mode);
const songKeyLabel=()=>keyLabel(song.key);
const snapOf=meter=>snapTicks(ui.snap,meter);
function fmtLen(t,meter){
  const bt=beatTicksOf(meter), nb=t/bt, bars=Math.floor(nb/meter[0]+1e-9), rem=nb-bars*meter[0];
  const whole=Math.floor(rem+1e-9), half=rem-whole>.01;
  const beats=whole||half?(whole?`${whole}拍`:'')+(half?(whole?'半':'半拍'):''):'';
  return (bars?`${bars}小節`:'')+beats||'0';
}
// 位置は DAW と同じ「小節.拍.16分」（例：9小節目の3拍目の裏 → 9.3.3）。拍は拍子の分母の音符、16分は4分音符の 1/4
const SIXTEENTH=PPQ/4;
function beatSub(pos,meter){
  const bt=beatTicksOf(meter);
  return `${Math.floor(pos/bt)+1}.${Math.floor((pos%bt)/SIXTEENTH)+1}`;
}
function fmtPos(gi,pos){
  const b=tl.bars[gi];if(!b)return '';
  return `${gi+1}.${beatSub(pos,b.meter)}`;
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

// パターンの選択肢をまとまり（基本・バンド・EDM）ごとに入れる
function addPatternOptions(sel){
  for(const g of PATTERN_GROUPS){
    const og=document.createElement('optgroup');og.label=g.name;
    for(const p of PATTERNS.filter(x=>x.group===g.id))og.appendChild(Object.assign(document.createElement('option'),{value:p.id,textContent:p.name}));
    sel.appendChild(og);
  }
}
function h(tag,cls,text){const e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e;}

/* ---------- 五度圏（shared/ui/wheel.js。ChordNavi と共通） ---------- */
const wheel=createWheel($('wheel'),{onSelect:(i,m)=>setKey(i,m)});
const {key:cKey,sig:cSig,mode:cMode}=wheel.center;
const drawOverlay=()=>wheel.setOverlay(curKey().mode);
const rotateTo=(idx,instant)=>wheel.rotateTo(idx,instant);
// キーの変更：カーソルのある範囲（曲の頭または途中のキーの変更点〜次の変更点）のキーを変える。
// 既定は度数を保って移調。「コード固定」なら、その範囲のコードの度数を付け替えてコード名（鳴る音）を変えない
function setKey(idx,mode){
  const k=curKey();
  if(idx===k.idx&&mode===k.mode)return;
  const r=keyRegion(tl,cursor.gi), before=keyTonic(k);
  commit(()=>{
    const nk={idx,mode,...(mode===k.mode&&k.scale?{scale:k.scale}:{})};   // モードを変えたら既定のスケールに戻す（ChordNavi と同じ）
    if(r.mark){const m=song.sections[r.mark.si].marks.find(x=>x.bar===r.mark.bar&&x.key);m.key=nk;}
    else song.key=nk;
    if(ui.keepNames)transposeBars(song,tl,r.from,r.to,mod12(before-tonicOf(idx,mode)),melodyBase(k)-melodyBase({idx,mode}));
    pruneMarks(song);
  });
  rotateTo(idx);
}
const keySel=$('keySel');
for(const m of ['major','minor'])for(let i=0;i<12;i++){
  const o=h('option','',(m==='major'?MAJ_LABEL[i]+' メジャー':MIN_LABEL[i].replace(/m/g,'')+' マイナー')+'（'+SIG[i]+'）');
  o.value=i+':'+m;keySel.appendChild(o);
}
keySel.addEventListener('change',()=>{const [i,m]=keySel.value.split(':');setKey(+i,m);});
// スケール：カーソルのある範囲のキーのスケールを変える（コードは変えない）
const scaleSel=$('scaleSel');
for(const x of SKETCH_SCALES)scaleSel.appendChild(Object.assign(h('option','',x.name),{value:x.id}));
scaleSel.addEventListener('change',()=>{
  const r=keyRegion(tl,cursor.gi), v=scaleSel.value;
  commit(()=>{
    const apply=k=>{if(v===defaultScale(k.mode))delete k.scale;else k.scale=v;};
    if(r.mark)apply(song.sections[r.mark.si].marks.find(x=>x.bar===r.mark.bar&&x.key).key);else apply(song.key);
    pruneMarks(song);
  });
});

/* ---------- パレット（ダイアトニック・コードを作る） ---------- */
function paletteChip(item){
  const b=h('button','pchip'+(outOfScale(item)?' out':''));
  b.append(h('span','n',nameOfItem(item)),h('span','d',degOfItem(item)));
  b.title='クリックで試聴、ダブルクリックでカーソル位置に入力、シートへドラッグで配置'+(outOfScale(item)?'（スケールの外の音を含む）':'');
  b.addEventListener('pointerdown',e=>startPaletteDrag(e,item));
  b.addEventListener('dblclick',()=>insertAtCursor(item));
  return b;
}
const diaItems=()=>scaleConforms()
  ?diatonicOf(curScale(),ui.dia==='3'?3:4).map(([off,q,,deg])=>({off,q,deg}))
  :DIATONIC[ui.dia][curKey().mode].map(([off,q])=>({off,q}));
// 7音でないスケール（ペンタ・ブルースなど）では、スケールの外の音を含むコードを薄く出す
const outOfScale=it=>{
  if(scaleConforms())return false;
  const iv=scaleById(curScale()).iv, t=tonic();
  return chordPcs(chordOfItem(it)).some(pc=>!iv.includes(mod12(pc-t)));
};
function customItem(){
  const off=+$('bRoot').value, q=$('bQ').value, bv=+$('bBass').value;
  return {off,q,...(bv!==off?{boff:bv}:{})};
}
let lastRoot='0';   // 直前のルート（ベースがこれと同じなら、ルートを変えたときに一緒に動かす）
function renderPalette(){
  const dia=$('dia');dia.innerHTML='';
  diaItems().forEach(it=>dia.appendChild(paletteChip(it)));
  // コードを作る：ルート・ベースの選択肢は今のキーの音名で
  for(const id of ['bRoot','bBass']){
    const s=$(id), v=s.value;s.innerHTML='';
    for(let off=0;off<12;off++)s.appendChild(Object.assign(h('option','',(id==='bBass'?'/':'')+noteName(mod12(tonic()+off),flat())),{value:off}));
    s.value=v||$('bRoot').value||'0';   // ベースの既定はルートと同じ音（分数コードにしない）
  }
  lastRoot=$('bRoot').value;
  const c=$('custom');c.innerHTML='';c.appendChild(paletteChip(customItem()));
  document.querySelectorAll('.left .pchip .n').forEach(n=>fitText(n,9));
  document.querySelectorAll('#diaSeg button').forEach(b=>b.setAttribute('aria-pressed',b.dataset.v===ui.dia));
}
for(const q of QUALITIES)$('bQ').appendChild(Object.assign(h('option','',q===''?'maj':CHORD[q].s),{value:q}));
// ルートを変えたとき、ベースがルートと同じ（分数コードでない）なら一緒に動かす
$('bRoot').addEventListener('change',()=>{if($('bBass').value===lastRoot)$('bBass').value=$('bRoot').value;lastRoot=$('bRoot').value;});
for(const id of ['bRoot','bQ','bBass'])$(id).addEventListener('change',()=>{renderPalette();previewItem(customItem());});
document.querySelectorAll('#diaSeg button').forEach(b=>b.addEventListener('click',()=>{ui.dia=b.dataset.v;renderPalette();persist();}));

function previewItem(it,key=curKey()){
  const {bass,upper}=voicingOf(song,chordOfItem(it,key));
  player.playNotes(song.bass?[bass,...upper]:upper,ui.timbre);
}
function insertAtCursor(it){
  const b=tl.bars[cursor.gi];if(!b)return;
  const len=insLenTicks(b.meter);let placed;
  editOpen=false;
  commit(()=>{placed=placeChord(song,b.si,{...newChord(b.bar,cursor.pos,len,it.off,it.q,it.boff),...(it.deg!=null?{deg:it.deg}:{})});if(placed)sel={si:b.si,id:placed.id};});
  if(placed){advanceCursor(b.start+cursor.pos+placed.len);previewItem(it);render();}
}
// 曲の中の tick → カーソル（最後の小節の終わりを越えたら最後の小節の頭）
function advanceCursor(abs){
  const b=tl.bars.find(x=>abs>=x.start&&abs<x.start+x.ticks);
  cursor=b?{gi:b.gi,pos:abs-b.start}:{gi:Math.max(0,tl.bars.length-1),pos:0};
  scrollToBar(cursor.gi);
}

// 入りきらない文字は、その要素だけ文字を小さくして収める（下限 min px）。
// scrollWidth は小数を丸めるので、文字の幅は Range で測る（拡大縮小中の画面座標どうしで比べる）
function fitText(box,min=8){
  box.style.fontSize='';
  let size=parseFloat(getComputedStyle(box).fontSize);
  const range=document.createRange();range.selectNodeContents(box);
  const cs=getComputedStyle(box), k=box.getBoundingClientRect().width/(box.offsetWidth||1);
  const room=()=>box.getBoundingClientRect().width-(parseFloat(cs.paddingLeft)+parseFloat(cs.paddingRight))*k-.5;
  while(range.getBoundingClientRect().width>room()&&size>min){size-=.5;box.style.fontSize=size+'px';}
}

/* ---------- 定番コード進行（ChordNavi の PROGRESSIONS） ---------- */
const progSel=$('progSel'), progVar=$('progVar');
const curProg=()=>{const m=curKey().mode, p=PROGRESSIONS[ui.prog[m]];return p&&p.mode===m?p:PROGRESSIONS.find(x=>x.mode===m);};
const curBars=()=>{
  const v=variantsOf(curProg()), bars=(v[ui.progVar]||v[0]).c, sc=curScale();
  return scaleConforms()&&sc!==defaultScale(curKey().mode)?conformBars(bars,curKey().mode,sc):bars;
};
function renderProg(){
  const mode=curKey().mode, p=curProg();
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
  // 1行4小節のミニ譜面（長い進行も見切れない。1小節に2つなら並べる）
  names.innerHTML='';
  for(const bar of bars){
    const cell=h('span','pb');
    (Array.isArray(bar[0])?bar:[bar]).forEach(([off,q,boff],k)=>{
      if(k)cell.appendChild(h('span','dash','-'));
      cell.appendChild(h('span','pc',nameOfItem({off,q,boff})));
    });
    cell.title=cell.textContent;names.appendChild(cell);
  }
  names.querySelectorAll('.pb').forEach(cell=>fitText(cell,7.5));
  names.title=progressionDegrees(bars);
  $('progPlay').textContent=progPreview&&player.isPlaying()?'停止':'試聴';
  $('progIns').title=`カーソルのある小節（${cursor.gi+1}小節目）から${bars.length}小節を上書きで入れる（1コード＝1小節）`;
}
progSel.addEventListener('change',()=>{ui.prog[curKey().mode]=+progSel.value;ui.progVar=0;stopProgPreview();renderProg();persist();});
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
    // 左の色の棒：つかんで上下にドラッグするとセクションごと移動
    const grip=h('div','sec-grip');grip.title=`「${s.name}」をドラッグして移動`;grip.setAttribute('aria-hidden','true');
    sec.appendChild(grip);
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
      if(first&&(p.start-b.start)%beatTicksOf(b.meter)!==0){blk.classList.add('anti');blk.dataset.sync='1';}   // 拍の裏から始まるコード（シンコペーション）
      if(sel&&sel.id===p.c.id)blk.classList.add('sel');
      if(playingId===p.c.id)blk.classList.add('playing');
      blk.append(h('span','n',first||w>30?nameOf(song,p.c,p.key):''),h('span','d',first?degOfItem(p.c):''));
      blk.title=`${nameOf(song,p.c,p.key)}（${degOfItem(p.c)}）${fmtLen(p.end-p.start,b.meter)}　パターン：${patternById(p.pattern).name}${p.c.pattern?'（このコードだけ）':''}${blk.dataset.sync?'　拍の裏から（シンコペーション）':''}`;
      if(first&&p.c.pattern){const t=h('span','ptag',patternById(p.c.pattern).short);t.title='このコードだけのパターン：'+patternById(p.c.pattern).name;blk.appendChild(t);blk.classList.add('haspat');}
      if(first)blk.appendChild(Object.assign(h('div','rs rsl'),{title:'ドラッグで頭の位置を変える（前に伸ばすと前のコードを上書き）'}));
      if(e===p.end)blk.appendChild(Object.assign(h('div','rs'),{title:'ドラッグで長さを変える'}));
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
  placeChordEditorLater=true;
  if(!song.sections.length)sheet.prepend(h('div','empty','セクションがありません。下の欄に名前を入れて追加してください。'));
  sheet.scrollTop=scroll;
  if(placeChordEditorLater){placeChordEditorLater=false;placeChordEditor();}
}
let placeChordEditorLater=false;
function barCell(b,rowEnd,songEnd){
  const bar=h('div','bar'+(rowEnd?' last':'')+(songEnd?' sec-end':''));bar.dataset.gi=b.gi;
  if(range&&b.gi>=range.from&&b.gi<range.to)bar.classList.add('insel');
  const no=h('div','bar-no',String(b.gi+1));no.title='クリック・ドラッグで小節を選択、ダブルクリックでテンポ・拍子を変更';
  const sec=song.sections[b.si];
  for(const m of sec.marks.filter(m=>m.bar===b.bar).sort((x,y)=>(y.key?2:y.meter?1:0)-(x.key?2:x.meter?1:0)||(x.pos||0)-(y.pos||0))){
    if(m.key)no.appendChild(Object.assign(h('span','mark key','Key '+keyLabel(m.key)),{title:'キーの変更（クリックで編集）'}));
    if(m.meter)no.appendChild(Object.assign(h('span','mark meter',m.meter.join('/')),{title:'拍子の変更（クリックで編集）'}));
    if(m.bpm){const t=h('span','mark tempo',`♩=${m.bpm}${m.pos?' @'+beatSub(m.pos,b.meter):''}`);t.title='テンポの変更（クリックで編集）';t.dataset.pos=m.pos||0;no.appendChild(t);}
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
  addPatternOptions(pat);
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
  // 次のセクションと1つにする（複製したサビを1つのサビにするなど）
  const next=song.sections[si+1];
  const merge=h('button','','次と結合');merge.disabled=!next;
  merge.title=next?`次のセクション「${next.name}」をこのセクションの後ろにつないで1つにする（名前・色はこのセクション）`:'次のセクションがありません';
  merge.onclick=()=>{
    const from=tl.secRanges[si].from;
    commit(()=>{if(mergeSections(song,si))pruneMarks(song,si);});
    sel=null;range={from,to:tl.secRanges[si].to};cursor={gi:from,pos:0};render();
  };
  // カーソルのある小節の頭で2つに分ける（このセクションの2小節目以降にカーソルがあるとき）
  const cb=tl.bars[cursor.gi], canSplit=!!cb&&cb.si===si&&cb.bar>0;
  const split=h('button','','分割');split.disabled=!canSplit;
  split.title=canSplit?`${cursor.gi+1}小節目の頭でこのセクションを2つに分ける`:'分けたい小節をクリックしてカーソルを置いてから押す（セクションの2小節目以降）';
  split.onclick=()=>splitAtCursor();
  head.append(sw,name,nb,h('span','n','小節'),pat,pick,drag,dup,split,merge,up,down,del);
  return head;
}

/* ---------- シートの操作 ---------- */
sheet.addEventListener('pointerdown',e=>{
  if(e.button===0&&e.target.closest('.sec-grip')){e.preventDefault();startSectionDrag(e,+e.target.closest('.sec').dataset.si);return;}
  if(e.button!==0||e.target.closest('.sec-head,.add-sec,.chip-edit'))return;
  const mark=e.target.closest('.mark'), blk=e.target.closest('.blk'), no=e.target.closest('.bar-no'), lane=e.target.closest('.lane');
  const bar=e.target.closest('.bar');
  if(mark&&bar){e.preventDefault();const gi=+bar.dataset.gi;openMarkPop(gi,mark.classList.contains('tempo')?+(mark.dataset.pos||0):0,mark);return;}
  if(blk){e.preventDefault();sheet.focus({preventScroll:true});startBlockDrag(e,blk);return;}
  if(no&&bar){e.preventDefault();sheet.focus({preventScroll:true});startRangeDrag(e,+bar.dataset.gi,true);return;}
  if(lane&&bar){e.preventDefault();sheet.focus({preventScroll:true});startRangeDrag(e,+bar.dataset.gi,false);}
});
// マウスを乗せた小節に、クリックでカーソルが入る位置を薄い線で出す
const hoverLine=h('div','hover-cursor');
sheet.addEventListener('pointermove',e=>{
  if(e.buttons||player.isPlaying()){hoverLine.remove();return;}
  const lane=e.target.closest?.('.lane'), hit=lane&&hitBar(e.clientX,e.clientY);
  if(!hit){hoverLine.remove();return;}
  const st=snapOf(hit.b.meter), pos=Math.min(hit.b.ticks-st,Math.round(hit.tick/st)*st);
  if(hoverLine.parentNode!==lane)lane.appendChild(hoverLine);
  hoverLine.style.left=pos/hit.b.ticks*100+'%';
  hoverLine.title=fmtPos(hit.b.gi,pos);
});
sheet.addEventListener('pointerleave',()=>hoverLine.remove());

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
// セクションの移動：色の棒をつかんで上下に。落とす位置（セクションの間）に線を出す。
// シートの上端・下端に近づけると自動でスクロールする。Esc で取り消し
function startSectionDrag(e,si){
  const secs=[...sheet.querySelectorAll('.sec')], me=secs[si], s=song.sections[si];
  const line=h('div','sec-drop');sheet.appendChild(line);
  me.classList.add('dragging');document.body.classList.add('grabbing');
  ghost.hidden=false;ghost.textContent=`「${s.name}」を移動`;
  let target=si, y=e.clientY, raf=0, cancelled=false;
  const place=()=>{
    const sr=sheet.getBoundingClientRect(), k=sr.height/sheet.clientHeight;
    // 落とす位置：ポインタより下にある最初のセクションの前（どれも上なら最後）
    target=secs.length;
    for(let i=0;i<secs.length;i++){const r=secs[i].getBoundingClientRect();if(y<r.top+r.height/2){target=i;break;}}
    const ref=secs[target]??secs.at(-1), rr=ref.getBoundingClientRect();
    const top=(target<secs.length?rr.top-5:rr.bottom+3)-sr.top+sheet.scrollTop*k;
    line.style.top=top/k+'px';
    line.hidden=target===si||target===si+1;   // 今の位置と同じなら線を出さない
  };
  let tabTarget=-1, tabX=0;
  const tick=()=>{
    // 別の曲のタブの上：そのタブを光らせ、シートの線は隠す（放すとその曲の最後へ）
    const over=document.elementFromPoint(tabX,y)?.closest?.('#tabs .tab');
    const ti=over?[...document.querySelectorAll('#tabs .tab')].indexOf(over):-1;
    tabTarget=ti>=0&&ti!==active?ti:-1;
    document.querySelectorAll('#tabs .tab').forEach((t,i)=>t.classList.toggle('drop-target',i===tabTarget));
    if(tabTarget>=0){line.hidden=true;ghost.textContent=`「${s.name}」を「${docs[tabTarget].song.title}」の最後へ${copyKey?'コピー':'移動'}`;raf=requestAnimationFrame(tick);return;}
    ghost.textContent=`「${s.name}」を移動`;
    const sr=sheet.getBoundingClientRect(), edge=40*sr.height/sheet.clientHeight;
    if(y<sr.top+edge)sheet.scrollTop-=12;else if(y>sr.bottom-edge)sheet.scrollTop+=12;
    place();raf=requestAnimationFrame(tick);
  };
  let copyKey=false;
  const move=ev=>{y=ev.clientY;tabX=ev.clientX;copyKey=ev.altKey;ghost.style.left=ev.clientX+10+'px';ghost.style.top=ev.clientY+8+'px';place();};
  const end=()=>{
    cancelAnimationFrame(raf);removeEventListener('pointermove',move);removeEventListener('pointerup',up);removeEventListener('keydown',key,true);
    line.remove();me.classList.remove('dragging');document.body.classList.remove('grabbing');ghost.hidden=true;
  };
  const up=ev=>{
    if(ev&&ev.clientY!=null&&!cancelled){y=ev.clientY;place();}   // 素早く放したときも放した位置で決める
    const toTab=cancelled?-1:tabTarget;
    end();
    document.querySelectorAll('#tabs .tab.drop-target').forEach(t=>t.classList.remove('drop-target'));
    if(toTab>=0){moveSectionToTab(si,toTab,copyKey||!!ev?.altKey);return;}
    if(cancelled||target===si||target===si+1)return;
    const to=target>si?target-1:target;
    commit(()=>{const [x]=song.sections.splice(si,1);song.sections.splice(to,0,x);});
    const r=tl.secRanges[to];sel=null;range={from:r.from,to:r.to};cursor={gi:r.from,pos:0};render();scrollToBar(r.from);
  };
  const key=ev=>{if(ev.key==='Escape'){ev.stopPropagation();ev.preventDefault();cancelled=true;up();}};
  move(e);
  addEventListener('pointermove',move);addEventListener('pointerup',up);addEventListener('keydown',key,true);
  raf=requestAnimationFrame(tick);
}

// 別の曲（タブ）の最後へセクションを移動（copy ならコピー）。移動先・移動元のどちらでも元に戻せる
function moveSectionToTab(si,ti,copy){
  const d=docs[ti], name=song.sections[si].name;
  d.undo=d.undo||[];d.undo.push(JSON.stringify(d.song));d.redo=[];
  appendSectionFrom(song,si,d.song);d.dirty=true;
  if(copy)renderTabs();else{commit(()=>song.sections.splice(si,1));sel=null;range=null;}
  persist();
  toast(`「${name}」を「${d.song.title}」の最後に${copy?'コピー':'移動'}しました`);
}
// 画面の中の確認ダイアログ（choices：[{id,label,primary?,danger?}]）。選んだ id を返す（Esc・外を押したら 'cancel'）
function askDialog(message,choices){
  return new Promise(resolve=>{
    const wrap=h('div','dialog-wrap'), box=h('div','dialog');
    box.setAttribute('role','alertdialog');box.appendChild(h('p','dialog-msg',message));
    const row=h('div','dialog-btns');
    const done=v=>{wrap.remove();removeEventListener('keydown',key,true);resolve(v);};
    for(const c of choices){const b=h('button',(c.primary?'primary':'')+(c.danger?' danger':''),c.label);b.onclick=()=>done(c.id);row.appendChild(b);}
    box.appendChild(row);wrap.appendChild(box);document.body.appendChild(wrap);
    wrap.addEventListener('pointerdown',e=>{if(e.target===wrap)done('cancel');});
    const key=e=>{e.stopPropagation();if(e.key==='Escape'){e.preventDefault();done('cancel');}};
    addEventListener('keydown',key,true);
    (row.querySelector('.primary')||row.firstChild).focus();
  });
}
function toast(msg){
  let t=$('toast');if(!t){t=h('div','toast');t.id='toast';document.body.appendChild(t);}
  t.textContent=msg;t.classList.add('on');clearTimeout(t._timer);t._timer=setTimeout(()=>t.classList.remove('on'),2600);
}

// ブロック：クリックで選択＋試聴、ドラッグで移動（Alt でコピー）、右端で長さ
function startBlockDrag(e,blkEl){
  const si=+blkEl.dataset.si, id=blkEl.dataset.id, c=song.sections[si].chords.find(x=>x.id===id);if(!c)return;
  const p=placedChords(song,tl).find(x=>x.c.id===id);if(!p)return;
  const resizing=e.target.classList.contains('rs'), fromLeft=e.target.classList.contains('rsl');   // 右端＝長さ、左端＝頭の位置
  const hit0=hitBar(e.clientX,e.clientY), grab=hit0?hit0.b.start+hit0.tick-p.start:0;
  const x0=e.clientX,y0=e.clientY;let moved=false,target=null;
  // 選ぶと同時に、クリックした位置（スナップ）にカーソルを置く
  sel={si,id};range=null;editOpen=false;
  if(hit0){const st=snapOf(hit0.b.meter);cursor={gi:hit0.b.gi,pos:Math.min(hit0.b.ticks-st,Math.round(hit0.tick/st)*st)};}
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
      const st=snapOf(hit.b.meter);
      song=JSON.parse(base);
      if(fromLeft){
        // 頭：セクションの頭からの tick（ほかのセクションの上なら、その端で止まる）
        const secStart=tl.bars[tl.secRanges[si].from].start, at=hit.b.start+Math.round(hit.tick/st)*st;
        stretchChordStart(song,si,id,at-secStart,st,maxLen);
      }else{
        const end=hit.b.start+Math.max(st,Math.round(hit.tick/st)*st);
        stretchChord(song,si,id,end-p.start,st,maxLen);
      }
      tl=timeline(song);render();
      return;
    }
    ghost.hidden=false;ghost.textContent=nameOf(song,c,p.key)+(ev.altKey?'（コピー）':'');
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
    if(!moved){previewItem(c,p.key);editOpen=true;render();return;}
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
// テンポ・拍子・キーの変更欄。only（'tempo'｜'meter'｜'key'）を渡すとその項目だけ（上部の位置の表示から開くとき）
function openMarkPop(gi,pos,anchor,only=null){
  const b=tl.bars[gi];if(!b)return;
  const sec=song.sections[b.si], atStart=gi===0&&pos===0;
  const doTempo=!only||only==='tempo', doMeter=!only||only==='meter', doKey=!only||only==='key';
  const tm=sec.marks.find(m=>m.bar===b.bar&&m.bpm&&(m.pos||0)===pos), mm=sec.marks.find(m=>m.bar===b.bar&&m.meter);
  pop.innerHTML='';
  pop.appendChild(h('h4','',only==='tempo'?`テンポ（${fmtPos(gi,pos)} から）`:only==='meter'?`拍子（${gi+1}小節目から）`:only==='key'?`キー（${gi+1}小節目から）`:`${fmtPos(gi,pos)} からの変更`));
  const bpm=h('input','');bpm.type='number';bpm.min=MIN_BPM;bpm.max=MAX_BPM;
  bpm.value=atStart?song.bpm:tm?.bpm??'';bpm.placeholder=String(Math.round(tempoAt(tl.tempos,b.start+pos)));
  const posSel=h('select','');
  const bt=beatTicksOf(b.meter);
  for(let t=0;t<b.ticks;t+=bt/2)posSel.appendChild(Object.assign(h('option','',`${gi+1}.${beatSub(t,b.meter)}`),{value:t}));
  posSel.value=pos;posSel.disabled=atStart;
  const met=h('select','');met.appendChild(Object.assign(h('option','','変更なし'),{value:''}));
  for(const m of METERS)met.appendChild(Object.assign(h('option','',m.join('/')),{value:m.join('/')}));
  met.value=atStart?song.meter.join('/'):mm?mm.meter.join('/'):'';
  // キー（小節の頭）。曲の頭のキーは五度圏で変える
  const km=sec.marks.find(m=>m.bar===b.bar&&m.key);
  const keyS=h('select','');keyS.appendChild(Object.assign(h('option','','変更なし'),{value:''}));
  for(const m of ['major','minor'])for(let i=0;i<12;i++)keyS.appendChild(Object.assign(h('option','',(m==='major'?MAJ_LABEL[i]:MIN_LABEL[i])+(m==='major'?' メジャー':' マイナー')),{value:i+':'+m}));
  keyS.value=km?km.key.idx+':'+km.key.mode:'';keyS.disabled=gi===0;
  if(gi===0)keyS.title='曲の頭のキーは五度圏で変えます';
  const trans=h('input','');trans.type='checkbox';trans.checked=!ui.keepNames;
  const transL=h('label','chk');transL.append(trans,' 後ろのコードも移調する（度数を保つ）');
  transL.title='オン：最後のサビを1音上げる、など（コードも一緒に移る）。オフ：鳴る音はそのままで、度数だけ新しいキーに付け替える';
  if(doTempo)pop.append(h('span','lbl','テンポ ♩='),bpm,h('span','lbl','位置'),posSel);
  if(doMeter)pop.append(h('span','lbl','拍子（小節の頭）'),met);
  if(doKey)pop.append(h('span','lbl','キー（小節の頭）'),keyS,transL);
  pop.appendChild(h('p','note',only==='tempo'?'空欄にすると外します。上部の表示のテンポは、つかんで上下にドラッグしても変えられます。':
    only?'「変更なし」にすると外します。直前と同じ値にしたときもタグは消えます。':
    'テンポは半拍単位の位置で、拍子とキーは小節の頭で変えられます。空欄・「変更なし」にすると外します。直前と同じ値にしたときもタグは消えます。'));
  const btns=h('div','btns');
  const ok=h('button','tg','適用');ok.setAttribute('aria-pressed','true');
  const cancel=h('button','','閉じる');
  ok.onclick=()=>{
    const v=Math.round(+bpm.value), m=met.value?met.value.split('/').map(Number):null, p=+posSel.value;
    const clampBpm=x=>Math.min(MAX_BPM,Math.max(MIN_BPM,x));
    commit(()=>{
      // 出している項目だけを変える
      if(doTempo){
        if(atStart){if(v)song.bpm=clampBpm(v);}
        else{
          sec.marks=sec.marks.filter(x=>x!==tm&&!(x.bar===b.bar&&x.bpm&&(x.pos||0)===p));
          if(v)sec.marks.push({bar:b.bar,pos:p,bpm:clampBpm(v)});
        }
      }
      if(doMeter){
        if(atStart){if(m)song.meter=m;}
        else{sec.marks=sec.marks.filter(x=>x!==mm);if(m)sec.marks.push({bar:b.bar,pos:0,meter:m});}
      }
      if(doKey){
        const kv=keyS.value, nk=kv?{idx:+kv.split(':')[0],mode:kv.split(':')[1]}:null;
        if(gi>0&&(nk?!km||!sameKey(km.key,nk):!!km))setKeyMark(song,b.si,b.bar,nk,!trans.checked);
      }
      pruneMarks(song);   // 直前と同じ値になった変更点はタグごと消す
    });
    closePop();
  };
  cancel.onclick=closePop;
  btns.append(cancel,ok);pop.appendChild(btns);
  pop.hidden=false;
  const r=anchor.getBoundingClientRect();
  pop.style.left=Math.min(innerWidth-pop.offsetWidth-8,r.left)+'px';pop.style.top=Math.min(innerHeight-pop.offsetHeight-8,r.bottom+4)+'px';
  (doTempo?bpm:doMeter?met:keyS).focus();
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
// 選んだコードの編集パネル：ブロックのすぐ下（下に入らなければ上）に出す。
// ブロックをクリックしたとき（ドラッグでない）に開き、Esc・ほかの場所のクリック・× で閉じる。Enter で開き直す
let editOpen=false;
function chordEditor(p){
  const c=p.c, b=tl.bars.find(x=>p.start>=x.start&&p.start<x.start+x.ticks), kt=keyTonic(p.key), kf=isFlatKey(p.key.idx);
  const edit=mut=>commit(()=>{const cc=song.sections[sel.si].chords.find(x=>x.id===sel.id);mut(cc);});
  const box=h('div','chip-edit');box.setAttribute('role','dialog');box.setAttribute('aria-label','コードの編集');
  const opt=(s,text,value)=>s.appendChild(Object.assign(h('option','',text),{value}));
  const root=h('select','');for(let off=0;off<12;off++)opt(root,noteName(mod12(kt+off),kf),off);
  root.value=c.off;root.title='ルート';
  root.onchange=()=>{const d=+root.value-c.off;edit(cc=>{cc.off=+root.value;if(cc.boff!=null)cc.boff=mod12(cc.boff+d);delete cc.deg;});previewSel();};
  const q=h('select','');for(const k of QUALITIES)opt(q,k===''?'maj':CHORD[k].s,k);
  q.value=c.q;q.title='種類';q.onchange=()=>{edit(cc=>{cc.q=q.value;});previewSel();};
  // ベース：コード作成と同じく「/音名」、ルートと同じ音なら分数コードにしない
  const bass=h('select','');for(let off=0;off<12;off++)opt(bass,'/'+noteName(mod12(kt+off),kf),off);
  bass.value=c.boff??c.off;bass.title='ベース（ルートと同じなら分数コードにしない）';
  bass.onchange=()=>{edit(cc=>{if(+bass.value===cc.off)delete cc.boff;else cc.boff=+bass.value;});previewSel();};
  const close=h('button','x','×');close.title='閉じる（Esc）';close.onclick=()=>{editOpen=false;render();};
  const head=h('div','ce-row');
  head.append(h('b','ce-name',nameOf(song,c,p.key)),h('span','ce-deg',degOfItem(c)),h('span','spacer'),root,q,bass,close);
  const st=snapOf(b.meter), max=maxLenAt(p.start);
  const minus=h('button','','−'),plus=h('button','','＋');minus.title=plus.title='長さ（スナップ単位）';
  minus.onclick=()=>commit(()=>stretchChord(song,sel.si,sel.id,p.end-p.start-st,st,max));
  plus.onclick=()=>commit(()=>stretchChord(song,sel.si,sel.id,p.end-p.start+st,st,max));
  minus.disabled=p.end-p.start<=st;plus.disabled=p.end-p.start>=max;
  const secPat=song.sections[sel.si].pattern||song.pattern;
  const pat=h('select','blk-pat'+(c.pattern?' over':''));pat.title='このコードだけの MIDI パターン';
  opt(pat,`セクションと同じ（${patternById(secPat).short}）`,'');
  addPatternOptions(pat);
  pat.value=c.pattern||'';
  pat.onchange=()=>edit(cc=>{if(pat.value)cc.pattern=pat.value;else delete cc.pattern;});
  const dup=h('button','','複製');dup.title='すぐ後ろに同じコードを置く（⌘D）';dup.onclick=duplicateSel;
  const del=h('button','del','削除');del.title='このコードを消す（⌫）';del.onclick=deleteSel;
  const tail=h('div','ce-row');
  tail.append(h('span','lbl','長さ'),minus,h('b','ce-len',fmtLen(p.end-p.start,b.meter)),plus,h('span','lbl ce-gap','パターン'),pat,h('span','spacer'),dup,del);
  box.append(head,tail);
  return box;
}
function placeChordEditor(){
  if(!sel||!editOpen||player.isPlaying())return;
  const p=placedChords(song,tl).find(x=>x.c.id===sel.id), blk=sheet.querySelector(`.blk[data-id="${sel.id}"]:not(.cont)`);
  if(!p||!blk){editOpen=false;return;}
  const box=chordEditor(p);sheet.appendChild(box);
  const sr=sheet.getBoundingClientRect(), k=sr.width/sheet.offsetWidth, br=blk.getBoundingClientRect();
  const top=(br.bottom-sr.top)/k+sheet.scrollTop+4, above=(br.top-sr.top)/k+sheet.scrollTop-box.offsetHeight-4;
  const fitsBelow=top+box.offsetHeight<=sheet.scrollTop+sheet.clientHeight;
  box.style.top=(fitsBelow||above<sheet.scrollTop?top:above)+'px';
  box.style.left=Math.max(4,Math.min(sheet.clientWidth-box.offsetWidth-4,(br.left-sr.left)/k))+'px';
  if(!fitsBelow&&above<sheet.scrollTop)box.scrollIntoView({block:'nearest'});
}
// 下のバー：カーソル・範囲に対する小節とセクションの操作（使えないボタンは出さない）
function renderFooter(){
  const f=$('footer');f.innerHTML='';
  const group=(label,...items)=>{const g=h('div','fgroup');if(label)g.appendChild(h('span','flbl',label));g.append(...items);return g;};
  const btn=(text,title,fn)=>{const b=h('button','',text);b.title=title;b.onclick=fn;return b;};
  if(ui.view==='melody'){
    const b=tl.bars[cursor.gi], s=roll.selection();
    if(range)f.append(group(null,h('b','',rangeLabel(range)),h('span','fsub',`${range.to-range.from}小節を選択`)),
      group('範囲',btn('▶ ループ再生','この範囲を繰り返し再生',()=>{ui.loop=true;render();startPlay();})));
    else f.append(group(null,h('span','flbl','カーソル'),h('b','pos',b?fmtPos(cursor.gi,cursor.pos):'—')),
      group('ステップ入力',btn('休符','カーソルを入力の長さだけ進める（ステップ入力の休み）',()=>roll.stepRest())));
    if(s.count)f.append(group(null,h('span','fsub',`${s.count}音を選択`),
      btn('↑','半音上げる（↑、⇧↑でオクターブ）',()=>roll.onKey(new KeyboardEvent('keydown',{key:'ArrowUp'}))),
      btn('↓','半音下げる（↓、⇧↓でオクターブ）',()=>roll.onKey(new KeyboardEvent('keydown',{key:'ArrowDown'}))),
      btn(range?'範囲の音を消す':'消す','選んだ音をまとめて消す（⌫）',()=>roll.deleteSelection()),
      ...(s.count>=2?[btn('結合','選んだ音を1つにする（いちばん前の音の高さで、最初から最後まで）',()=>roll.joinSelection())]:[]),
      btn('クオンタイズ','選んだ音の頭と終わりをスナップ（'+(M_SNAPS.find(x=>x.id===ui.mSnap)?.name||'')+'）にそろえる（Q）',()=>roll.quantizeSelection()),
      btn('分割','選んだ音を2つに分ける（カーソルが音の中ならカーソルで、外なら真ん中で。⌘＋クリックでその位置）',()=>roll.splitSelection()),
      btn('選択を外す','（Esc）',()=>roll.onKey(new KeyboardEvent('keydown',{key:'Escape'})))));
    f.appendChild(h('span','fhint',ui.mTool==='select'
      ?'ドラッグで囲んで選ぶ（⇧で追加）・⌘ドラッグで音を置く・⌥ドラッグで複製・⌘クリックで分割'
      :'クリックで音を置く（右へ引くと長さ）・⌘ドラッグで囲んで選ぶ・⌥ドラッグで複製・⌘クリックで分割'));
    return;
  }
  if(range){
    const n=range.to-range.from;
    f.append(group(null,h('b','',rangeLabel(range)),h('span','fsub',`${n}小節を選択`)),
      group('範囲',btn('▶ ループ再生','この範囲を繰り返し再生',()=>{ui.loop=true;render();startPlay();}),btn('コピー','コードをコピー（⌘C）',copySel),btn('コードを消す','範囲のコードを消す（⌫）',deleteSel)),
      group('小節',btn('＋ 挿入',`選択範囲の前に${n}小節を入れる`,()=>insertBarsAtCursor(n)),btn('− 削除','選択範囲の小節を消す',()=>deleteRangeBars())));
  }else{
    const b=tl.bars[cursor.gi];
    f.append(group(null,h('span','flbl','カーソル'),h('b','pos',b?fmtPos(cursor.gi,cursor.pos):'—')),
      group('小節',btn('＋ 挿入','カーソルのある小節の前に1小節入れる',()=>insertBarsAtCursor(1)),btn('− 削除','カーソルのある小節を消す',()=>{range={from:cursor.gi,to:cursor.gi+1};deleteRangeBars();})));
    if(b&&b.bar>0)f.append(group('セクション',btn('✂ ここで分割','カーソルのある小節の頭でセクションを2つに分ける',splitAtCursor)));
  }
  if(clip)f.append(group(null,btn('貼り付け','コピーしたコードをカーソル（範囲の頭）から貼り付ける（⌘V）',pasteSel)));
  f.appendChild(h('span','fhint','テンポ・拍子・キーは小節番号をダブルクリック'));
}
function splitAtCursor(){
  const b=tl.bars[cursor.gi];if(!b||b.bar===0)return;
  commit(()=>splitSection(song,b.si,b.bar));
  sel=null;range=null;render();
  // 分けた後ろのセクションの名前をすぐ変えられるように
  const nameEl=sheet.querySelectorAll('.sec-name')[b.si+1];if(nameEl){nameEl.focus();nameEl.select();}
}
function previewSel(){const p=sel&&placedChords(song,tl).find(x=>x.c.id===sel.id);if(p)previewItem(p.c,p.key);}
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
  if((e.metaKey||e.ctrlKey)&&(e.key.toLowerCase()==='s'||e.key.toLowerCase()==='o')){
    e.preventDefault();
    if(e.key.toLowerCase()==='o')openFile();else if(e.shiftKey)saveFileAs();else saveFile();
    return;
  }
  if(e.target.closest?.('input,select,textarea')&&e.key!=='Escape')return;
  const mod=e.metaKey||e.ctrlKey, k=e.key.toLowerCase();
  if(mod&&k==='z'){e.preventDefault();e.shiftKey?redo():undo();return;}
  if(mod&&k==='y'){e.preventDefault();redo();return;}
  // メロディーの画面：音の操作（選択・移動・コピーなど）を先に。コードの操作（数字キー・コードの選択）はしない
  if(ui.view==='melody'&&$('printWrap').hidden){
    if(roll.onKey(e))return;
    if(mod)return;
    if(e.key===' '){e.preventDefault();rec?toggleRec():togglePlay();return;}
    if(k==='m'){e.preventDefault();toggleMute();return;}
    if(k==='r'){e.preventDefault();toggleRec();return;}
    if(e.key==='Home'){cursor={gi:0,pos:0};render();roll.reveal(0);return;}
    return;
  }
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
  if(e.key==='Escape'&&editOpen){editOpen=false;render();return;}
  if(e.key==='Enter'&&sel){e.preventDefault();editOpen=true;render();return;}
  if(e.key==='Escape'){sel=null;range=null;pop.hidden=true;render();return;}
  if(e.key==='Home'){cursor={gi:0,pos:0};sel=null;range=null;render();scrollToBar(0);return;}
  if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();deleteSel();return;}
  if(/^[1-7]$/.test(e.key)){e.preventDefault();sel=null;range=null;insertAtCursor(diaItems()[+e.key-1]);return;}
  if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();arrow(e.key==='ArrowRight'?1:-1,e.shiftKey,e.altKey);return;}
  if((e.key==='ArrowUp'||e.key==='ArrowDown')&&sel){
    e.preventDefault();const d=e.key==='ArrowUp'?1:-1;
    commit(()=>{const c=song.sections[sel.si].chords.find(x=>x.id===sel.id);c.off=mod12(c.off+d);if(c.boff!=null)c.boff=mod12(c.boff+d);});
    previewSel();
  }
});
function arrow(dir,shift,alt){
  const b=tl.bars[cursor.gi];if(!b)return;
  const st=snapOf(b.meter);
  if(sel){
    const p=placedChords(song,tl).find(x=>x.c.id===sel.id);if(!p)return;
    // ⌥⇧＋←→：頭の位置（終わりはそのまま）、⇧＋←→：長さ
    if(shift&&alt){const secStart=tl.bars[tl.secRanges[sel.si].from].start;commit(()=>stretchChordStart(song,sel.si,sel.id,p.start-secStart+dir*st,st,maxLenAt(p.start)));return;}
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
// メロディーの画面では「鳴らす」のオン／オフに従う（コードの画面ではいつも両方）
function audible(r){
  if(ui.view==='melody'){if(!ui.hearChords)r.notes=[];if(!ui.hearMelody)r.melody=[];}
  return r;
}
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
    render:()=>audible(renderSong(song,rangeTicks(tl,r))),
    loop:()=>ui.loop, countIn:ui.countIn?ui.countBars:0, metronome:()=>ui.metroOn?ui.metro:'off', timbre:()=>ui.timbre,melodyTimbre:()=>ui.mTimbre,
    onPos:(t,counting,cnt)=>onPos(t==null?null:playFrom+t,counting,cnt),
    onEnd:()=>{finishRec();playTick=null;playingId=null;render();}
  });
  render();
}
function togglePlay(){if(player.isPlaying()){player.stop();finishRec();progPreview=false;playTick=null;playingId=null;render();}else startPlay();}

/* ---------- リアルタイム録音（メロディー） ----------
   ● を押すと、カウントイン（設定どおり）のあとカーソルの小節（範囲があれば範囲）から再生しながら、MIDI 鍵盤で弾いた音を録る。
   今ある音には重ねる。止めたら（●・■・Space・曲の終わり）まとめて入れる（⌘Z 1回で戻せる）。クオンタイズはあとで（Q）。
   時刻：JUCE 版は C++ が MIDI を受けた瞬間の曲の位置（recNotes）、ブラウザは受けたときの WebAudio の時計 */
let rec=null;   // {from, to, tempos, notes:[{abs,len,n,v}], open:Map(音 → {abs,v})}
const nSetRec=nativeFn('setRecording');
function startRec(){
  if(player.isPlaying()){player.stop();finishRec();}
  if(ui.view!=='melody'){ui.view='melody';persist();}
  const rr=rangeTicks(tl,playRange());
  rec={from:rr.from,to:rr.to,tempos:renderSong(song,rr).tempos,notes:[],open:new Map()};
  nSetRec?.(true).catch(e=>console.error(e));
  roll.clearSelection();
  startPlay();
}
// 周の頭からの秒 → 曲の tick（ループなら周の中に折り返す。カウントイン中の負の時刻は範囲の頭より前）
function recAbs(sec){
  const len=rec.to-rec.from;
  if(sec<0)return rec.from+Math.round(sec*rec.tempos[0].bpm/60*PPQ);
  let t=secToTick(rec.tempos,sec);
  if(ui.loop&&len>0)t%=len;else t=Math.min(t,len);
  return rec.from+Math.round(t);
}
function recEvent(sec,n,v,on){
  if(!rec)return;
  const abs=recAbs(sec);
  if(on){recOff(n,abs);rec.open.set(n,{abs,v:Math.max(1,v)});}else recOff(n,abs);
}
function recOff(n,abs){
  const o=rec.open.get(n);if(!o)return;
  rec.open.delete(n);
  const end=abs>o.abs?abs:rec.to;   // ループで周をまたいだら周の終わりまで
  rec.notes.push({abs:o.abs,len:Math.max(20,end-o.abs),n,v:o.v});
}
function finishRec(){
  if(!rec)return;
  const cur=playTick??rec.to;
  for(const n of [...rec.open.keys()])recOff(n,Math.max(cur,(rec.open.get(n)?.abs??0)+20));
  nSetRec?.(false).catch(e=>console.error(e));
  // 範囲の頭より前（カウントイン中）に弾き始めた音は頭から。頭より前で終わった音は捨てる
  const got=rec.notes.map(x=>({...x,s:Math.max(x.abs,rec.from)})).filter(x=>x.abs+x.len>x.s);
  const r=rec;rec=null;
  roll.setRecNotes([]);
  if(got.length){commit(()=>{for(const x of got)addNote(song,tl,x.s,x.abs+x.len-x.s,x.n,{v:x.v});});toast(`${got.length}音を録音しました`);}
  else render();
}
function toggleRec(){
  if(rec){player.stop();finishRec();progPreview=false;playTick=null;playingId=null;render();return;}
  startRec();
}
$('recBtn').onclick=toggleRec;
onNative('recNotes',({events})=>{
  if(!rec||!Array.isArray(events))return;
  const s=player.playSession();
  for(let i=0;i+4<events.length;i+=5)if(events[i]===s)recEvent(events[i+1],events[i+2],events[i+3],!!events[i+4]);
});
// 録音中の表示：確定した音と、押している音（今の位置まで）
function recDisplay(abs){
  const list=rec.notes.map(x=>({start:Math.max(x.abs,rec.from),end:x.abs+x.len,midi:x.n}));
  for(const [n,o] of rec.open)list.push({start:Math.max(o.abs,rec.from),end:Math.max(abs,o.abs+20),midi:n});
  return list;
}
// カウントインの「•」：大きな拍（6/8 なら付点4分）で数える。8つを超えるなら今の小節の分だけ並べ、前に「2/2」のように小節を出す
function renderCountDots(disp,cnt,m){
  const {P,size}=player.pulsesOf(m);
  const n=cnt?.n??m[0], bars=Math.max(1,Math.round(n/m[0])), total=P*bars;
  const k=cnt&&cnt.beat>=0?Math.floor(cnt.beat/size):-1;
  const perBar=total>8, cur=perBar?Math.max(0,Math.floor(k/P)):0;
  const dots=perBar?P:total, lit=perBar?k-cur*P:k;
  const key='count:'+m.join('/')+':'+total+':'+k;
  if(lastPos===key)return;
  disp.innerHTML='';disp.classList.toggle('many',dots>4);disp.classList.toggle('tiny',perBar&&dots>5);   // 「2/2」＋6つ以上はさらに小さく
  if(perBar)disp.appendChild(h('span','cbar',`${cur+1}/${bars}`));
  for(let i=0;i<dots;i++)disp.appendChild(h('span','cdot'+(i<=lit?' on':''),'•'));
  lastPos=key;
}
// 開発用：拍子を変えずにカウントの表示を確かめる（例：__countDots({beat:5,n:12},[6,8])）
window.__countDots=(cnt,m)=>{const d=$('posDisp');d.classList.add('count');lastPos='';renderCountDots(d,cnt,m);return d;};
function onPos(abs,counting,cnt){
  const disp=$('posDisp');
  disp.classList.toggle('count',!!counting);
  // カウントイン：拍の数だけ「・」を並べ、鳴った拍まで赤くする
  if(abs==null){renderCountDots(disp,cnt,meterAt(tl.meters,playFrom));return;}
  playTick=abs;
  const b=tl.bars.find(x=>abs>=x.start&&abs<x.start+x.ticks)||tl.bars.at(-1);
  const s=fmtPos(b.gi,Math.floor((abs-b.start)/SIXTEENTH)*SIXTEENTH);
  if(s!==lastPos){disp.textContent=s;disp.classList.remove('many','tiny');lastPos=s;scrollToBar(b.gi);}
  renderLcd(abs);
  const p=placedChords(song,tl).find(x=>abs>=x.start&&abs<x.end);
  const id=p?.c.id??null;
  if(id!==playingId){
    playingId=id;
    sheet.querySelectorAll('.blk.playing').forEach(x=>x.classList.remove('playing'));
    if(id)sheet.querySelectorAll(`.blk[data-id="${id}"]`).forEach(x=>x.classList.add('playing'));
  }
  placePlayhead();
  if(ui.view==='melody')roll.setPlayhead(abs);
  if(rec)roll.setRecNotes(recDisplay(abs));
}
/* ---------- 位置の表示（テンポ・拍子・キー・位置・経過時間） ---------- */
// 再生中は再生位置、止まっているときはカーソル位置の値
const lcdTick=()=>playTick!=null&&player.isPlaying()?playTick:(tl.bars[cursor.gi]?.start??0)+cursor.pos;
let lcdLast='';
function renderLcd(t=lcdTick()){
  const b=barOf(Math.min(t,Math.max(0,tl.total-1)))||tl.bars[0];
  const bpm=tempoAt(tl.tempos,t), m=meterAt(tl.meters,t), k=b?b.key:song.key;
  const sec=tickToSec(tl.tempos,t), time=`${Math.floor(sec/60)}:${(sec%60).toFixed(1).padStart(4,'0')}`;
  const s=[bpm,m.join('/'),k.idx,k.mode,time].join('|');
  if(s===lcdLast)return;
  lcdLast=s;
  $('lcdBpm').textContent=(Math.round(bpm*10)/10).toFixed(1);
  $('lcdMeter').textContent=m.join('/');
  $('lcdKey').textContent=keyLabel(k);
  $('lcdTime').textContent=time;
  const kr=b?keyRegion(tl,b.gi):null;
  $('lcdKey').title=kr&&kr.mark?`キー（${kr.from+1}小節目から。押すと変更）`:'キー（曲の頭のキーは五度圏で変更）';
}
// 押すと、その値を決めている場所（曲の頭か、途中の変更点）を編集する
// テンポ：いま効いているテンポの出どころ（曲の頭 or 途中の変更点）
function tempoSource(t){
  let x=tl.tempos[0];for(const y of tl.tempos){if(y.tick>t)break;x=y;}
  if(x.tick===0){
    const b0=tl.bars[0], m0=b0&&song.sections[b0.si].marks.find(m=>m.bar===0&&m.bpm&&!(m.pos||0));
    return m0?{mark:m0,gi:0,pos:0}:{song:true,gi:0,pos:0};
  }
  const b=barOf(x.tick), pos=x.tick-b.start;
  return {mark:song.sections[b.si].marks.find(m=>m.bar===b.bar&&m.bpm&&(m.pos||0)===pos),gi:b.gi,pos};
}
// つかんで上下にドラッグ：上へ動かすと速く（3px で 1 BPM）。動かさずに離したらテンポだけの変更欄
$('lcdTempo').addEventListener('pointerdown',e=>{
  if(e.button!==0)return;
  e.preventDefault();
  const src=tempoSource(lcdTick()), y0=e.clientY, v0=src.song?song.bpm:src.mark.bpm, el=e.currentTarget;
  let dragging=false;
  const move=ev=>{
    const dy=y0-ev.clientY;
    if(!dragging&&Math.abs(dy)<3)return;
    if(!dragging){dragging=true;snapshot();document.body.classList.add('tempo-drag');}
    const v=Math.min(MAX_BPM,Math.max(MIN_BPM,Math.round(v0+dy/3)));
    const cur=src.song?song.bpm:src.mark.bpm;
    if(v===cur)return;
    if(src.song)song.bpm=v;else src.mark.bpm=v;
    tl=timeline(song);lcdLast='';renderLcd();renderSheet();player.refresh();
  };
  const up=()=>{
    removeEventListener('pointermove',move);removeEventListener('pointerup',up);
    document.body.classList.remove('tempo-drag');
    if(dragging){pruneMarks(song);changed();return;}   // 離したら確定（直前と同じ値になった変更点は消す）
    openMarkPop(src.gi,src.pos,el,'tempo');
  };
  addEventListener('pointermove',move);addEventListener('pointerup',up);
});
$('lcdMeter').onclick=e=>{
  const t=lcdTick();let x=tl.meters[0];for(const y of tl.meters){if(y.tick>t)break;x=y;}
  openMarkPop(x.gi||0,0,e.currentTarget,'meter');
};
$('lcdKey').onclick=e=>{
  const b=barOf(lcdTick())||tl.bars[0];if(!b)return;
  const kr=keyRegion(tl,b.gi);
  if(kr.mark)openMarkPop(kr.from,0,e.currentTarget,'key');else keySel.focus();
};

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
  const key=safeFileName(songKeyLabel().split('/')[0]), title=ascii(song.title);
  const part=ui.midiParts==='melody'?'Melody':ui.midiParts==='chords'&&hasMelody()?'Chords':'';   // メロディーがある曲でコードだけなら Chords
  return [key,title,label,part].filter(Boolean).join('_')+'.mid';
}
const hasMelody=()=>song.sections.some(s=>s.melody.length);
function currentExport(){
  if(range){
    const si=song.sections.findIndex((s,i)=>tl.secRanges[i].from===range.from&&tl.secRanges[i].to===range.to);
    return {r:range,si,label:si>=0?sectionFileLabel(song.sections[si],si):`Bar${range.from+1}-${range.to}`};
  }
  return {r:{from:0,to:tl.bars.length},si:-1,label:'Song'};
}
function smfFor(r,label){return buildSmf(renderSong(song,rangeTicks(tl,r)),`${song.title} ${label}`,ui.midiParts);}
const b64=bytes=>{let s='';for(const x of bytes)s+=String.fromCharCode(x);return btoa(s);};
// MIDI を DAW・デスクトップへドラッグする。SMF はここ（song.js）で作る。
// JUCE 版：押して少し動かしたら C++ の startMidiDragBytes（一時ファイルに書いて OS のファイルドラッグ）。WebView では HTML のドラッグは使えない
// ブラウザ：Chrome の DownloadURL
const nativeDrag=nativeFn('startMidiDragBytes'), nativeSaveMidi=nativeFn('saveMidiBytes');
function attachMidiDrag(el,getPayload){   // getPayload() → {name, bytes}
  if(!hasNative){
    el.draggable=true;
    el.addEventListener('dragstart',e=>{
      const {name,bytes}=getPayload();
      e.dataTransfer.setData('DownloadURL',`audio/midi:${name}:data:audio/midi;base64,${b64(bytes)}`);
      e.dataTransfer.effectAllowed='copy';
    });
    return;
  }
  el.draggable=false;
  el.addEventListener('mousedown',e=>{
    if(e.button!==0)return;
    e.preventDefault();
    const x0=e.clientX,y0=e.clientY;
    const cleanup=()=>{removeEventListener('mousemove',move);removeEventListener('mouseup',cleanup);};
    const move=ev=>{
      if(Math.hypot(ev.clientX-x0,ev.clientY-y0)<4)return;
      cleanup();
      const {name,bytes}=getPayload();
      nativeDrag({name,data:b64(bytes)}).then(r=>{if(String(r).startsWith('error'))toast('MIDI のドラッグを始められませんでした');}).catch(err=>console.error(err));
    };
    addEventListener('mousemove',move);addEventListener('mouseup',cleanup);
  });
}
function midiHandle(getRange,getLabel){
  const b=h('button','handle');
  attachMidiDrag(b,()=>{const label=getLabel();return {name:fileName(label),bytes:smfFor(getRange(),label)};});
  return b;
}
const dragSel=$('dragSel');
attachMidiDrag(dragSel,()=>{const {r,label}=currentExport();return {name:fileName(label),bytes:smfFor(r,label)};});
$('saveMidi').onclick=async()=>{
  const {r,label}=currentExport();
  if(nativeSaveMidi){   // JUCE 版：ネイティブの保存ダイアログ（拡張子が無ければ C++ で付ける）
    const res=String(await nativeSaveMidi({name:fileName(label),data:b64(smfFor(r,label))}).catch(()=>'error'));
    if(res.startsWith('saved:'))toast('MIDI を保存しました');else if(res.startsWith('error'))toast('MIDI を保存できませんでした');
    return;
  }
  const name=await askFileName(fileName(label),'.mid',$('saveMidi'));
  if(name)download(new Blob([smfFor(r,label)],{type:'audio/midi'}),name);
};
// 保存の名前を聞く。拡張子（ext）が無ければ付ける（withExtension）。取り消しなら null
function askFileName(def,ext,anchor){
  return new Promise(resolve=>{
    const base=def.toLowerCase().endsWith(ext)?def.slice(0,-ext.length):def;
    pop.innerHTML='';pop.appendChild(h('h4','','名前を付けて保存'));
    const input=h('input','save-name');input.type='text';input.value=base;input.setAttribute('aria-label','ファイル名');
    const row=h('div','save-row');row.append(input,h('span','ext',ext));
    pop.appendChild(row);
    pop.appendChild(h('p','note',`拡張子（${ext}）は付けなくても自動で付きます。`));
    const btns=h('div','btns'), ok=h('button','tg','保存'), cancel=h('button','','閉じる');ok.setAttribute('aria-pressed','true');
    const done=v=>{pop.hidden=true;resolve(v);};
    ok.onclick=()=>done(withExtension(input.value,ext,base||'ChordSketch'));
    cancel.onclick=()=>done(null);
    btns.append(cancel,ok);pop.appendChild(btns);
    pop.hidden=false;
    const rr=anchor.getBoundingClientRect();
    pop.style.left=Math.max(8,Math.min(innerWidth-pop.offsetWidth-8,rr.right-pop.offsetWidth))+'px';
    pop.style.top=Math.min(innerHeight-pop.offsetHeight-8,rr.bottom+4)+'px';
    input.focus();input.select();
    pop.onkeydown=e=>{e.stopPropagation();if(e.key==='Enter')ok.click();if(e.key==='Escape')cancel.click();};
  });
}
function download(blob,name){
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}

/* ---------- ファイル ---------- */
function markDirty(){dirty=true;renderFileState();renderTabs();}   // 保存していない変更あり
const fileMenu=$('fileMenu');
$('fileBtn').onclick=e=>{e.stopPropagation();$('themeMenu').hidden=true;$('metroMenu').hidden=true;fileMenu.hidden=!fileMenu.hidden;};
addEventListener('click',()=>{fileMenu.hidden=true;});
fileMenu.addEventListener('click',e=>{
  const act=e.target.closest('[data-act]')?.dataset.act;if(!act)return;
  fileMenu.hidden=true;
  if(act==='new')openInTab(newSong());
  if(act==='demo')openInTab(demoSong());
  if(act==='open')openFile();
  if(act==='save')saveFile();
  if(act==='saveas')saveFileAs();
});
// 上書き保存・名前を付けて保存。ブラウザでは File System Access API（Chrome など）があれば同じファイルに書き込む。
// 無ければ「名前を付けて保存」は名前を聞いてダウンロード、「上書き保存」は同じ名前でダウンロードし直す。
// JUCE 版はネイティブのダイアログとファイル（fileHandle はファイルのパスの文字列）
let fileHandle=docs[active]?.handle||null, songFile=docs[active]?.file||'', dirty=!!docs[active]?.dirty;
const nativeFile={open:nativeFn('songOpen'),saveAs:nativeFn('songSaveAs'),write:nativeFn('songWrite')};
const SONG_EXT='.chordsketch', PICK_TYPES=[{description:'ChordSketch の曲',accept:{'application/json':[SONG_EXT]}}];
const songJSON=()=>JSON.stringify({app:'ChordSketch',v:1,song},null,1);
async function writeHandle(hd){
  if(typeof hd==='string'){if(!await nativeFile.write({path:hd,text:songJSON()}))throw new Error('書き込めませんでした: '+hd);return;}
  const w=await hd.createWritable();await w.write(songJSON());await w.close();}
const pathOf=hd=>typeof hd==='string'?hd:'';   // JUCE 版のファイルのパス（ブラウザのハンドルは保存できない）
function setFile(name,handle){songFile=name;fileHandle=handle||null;dirty=false;persist();renderFileState();renderTabs();}
function renderFileState(){
  $('fileState').hidden=!dirty;
  $('fileBtn').title=`ファイル：${songFile||'（まだ保存していない曲）'}${dirty?'・保存していない変更あり':''}`;
}
async function saveFileAs(){
  const suggested=withExtension(songFile||song.title||'song',SONG_EXT);
  if(hasNative){
    const r=await nativeFile.saveAs({name:suggested,text:songJSON(),path:pathOf(fileHandle)}).catch(e=>{console.error(e);return null;});
    if(r?.path)setFile(r.name,r.path);else if(r!=='cancelled'){console.error(r);toast('保存できませんでした');}
    return;
  }
  if('showSaveFilePicker' in window){
    try{
      let hd=await showSaveFilePicker({suggestedName:suggested,types:PICK_TYPES});
      // 拡張子を付けずに名前を入れたときは付け直す（できるブラウザだけ）
      if(!hd.name.toLowerCase().endsWith(SONG_EXT)&&hd.move){try{await hd.move(withExtension(hd.name,SONG_EXT));}catch{}}
      await writeHandle(hd);setFile(hd.name,hd);
    }catch(e){if(e.name!=='AbortError'){console.error(e);toast('保存できませんでした');}}
    return;
  }
  const name=await askFileName(suggested,SONG_EXT,$('fileBtn'));if(!name)return;
  download(new Blob([songJSON()],{type:'application/json'}),name);setFile(name,null);
}
async function saveFile(){
  if(fileHandle){
    try{await writeHandle(fileHandle);setFile(songFile,fileHandle);return;}
    catch(e){console.error(e);if(hasNative){toast('上書き保存できませんでした。保存先を選び直してください');await saveFileAs();return;}}
  }
  if(!songFile||(hasNative||'showSaveFilePicker' in window)&&!fileHandle){await saveFileAs();return;}   // まだ保存していない、または書き込み先を忘れた
  download(new Blob([songJSON()],{type:'application/json'}),songFile);setFile(songFile,null);
}
async function openFile(){
  if(hasNative){
    const r=await nativeFile.open().catch(e=>{console.error(e);return null;});
    if(typeof r?.text!=='string'){if(r!=='cancelled'){console.error(r);toast('ファイルを開けませんでした');}return;}
    openNativeFile(r);
    return;
  }
  if('showOpenFilePicker' in window){
    try{const [hd]=await showOpenFilePicker({types:PICK_TYPES,multiple:false});loadSongText(await (await hd.getFile()).text(),hd.name,hd);}
    catch(e){if(e.name!=='AbortError')console.error(e);}
    return;
  }
  $('fileInput').click();
}
// JUCE 版で読んだファイル { path, name, text }。もう開いているならそのタブへ
function openNativeFile(r){
  const open=docs.findIndex((d,i)=>(i===active?fileHandle:d.handle)===r.path);
  if(open>=0){switchTab(open);toast('このファイルはもう開いています');return;}
  loadSongText(r.text,r.name,r.path);
}
// Finder・エクスプローラーでダブルクリックした曲ファイル（起動前に開いたものは takeOpenFiles でまとめて受け取る）
if(hasNative){
  const openList=list=>{for(const r of Array.isArray(list)?list:[])if(typeof r?.text==='string')openNativeFile(r);};
  nativeFn('takeOpenFiles')().then(openList).catch(e=>console.error(e));
  onNative('openFiles',openList);
}
function loadSongText(text,name,handle){
  try{const s=validSong(JSON.parse(text).song);if(!s)throw 0;openInTab(s,name,handle);}
  catch{toast('ChordSketch の曲ファイルとして読み込めませんでした');}
}
$('fileInput').addEventListener('change',async e=>{
  const f=e.target.files[0];e.target.value='';if(!f)return;
  loadSongText(await f.text(),f.name,null);
});
/* ---------- タブ ---------- */
// 表示中のタブの状態を docs にしまう／docs から出す
function stashDoc(){docs[active]={song,undo:undoStack,redo:redoStack,sel,cursor,range,scroll:sheet.scrollTop,handle:fileHandle,file:songFile,dirty};}
function loadDoc(i){
  const d=docs[i];active=i;
  song=d.song;undoStack=d.undo||[];redoStack=d.redo||[];sel=d.sel||null;cursor=d.cursor||{gi:0,pos:0};range=d.range||null;
  fileHandle=d.handle||null;songFile=d.file||'';dirty=!!d.dirty;editOpen=false;
  tl=timeline(song);fixSelection();rotateTo(curKey().idx,true);render();sheet.scrollTop=d.scroll||0;renderFileState();
}
function switchTab(i){
  if(i===active||!docs[i])return;
  player.stop();progPreview=false;playTick=null;playingId=null;
  stashDoc();loadDoc(i);persist();
}
// 何も入力していない新規の曲のタブ（ここに開くならタブを増やさない）
const pristine=()=>!dirty&&!songFile&&song.title===NEW_TITLE&&song.sections.every(s=>!s.chords.length);
function openInTab(s,name='',handle=null){
  player.stop();progPreview=false;playTick=null;playingId=null;
  if(!TABS||!pristine()){if(TABS){stashDoc();docs.push({});active=docs.length-1;}}
  docs[active]={song:s,file:name,handle,undo:[],redo:[],dirty:false};
  loadDoc(active);persist();
}
// 保存していない変更があれば、そのタブに切り替えてから「保存して閉じる／保存しないで閉じる／キャンセル」を聞く
// （JUCE の WebView は confirm() を出せないので、画面の中のダイアログにする）
async function closeTab(i){
  const d=i===active?{song,dirty}:docs[i];
  if(d.dirty){
    if(i!==active)switchTab(i);
    const choice=await askDialog(`「${song.title}」の変更を保存していません。`,[
      {id:'save',label:'保存して閉じる',primary:true},{id:'discard',label:'保存しないで閉じる',danger:true},{id:'cancel',label:'キャンセル'}]);
    if(choice==='cancel'||!choice)return;
    if(choice==='save'){await saveFile();if(dirty)return;}   // 保存を取り消したら閉じない
    i=active;
  }
  if(i===active)stashDoc();
  docs.splice(i,1);
  if(!docs.length)docs=[{song:newSong(),undo:[],redo:[]}];
  const next=Math.min(i<active?active-1:active,docs.length-1);
  player.stop();loadDoc(next);persist();
}
function renderTabs(){
  const bar=$('tabs');if(!bar)return;
  bar.hidden=!TABS;if(!TABS)return;
  bar.innerHTML='';
  docs.forEach((d,i)=>{
    const s=i===active?song:d.song, isDirty=i===active?dirty:d.dirty, file=i===active?songFile:d.file;
    const t=h('div','tab'+(i===active?' on':''));t.setAttribute('role','tab');t.setAttribute('aria-selected',i===active);
    t.title=(file||'まだ保存していない曲')+(isDirty?'・保存していない変更あり':'');
    t.append(h('span','tname',s.title||'無題'));
    if(isDirty)t.append(h('span','tdot','●'));
    const x=h('button','tclose','×');x.title='このタブを閉じる';x.setAttribute('aria-label','閉じる');
    x.onclick=e=>{e.stopPropagation();closeTab(i);};
    t.append(x);
    t.onclick=()=>switchTab(i);
    bar.appendChild(t);
  });
  const add=h('button','tadd','＋');add.title='新しい曲のタブを開く';add.onclick=()=>openInTab(newSong());
  bar.appendChild(add);
}

/* ---------- コード譜（印刷／PDF） ---------- */
// 食い：小節の終わりまで1拍未満のところから始まり、次の小節へ続くコード（コード譜では次の小節の頭に「<」付きで書く）
const barOf=abs=>tl.bars.find(x=>abs>=x.start&&abs<x.start+x.ticks);
function isAnti(p){
  const b=barOf(p.start);if(!b)return false;
  const be=b.start+b.ticks;
  return p.start>b.start&&be-p.start<beatTicksOf(b.meter)&&p.end>be;
}
// 印刷のプレビューを出したあとで、重なったコード名を詰める：まず文字を小さく（8pt まで）、それでも重なれば右へずらす
function layoutPrint(){
  const GAP=4;
  for(const cell of document.querySelectorAll('#print .pbar')){
    const boxes=[...cell.querySelectorAll('.pch')].sort((x,y)=>x.getBoundingClientRect().left-y.getBoundingClientRect().left);
    const cr=cell.getBoundingClientRect();
    for(let i=0;i<boxes.length;i++){
      const cur=boxes[i], prev=boxes[i-1], R=el=>el.getBoundingClientRect();
      const hitsPrev=()=>!!prev&&R(prev).right+GAP>R(cur).left, overRight=()=>R(cur).right>cr.right+1;
      const pt=el=>parseFloat(getComputedStyle(el).fontSize)*72/96;
      // 1. 小節の右からはみ出すなら右端にそろえる
      if(overRight()){cur.style.left='auto';cur.style.right='1mm';cur.style.paddingLeft='0';}
      // 2. 右端にそろえても入らなければ、後ろのコード名を小さくする（8pt まで）
      let size=pt(cur);
      while(overRight()&&size>8){size-=.5;cur.style.fontSize=size+'pt';}
      // 3. 前のコード名と重なるなら、大きいほうから交互に小さくして大きさをそろえる。それでも重なれば右へずらす
      let ps=prev?pt(prev):0;
      while(hitsPrev()&&(size>8||ps>8)){
        if(ps>=size&&ps>8){ps-=.5;prev.style.fontSize=ps+'pt';}else{size-=.5;cur.style.fontSize=size+'pt';}
      }
      if(hitsPrev()){cur.style.right='auto';cur.style.left=R(prev).right+GAP-cr.left+'px';}
    }
  }
}
let usedSync=false, usedAnti=false;
function buildPrint(){
  const pr=$('print');pr.innerHTML='';pr.classList.toggle('with-deg',$('prDeg').checked);usedSync=false;usedAnti=false;
  pr.appendChild(h('h2','',song.title));
  pr.appendChild(h('div','meta',`Key: ${songKeyLabel()}（${song.key.mode==='major'?'メジャー':'マイナー'}）　♩=${song.bpm}　${song.meter.join('/')}`));
  const pcs=placedChords(song,tl);
  song.sections.forEach((s,si)=>{
    const {from,to}=tl.secRanges[si];
    const ps=h('div','psec');ps.style.setProperty('--c',SECTION_COLORS[s.color%SECTION_COLORS.length]);
    ps.appendChild(h('div','plabel',s.name));
    for(let r=from;r<to;r+=4){
      const row=h('div','prow');
      for(let gi=r;gi<Math.min(r+4,to);gi++){
        const b=tl.bars[gi], cell=h('div','pbar'+(gi===Math.min(r+4,to)-1?' end':'')+(gi===tl.bars.length-1?' final':''));
        const marks=s.marks.filter(m=>m.bar===b.bar).sort((x,y)=>(y.key?2:y.meter?1:0)-(x.key?2:x.meter?1:0)).map(m=>m.key?`Key: ${keyLabel(m.key)}`:m.meter?m.meter.join('/'):`♩=${m.bpm}`);
        if(marks.length)cell.appendChild(h('span','pm',marks.join('  ')));
        if(gi===r)cell.appendChild(h('span','pn',String(gi+1)));
        // 小節の半分（偶数拍子）または各拍（奇数拍子）に小さな縦棒
        const n=b.meter[0];
        for(let k=1;k<n;k++)if(n%2?true:k===n/2){const t=h('span','ptick'+(n%2?' small':''));t.style.left=k/n*100+'%';cell.appendChild(t);}
        const be=b.start+b.ticks, items=[];
        for(const p of pcs){
          if(p.end<=b.start||p.start>=be)continue;
          if(isAnti(p)&&p.start>=b.start)continue;            // 食い：次の小節の頭に書く
          if(p.start<b.start){
            const pb=barOf(p.start);
            if(isAnti(p)&&pb&&pb.gi===b.gi-1)items.push({p,frac:0,anti:true});   // 前の小節から食い込んだコード
            else items.push({p,frac:0,cont:true});
          }else items.push({p,frac:(p.start-b.start)/b.ticks});
        }
        // 前からの続きは、小節の頭のほうで別のコードが始まるなら書かない
        const shown=items.filter(x=>!x.cont||!items.some(y=>!y.cont&&y.frac<.25));
        for(const x of shown){
          const box=h('span','pch'+(x.cont?' cont':'')+(x.anti?' anti':''));
          box.style.left=x.frac*100+'%';
          const name=h('span','pc',nameOf(song,x.p.c,x.p.key));
          if(x.anti)name.prepend(Object.assign(h('span','pa','<'),{title:'食い（前の小節から先に鳴る）'}));
          // シンコペーション：拍の裏から始まるコードの上に「＞」
          const sb=barOf(x.p.start);
          if(!x.cont&&sb&&(x.p.start-sb.start)%beatTicksOf(sb.meter)!==0){box.appendChild(Object.assign(h('span','psync','＞'),{title:'拍の裏から（シンコペーション）'}));usedSync=true;}
          if(x.anti)usedAnti=true;
          box.appendChild(name);
          if($('prDeg').checked&&!x.cont)box.appendChild(h('span','pd',degOfItem(x.p.c)));
          cell.appendChild(box);
        }
        row.appendChild(cell);
      }
      ps.appendChild(row);
    }
    pr.appendChild(ps);
  });
  // 記号の説明（使っているときだけ）
  if(usedSync||usedAnti){
    const lg=h('div','plegend');
    if(usedSync)lg.appendChild(h('span','','＞ 拍の裏から（シンコペーション）'));
    if(usedAnti)lg.appendChild(h('span','','< 前の小節から先に鳴る（食い）'));
    pr.querySelector('.meta').after(lg);
  }
}
$('printBtn').onclick=()=>{buildPrint();$('printWrap').hidden=false;layoutPrint();};
$('prDeg').onchange=()=>{buildPrint();layoutPrint();};
$('prClose').onclick=()=>{$('printWrap').hidden=true;};
// PDF のファイル名は document.title になる
// 印刷。JUCE 版の macOS の WebView は print() を扱わないので、C++ から OS の印刷画面を出す（PDF もそこから保存）
const nativePrint=nativeFn('printPage');
$('prGo').onclick=async()=>{
  // macOS は C++ が印刷画面を出す。Windows（WebView2）は JS の print() で印刷画面が出るので、false が返ったら print() を使う
  if(nativePrint&&await nativePrint({title:song.title||'ChordSketch'}).catch(()=>false))return;
  const t=document.title;document.title=song.title||'ChordSketch';print();document.title=t;
};

/* ---------- MIDI 鍵盤 ----------
   JUCE 版：C++ が鳴らし、押している鍵盤が "midiNotes" で届く（機器は「オプション → オーディオ／MIDI の設定」）。
   ブラウザ：Web MIDI で受けて WebAudio で鳴らす。
   どちらも押している音からコード名を出し、ステップ入力では全部離したときに一番多く押していた音のコードを入れる */
const held=new Set();let peak=[];
function setMidiStatus(s,on){const e=$('midiSt');e.textContent=s;e.classList.toggle('on',!!on);}
// 押している音が変わったとき（added：押した音、全部離したらステップ入力）
function heldChanged(){
  if(held.size>=peak.length)peak=[...held];
  if(!held.size){
    if(ui.step&&ui.view==='melody'&&peak.length)roll.stepInput([...peak].sort((a,b)=>a-b));   // メロディー：弾いた音（和音なら全部）
    else if(ui.step&&peak.length>=2){const d=detectChords(peak,1)[0];if(d)insertAtCursor({off:mod12(d.root-tonic()),q:d.q,...(d.bass!=null?{boff:mod12(d.bass-tonic())}:{})});}
    peak=[];
  }
  renderLive();
}
if(hasNative){
  setMidiStatus('設定の機器',true);$('midiSt').title='「オプション → オーディオ／MIDI の設定」で選んだ MIDI 機器';
  onNative('midiNotes',({notes})=>{
    const next=new Set(notes||[]);
    if(next.size===held.size&&[...next].every(n=>held.has(n)))return;
    held.clear();for(const n of next)held.add(n);
    heldChanged();
  });
}else if(navigator.requestMIDIAccess){
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
  if(t===0x90&&d2>0){held.add(d1);player.noteOn(d1,d2,liveTimbre());}
  else if(t===0x80||t===0x90){held.delete(d1);player.noteOff(d1);}
  else return;
  if(rec&&!hasNative){const sec=player.songSeconds();if(sec!=null)recEvent(sec,d1,d2,t===0x90&&d2>0);}
  heldChanged();
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
// メトロノームの種類のメニュー（「なし」はアイコンのオフで）
const metroMenu=$('metroMenu');
for(const m of player.METRONOMES.filter(x=>x.id!=='off'))metroMenu.appendChild(Object.assign(h('button','',m.name.replace(/^♪\s*/,'')),{value:m.id,role:'menuitemradio'}));
for(const t of player.TIMBRES)$('timbre').appendChild(Object.assign(h('option','',t.name),{value:t.id}));
// 保存してあった音色が今の環境（JUCE 版・ブラウザ）の選択肢に無ければピアノ
if(!player.TIMBRES.some(t=>t.id===ui.timbre))ui.timbre='piano';
// MIDI 鍵盤で弾く音の音色：メロディーの画面ではメロディーの音色
const liveTimbre=()=>ui.view==='melody'?ui.mTimbre:ui.timbre;
player.setLiveTimbre(liveTimbre());
addPatternOptions($('pattern'));
for(const [v,n] of INS_LENS)$('insLen').appendChild(Object.assign(h('option','',n),{value:v}));
for(const p of SECTION_PRESETS)$('secNames').appendChild(Object.assign(h('option'),{value:p.name}));
$('title').addEventListener('change',e=>commit(()=>{song.title=e.target.value.trim()||'無題';}));
$('title').addEventListener('keydown',e=>{if(e.key==='Enter')e.target.blur();});
$('pattern').addEventListener('change',e=>commit(()=>{song.pattern=e.target.value;}));
const uiSet=(k,v)=>{ui[k]=v;render();persist();};
$('metroBtn').onclick=()=>{uiSet('metroOn',!ui.metroOn);player.refresh();};
$('metroKind').onclick=e=>{e.stopPropagation();fileMenu.hidden=true;$('themeMenu').hidden=true;$('countMenu').hidden=true;metroMenu.hidden=!metroMenu.hidden;};
metroMenu.addEventListener('click',e=>{
  const v=e.target.closest('button')?.value;if(!v)return;
  ui.metroOn=true;uiSet('metro',v);player.refresh();metroMenu.hidden=true;   // 種類を選んだらオンにする
});
addEventListener('click',e=>{if(!e.target.closest('#metroMenu'))metroMenu.hidden=true;});
// カウントインの小節数（1小節／2小節）。選んだらオンにする
const countMenu=$('countMenu');
$('countKind').onclick=e=>{e.stopPropagation();fileMenu.hidden=true;metroMenu.hidden=true;$('themeMenu').hidden=true;countMenu.hidden=!countMenu.hidden;};
countMenu.addEventListener('click',e=>{const v=+e.target.closest('button')?.value;if(!v)return;ui.countIn=true;uiSet('countBars',v);countMenu.hidden=true;});
addEventListener('click',e=>{if(!e.target.closest('#countMenu'))countMenu.hidden=true;});
$('timbre').addEventListener('change',e=>{uiSet('timbre',e.target.value);player.setLiveTimbre(liveTimbre());player.refresh();});
$('insLen').addEventListener('change',e=>uiSet('insLen',e.target.value));
/* ---------- メロディー（ピアノロール） ---------- */
const roll=createRoll($('roll'),{
  song:()=>song, tl:()=>tl, ui,
  commit, changed:()=>render(),
  preview:m=>player.playNotes([m],ui.mTimbre,.45),
  chordName:p=>nameOf(song,p.c,p.key),
  cursorAbs:()=>(tl.bars[cursor.gi]?.start??0)+cursor.pos,
  // abs（曲の頭からの tick）にカーソルを置く。redraw=false なら描き直さない（呼んだ側が描く）
  setCursorAbs:(abs,redraw=true)=>{const b=tl.bars.find(x=>abs>=x.start&&abs<x.start+x.ticks)||tl.bars.at(-1);cursor={gi:b.gi,pos:Math.max(0,abs-b.start)};range=null;sel=null;if(redraw)render();},
  fmtPos:abs=>{const b=tl.bars.find(x=>abs>=x.start&&abs<x.start+x.ticks);return b?fmtPos(b.gi,abs-b.start):'';},
  playingChord:()=>playingId,
  range:()=>range,
  // 小節の範囲を選ぶ（null で外す）。コードの画面と同じ range なので、再生・MIDI のドラッグにも使う
  setRange:r=>{range=r?{...r,anchor:r.from}:null;if(r)cursor={gi:r.from,pos:0};sel=null;render();},
  focus:()=>$('roll').focus({preventScroll:true}),
  toast:m=>toast(m),
});
for(const x of M_SNAPS)$('mSnap').appendChild(Object.assign(h('option','',x.name),{value:x.id}));
for(const x of M_LENS)$('mLen').appendChild(Object.assign(h('option','',x.name),{value:x.id}));
for(const t of player.TIMBRES)$('mTimbre').appendChild(Object.assign(h('option','',t.name),{value:t.id}));
if(!player.TIMBRES.some(t=>t.id===ui.mTimbre))ui.mTimbre='square';
$('mSnap').addEventListener('change',e=>uiSet('mSnap',e.target.value));
$('mLen').addEventListener('change',e=>uiSet('mLen',e.target.value));
$('mTimbre').addEventListener('change',e=>{uiSet('mTimbre',e.target.value);player.setLiveTimbre(liveTimbre());player.refresh();player.playNotes([melodyBase(curKey())+7],ui.mTimbre,.5);});
$('midiParts').addEventListener('change',e=>uiSet('midiParts',e.target.value));
document.querySelectorAll('#zoomSeg button').forEach(b=>b.onclick=()=>uiSet('mZoom',+b.dataset.v));
document.querySelectorAll('#viewSeg button').forEach(b=>b.onclick=()=>{
  if(ui.view===b.dataset.v)return;
  if(rec){player.stop();finishRec();playTick=null;}
  roll.clearSelection();editOpen=false;uiSet('view',b.dataset.v);player.setLiveTimbre(liveTimbre());player.refresh();
  if(ui.view==='melody'){roll.reveal(roll?(tl.bars[cursor.gi]?.start??0)+cursor.pos:0);$('roll').focus({preventScroll:true});}else sheet.focus({preventScroll:true});
});
for(const id of ['hearChords','hearMelody'])$(id).onclick=()=>{uiSet(id,!ui[id]);player.refresh();};
for(const id of ['guideChord','guideScale'])$(id).onclick=()=>uiSet(id,!ui[id]);
document.querySelectorAll('#toolSeg button').forEach(b=>b.onclick=()=>uiSet('mTool',b.dataset.v));
// ⌘（Windows は Ctrl）を押しているあいだは、描く⇔選ぶを入れ替えて見せる（押したときの動きは roll.js の toolOf）
let toolFlip=false;
function renderTool(){
  const t=toolFlip?(ui.mTool==='select'?'draw':'select'):ui.mTool;
  document.querySelectorAll('#toolSeg button').forEach(b=>b.setAttribute('aria-pressed',b.dataset.v===t));
  $('roll').classList.toggle('select-tool',t==='select');
}
const setToolFlip=on=>{if(toolFlip!==on){toolFlip=on;renderTool();}};
addEventListener('keydown',e=>{if(e.key==='Meta'||e.key==='Control')setToolFlip(true);});
addEventListener('keyup',e=>{if(e.key==='Meta'||e.key==='Control')setToolFlip(false);});
addEventListener('blur',()=>setToolFlip(false));
$('countIn').onclick=()=>uiSet('countIn',!ui.countIn);
// ミュートは保存しない（開き直すと音が出る状態に戻る）
let muted=false;
function toggleMute(){muted=!muted;player.setMuted(muted);$('muteBtn').setAttribute('aria-pressed',muted);}
$('muteBtn').onclick=toggleMute;
$('loopBtn').onclick=()=>{uiSet('loop',!ui.loop);player.refresh();};   // JUCE 版は再生中の予定表にループの有無が入っている
$('stepBtn').onclick=()=>{uiSet('step',!ui.step);renderLive();};
$('keepNames').onclick=()=>uiSet('keepNames',!ui.keepNames);
$('bassBtn').onclick=()=>commit(()=>{song.bass=!song.bass;});
document.querySelectorAll('#snapSeg button').forEach(b=>b.onclick=()=>uiSet('snap',b.dataset.v));
// ボイシング（曲の設定なので元に戻せる。再生中ならすぐ反映）
document.querySelectorAll('#voicingSeg button').forEach(b=>b.onclick=()=>{if(song.voicing!==b.dataset.v){commit(()=>{song.voicing=b.dataset.v;});previewSel();}});
document.querySelectorAll('#areaSeg button').forEach(b=>b.onclick=()=>{if(song.guitarArea!==b.dataset.v){commit(()=>{song.guitarArea=b.dataset.v;});previewSel();}});
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
$('octUp').title='上声のオクターブ（ピアノ：0 = ルートが C3〜B3、ギター：0 = フォームのまま）';$('octBass').title='ベースのオクターブ（ピアノ：0 = C2〜B2、ギター：0 = 一番低い弦のまま）';

/* ---------- テーマ ---------- */
const THEMES=['light','dark','auto'], THEME_NAME={light:'☀',dark:'☾',auto:'◐'}, THEME_LABEL={light:'ライト',dark:'ダーク',auto:'自動'};
const dark=matchMedia('(prefers-color-scheme: dark)');
function applyTheme(){
  const t=ui.theme==='auto'?(dark.matches?'dark':'light'):ui.theme;
  document.documentElement.dataset.theme=t;$('themeBtn').textContent=THEME_NAME[ui.theme];
  $('themeBtn').title=`テーマ：${THEME_LABEL[ui.theme]}（押して選ぶ）`;
  document.querySelectorAll('#themeMenu button').forEach(b=>b.setAttribute('aria-checked',b.dataset.v===ui.theme));
}
// テーマはメニューから選ぶ（ライト／ダーク／自動）
const themeMenu=$('themeMenu');
$('themeBtn').onclick=e=>{e.stopPropagation();fileMenu.hidden=true;$('metroMenu').hidden=true;themeMenu.hidden=!themeMenu.hidden;};
themeMenu.addEventListener('click',e=>{
  // data-theme は使わない（[data-theme=dark] の配色がその要素に効いてしまう）
  const v=e.target.closest('[data-v]')?.dataset.v;if(!v)return;
  ui.theme=v;applyTheme();persist();themeMenu.hidden=true;
});
addEventListener('click',e=>{if(!e.target.closest('#themeMenu'))themeMenu.hidden=true;});
dark.addEventListener('change',applyTheme);

/* ---------- 描画 ---------- */
function render(){
  const pressed=(id,on)=>$(id).setAttribute('aria-pressed',!!on);
  $('title').value=song.title;
  pressed('metroBtn',ui.metroOn);
  const mk=player.METRONOMES.find(x=>x.id===ui.metro);
  $('metroBtn').title=`メトロノーム（試聴のみ）：${ui.metroOn?'オン':'オフ'}・${mk?mk.name.replace(/^♪\s*/,''):''}（押してオン／オフ、種類は ▾）`;
  metroMenu.querySelectorAll('button').forEach(b=>b.setAttribute('aria-checked',b.value===ui.metro));
  countMenu.querySelectorAll('button').forEach(b=>b.setAttribute('aria-checked',+b.value===ui.countBars));
  $('countIn').title=`カウントイン：${ui.countIn?'オン':'オフ'}・${ui.countBars}小節（押してオン／オフ、小節数は ▾）`;
  $('timbre').value=ui.timbre;$('pattern').value=song.pattern;$('insLen').value=ui.insLen;
  pressed('countIn',ui.countIn);pressed('loopBtn',ui.loop);pressed('stepBtn',ui.step);pressed('keepNames',ui.keepNames);pressed('bassBtn',song.bass);
  document.querySelectorAll('#snapSeg button').forEach(b=>b.setAttribute('aria-pressed',b.dataset.v===ui.snap));
  document.querySelectorAll('#rowSeg button').forEach(b=>b.setAttribute('aria-pressed',+b.dataset.v===ui.perRow));
  document.querySelectorAll('#voicingSeg button').forEach(b=>b.setAttribute('aria-pressed',b.dataset.v===song.voicing));
  document.querySelectorAll('#areaSeg button').forEach(b=>b.setAttribute('aria-pressed',b.dataset.v===song.guitarArea));
  $('areaSeg').hidden=song.voicing!=='guitar';
  $('recBtn').setAttribute('aria-pressed',!!rec);$('recBtn').classList.toggle('on',!!rec);
  const playing=player.isPlaying(), pb=$('playBtn');
  pb.textContent=playing?'■':'▶';pb.setAttribute('aria-label',playing?'停止':'再生');pb.classList.toggle('on',playing);
  if(!playing){$('posDisp').textContent=fmtPos(cursor.gi,cursor.pos)||'1.1.1';$('posDisp').classList.remove('count');lastPos='';}
  renderLcd();
  $('undo').disabled=!undoStack.length;$('redo').disabled=!redoStack.length;
  const ck=curKey(), kr=keyRegion(tl,cursor.gi);
  scaleSel.value=keyScale(ck);
  scaleSel.title=`スケール（${kr.from>0?kr.from+1+'小節目から':'曲の頭から'}）：7音のスケールでは、ダイアトニックとプリセットをそのスケールで作り直す`;
  keySel.value=ck.idx+':'+ck.mode;
  keySel.title=kr.from>0?`${kr.from+1}小節目からのキー（カーソルのある場所）`:'曲の頭のキー（途中で転調しているときはカーソルのある場所のキー）';
  cKey.textContent=keyLabel(ck);cSig.textContent=SIG[ck.idx];
  // 中央の下の行：モード（既定と違うスケールならスケール名。長い名前は「（」の前まで）と、途中のキーなら範囲の頭
  const scName=keyScale(ck)!==defaultScale(ck.mode)?scaleById(keyScale(ck)).name.split('（')[0]:(ck.mode==='major'?'メジャー':'マイナー');
  cMode.textContent=scName+(kr.from>0?`・${kr.from+1}小節〜`:'');
  drawOverlay();
  if(wheel.target!==ck.idx)rotateTo(ck.idx);   // 元に戻す・ファイルを開く・タブの切り替えでキーが変わったときも回す
  renderOctUp();renderOctBass();
  const ex=currentExport();
  $('dragLabel').textContent=!range?'曲全体':ex.si>=0?`「${song.sections[ex.si].name}」`:rangeLabel(range);
  const mel=ui.view==='melody';
  $('stage').querySelector('.main').classList.toggle('melody',mel);
  document.querySelectorAll('#viewSeg button').forEach(b=>b.setAttribute('aria-pressed',b.dataset.v===ui.view));
  sheet.hidden=mel;$('roll').hidden=!mel;
  $('mSnap').value=ui.mSnap;$('mLen').value=ui.mLen;$('mTimbre').value=ui.mTimbre;$('midiParts').value=ui.midiParts;
  document.querySelectorAll('#zoomSeg button').forEach(b=>b.setAttribute('aria-pressed',+b.dataset.v===ui.mZoom));
  renderTool();
  pressed('hearChords',ui.hearChords);pressed('hearMelody',ui.hearMelody);pressed('guideChord',ui.guideChord);pressed('guideScale',ui.guideScale);
  renderPalette();renderProg();
  if(mel)roll.render();else renderSheet();
  renderFooter();renderTabs();
}

/* ---------- 画面の拡大縮小（スクロールなし、ChordNavi と同じ） ---------- */
// 画面をウィンドウに合わせて拡大縮小する。横幅は 1280 を基準にし、ウィンドウが基準（1280×780）より縦長なら
// 余った高さの分だけ画面を縦に伸ばす（シートが広がる）。横長なら縦に合わせて左右に余白を出す。
// 文字がにじまないよう、拡大率が 1 にほぼ等しいときはちょうど 1 にし、位置は整数のピクセルにそろえる
// （JUCE 版の macOS は WebView のページのズームで拡大縮小するので、ここでは倍率 1 になる）
const BASE_W=1280, BASE_H=780;
function fit(){
  let s=Math.min(innerWidth/BASE_W,innerHeight/BASE_H);
  if(Math.abs(s-1)<.015)s=1;
  const h=Math.max(BASE_H,Math.floor(innerHeight/s));
  const x=Math.round((innerWidth-BASE_W*s)/2), y=Math.round((innerHeight-h*s)/2);
  const st=$('stage');
  st.style.height=h+'px';
  st.style.transform=`translate(${Math.max(0,x)}px,${Math.max(0,y)}px) scale(${s})`;
}
addEventListener('resize',()=>{fit();if(ui.view==='melody')roll.render();else renderSheet();});
fit();applyTheme();rotateTo(curKey().idx,true);render();renderLive();renderFileState();
