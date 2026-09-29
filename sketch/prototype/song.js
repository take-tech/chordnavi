/* ChordSketch：曲データと MIDI 生成の純粋関数（UI コードは置かない）
   音楽理論（コード・表記・判別）は ChordNavi の ui/theory.js を共有する */
import {CHORD,chordAt,chordName as chordNameOf,tonicOf,isFlatKey,mod12} from '../../ui/theory.js';

export const PPQ=480, WHOLE=PPQ*4;
export const barTicksOf=([n,d])=>n*WHOLE/d;
export const beatTicksOf=([,d])=>WHOLE/d;
export const METERS=[[4,4],[3,4],[2,4],[5,4],[6,4],[6,8],[7,8],[9,8],[12,8]];
export const MIN_BPM=20, MAX_BPM=300;

// スナップ：1小節／1拍／半拍（シンコペーション・食いのコード用）
export const SNAPS=[{id:'bar',name:'1小節'},{id:'beat',name:'1拍'},{id:'half',name:'半拍'}];
export const snapTicks=(snap,meter)=>snap==='bar'?barTicksOf(meter):snap==='beat'?beatTicksOf(meter):beatTicksOf(meter)/2;

/* ---------- セクション ---------- */
export const SECTION_COLORS=['#7A869A','#2E8C80','#3D7CC9','#C4456A','#E3A21A','#6B4FBB','#D9733A','#4E7A3A'];
export const SECTION_PRESETS=[
  {name:'Intro',color:0},{name:'Aメロ',color:1},{name:'Bメロ',color:2},{name:'サビ',color:3},
  {name:'間奏',color:4},{name:'Cメロ',color:5},{name:'落ちサビ',color:6},{name:'Outro',color:7}
];
const uid=()=>Math.random().toString(36).slice(2,10);
export const newSection=(name='Aメロ',color=1,bars=8)=>({id:uid(),name,color,bars,pattern:null,chords:[],marks:[]});
export const newChord=(bar,pos,len,off,q,boff)=>({id:uid(),bar,pos,len,off,q,...(boff!=null?{boff}:{})});
export const cloneSection=s=>({...structuredClone(s),id:uid(),chords:s.chords.map(c=>({...c,id:uid()}))});

export function newSong(){
  return {v:1,title:'新しい曲',key:{idx:0,mode:'major'},bpm:120,meter:[4,4],
    pattern:'whole',octave:0,bassOctave:0,bass:true,sections:[newSection('Aメロ',1,8)]};
}

// 最初に開いたときのサンプル（Intro 4・Aメロ 8・サビ 8）。
// 2拍ずつのコード、サビ前の食い（Aメロ最後の半拍から FM7、サビ頭の FM7 とタイでつながる）、サビのテンポ変更を含む
export function demoSong(){
  const s=newSong();s.title='サンプル';
  const B=barTicksOf([4,4]), H=B/2, E=PPQ/2;
  const mk=list=>list.map(x=>newChord(...x));
  const intro=newSection('Intro',0,4), a=newSection('Aメロ',1,8), sabi=newSection('サビ',3,8);
  intro.chords=mk([[0,0,B,5,'M7'],[1,0,B,7,''],[2,0,B,4,'m7'],[3,0,B,9,'m7']]);
  a.chords=mk([[0,0,B,0,''],[1,0,B,7,'',11],[2,0,B,9,'m'],[3,0,B,4,'m',7],[4,0,B,5,''],[5,0,B,0,'',4],
    [6,0,H,2,'m7'],[6,H,H,7,'7'],[7,0,B-E,7,'sus4'],[7,B-E,E,5,'M7']]);
  sabi.chords=mk([[0,0,B,5,'M7'],[1,0,B,7,'7'],[2,0,B,4,'m7'],[3,0,B,9,'m7'],[4,0,B,5,'M7'],[5,0,B,7,'7'],[6,0,B,0,''],[7,0,B,0,'']]);
  sabi.pattern='eighth';
  sabi.marks=[{bar:0,pos:0,bpm:124}];
  s.sections=[intro,a,sabi];
  return s;
}

/* ---------- タイムライン（小節の位置・テンポ・拍子） ---------- */
// 拍子の変更は小節の頭、テンポの変更は任意の位置（pos は小節内の tick）。セクションの並び順に流れる
export function timeline(song){
  const bars=[],secRanges=[],meters=[];let tempos=[{tick:0,bpm:song.bpm}];
  let meter=song.meter,tick=0;
  song.sections.forEach((s,si)=>{
    const from=bars.length;
    for(let b=0;b<s.bars;b++){
      const mm=s.marks.find(m=>m.bar===b&&m.meter);
      if(mm)meter=mm.meter;
      const t=barTicksOf(meter);
      if(!meters.length||meters.at(-1).meter.join('/')!==meter.join('/'))meters.push({tick,meter,gi:bars.length});
      bars.push({si,bar:b,start:tick,ticks:t,meter,gi:bars.length});
      for(const m of s.marks)if(m.bar===b&&m.bpm)tempos.push({tick:tick+Math.min(m.pos||0,t-1),bpm:m.bpm});
      tick+=t;
    }
    secRanges.push({from,to:bars.length});
  });
  if(!meters.length)meters.push({tick:0,meter:song.meter,gi:0});
  // 同じ位置のテンポは後のものを使う
  tempos=tempos.sort((a,b)=>a.tick-b.tick).filter((x,i,a)=>i===a.length-1||a[i+1].tick!==x.tick);
  return {bars,secRanges,tempos,meters,total:tick};
}
export const tempoAt=(tempos,tick)=>{let b=tempos[0].bpm;for(const x of tempos){if(x.tick>tick)break;b=x.bpm;}return b;};
export const meterAt=(meters,tick)=>{let m=meters[0].meter;for(const x of meters){if(x.tick>tick)break;m=x.meter;}return m;};
// tick → 秒（テンポの変化を積分）
export function tickToSec(tempos,tick){
  let sec=0,prev=0,bpm=tempos[0].bpm;
  for(const x of tempos){
    if(x.tick>=tick)break;
    sec+=(x.tick-prev)*60/(bpm*PPQ);prev=x.tick;bpm=x.bpm;
  }
  return sec+(tick-prev)*60/(bpm*PPQ);
}
export function secToTick(tempos,sec){
  let acc=0,prev=0,bpm=tempos[0].bpm;
  for(const x of tempos){
    const d=(x.tick-prev)*60/(bpm*PPQ);
    if(acc+d>sec)break;
    acc+=d;prev=x.tick;bpm=x.bpm;
  }
  return prev+(sec-acc)*bpm*PPQ/60;
}

/* ---------- セクション内の位置（小節・小節内 tick ⇔ セクション先頭からの tick） ---------- */
export function secGeom(tl,si){
  const {from,to}=tl.secRanges[si], bars=tl.bars.slice(from,to);
  const base=bars.length?bars[0].start:0;
  return {
    bars, len:bars.length?bars.at(-1).start+bars.at(-1).ticks-base:0,
    toLocal:(bar,pos)=>bars[bar].start-base+Math.min(pos,bars[bar].ticks),
    fromLocal:t=>{
      for(let i=bars.length-1;i>=0;i--)if(bars[i].start-base<=t)return {bar:i,pos:t-(bars[i].start-base)};
      return {bar:0,pos:0};
    }
  };
}

// 曲の中のコード（位置は曲の先頭からの tick）。重なっていたら前のコードを次のコードの頭で切る
export function placedChords(song,tl=timeline(song)){
  const t=tonicOf(song.key.idx,song.key.mode), out=[];
  song.sections.forEach((s,si)=>{
    const {from,to}=tl.secRanges[si];if(from===to)return;
    const secEnd=tl.bars[to-1].start+tl.bars[to-1].ticks;
    for(const c of s.chords){
      if(c.bar>=s.bars)continue;
      const b=tl.bars[from+c.bar], start=b.start+Math.min(c.pos,b.ticks-1), end=Math.min(start+c.len,secEnd);
      if(end>start)out.push({c,si,start,end,ch:chordAt(t,[c.off,c.q,c.boff]),pattern:s.pattern||song.pattern});
    }
  });
  out.sort((a,b)=>a.start-b.start);
  for(let i=0;i<out.length-1;i++)out[i].end=Math.min(out[i].end,out[i+1].start);
  return out;
}

export const songTonic=song=>tonicOf(song.key.idx,song.key.mode);
export const songFlat=song=>isFlatKey(song.key.idx);
export const chordOf=(song,c)=>chordAt(songTonic(song),[c.off,c.q,c.boff]);
export const nameOf=(song,c)=>chordNameOf(chordOf(song,c),songFlat(song),songTonic(song));

/* ---------- 編集（song を直接書き換える） ---------- */
// セクションに置く。重なる範囲は上書き（前のコードは切る・前後に分ける、後ろのコードは頭を削る、中に収まるコードは消す）
export function placeChord(song,si,chord){
  const tl=timeline(song), g=secGeom(tl,si), sec=song.sections[si];
  const s=g.toLocal(chord.bar,chord.pos), e=Math.min(s+chord.len,g.len);
  if(e<=s)return null;
  const kept=[];
  for(const c of sec.chords){
    if(c.id===chord.id)continue;
    const a=g.toLocal(c.bar,c.pos), b=a+c.len;
    if(b<=s||a>=e){kept.push(c);continue;}
    if(a<s){
      kept.push({...c,len:s-a});
      if(b>e)kept.push({...c,id:uid(),...g.fromLocal(e),len:b-e});   // 長いコードの途中に置いたときは前後に分ける
      continue;
    }
    if(b>e){const p=g.fromLocal(e);kept.push({...c,...p,len:b-e});}
  }
  const p=g.fromLocal(s), placed={...chord,...p,len:e-s};
  sec.chords=[...kept,placed].sort((x,y)=>g.toLocal(x.bar,x.pos)-g.toLocal(y.bar,y.pos));
  return placed;
}
export function removeChord(song,si,id){const s=song.sections[si];s.chords=s.chords.filter(c=>c.id!==id);}
// 長さの変更：次のコードの頭とセクションの終わりまで
export function resizeChord(song,si,id,len,minLen){
  const tl=timeline(song), g=secGeom(tl,si), sec=song.sections[si], c=sec.chords.find(x=>x.id===id);
  if(!c)return;
  const a=g.toLocal(c.bar,c.pos);
  const next=Math.min(g.len,...sec.chords.filter(x=>x.id!==id).map(x=>g.toLocal(x.bar,x.pos)).filter(t=>t>a));
  c.len=Math.max(minLen,Math.min(len,next-a));
}
// セクションの小節数を変える。はみ出したコード・マークは消す（長さは切る）
export function setSectionBars(song,si,n){
  const sec=song.sections[si];n=Math.max(1,Math.min(128,n));
  sec.bars=n;
  sec.chords=sec.chords.filter(c=>c.bar<n);
  sec.marks=sec.marks.filter(m=>m.bar<n);
}
// bar の前に count 小節を入れる（負なら bar から削除）
export function insertBars(song,si,bar,count){
  const sec=song.sections[si];
  if(count>0){
    sec.bars+=count;
    for(const c of sec.chords)if(c.bar>=bar)c.bar+=count;
    for(const m of sec.marks)if(m.bar>=bar)m.bar+=count;
  }else if(count<0){
    const n=Math.min(-count,sec.bars-bar);if(n<=0||sec.bars-n<1)return;
    sec.bars-=n;
    sec.chords=sec.chords.filter(c=>c.bar<bar||c.bar>=bar+n);
    sec.marks=sec.marks.filter(m=>m.bar<bar||m.bar>=bar+n);
    for(const c of sec.chords)if(c.bar>=bar+n)c.bar-=n;
    for(const m of sec.marks)if(m.bar>=bar+n)m.bar-=n;
  }
}
// テンポ・拍子の変更点。bpm・meter が null ならその指定を外す。拍子は小節の頭のみ
export function setMark(song,si,bar,pos,{bpm,meter}){
  const sec=song.sections[si];
  const tempo=sec.marks.find(m=>m.bar===bar&&m.bpm&&(m.pos||0)===pos), met=sec.marks.find(m=>m.bar===bar&&m.meter);
  sec.marks=sec.marks.filter(m=>m!==tempo&&m!==met);
  if(bpm)sec.marks.push({bar,pos,bpm:Math.min(MAX_BPM,Math.max(MIN_BPM,bpm))});
  if(meter)sec.marks.push({bar,pos:0,meter});
}

/* ---------- 範囲（小節番号は曲全体の通し番号） ---------- */
export const rangeTicks=(tl,{from,to})=>({from:tl.bars[from]?.start??0,to:to>=tl.bars.length?tl.total:tl.bars[to].start});

// コピー：範囲の小節のコードを、範囲の先頭からの tick で持つ
export function copyRange(song,{from,to}){
  const tl=timeline(song), r=rangeTicks(tl,{from,to});
  return {len:r.to-r.from,chords:placedChords(song,tl).filter(p=>p.end>r.from&&p.start<r.to).map(p=>{
    const s=Math.max(p.start,r.from);return {at:s-r.from,len:Math.min(p.end,r.to)-s,off:p.c.off,q:p.c.q,boff:p.c.boff};
  })};
}
// 貼り付け：曲の中の origin（tick）から上書き（セクションをまたぐときはそれぞれのセクションに置く）
export function pasteAt(song,origin,clip){
  for(const x of clip.chords){
    const tl=timeline(song), abs=origin+x.at, bar=tl.bars.find(b=>abs>=b.start&&abs<b.start+b.ticks);
    if(!bar)continue;
    placeChord(song,bar.si,newChord(bar.bar,abs-bar.start,x.len,x.off,x.q,x.boff));
  }
}

/* ---------- MIDI パターン ---------- */
// t・d は tick（4分音符＝480）。1小節ぶん（1920）を1周として小節の頭から繰り返し、小節の終わりで切る。
// part：bass（ベース）／chord（上声すべて）／arp（上声の i 番目。数が足りなければ1オクターブ上に折り返す）。acc はアクセント
const each=(ts,f)=>ts.flatMap(f);
export const PATTERNS=[
  {id:'whole',name:'全音符',ev:[{t:0,d:1920,part:'bass'},{t:0,d:1920,part:'chord'}]},
  {id:'half',name:'2分音符',ev:each([0,960],t=>[{t,d:940,part:'bass'},{t,d:940,part:'chord'}])},
  {id:'quarter',name:'4分刻み',ev:[{t:0,d:1900,part:'bass'},...[0,480,960,1440].map(t=>({t,d:430,part:'chord',acc:t%960===0}))]},
  {id:'eighth',name:'8分刻み',ev:each([0,240,480,720,960,1200,1440,1680],t=>[{t,d:210,part:'bass',acc:t%480===0},{t,d:210,part:'chord',acc:t%480===0}])},
  {id:'pop',name:'ポップ（ベース＋裏拍）',ev:[{t:0,d:900,part:'bass'},{t:960,d:900,part:'bass'},{t:0,d:440,part:'chord',acc:true},
    ...[720,1200,1680].map(t=>({t,d:220,part:'chord'})),{t:960,d:220,part:'chord'}]},
  {id:'sync',name:'シンコペーション（3・3・2）',ev:each([[0,700],[720,700],[1440,460]],([t,d])=>[{t,d,part:'bass',acc:t===0},{t,d,part:'chord',acc:t===0}])},
  {id:'arp',name:'アルペジオ（8分）',ev:[{t:0,d:1900,part:'bass'},...[0,1,2,3,4,3,2,1].map((i,k)=>({t:k*240,d:230,part:'arp',i,acc:k===0}))]},
  {id:'ballad',name:'バラード（4分の分散）',ev:[{t:0,d:1900,part:'bass'},{t:0,d:1900,part:'chord',soft:true},...[1,2,3].map((i,k)=>({t:480*(k+1),d:460,part:'arp',i}))]}
];
export const patternById=id=>PATTERNS.find(p=>p.id===id)||PATTERNS[0];
const VEL={bass:88,chord:80,arp:78}, ACC=12, SOFT=-26;

// ボイシング：ベース＝ルート（分数コードは指定音）を C2〜B2、上声＝ルートを C3〜B3 に置いて積む（ChordNavi と同じ）。
// octave・bassOctave で上声・ベースをそれぞれオクターブ移動
export function voicingOf(song,ch){
  const up=CHORD[ch.q].iv.map(i=>48+ch.root+i+12*song.octave);
  return {bass:36+(ch.bass??ch.root)+12*song.bassOctave,upper:up};
}
const arpNote=(upper,i)=>upper[i%upper.length]+12*Math.floor(i/upper.length);

// 1つのコード（p.start〜p.end）のノート。
// パターンの音が無い位置から始まるコード（半拍の食いなど）は、頭に和音を足す。
// それが小節線の1拍以内前なら「食い」として、小節頭の音を鳴らし直さずにタイでつなぐ
// （次のコードが同じコードでセクションをまたぐときも。tie は前のコードの食いの音）
function chordNotes(song,tl,p,tie){
  const s=p.start, e=p.end, pat=patternById(p.pattern), {bass,upper}=voicingOf(song,p.ch), out=[];
  const barAt=t=>tl.bars.find(b=>t>=b.start&&t<b.start+b.ticks);
  let hits=[];
  for(const b of tl.bars){
    if(b.start+b.ticks<=s)continue;
    if(b.start>=e)break;
    for(let cyc=0;cyc<b.ticks;cyc+=WHOLE)for(const ev of pat.ev){
      const t=b.start+cyc+ev.t;
      if(cyc+ev.t>=b.ticks||t<s||t>=e)continue;
      hits.push({...ev,t,d:Math.min(ev.d,b.start+b.ticks-t)});
    }
  }
  const emit=h=>{
    const v=VEL[h.part]+(h.acc?ACC:0)+(h.soft?SOFT:0);
    const pitches=h.part==='bass'?(song.bass?[bass]:[]):h.part==='chord'?upper:[arpNote(upper,h.i)];
    return pitches.filter(n=>n>=0&&n<=127).map(n=>{
      const x={t:h.t,d:Math.min(h.d,e-h.t),n,v:Math.max(1,Math.min(127,v)),part:h.part};out.push(x);return x;
    });
  };
  // 前のコードからのタイ：頭の音は鳴らさず、前の音を伸ばす
  if(tie){
    for(const h of hits.filter(h=>h.t===s))for(const n of tie)if(n.part===h.part||h.part==='arp'&&n.part==='chord')n.d=Math.max(n.d,n.t<s?s-n.t+Math.min(h.d,e-s):n.d);
    hits=hits.filter(h=>h.t!==s);
  }
  let forced=null;
  if(!tie&&!hits.some(h=>h.t===s)){
    const next=Math.min(e,...hits.map(h=>h.t));
    forced=[...emit({t:s,d:next-s,part:'bass'}),...emit({t:s,d:next-s,part:'chord',acc:true})];
    // 同じコードの中で小節線をまたぐ食い
    const b=barAt(s), line=b?b.start+b.ticks:Infinity;
    if(b&&line<e&&line-s<=beatTicksOf(b.meter)){
      for(const h of hits.filter(h=>h.t===line))for(const n of forced)if(n.part===h.part||h.part==='arp'&&n.part==='chord')n.d=Math.max(n.d,line-s+Math.min(h.d,e-line));
      hits=hits.filter(h=>h.t!==line);
    }
  }
  hits.forEach(emit);
  // 小節線の1拍以内前から始まって小節線で終わるコード：次の同じコードへタイでつなぐ
  const b=barAt(s);
  const tail=forced&&b&&e===b.start+b.ticks&&e-s<=beatTicksOf(b.meter)?forced:null;
  return {notes:out,tail};
}
const sameCode=(a,b)=>a.off===b.off&&a.q===b.q&&(a.boff??null)===(b.boff??null);

// 範囲（tick、省略時は曲全体）のノート・テンポ・拍子。位置は範囲の先頭を 0 にする
export function renderSong(song,range){
  const tl=timeline(song), lo=range?.from??0, hi=range?.to??tl.total, raw=[];
  const pcs=placedChords(song,tl);
  let tail=null;
  pcs.forEach((p,i)=>{
    const prev=pcs[i-1];
    const tie=tail&&prev&&prev.end===p.start&&sameCode(prev.c,p.c)?tail:null;
    const r=chordNotes(song,tl,p,tie);
    raw.push(...r.notes);tail=r.tail;
  });
  const notes=[];
  for(const n of raw){
    let t=n.t, end=n.t+n.d;
    if(end<=lo||t>=hi)continue;
    t=Math.max(t,lo);end=Math.min(end,hi);    // 範囲の頭にかかる音は範囲の頭から鳴らし直す
    notes.push({t:t-lo,d:end-t,n:n.n,v:n.v});
  }
  const shift=(list,key)=>{
    const head={tick:0,[key]:key==='bpm'?tempoAt(tl.tempos,lo):meterAt(tl.meters,lo)};
    return [head,...list.filter(x=>x.tick>lo&&x.tick<hi).map(x=>({tick:x.tick-lo,[key]:x[key]}))];
  };
  return {notes:notes.sort((a,b)=>a.t-b.t||a.n-b.n),tempos:shift(tl.tempos,'bpm'),meters:shift(tl.meters,'meter'),length:hi-lo};
}

/* ---------- SMF（フォーマット0、分解能480） ---------- */
function vlq(n){const b=[n&0x7f];while((n>>=7))b.unshift((n&0x7f)|0x80);return b;}
export function buildSmf({notes,tempos,meters,length},name=''){
  const ev=[];   // [tick, 並び順（メタ0・オフ1・オン2）, バイト列]
  const nameBytes=[...new TextEncoder().encode(name)];
  if(nameBytes.length)ev.push([0,0,[0xff,0x03,...vlq(nameBytes.length),...nameBytes]]);
  for(const x of tempos){const us=Math.round(60e6/x.bpm);ev.push([x.tick,0,[0xff,0x51,3,us>>16&255,us>>8&255,us&255]]);}
  for(const x of meters)ev.push([x.tick,0,[0xff,0x58,4,x.meter[0],Math.log2(x.meter[1]),24,8]]);
  for(const n of notes){ev.push([n.t,2,[0x90,n.n,n.v]]);ev.push([n.t+n.d,1,[0x80,n.n,0]]);}
  ev.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  const trk=[];let prev=0;
  for(const [t,,bytes] of ev){trk.push(...vlq(t-prev),...bytes);prev=t;}
  trk.push(...vlq(Math.max(0,(length??prev)-prev)),0xff,0x2f,0);
  const len=trk.length;
  return new Uint8Array([0x4d,0x54,0x68,0x64,0,0,0,6,0,0,0,1,PPQ>>8,PPQ&255,
    0x4d,0x54,0x72,0x6b,len>>>24&255,len>>16&255,len>>8&255,len&255,...trk]);
}

// ファイル名に日本語を使わない（ChordNavi と同じ規則：♯→#、♭→b、英数字と _ # - 以外は _）
export function safeFileName(s){
  const t=s.replace(/♯/g,'#').replace(/♭/g,'b').replace(/[^A-Za-z0-9_#\-]+/g,'_').replace(/_+/g,'_').replace(/^_|_$/g,'');
  return t||'ChordSketch';
}
export {mod12};
