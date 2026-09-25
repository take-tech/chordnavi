/* 音楽理論のデータと純粋関数（UIコードは置かない） */

export const PC_CIRCLE=[0,7,2,9,4,11,6,1,8,3,10,5];
export const MAJ_LABEL=['C','G','D','A','E','B','F♯/G♭','D♭','A♭','E♭','B♭','F'];
export const MIN_LABEL=['Am','Em','Bm','F♯m','C♯m','G♯m','D♯m/E♭m','B♭m','Fm','Cm','Gm','Dm'];
export const SIG=['調号なし','♯1つ','♯2つ','♯3つ','♯4つ','♯5つ','♯6つ / ♭6つ','♭5つ','♭4つ','♭3つ','♭2つ','♭1つ'];
export const SHARP=['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'];
export const FLAT =['C','D♭','D','E♭','E','F','G♭','G','A♭','A','B♭','B'];
export const DEG=['1','♭2','2','♭3','3','4','♭5','5','♭6','6','♭7','7'];
export const ROMAN=['I','♭II','II','♭III','III','IV','♯IV','V','♭VI','VI','♭VII','VII'];

export const SCALES=[
  {id:'major',name:'メジャー（アイオニアン）',iv:[0,2,4,5,7,9,11]},
  {id:'nminor',name:'ナチュラル・マイナー（エオリアン）',iv:[0,2,3,5,7,8,10]},
  {id:'hminor',name:'ハーモニック・マイナー',iv:[0,2,3,5,7,8,11]},
  {id:'mminor',name:'メロディック・マイナー',iv:[0,2,3,5,7,9,11]},
  {id:'dorian',name:'ドリアン',iv:[0,2,3,5,7,9,10]},
  {id:'phrygian',name:'フリジアン',iv:[0,1,3,5,7,8,10]},
  {id:'lydian',name:'リディアン',iv:[0,2,4,6,7,9,11],alt:{6:'♯4'}},
  {id:'mixo',name:'ミクソリディアン',iv:[0,2,4,5,7,9,10]},
  {id:'locrian',name:'ロクリアン',iv:[0,1,3,5,6,8,10]},
  {id:'majpenta',name:'メジャー・ペンタトニック',iv:[0,2,4,7,9]},
  {id:'minpenta',name:'マイナー・ペンタトニック',iv:[0,3,5,7,10]},
  {id:'blues',name:'ブルース',iv:[0,3,5,6,7,10]},
  {id:'whole',name:'ホールトーン',iv:[0,2,4,6,8,10],alt:{6:'♯4',8:'♯5'}},
  {id:'dim',name:'ディミニッシュ（H-W）',iv:[0,1,3,4,6,7,9,10],alt:{4:'♭4'}}
];

export const CHORD={
  '':{s:'',iv:[0,4,7]}, m:{s:'m',iv:[0,3,7]}, '7':{s:'7',iv:[0,4,7,10]},
  M7:{s:'M7',iv:[0,4,7,11]}, m7:{s:'m7',iv:[0,3,7,10]}, m7b5:{s:'m7♭5',iv:[0,3,6,10]},
  dim:{s:'dim',iv:[0,3,6]}, aug:{s:'aug',iv:[0,4,8]}, sus4:{s:'sus4',iv:[0,5,7]},
  '7sus4':{s:'7sus4',iv:[0,5,7,10]}, dim7:{s:'dim7',iv:[0,3,6,9]},
  // 以下はコード判別用（進行データでも使える）
  sus2:{s:'sus2',iv:[0,2,7]}, '6':{s:'6',iv:[0,4,7,9]}, m6:{s:'m6',iv:[0,3,7,9]},
  add9:{s:'add9',iv:[0,4,7,14]}, mM7:{s:'mM7',iv:[0,3,7,11]}, '9':{s:'9',iv:[0,4,7,10,14]},
  M9:{s:'M9',iv:[0,4,7,11,14]}, m9:{s:'m9',iv:[0,3,7,10,14]}, '5':{s:'5',iv:[0,7]}
};

// file はファイル名用の英字名。c は小節の並び。1小節は [ルートの度数(半音), 種類, ベースの度数(分数コードのみ)]、
// 1小節に複数のコードを入れるときは [[...],[...]] と並べる（小節内で等分。2つなら各2拍）
// v は派生形（基本形は c）。ここの内容は好みで追加・変更してよい
export const PROGRESSIONS=[
  {mode:'major',name:'王道進行',file:'RoyalRoad',c:[[5,'M7'],[7,'7'],[4,'m7'],[9,'m']],v:[
    {name:'3和音',c:[[5,''],[7,''],[4,'m'],[9,'m']]},
    {name:'III7版',c:[[5,'M7'],[7,'7'],[4,'7'],[9,'m7']]},
    {name:'ツーファイブ解決',c:[[5,'M7'],[7,'7'],[4,'m7'],[9,'m7'],[2,'m7'],[7,'7'],[0,'M7'],[0,'M7']]}]},
  {mode:'major',name:'カノン進行',file:'Canon',c:[[0,''],[7,''],[9,'m'],[4,'m'],[5,''],[0,''],[5,''],[7,'']],v:[
    {name:'ベース下降',c:[[0,''],[7,'',11],[9,'m'],[4,'m',7],[5,''],[0,'',4],[5,''],[7,'']]},
    {name:'III7版',c:[[0,''],[7,''],[9,'m'],[4,'7'],[5,''],[0,''],[5,''],[7,'']]},
    {name:'7th',c:[[0,'M7'],[7,''],[9,'m7'],[4,'m7'],[5,'M7'],[0,'M7'],[5,'M7'],[7,'7']]}]},
  {mode:'major',name:'I–V–VIm–IV',file:'I-V-VIm-IV',c:[[0,''],[7,''],[9,'m'],[5,'']],v:[
    {name:'ベース下降',c:[[0,''],[7,'',11],[9,'m'],[5,'']]},
    {name:'IV始まり',c:[[5,''],[0,''],[7,''],[9,'m']]},
    {name:'7th',c:[[0,'M7'],[7,''],[9,'m7'],[5,'M7']]}]},
  {mode:'major',name:'小室進行',file:'Komuro',c:[[9,'m'],[5,''],[7,''],[0,'']],v:[
    {name:'sus4',c:[[9,'m'],[5,''],[[7,'sus4'],[7,'']],[0,'']]},
    {name:'分数ベース',c:[[9,'m'],[5,''],[7,''],[0,'',4]]},
    {name:'7th',c:[[9,'m7'],[5,'M7'],[7,'7'],[0,'M7']]}]},
  {mode:'major',name:'50年代進行',file:'50s',c:[[0,''],[9,'m'],[5,''],[7,'']],v:[
    {name:'IIm版',c:[[0,''],[9,'m'],[2,'m'],[7,'']]},
    {name:'7th',c:[[0,'M7'],[9,'m7'],[5,'M7'],[7,'7']]}]},
  {mode:'major',name:'ツーファイブワン',file:'II-V-I',c:[[2,'m7'],[7,'7'],[0,'M7'],[0,'M7']],v:[
    {name:'裏コード',c:[[2,'m7'],[1,'7'],[0,'M7'],[0,'M7']]},
    {name:'V7sus4経由',c:[[2,'m7'],[[7,'7sus4'],[7,'7']],[0,'M7'],[0,'M7']]}]},
  {mode:'major',name:'イチロクニーゴー（循環）',file:'I-VIm-IIm-V',c:[[0,'M7'],[9,'m7'],[2,'m7'],[7,'7']],v:[
    {name:'3和音',c:[[0,''],[9,'m'],[2,'m'],[7,'']]},
    {name:'VI7版',c:[[0,'M7'],[9,'7'],[2,'m7'],[7,'7']]},
    {name:'スリーシックス',c:[[4,'m7'],[9,'7'],[2,'m7'],[7,'7']]},
    {name:'裏コード',c:[[0,'M7'],[9,'7'],[2,'m7'],[1,'7']]}]},
  {mode:'major',name:'丸サ進行',file:'Marunouchi',c:[[5,'M7'],[4,'7'],[9,'m7'],[0,'7']],v:[
    {name:'IIIm7版',c:[[5,'M7'],[4,'m7'],[9,'m7'],[0,'7']]},
    {name:'Vm7経由',c:[[5,'M7'],[4,'7'],[9,'m7'],[[7,'m7'],[0,'7']]]}]},
  {mode:'minor',name:'Im–♭VI–♭III–♭VII',file:'Im-bVI-bIII-bVII',c:[[0,'m'],[8,''],[3,''],[10,'']],v:[
    {name:'♭VI始まり',c:[[8,''],[10,''],[0,'m'],[0,'m']]},
    {name:'7th',c:[[0,'m7'],[8,'M7'],[3,'M7'],[10,'7']]}]},
  {mode:'minor',name:'アンダルシア進行',file:'Andalusian',c:[[0,'m'],[10,''],[8,''],[7,'']],v:[
    {name:'V7版',c:[[0,'m'],[10,''],[8,''],[7,'7']]},
    {name:'ベース下降',c:[[0,'m'],[0,'m',10],[8,''],[7,'7']]}]},
  {mode:'minor',name:'マイナー・ツーファイブワン',file:'MinorII-V-I',c:[[2,'m7b5'],[7,'7'],[0,'m7'],[0,'m7']],v:[
    {name:'裏コード',c:[[2,'m7b5'],[1,'7'],[0,'m7'],[0,'m7']]}]},
  {mode:'minor',name:'Im–IVm–V7–Im',file:'Im-IVm-V7-Im',c:[[0,'m'],[5,'m'],[7,'7'],[0,'m']],v:[
    {name:'Vm版',c:[[0,'m'],[5,'m'],[7,'m'],[0,'m']]},
    {name:'7th',c:[[0,'m7'],[5,'m7'],[7,'7'],[0,'m7']]}]},
  {mode:'minor',name:'Im–♭VII–♭VI–♭VII',file:'Im-bVII-bVI-bVII',c:[[0,'m'],[10,''],[8,''],[10,'']],v:[
    {name:'7th',c:[[0,'m7'],[10,''],[8,'M7'],[10,'7']]}]},
];

// 「その他」から選ぶ進行（extra:true）。メインの進行の後ろに並べるので、保存済みの番号はずれない
PROGRESSIONS.push(...[
  {mode:'major',name:'クリシェ進行',file:'Cliche',c:[[0,''],[0,'aug'],[0,'6'],[0,'7']],v:[{name:'M7下降',c:[[0,''],[0,'M7'],[0,'7'],[0,'6']]},{name:'IV解決',c:[[0,''],[0,'aug'],[0,'6'],[0,'7'],[5,'M7'],[5,'m6'],[0,''],[0,'']]}]},
  {mode:'major',name:'サブドミナントマイナー',file:'SubdominantMinor',c:[[0,'M7'],[5,'M7'],[5,'m6'],[0,'M7']],v:[{name:'バックドア',c:[[0,'M7'],[5,'M7'],[[5,'m7'],[10,'7']],[0,'M7']]},{name:'3和音',c:[[0,''],[5,''],[5,'m'],[0,'']]}]},
  {mode:'major',name:'I–III–IV–IVm',file:'I-III-IV-IVm',c:[[0,''],[4,''],[5,''],[5,'m']],v:[{name:'7th',c:[[0,'M7'],[4,'7'],[5,'M7'],[5,'m6']]}]},
  {mode:'major',name:'VIm–IV–I–V',file:'VIm-IV-I-V',c:[[9,'m'],[5,''],[0,''],[7,'']],v:[{name:'sus4',c:[[9,'m'],[5,''],[0,''],[[7,'sus4'],[7,'']]]},{name:'7th',c:[[9,'m7'],[5,'M7'],[0,'M7'],[7,'7']]}]},
  {mode:'major',name:'I–IIIm–IV–V',file:'I-IIIm-IV-V',c:[[0,''],[4,'m'],[5,''],[7,'']],v:[{name:'7th',c:[[0,'M7'],[4,'m7'],[5,'M7'],[7,'7']]},{name:'2拍ずつ',c:[[[0,''],[4,'m']],[[5,''],[7,'']]]}]},
  {mode:'major',name:'IV–V–VIm（偽終止）',file:'DeceptiveCadence',c:[[5,''],[7,''],[9,'m'],[9,'m']],v:[{name:'7th',c:[[5,'M7'],[7,'7'],[9,'m7'],[9,'m7']]},{name:'2拍ずつ',c:[[[5,''],[7,'']],[9,'m'],[9,'m']]}]},
  {mode:'major',name:'逆循環',file:'ReverseCycle',c:[[2,'m7'],[7,'7'],[0,'M7'],[9,'m7']],v:[{name:'2拍ずつ',c:[[[2,'m7'],[7,'7']],[[0,'M7'],[9,'m7']]]},{name:'VI7版',c:[[2,'m7'],[7,'7'],[0,'M7'],[9,'7']]}]},
  {mode:'major',name:'ボサノバ進行',file:'BossaNova',c:[[0,'M7'],[2,'7'],[2,'m7'],[7,'7']],v:[{name:'8小節',c:[[0,'M7'],[0,'M7'],[2,'7'],[2,'7'],[2,'m7'],[1,'7'],[0,'M7'],[0,'M7']]},{name:'裏コード',c:[[0,'M7'],[2,'7'],[2,'m7'],[1,'7']]}]},
  {mode:'major',name:'ドミナントの連鎖',file:'DominantChain',c:[[4,'7'],[9,'7'],[2,'7'],[7,'7'],[0,'M7'],[0,'M7']],v:[{name:'2拍ずつ',c:[[[4,'7'],[9,'7']],[[2,'7'],[7,'7']],[0,'M7'],[0,'M7']]},{name:'IIm7版',c:[[4,'7'],[9,'7'],[2,'m7'],[7,'7'],[0,'M7'],[0,'M7']]}]},
  {mode:'major',name:'I–♭VII–IV–I（ミクソリディアン）',file:'Mixolydian',c:[[0,''],[10,''],[5,''],[0,'']],v:[{name:'I–♭VII–IV',c:[[0,''],[10,''],[5,''],[5,'']]},{name:'2拍ずつ',c:[[[0,''],[10,'']],[[5,''],[0,'']]]}]},
  {mode:'major',name:'♭VI–♭VII–I',file:'bVI-bVII-I',c:[[8,''],[10,''],[0,''],[0,'']],v:[{name:'♭VI・♭VII',c:[[[8,''],[10,'']],[0,'']]},{name:'7th',c:[[8,'M7'],[10,'7'],[0,'M7'],[0,'M7']]}]},
  {mode:'major',name:'IM7–IVM7（2コード）',file:'I-IV-Vamp',c:[[0,'M7'],[5,'M7'],[0,'M7'],[5,'M7']],v:[{name:'2拍ずつ',c:[[[0,'M7'],[5,'M7']],[[0,'M7'],[5,'M7']]]},{name:'IM7–IIm7',c:[[0,'M7'],[2,'m7'],[0,'M7'],[2,'m7']]}]},
  {mode:'minor',name:'マイナー・クリシェ',file:'MinorCliche',c:[[0,'m'],[0,'mM7'],[0,'m7'],[0,'m6']],v:[{name:'2拍ずつ',c:[[[0,'m'],[0,'mM7']],[[0,'m7'],[0,'m6']]]},{name:'♭VIM7へ',c:[[0,'m'],[0,'mM7'],[0,'m7'],[0,'m6'],[8,'M7'],[8,'M7']]}]},
  {mode:'minor',name:'枯葉進行',file:'AutumnLeaves',c:[[5,'m7'],[10,'7'],[3,'M7'],[8,'M7'],[2,'m7b5'],[7,'7'],[0,'m'],[0,'m']]},
  {mode:'minor',name:'Im7–IV7（ドリアン）',file:'DorianVamp',c:[[0,'m7'],[5,'7'],[0,'m7'],[5,'7']],v:[{name:'2拍ずつ',c:[[[0,'m7'],[5,'7']],[[0,'m7'],[5,'7']]]}]},
  {mode:'minor',name:'Im–♭VI–♭VII–Im',file:'Im-bVI-bVII-Im',c:[[0,'m'],[8,''],[10,''],[0,'m']],v:[{name:'7th',c:[[0,'m7'],[8,'M7'],[10,'7'],[0,'m7']]},{name:'V7終止',c:[[0,'m'],[8,''],[10,''],[7,'7']]}]},
  {mode:'minor',name:'Im–♭III–♭VII–IV',file:'Im-bIII-bVII-IV',c:[[0,'m'],[3,''],[10,''],[5,'']],v:[{name:'7th',c:[[0,'m7'],[3,'M7'],[10,'7'],[5,'7']]}]}
].map(p=>({...p,extra:true})));

// ファイル名に使う派生形の英字名（ファイル名に日本語を使わない）
export const VARIANT_FILE={
  '3和音':'Triad','III7版':'III7','ツーファイブ解決':'II-V-Resolve','ベース下降':'BassLine','7th':'7th',
  'IV始まり':'FromIV','sus4':'sus4','分数ベース':'SlashBass','IIm版':'IIm','裏コード':'TritoneSub',
  'V7sus4経由':'V7sus4','VI7版':'VI7','スリーシックス':'III-VI','IIIm7版':'IIIm7','Vm7経由':'Vm7',
  '♭VI始まり':'FrombVI','V7版':'V7','Vm版':'Vm',
  'M7下降':'DescendingM7','IV解決':'ToIV','バックドア':'Backdoor','2拍ずつ':'HalfBar','8小節':'8Bars','IIm7版':'IIm7',
  'I–♭VII–IV':'I-bVII-IV','♭VI・♭VII':'bVI-bVII','IM7–IIm7':'I-IIm','V7終止':'V7End','♭VIM7へ':'TobVIM7'
};

// 派生形の一覧（先頭が基本形）
export const variantsOf=p=>[{name:'基本',c:p.c},...(p.v||[])];

// ダイアトニックコード（'7'＝4和音、'3'＝3和音）
export const DIATONIC={
  '7':{major:[[0,'M7'],[2,'m7'],[4,'m7'],[5,'M7'],[7,'7'],[9,'m7'],[11,'m7b5']],
       minor:[[0,'m7'],[2,'m7b5'],[3,'M7'],[5,'m7'],[7,'m7'],[8,'M7'],[10,'7']]},
  '3':{major:[[0,''],[2,'m'],[4,'m'],[5,''],[7,''],[9,'m'],[11,'dim']],
       minor:[[0,'m'],[2,'dim'],[3,''],[5,'m'],[7,'m'],[8,''],[10,'']]}
};

// 五度圏オーバーレイ：[相対位置, 外周?, ディグリー, トニック?]
export const WHEEL_CELLS={
  major:[[-1,1,'IV'],[0,1,'I',1],[1,1,'V'],[-1,0,'IIm'],[0,0,'VIm'],[1,0,'IIIm'],[2,0,'VIIm♭5']],
  minor:[[-1,1,'♭VI'],[0,1,'♭III'],[1,1,'♭VII'],[-1,0,'IVm'],[0,0,'Im',1],[1,0,'Vm'],[2,0,'IIm♭5']]
};

// 4和音 → 3和音
const TRIAD_OF={M7:'',7:'',m7:'m',m7b5:'dim',dim7:'dim','7sus4':'sus4'};

// 3和音／4和音の切替に合わせて選択中のコードを対応する和音に置き換える。
// 3和音へは7thを落とす。4和音へはダイアトニックの度数に一致するときだけその4和音にする
export function convertChordSize(ch,size,mode){
  if(size==='3')return ch.q in TRIAD_OF?{...ch,q:TRIAD_OF[ch.q]}:ch;
  const i=DIATONIC['3'][mode].findIndex(([off,q])=>off===ch.off&&q===ch.q);
  return i<0?ch:{...ch,q:DIATONIC['7'][mode][i][1]};
}

/* ---------- コード判別 ---------- */
// 同じ構成音なら先に来る種類を優先（例：C E G A は C6 より Am7/C を後に）
const DETECT_ORDER=['','m','7','M7','m7','m7b5','dim','dim7','aug','sus4','7sus4','sus2','6','m6','mM7','add9','9','M9','m9','5'];

/**
 * MIDI ノート番号の集合 → コード候補（良い順、最大 limit 件）。
 * 最低音をベースとし、ルート≠ベースなら分数コードにする。5度を省略した形も低い優先度で候補にする
 */
export function detectChords(midiNotes,limit=4){
  const notes=[...new Set(midiNotes)].sort((a,b)=>a-b);
  if(!notes.length)return [];
  const pcs=[...new Set(notes.map(mod12))], bass=mod12(notes[0]);
  const same=(a,b)=>a.length===b.length&&a.every(x=>b.includes(x));
  const found=[];
  for(const root of pcs){
    DETECT_ORDER.forEach((q,order)=>{
      const tones=[...new Set(CHORD[q].iv.map(i=>mod12(root+i)))];
      let penalty=null;
      if(same(tones,pcs))penalty=0;
      else if(tones.length>=4&&CHORD[q].iv.includes(7)&&same(tones.filter(p=>p!==mod12(root+7)),pcs))penalty=10;   // 5度省略
      if(penalty==null)return;
      if(root!==bass)penalty+=2;
      found.push({root,q,...(root!==bass?{bass}:{}),score:penalty*100+order});
    });
  }
  return found.sort((a,b)=>a.score-b.score).slice(0,limit).map(({score,...c})=>c);
}

/* ---------- 純粋関数 ---------- */
export const mod12=n=>((n%12)+12)%12;
export const tonicOf=(idx,mode)=>mode==='major'?PC_CIRCLE[idx]:mod12(PC_CIRCLE[idx]+9);
export const isFlatKey=idx=>idx>=7;   // 五度圏の位置7〜11は♭表記
export const noteName=(pc,flat)=>(flat?FLAT:SHARP)[mod12(pc)];
export const keyName=(idx,mode)=>mode==='major'?MAJ_LABEL[idx]:MIN_LABEL[idx];
export const degLabel=(iv,sc)=>(sc&&sc.alt&&sc.alt[iv])||DEG[iv];
export const hasBass=ch=>ch.bass!=null&&ch.bass!==ch.root;
export const chordName=(ch,flat)=>noteName(ch.root,flat)+CHORD[ch.q].s+(hasBass(ch)?'/'+spellChordTone(ch.bass,ch.root,flat):'');
export const chordDeg=(off,q,boff)=>ROMAN[off]+CHORD[q].s+(boff!=null?'/'+ROMAN[boff]:'');
export const chordPcs=ch=>{const pcs=CHORD[ch.q].iv.map(x=>mod12(ch.root+x));return hasBass(ch)&&!pcs.includes(ch.bass)?[...pcs,ch.bass]:pcs;};
export const sameChord=(a,b)=>!!a&&!!b&&a.root===b.root&&a.q===b.q&&(a.bass??a.root)===(b.bass??b.root);
// [度数, 種類, ベース度数] → コード（tonic 基準）
export const chordAt=(t,[off,q,boff])=>({root:mod12(t+off),q,off,...(boff!=null?{bass:mod12(t+boff),boff}:{})});

export const BEATS_PER_BAR=4;
const barItems=bar=>Array.isArray(bar[0])?bar:[bar];
// 小節の並び → コード列（各コードに拍数 beats を付ける）
export const progressionChords=(t,bars)=>bars.flatMap(bar=>{
  const items=barItems(bar);
  return items.map(c=>({...chordAt(t,c),beats:BEATS_PER_BAR/items.length}));
});
// ディグリー表記：小節は「 – 」、小節内は「・」でつなぐ
export const progressionDegrees=bars=>bars.map(bar=>barItems(bar).map(([o,q,bo])=>chordDeg(o,q,bo)).join('・')).join(' – ');

// MIDI と同じボイシング：ベース（C2〜B2）＋上声（ルートを C3〜B3 に置いて積む）
export const voicing=ch=>[36+(ch.bass??ch.root),...CHORD[ch.q].iv.map(i=>48+ch.root+i)];

/* ---------- 譜表用の綴り（音名の文字を度数から決める） ---------- */
const LETTERS='CDEFGAB', NATURAL_PC=[0,2,4,5,7,9,11];
const ACC_BY_DIFF={'-2':'𝄫','-1':'♭','0':'','1':'♯','2':'𝄪'};
// pc を指定の文字で綴る（例：pc5 と 'E' → 'E♯'）
export function spellWithLetter(pc,letter){
  let d=mod12(pc-NATURAL_PC[LETTERS.indexOf(letter)]);if(d>6)d-=12;
  return ACC_BY_DIFF[d]!=null?letter+ACC_BY_DIFF[d]:null;
}
const shiftLetter=(name,n)=>LETTERS[(LETTERS.indexOf(name[0])+n)%7];
// スケール音：度数表記（'♭3','♯4' など）の数字で文字を決める
export function spellScaleTone(pc,tonicName,deg){
  return spellWithLetter(pc,shiftLetter(tonicName,parseInt(deg.replace(/[♭♯]/g,''),10)-1));
}
// コード構成音：ルートからの音程で文字を決める（dim7 の 9半音は減7度）
const CHORD_LETTER={0:0,1:1,2:1,3:2,4:2,5:3,6:4,7:4,8:4,9:5,10:6,11:6};
export function spellChordInterval(root,rootName,iv,q){
  const n=iv===9&&q==='dim7'?6:CHORD_LETTER[mod12(iv)];
  return spellWithLetter(mod12(root+iv),shiftLetter(rootName,n));
}

// 調号：五度圏の位置 0〜6 は♯、7〜11 は♭
export const keySignature=idx=>idx<=6?{acc:'♯',count:idx}:{acc:'♭',count:12-idx};
export const scaleById=id=>SCALES.find(s=>s.id===id);

// コード構成音はコードのルート基準で綴る（例：C7の7度はB♭）
export function spellChordTone(pc,root,flat){
  const nn=p=>noteName(p,flat);
  if(SHARP[pc]===FLAT[pc])return nn(pc);
  const ci=mod12(pc-root), rootName=nn(root), rootFlat=rootName.includes('♭');
  if([3,6,10].includes(ci))return rootFlat||!rootName.includes('♯')?FLAT[pc]:nn(pc);
  if([4,7,11].includes(ci))return rootFlat?FLAT[pc]:SHARP[pc];
  return nn(pc);
}
