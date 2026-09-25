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
  dim:{s:'dim',iv:[0,3,6]}, aug:{s:'aug',iv:[0,4,8]}, sus4:{s:'sus4',iv:[0,5,7]}
};

const rep=(a,n)=>Array(n).fill(a);
export const PROGRESSIONS=[
  {mode:'major',name:'王道進行',c:[[5,'M7'],[7,'7'],[4,'m7'],[9,'m']]},
  {mode:'major',name:'カノン進行',c:[[0,''],[7,''],[9,'m'],[4,'m'],[5,''],[0,''],[5,''],[7,'']]},
  {mode:'major',name:'I–V–VIm–IV',c:[[0,''],[7,''],[9,'m'],[5,'']]},
  {mode:'major',name:'小室進行',c:[[9,'m'],[5,''],[7,''],[0,'']]},
  {mode:'major',name:'50年代進行',c:[[0,''],[9,'m'],[5,''],[7,'']]},
  {mode:'major',name:'ツーファイブワン',c:[[2,'m7'],[7,'7'],[0,'M7'],[0,'M7']]},
  {mode:'major',name:'イチロクニーゴー（循環）',c:[[0,'M7'],[9,'m7'],[2,'m7'],[7,'7']]},
  {mode:'major',name:'丸サ進行',c:[[5,'M7'],[4,'7'],[9,'m7'],[0,'7']]},
  {mode:'major',name:'12小節ブルース',c:[...rep([0,'7'],4),...rep([5,'7'],2),...rep([0,'7'],2),[7,'7'],[5,'7'],[0,'7'],[7,'7']]},
  {mode:'minor',name:'Im–♭VI–♭III–♭VII',c:[[0,'m'],[8,''],[3,''],[10,'']]},
  {mode:'minor',name:'アンダルシア進行',c:[[0,'m'],[10,''],[8,''],[7,'']]},
  {mode:'minor',name:'マイナー・ツーファイブワン',c:[[2,'m7b5'],[7,'7'],[0,'m7'],[0,'m7']]},
  {mode:'minor',name:'Im–IVm–V7–Im',c:[[0,'m'],[5,'m'],[7,'7'],[0,'m']]},
  {mode:'minor',name:'Im–♭VII–♭VI–♭VII',c:[[0,'m'],[10,''],[8,''],[10,'']]},
  {mode:'minor',name:'マイナー12小節ブルース',c:[...rep([0,'m7'],4),...rep([5,'m7'],2),...rep([0,'m7'],2),[8,'7'],[7,'7'],[0,'m7'],[7,'7']]}
];

export const DIATONIC={
  major:[[0,'M7'],[2,'m7'],[4,'m7'],[5,'M7'],[7,'7'],[9,'m7'],[11,'m7b5']],
  minor:[[0,'m7'],[2,'m7b5'],[3,'M7'],[5,'m7'],[7,'m7'],[8,'M7'],[10,'7']]
};

// 五度圏オーバーレイ：[相対位置, 外周?, ディグリー, トニック?]
export const WHEEL_CELLS={
  major:[[-1,1,'IV'],[0,1,'I',1],[1,1,'V'],[-1,0,'IIm'],[0,0,'VIm'],[1,0,'IIIm'],[2,0,'VIIm♭5']],
  minor:[[-1,1,'♭VI'],[0,1,'♭III'],[1,1,'♭VII'],[-1,0,'IVm'],[0,0,'Im',1],[1,0,'Vm'],[2,0,'IIm♭5']]
};

/* ---------- 純粋関数 ---------- */
export const mod12=n=>((n%12)+12)%12;
export const tonicOf=(idx,mode)=>mode==='major'?PC_CIRCLE[idx]:mod12(PC_CIRCLE[idx]+9);
export const isFlatKey=idx=>idx>=7;   // 五度圏の位置7〜11は♭表記
export const noteName=(pc,flat)=>(flat?FLAT:SHARP)[mod12(pc)];
export const keyName=(idx,mode)=>mode==='major'?MAJ_LABEL[idx]:MIN_LABEL[idx];
export const degLabel=(iv,sc)=>(sc&&sc.alt&&sc.alt[iv])||DEG[iv];
export const chordName=(ch,flat)=>noteName(ch.root,flat)+CHORD[ch.q].s;
export const chordDeg=(off,q)=>ROMAN[off]+CHORD[q].s;
export const chordPcs=ch=>CHORD[ch.q].iv.map(x=>mod12(ch.root+x));
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
