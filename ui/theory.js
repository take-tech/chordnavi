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
  '7sus4':{s:'7sus4',iv:[0,5,7,10]}, dim7:{s:'dim7',iv:[0,3,6,9]}
};

const rep=(a,n)=>Array(n).fill(a);
// コードは [ルートの度数(半音), 種類, ベースの度数(分数コードのみ)]
// v は派生形（基本形は c）。ここの内容は好みで追加・変更してよい
export const PROGRESSIONS=[
  {mode:'major',name:'王道進行',c:[[5,'M7'],[7,'7'],[4,'m7'],[9,'m']],v:[
    {name:'3和音',c:[[5,''],[7,''],[4,'m'],[9,'m']]},
    {name:'III7版',c:[[5,'M7'],[7,'7'],[4,'7'],[9,'m7']]},
    {name:'ツーファイブ解決',c:[[5,'M7'],[7,'7'],[4,'m7'],[9,'m7'],[2,'m7'],[7,'7'],[0,'M7'],[0,'M7']]}]},
  {mode:'major',name:'カノン進行',c:[[0,''],[7,''],[9,'m'],[4,'m'],[5,''],[0,''],[5,''],[7,'']],v:[
    {name:'ベース下降',c:[[0,''],[7,'',11],[9,'m'],[4,'m',7],[5,''],[0,'',4],[5,''],[7,'']]},
    {name:'III7版',c:[[0,''],[7,''],[9,'m'],[4,'7'],[5,''],[0,''],[5,''],[7,'']]},
    {name:'7th',c:[[0,'M7'],[7,''],[9,'m7'],[4,'m7'],[5,'M7'],[0,'M7'],[5,'M7'],[7,'7']]}]},
  {mode:'major',name:'I–V–VIm–IV',c:[[0,''],[7,''],[9,'m'],[5,'']],v:[
    {name:'ベース下降',c:[[0,''],[7,'',11],[9,'m'],[5,'']]},
    {name:'IV始まり',c:[[5,''],[0,''],[7,''],[9,'m']]},
    {name:'7th',c:[[0,'M7'],[7,''],[9,'m7'],[5,'M7']]}]},
  {mode:'major',name:'小室進行',c:[[9,'m'],[5,''],[7,''],[0,'']],v:[
    {name:'sus4',c:[[9,'m'],[5,''],[7,'sus4'],[0,'']]},
    {name:'分数ベース',c:[[9,'m'],[5,''],[7,''],[0,'',4]]},
    {name:'7th',c:[[9,'m7'],[5,'M7'],[7,'7'],[0,'M7']]}]},
  {mode:'major',name:'50年代進行',c:[[0,''],[9,'m'],[5,''],[7,'']],v:[
    {name:'IIm版',c:[[0,''],[9,'m'],[2,'m'],[7,'']]},
    {name:'7th',c:[[0,'M7'],[9,'m7'],[5,'M7'],[7,'7']]}]},
  {mode:'major',name:'ツーファイブワン',c:[[2,'m7'],[7,'7'],[0,'M7'],[0,'M7']],v:[
    {name:'裏コード',c:[[2,'m7'],[1,'7'],[0,'M7'],[0,'M7']]},
    {name:'V7sus4経由',c:[[2,'m7'],[7,'7sus4'],[7,'7'],[0,'M7']]}]},
  {mode:'major',name:'イチロクニーゴー（循環）',c:[[0,'M7'],[9,'m7'],[2,'m7'],[7,'7']],v:[
    {name:'3和音',c:[[0,''],[9,'m'],[2,'m'],[7,'']]},
    {name:'VI7版',c:[[0,'M7'],[9,'7'],[2,'m7'],[7,'7']]},
    {name:'スリーシックス',c:[[4,'m7'],[9,'7'],[2,'m7'],[7,'7']]},
    {name:'裏コード',c:[[0,'M7'],[9,'7'],[2,'m7'],[1,'7']]}]},
  {mode:'major',name:'丸サ進行',c:[[5,'M7'],[4,'7'],[9,'m7'],[0,'7']],v:[
    {name:'IIIm7版',c:[[5,'M7'],[4,'m7'],[9,'m7'],[0,'7']]},
    {name:'Vm7経由',c:[[5,'M7'],[4,'7'],[9,'m7'],[7,'m7'],[0,'7']]}]},
  {mode:'major',name:'12小節ブルース',c:[...rep([0,'7'],4),...rep([5,'7'],2),...rep([0,'7'],2),[7,'7'],[5,'7'],[0,'7'],[7,'7']],v:[
    {name:'クイックチェンジ',c:[[0,'7'],[5,'7'],[0,'7'],[0,'7'],...rep([5,'7'],2),...rep([0,'7'],2),[7,'7'],[5,'7'],[0,'7'],[7,'7']]},
    {name:'ジャズ・ブルース',c:[[0,'7'],[5,'7'],[0,'7'],[0,'7'],[5,'7'],[6,'dim7'],[0,'7'],[9,'7'],[2,'m7'],[7,'7'],[0,'7'],[7,'7']]}]},
  {mode:'minor',name:'Im–♭VI–♭III–♭VII',c:[[0,'m'],[8,''],[3,''],[10,'']],v:[
    {name:'♭VI始まり',c:[[8,''],[10,''],[0,'m'],[0,'m']]},
    {name:'7th',c:[[0,'m7'],[8,'M7'],[3,'M7'],[10,'7']]}]},
  {mode:'minor',name:'アンダルシア進行',c:[[0,'m'],[10,''],[8,''],[7,'']],v:[
    {name:'V7版',c:[[0,'m'],[10,''],[8,''],[7,'7']]},
    {name:'ベース下降',c:[[0,'m'],[0,'m',10],[8,''],[7,'7']]}]},
  {mode:'minor',name:'マイナー・ツーファイブワン',c:[[2,'m7b5'],[7,'7'],[0,'m7'],[0,'m7']],v:[
    {name:'裏コード',c:[[2,'m7b5'],[1,'7'],[0,'m7'],[0,'m7']]}]},
  {mode:'minor',name:'Im–IVm–V7–Im',c:[[0,'m'],[5,'m'],[7,'7'],[0,'m']],v:[
    {name:'Vm版',c:[[0,'m'],[5,'m'],[7,'m'],[0,'m']]},
    {name:'7th',c:[[0,'m7'],[5,'m7'],[7,'7'],[0,'m7']]}]},
  {mode:'minor',name:'Im–♭VII–♭VI–♭VII',c:[[0,'m'],[10,''],[8,''],[10,'']],v:[
    {name:'7th',c:[[0,'m7'],[10,''],[8,'M7'],[10,'7']]}]},
  {mode:'minor',name:'マイナー12小節ブルース',c:[...rep([0,'m7'],4),...rep([5,'m7'],2),...rep([0,'m7'],2),[8,'7'],[7,'7'],[0,'m7'],[7,'7']],v:[
    {name:'IIm7♭5–V7',c:[...rep([0,'m7'],4),...rep([5,'m7'],2),...rep([0,'m7'],2),[2,'m7b5'],[7,'7'],[0,'m7'],[7,'7']]}]}
];

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
