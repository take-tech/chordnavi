/* ChordSketch：曲データと MIDI 生成の純粋関数（UI コードは置かない）
   音楽理論（コード・表記・判別）は ChordNavi の ui/theory.js を共有する */
import {CHORD,chordAt,chordName as chordNameOf,tonicOf,isFlatKey,mod12} from '../../ui/theory.js';
import {nearestVoicing,TAB_AREAS} from '../../ui/guitar.js';

export const PPQ=480, WHOLE=PPQ*4;
export const barTicksOf=([n,d])=>n*WHOLE/d;
export const beatTicksOf=([,d])=>WHOLE/d;
export const METERS=[[4,4],[3,4],[2,4],[5,4],[6,4],[6,8],[7,8],[9,8],[12,8]];
export const MIN_BPM=20, MAX_BPM=300;

// スナップ：1小節／1拍／半拍（シンコペーション・食いのコード用）
export const SNAPS=[{id:'bar',name:'1小節'},{id:'beat',name:'1拍'},{id:'half',short:'2分',name:'半拍'}];
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
    pattern:'whole',voicing:'piano',guitarArea:'low',octave:0,bassOctave:0,bass:true,sections:[newSection('Aメロ',1,8)]};
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
  let meter=song.meter,key=song.key,tick=0;
  song.sections.forEach((s,si)=>{
    const from=bars.length;
    for(let b=0;b<s.bars;b++){
      const mm=s.marks.find(m=>m.bar===b&&m.meter);
      if(mm)meter=mm.meter;
      const km=s.marks.find(m=>m.bar===b&&m.key);
      if(km)key=km.key;
      const t=barTicksOf(meter);
      if(!meters.length||meters.at(-1).meter.join('/')!==meter.join('/'))meters.push({tick,meter,gi:bars.length});
      bars.push({si,bar:b,start:tick,ticks:t,meter,key,keyMark:!!km,gi:bars.length});
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
  const out=[];
  song.sections.forEach((s,si)=>{
    const {from,to}=tl.secRanges[si];if(from===to)return;
    const secEnd=tl.bars[to-1].start+tl.bars[to-1].ticks;
    for(const c of s.chords){
      if(c.bar>=s.bars)continue;
      const b=tl.bars[from+c.bar], start=b.start+Math.min(c.pos,b.ticks-1), end=Math.min(start+c.len,secEnd);
      // コードの度数（off）は、コードが始まる小節のキーの主音が基準（途中の転調に対応）
      if(end>start)out.push({c,si,start,end,key:b.key,ch:chordAt(tonicOf(b.key.idx,b.key.mode),[c.off,c.q,c.boff]),pattern:c.pattern||s.pattern||song.pattern});   // コード → セクション → 曲の順
    }
  });
  out.sort((a,b)=>a.start-b.start);
  for(let i=0;i<out.length-1;i++)out[i].end=Math.min(out[i].end,out[i+1].start);
  return out;
}

// key を省くと曲の頭のキー。途中で転調しているときは、そのコードの位置のキー（placedChords の key、timeline の bars[].key）を渡す
export const keyTonic=key=>tonicOf(key.idx,key.mode);
export const songTonic=song=>keyTonic(song.key);
export const songFlat=song=>isFlatKey(song.key.idx);
export const chordOf=(song,c,key=song.key)=>chordAt(keyTonic(key),[c.off,c.q,c.boff]);
export const nameOf=(song,c,key=song.key)=>chordNameOf(chordOf(song,c,key),isFlatKey(key.idx),keyTonic(key));
export const sameKey=(a,b)=>a.idx===b.idx&&a.mode===b.mode;

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
// 長さの変更（伸ばした先のコードは上書き）。maxLen は2小節ぶんなど。セクションの終わりで切る
export function stretchChord(song,si,id,len,minLen,maxLen){
  const c=song.sections[si].chords.find(x=>x.id===id);
  if(!c)return null;
  return placeChord(song,si,{...c,len:Math.max(minLen,Math.min(maxLen,len))});
}
// 頭の位置の変更（終わりはそのまま）。start はセクションの頭からの tick。前に伸ばした先のコードは上書き。
// 長さは minLen〜maxLen、セクションの頭より前には伸ばさない
export function stretchChordStart(song,si,id,start,minLen,maxLen){
  const c=song.sections[si].chords.find(x=>x.id===id);
  if(!c)return null;
  const g=secGeom(timeline(song),si), a=g.toLocal(c.bar,c.pos), e=a+c.len;
  let s0=Math.max(0,Math.min(start,e-minLen));
  if(e-s0>maxLen)s0=e-maxLen;
  return placeChord(song,si,{...c,...g.fromLocal(s0),len:e-s0});
}
// セクションの小節数を変える。はみ出したコード・マークは消す（長さは切る）
export function setSectionBars(song,si,n){
  const sec=song.sections[si];n=Math.max(1,Math.min(128,n));
  sec.bars=n;
  sec.chords=sec.chords.filter(c=>c.bar<n);
  sec.marks=sec.marks.filter(m=>m.bar<n);
}
// si と次のセクションを1つにする（名前・色・パターンは前のもの）。後ろのコード・変更点は小節をずらして引き継ぐ。
// パターンが違うときは、後ろのコードに元のパターンをコードごとのパターンとして付けて、鳴り方を変えない
export function mergeSections(song,si){
  const a=song.sections[si], b=song.sections[si+1];
  if(!a||!b)return false;
  const pa=a.pattern||song.pattern, pb=b.pattern||song.pattern;
  for(const c of b.chords){
    const cc={...c,bar:c.bar+a.bars};
    if(!cc.pattern&&pa!==pb)cc.pattern=pb;
    a.chords.push(cc);
  }
  for(const m of b.marks)a.marks.push({...m,bar:m.bar+a.bars});
  a.bars+=b.bars;
  song.sections.splice(si+1,1);
  return true;
}
// si を bar 小節目の頭で2つに分ける（mergeSections の逆）。後ろは同じ名前・色・パターンの新しいセクション。
// 分け目をまたぐコードは2つに切る（後ろは同じコード。MIDI では同じコードへのタイ・小節頭の音としてつながる）
export function splitSection(song,si,bar){
  const a=song.sections[si];
  if(!a||bar<=0||bar>=a.bars)return false;
  const tl=timeline(song), g=secGeom(tl,si), cut=g.toLocal(bar,0);
  const b={...newSection(a.name,a.color,a.bars-bar),pattern:a.pattern};
  const keep=[];
  for(const c of a.chords){
    const s0=g.toLocal(c.bar,c.pos), e0=s0+c.len;
    if(e0<=cut){keep.push(c);continue;}
    if(s0>=cut){b.chords.push({...c,bar:c.bar-bar});continue;}
    keep.push({...c,len:cut-s0});
    b.chords.push({...c,id:uid(),bar:0,pos:0,len:e0-cut});
  }
  a.chords=keep;
  b.marks=a.marks.filter(m=>m.bar>=bar).map(m=>({...m,bar:m.bar-bar}));
  a.marks=a.marks.filter(m=>m.bar<bar);
  a.bars=bar;
  song.sections.splice(si+1,0,b);
  return true;
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
  const tempo=sec.marks.find(m=>m.bar===bar&&m.bpm&&(m.pos||0)===pos), met=sec.marks.find(m=>m.bar===bar&&m.meter);   // キーの変更点（setKeyMark）は触らない
  sec.marks=sec.marks.filter(m=>m!==tempo&&m!==met);
  if(bpm)sec.marks.push({bar,pos,bpm:Math.min(MAX_BPM,Math.max(MIN_BPM,bpm))});
  if(meter)sec.marks.push({bar,pos:0,meter});
}

// キーの変更点（小節の頭）。key が null なら外す。
// keepSound なら、影響する範囲（この小節から次のキーの変更点まで）のコードの度数を付け替えて、鳴る音を保つ。
// そうでなければ度数を保つ（＝コードも一緒に移調する。最後のサビを1音上げる、など）
export function setKeyMark(song,si,bar,key,keepSound){
  const tl0=timeline(song), gi=tl0.secRanges[si].from+bar;
  const before=tl0.bars[gi].key;
  const sec=song.sections[si];
  sec.marks=sec.marks.filter(m=>!(m.bar===bar&&m.key));
  if(key)sec.marks.push({bar,pos:0,key:{idx:key.idx,mode:key.mode}});
  const tl=timeline(song), after=tl.bars[gi].key;
  if(keepSound&&!sameKey(before,after)){const r=keyRegion(tl,gi);transposeBars(song,tl,r.from,r.to,mod12(keyTonic(before)-keyTonic(after)));}
}
// gi 小節目のキーが続く範囲（小節番号、to は含まない）と、その頭の変更点（曲の頭なら null）
export function keyRegion(tl,gi){
  let from=gi;while(from>0&&!tl.bars[from].keyMark)from--;
  let to=gi+1;while(to<tl.bars.length&&!tl.bars[to].keyMark)to++;
  const b=tl.bars[from];
  return {from,to,key:b?b.key:null,mark:b&&b.keyMark?{si:b.si,bar:b.bar}:null};
}
// 小節の範囲 [from, to) で始まるコードの度数を d 半音ずらす
export function transposeBars(song,tl,from,to,d){
  if(!mod12(d))return;
  song.sections.forEach((s,si)=>{
    const base=tl.secRanges[si].from;
    for(const c of s.chords){
      const gi=base+c.bar;
      if(gi>=from&&gi<to){c.off=mod12(c.off+d);if(c.boff!=null)c.boff=mod12(c.boff+d);}
    }
  });
}

// 直前に効いている値と同じテンポ・拍子の変更点を消す（曲の頭から順に見るので、消した結果いらなくなった後ろの変更点も消える）。
// テンポ・拍子を変えたときに呼ぶ（セクションの並べ替えでは呼ばない：戻したときに変更点が消えないように）
// only を指定すると、そのセクションの変更点だけを消す（値の流れは曲の頭から見る）
export function pruneMarks(song,only=null){
  let bpm=song.bpm, meter=song.meter.join('/'), key=song.key.idx+':'+song.key.mode;
  song.sections.forEach((s,si)=>{
    const keep=[];
    const sorted=[...s.marks].sort((a,b)=>a.bar-b.bar||(b.key?1:0)-(a.key?1:0)||(b.meter?1:0)-(a.meter?1:0)||(a.pos||0)-(b.pos||0));
    for(const m of sorted){
      if(m.bar>=s.bars)continue;
      const drop=only==null||only===si;
      if(m.meter){const k=m.meter.join('/');if(k===meter&&drop)continue;meter=k;}
      if(m.key){const k=m.key.idx+':'+m.key.mode;if(k===key&&drop)continue;key=k;}
      if(m.bpm){if(m.bpm===bpm&&drop)continue;bpm=m.bpm;}
      keep.push(m);
    }
    s.marks=keep;
  });
}

/* ---------- 範囲（小節番号は曲全体の通し番号） ---------- */
export const rangeTicks=(tl,{from,to})=>({from:tl.bars[from]?.start??0,to:to>=tl.bars.length?tl.total:tl.bars[to].start});

// コピー：範囲の小節のコードを、範囲の先頭からの tick で持つ
export function copyRange(song,{from,to}){
  const tl=timeline(song), r=rangeTicks(tl,{from,to});
  return {len:r.to-r.from,chords:placedChords(song,tl).filter(p=>p.end>r.from&&p.start<r.to).map(p=>{
    const s=Math.max(p.start,r.from);return {at:s-r.from,len:Math.min(p.end,r.to)-s,off:p.c.off,q:p.c.q,boff:p.c.boff,pattern:p.c.pattern};
  })};
}
// 貼り付け：曲の中の origin（tick）から上書き（セクションをまたぐときはそれぞれのセクションに置く）
export function pasteAt(song,origin,clip){
  for(const x of clip.chords){
    const tl=timeline(song), abs=origin+x.at, bar=tl.bars.find(b=>abs>=b.start&&abs<b.start+b.ticks);
    if(!bar)continue;
    placeChord(song,bar.si,{...newChord(bar.bar,abs-bar.start,x.len,x.off,x.q,x.boff),...(x.pattern?{pattern:x.pattern}:{})});
  }
}

// 定番進行（ChordNavi の PROGRESSIONS の小節の並び）を gi 小節目から入れる。1小節＝1小節、1小節に複数なら等分。
// 曲の最後を越えるときは最後のセクションの小節を増やす。入れた小節の範囲を返す
export function insertProgression(song,gi,bars){
  if(!song.sections.length)return null;
  let tl=timeline(song);
  const need=gi+bars.length-tl.bars.length;
  if(need>0){const last=song.sections.length-1;setSectionBars(song,last,song.sections[last].bars+need);tl=timeline(song);}
  bars.forEach((bar,i)=>{
    const b=tl.bars[gi+i];if(!b)return;
    const items=Array.isArray(bar[0])?bar:[bar], len=b.ticks/items.length;
    items.forEach(([off,q,boff],k)=>placeChord(song,b.si,newChord(b.bar,k*len,len,off,q,boff)));
  });
  return {from:gi,to:gi+bars.length};
}

/* ---------- MIDI パターン ---------- */
// t・d は tick（4分音符＝480）。1小節ぶん（1920）を1周として小節の頭から繰り返し、小節の終わりで切る。
// part：bass（ベース）／chord（上声すべて）／arp（上声の i 番目。数が足りなければ1オクターブ上に折り返す）。acc はアクセント
const each=(ts,f)=>ts.flatMap(f);
export const PATTERNS=[
  {id:'whole',short:'全',name:'全音符',ev:[{t:0,d:1920,part:'bass'},{t:0,d:1920,part:'chord'}]},
  {id:'half',short:'2分',name:'2分音符',ev:each([0,960],t=>[{t,d:940,part:'bass'},{t,d:940,part:'chord'}])},
  {id:'quarter',short:'4分',name:'4分刻み',ev:[{t:0,d:1900,part:'bass'},...[0,480,960,1440].map(t=>({t,d:430,part:'chord',acc:t%960===0}))]},
  {id:'eighth',short:'8分',name:'8分刻み',ev:each([0,240,480,720,960,1200,1440,1680],t=>[{t,d:210,part:'bass',acc:t%480===0},{t,d:210,part:'chord',acc:t%480===0}])},
  {id:'pop',short:'ポップ',name:'ポップ（ベース＋裏拍）',ev:[{t:0,d:900,part:'bass'},{t:960,d:900,part:'bass'},{t:0,d:440,part:'chord',acc:true},
    ...[720,1200,1680].map(t=>({t,d:220,part:'chord'})),{t:960,d:220,part:'chord'}]},
  {id:'sync',short:'シンコペ',name:'シンコペーション（3・3・2）',ev:each([[0,700],[720,700],[1440,460]],([t,d])=>[{t,d,part:'bass',acc:t===0},{t,d,part:'chord',acc:t===0}])},
  {id:'arp',short:'アルペ',name:'アルペジオ（8分）',ev:[{t:0,d:1900,part:'bass'},...[0,1,2,3,4,3,2,1].map((i,k)=>({t:k*240,d:230,part:'arp',i,acc:k===0}))]},
  // バラード：音の高さの順で 1・2・4・3（ベース → 上声の低い音 → 一番上 → 間の音）。g はギターのときの上の弦の番号（低い方から）
  {id:'ballad',short:'バラード',name:'バラード（4分の分散）',ev:[{t:0,d:1900,part:'bass'},{t:0,d:1900,part:'chord',soft:true},...[[1,0],[3,2],[2,1]].map(([i,g],k)=>({t:480*(k+1),d:460,part:'arp',i,g}))]}
];
export const patternById=id=>PATTERNS.find(p=>p.id===id)||PATTERNS[0];
const VEL={bass:88,chord:80,arp:78}, ACC=12, SOFT=-26;

// ボイシング：ベース＝ルート（分数コードは指定音）を C2〜B2、上声＝ルートを C3〜B3 に置いて積む（ChordNavi と同じ）。
// octave・bassOctave で上声・ベースをそれぞれオクターブ移動
// ボイシングは「ピアノ」と「ギター」を切り替える（song.voicing）。
// ギター：ChordNavi の guitar.js で弾けるコードフォームを探す（最低音の弦＝ベース、残りの弦＝上声）。
// ポジションは song.guitarArea（ロー／ミドル／ハイ）あたりで、前のコードのフォーム prev から手の移動が少ない形。
// 見つからないコード（sus4(♭5) など）はピアノの形にする
export const VOICINGS=[{id:'piano',name:'ピアノ'},{id:'guitar',name:'ギター'}];
export const GUITAR_AREAS=[{id:'low',name:'ロー'},{id:'mid',name:'ミドル'},{id:'high',name:'ハイ'}];
export function voicingOf(song,ch,prev=null){
  if(song.voicing==='guitar'){
    const form=nearestVoicing(ch,TAB_AREAS[song.guitarArea]??TAB_AREAS.low,prev);
    if(form){
      const [low,...rest]=form.notes;
      return {bass:low+12*song.bassOctave,upper:rest.map(n=>n+12*song.octave),form};
    }
  }
  const up=CHORD[ch.q].iv.map(i=>48+ch.root+i+12*song.octave);
  return {bass:36+(ch.bass??ch.root)+12*song.bassOctave,upper:up,form:null};
}
// 上って下る順番（4本なら 0,1,2,3,2,1）
const bounce=n=>n<=1?[0]:[...Array(n).keys(),...[...Array(n-2).keys()].map(k=>n-2-k)];
const arpNote=(upper,i)=>upper[i%upper.length]+12*Math.floor(i/upper.length);

// 1つのコード（p.start〜p.end）のノート。
// 途中から始まるコードは、その位置で伸びているはずのベース・和音を鳴らし直す（下の chase）。
// それが小節線の1拍以内前なら「食い」として、小節頭の音を鳴らし直さずにタイでつなぐ
// （次のコードが同じコードでセクションをまたぐときも。tie は前のコードの食いの音）
function chordNotes(song,tl,p,tie,voicing){
  const s=p.start, e=p.end, pat=patternById(p.pattern), {bass,upper}=voicing, out=[];
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
  // ギターのアルペジオ：1拍目（小節の頭）はベースだけ、あとは上の弦を低い方から上って下る（フォームの外の音は足さない）。
  // バラードの伸ばす和音は、同じ弦をアルペジオでも弾くので外す
  const guitar=song.voicing==='guitar'&&!!voicing.form;
  if(guitar&&hits.some(h=>h.part==='arp')){
    const seq=bounce(upper.length), count=new Map();
    hits=hits.filter(h=>{
      if(h.part==='chord'&&h.soft)return false;
      if(h.part!=='arp')return true;
      const b=barAt(h.t), rel=h.t-b.start;
      if(rel%WHOLE===0)return false;
      const cyc=b.start+rel-rel%WHOLE, k=count.get(cyc)||0;count.set(cyc,k+1);
      h.i=h.g!=null?Math.min(h.g,upper.length-1):seq[k%seq.length];   // パターンが弦を決めていればそれ、なければ上って下る
      return true;
    });
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
  // 途中から始まるコード：パターンの中でその位置にまだ伸びているはずのベース・和音を、その位置から鳴らし直す
  // （例：バラードの3拍目で変わるコード。3拍目にはアルペジオの1音しか無いが、ベースと和音も新しいコードで鳴らす）。
  // 伸びている音も無く、その位置にパターンの音も無いときは、次のパターンの音まで和音を足す
  let forced=null;
  const exact=hits.filter(h=>h.t===s), bs=barAt(s);
  if(!tie&&bs){
    const chase=[];
    for(let cyc=0;cyc<bs.ticks;cyc+=WHOLE)for(const ev of pat.ev){
      if(ev.part==='arp'||exact.some(h=>h.part===ev.part))continue;
      const t=bs.start+cyc+ev.t;
      if(cyc+ev.t>=bs.ticks||t>=s)continue;
      const end=t+Math.min(ev.d,bs.start+bs.ticks-t);
      if(end>s&&!chase.some(c=>c.part===ev.part))chase.push({...ev,t:s,d:end-s,acc:true});
    }
    if(chase.length)forced=chase.flatMap(emit);
    else if(!exact.length){
      const next=Math.min(e,...hits.map(h=>h.t));
      forced=[...emit({t:s,d:next-s,part:'bass'}),...emit({t:s,d:next-s,part:'chord',acc:true})];
    }
    if(forced&&!forced.length)forced=null;
    // 同じコードの中で小節線をまたぐ食い（その位置にパターンの音が無いときだけ）
    const line=bs.start+bs.ticks;
    if(forced&&!exact.length&&line<e&&line-s<=beatTicksOf(bs.meter)){
      for(const h of hits.filter(h=>h.t===line))for(const n of forced)if(n.part===h.part||h.part==='arp'&&n.part==='chord')n.d=Math.max(n.d,line-s+Math.min(h.d,e-line));
      hits=hits.filter(h=>h.t!==line);
    }
  }
  hits.forEach(emit);
  if(guitar){
    // 弾いた弦は、次に同じ弦（同じ音）を弾くまで鳴らしたまま（コードの終わりまで）
    for(const n of out)if(n.part==='arp'){
      const next=out.filter(m=>m!==n&&m.n===n.n&&m.t>n.t).reduce((a,m)=>Math.min(a,m.t),e);
      n.d=Math.max(n.d,next-n.t);
    }
    strum(out,tl);
  }
  // 小節線の1拍以内前から始まって小節線で終わるコード：次の同じコードへタイでつなぐ
  const tail=forced&&!exact.length&&bs&&e===bs.start+bs.ticks&&e-s<=beatTicksOf(bs.meter)?forced:null;
  return {notes:out,tail};
}
// ギターのストローク：同時に鳴らすベース＋和音（3音以上）を弦ごとに少しずらす。
// 拍の頭はダウン（低い弦から）、それ以外はアップ（高い弦から）。音の終わりはそろえる
export const STRUM_TICKS=10;
function strum(notes,tl){
  const groups=new Map();
  for(const n of notes)if(n.part!=='arp'){const g=groups.get(n.t)||[];g.push(n);groups.set(n.t,g);}
  for(const [t,g] of groups){
    if(g.length<3)continue;
    const b=tl.bars.find(x=>t>=x.start&&t<x.start+x.ticks), down=!b||(t-b.start)%beatTicksOf(b.meter)===0;
    g.sort((x,y)=>down?x.n-y.n:y.n-x.n).forEach((n,k)=>{const o=Math.min(k*STRUM_TICKS,n.d-1);n.t+=o;n.d-=o;});
  }
}
const sameCode=(a,b)=>a.off===b.off&&a.q===b.q&&(a.boff??null)===(b.boff??null);

// 範囲（tick、省略時は曲全体）のノート・テンポ・拍子。位置は範囲の先頭を 0 にする
export function renderSong(song,range){
  const tl=timeline(song), lo=range?.from??0, hi=range?.to??tl.total, raw=[];
  const pcs=placedChords(song,tl);
  let tail=null, prevForm=null;
  pcs.forEach((p,i)=>{
    const v=voicingOf(song,p.ch,prevForm);if(v.form)prevForm=v.form;
    const prev=pcs[i-1];
    const tie=tail&&prev&&prev.end===p.start&&sameCode(prev.c,p.c)?tail:null;
    const r=chordNotes(song,tl,p,tie,v);
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
// 保存するときのファイル名：使えない文字は _、末尾の空白・ドットは外し、拡張子（ext、例 '.mid'）が無ければ付ける（大文字小文字は区別しない）。
// 空なら fallback。ネイティブの保存ダイアログ（JUCE 版）でも同じ決まりにする
export function withExtension(name,ext,fallback='ChordSketch'){
  let n=String(name??'').replace(/[\\/:*?"<>|\u0000-\u001f]/g,'_').trim().replace(/[.\s]+$/,'');
  if(!n||n===ext)n=fallback;
  return n.toLowerCase().endsWith(ext.toLowerCase())?n:n+ext;
}
export {mod12};
