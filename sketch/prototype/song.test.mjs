// song.js の単体テスト：node sketch/prototype/song.test.mjs
import assert from 'node:assert/strict';
import {demoSong,newSong,newSection,newChord,timeline,placedChords,renderSong,buildSmf,placeChord,resizeChord,insertBars,
  setMark,pruneMarks,setKeyMark,appendSectionFrom,stretchChordStart,keyRegion,mergeSections,splitSection,cloneSection,stretchChord,insertProgression,tickToSec,secToTick,copyRange,pasteAt,nameOf,rangeTicks,PPQ,safeFileName,voicingOf,STRUM_TICKS,withExtension,keyScale,sameKey,PATTERNS,PATTERN_GROUPS} from './song.js';
import {diatonicOf,conformBars,chordDeg} from '../../shared/ui/theory.js';
import {barDrums,pulsesOf,backbeat} from './player.js';

const B=PPQ*4;
let n=0;const test=(name,f)=>{f();n++;console.log('ok',name);};

test('タイムライン：拍子とテンポの変更',()=>{
  const s=newSong();s.sections=[newSection('A',1,4)];
  setMark(s,0,2,0,{meter:[3,4]});setMark(s,0,3,PPQ,{bpm:90});
  const tl=timeline(s);
  assert.deepEqual(tl.bars.map(b=>b.ticks),[B,B,B*3/4,B*3/4]);
  assert.equal(tl.total,B*2+B*3/2);
  assert.deepEqual(tl.tempos,[{tick:0,bpm:120},{tick:B*2+B*3/4+PPQ,bpm:90}]);
  assert.equal(tl.meters.length,2);
});
test('直前と同じテンポ・拍子の変更点は消す（前に変更があれば残す）',()=>{
  const s=newSong();s.sections=[newSection('A',1,4),newSection('B',2,4)];
  setMark(s,0,2,0,{bpm:120});setMark(s,0,3,0,{meter:[4,4]});pruneMarks(s);
  assert.equal(s.sections[0].marks.length,0);                       // 曲全体と同じ → 消える
  setMark(s,0,1,0,{bpm:140});setMark(s,1,0,0,{bpm:120});setMark(s,1,2,0,{bpm:120});pruneMarks(s);
  assert.deepEqual(s.sections.map(x=>x.marks.map(m=>m.bpm)),[[140],[120]]);   // 140 から 120 に戻すのは残す、続く 120 は消える
  setMark(s,0,1,0,{bpm:null});pruneMarks(s);
  assert.deepEqual(s.sections.map(x=>x.marks.length),[0,0]);        // 140 を外すと 120 に戻す変更点もいらなくなる
  s.bpm=100;setMark(s,1,1,0,{bpm:120});s.bpm=120;pruneMarks(s);
  assert.equal(s.sections[1].marks.length,0);                       // 曲全体のテンポを変えて同じになったら消える
});
test('tick ⇔ 秒',()=>{
  const tempos=[{tick:0,bpm:120},{tick:B,bpm:60}];
  assert.equal(tickToSec(tempos,B),2);assert.equal(tickToSec(tempos,B+PPQ),3);
  assert.equal(secToTick(tempos,3),B+PPQ);
});
test('上書きで配置',()=>{
  const s=newSong();const sec=s.sections[0];
  placeChord(s,0,newChord(0,0,B*2,0,''));          // 2小節の C
  placeChord(s,0,newChord(0,B/2,B,7,''));          // 1小節目の3拍目から G を1小節
  const p=placedChords(s);
  assert.deepEqual(p.map(x=>[x.start,x.end,nameOf(s,x.c)]),[[0,B/2,'C'],[B/2,B*3/2,'G'],[B*3/2,B*2,'C']]);
  assert.equal(sec.chords.length,3);
});
test('長さの変更は次のコードまで',()=>{
  const s=newSong();
  const a=placeChord(s,0,newChord(0,0,B,0,''));placeChord(s,0,newChord(2,0,B,7,''));
  resizeChord(s,0,a.id,B*5,PPQ/2);
  assert.equal(s.sections[0].chords.find(c=>c.id===a.id).len,B*2);
});
test('伸ばす：次のコードを上書きし、上限（2小節）で止まる',()=>{
  const s=newSong();
  const a=placeChord(s,0,newChord(0,0,B,0,''));placeChord(s,0,newChord(1,0,B,7,''));placeChord(s,0,newChord(2,0,B,9,'m'));
  stretchChord(s,0,a.id,B*5,PPQ/2,B*2);
  assert.deepEqual(placedChords(s).map(x=>[x.start,x.end,nameOf(s,x.c)]),[[0,B*2,'C'],[B*2,B*3,'Am']]);
});
test('頭を伸ばす：前のコードを上書き、終わりはそのまま、上限とセクションの頭で止まる',()=>{
  const s=newSong();s.sections=[newSection('A',1,4)];
  placeChord(s,0,newChord(0,0,B,0,''));const g=placeChord(s,0,newChord(1,0,B,7,''));
  stretchChordStart(s,0,g.id,B-PPQ/2,PPQ/2,B*2);                     // 半拍前へ（食い）
  assert.deepEqual(placedChords(s).map(x=>[x.start,x.end,nameOf(s,x.c)]),[[0,B-PPQ/2,'C'],[B-PPQ/2,B*2,'G']]);
  stretchChordStart(s,0,g.id,-B,PPQ/2,B*2);                          // セクションの頭より前へは伸ばさない
  assert.deepEqual(placedChords(s).map(x=>[x.start,x.end]),[[0,B*2]]);
  stretchChordStart(s,0,g.id,B*2,PPQ/2,B*2);                         // 後ろへずらすと短くなる（最短 minLen）
  assert.deepEqual(placedChords(s).map(x=>[x.start,x.end]),[[B*2-PPQ/2,B*2]]);
  const h=placeChord(s,0,newChord(3,0,B,5,''));stretchChordStart(s,0,h.id,0,PPQ/2,B*2);   // 上限は2小節
  assert.deepEqual(placedChords(s).at(-1).start,B*2);
});
test('小節の挿入と削除',()=>{
  const s=newSong();placeChord(s,0,newChord(3,0,B,7,''));
  insertBars(s,0,1,2);assert.equal(s.sections[0].chords[0].bar,5);assert.equal(s.sections[0].bars,10);
  insertBars(s,0,1,-2);assert.equal(s.sections[0].chords[0].bar,3);
});
test('全音符：1小節ごとに鳴らし直す、ベースと上声',()=>{
  const s=newSong();s.sections=[newSection('A',1,2)];placeChord(s,0,newChord(0,0,B*2,0,''));
  const r=renderSong(s);
  assert.deepEqual(r.notes.filter(x=>x.t===0).map(x=>x.n),[36,48,52,55]);
  assert.equal(r.notes.filter(x=>x.t===B).length,4);
  assert.equal(r.length,B*2);
});
test('オクターブとベースなし',()=>{
  const s=newSong();s.octave=1;s.bass=false;s.sections=[newSection('A',1,1)];placeChord(s,0,newChord(0,0,B,0,''));
  assert.deepEqual(renderSong(s).notes.map(x=>x.n),[60,64,67]);
});
test('半拍の食い：小節頭を鳴らし直さずタイでつなぐ（同じコードの中）',()=>{
  const s=newSong();s.sections=[newSection('A',1,2)];
  placeChord(s,0,newChord(0,0,B-PPQ/2,0,''));placeChord(s,0,newChord(0,B-PPQ/2,B+PPQ/2,5,''));
  const r=renderSong(s), f=r.notes.filter(x=>x.n===41);
  assert.deepEqual(f.map(x=>[x.t,x.d]),[[B-PPQ/2,PPQ/2+B]]);   // 4拍裏から次の小節の終わりまで1音
  assert.equal(r.notes.filter(x=>x.t===B).length,0);
});
test('半拍の食い：セクションをまたいで同じコードへタイ',()=>{
  const s=demoSong(), tl=timeline(s);
  const sabi=tl.bars[tl.secRanges[2].from].start;
  const r=renderSong(s);
  assert.equal(r.notes.filter(x=>x.t===sabi).length,0);          // サビ頭は鳴らし直さない
  const tie=r.notes.filter(x=>x.t===sabi-PPQ/2);
  assert.ok(tie.length>0&&tie.every(x=>x.t+x.d>sabi));           // 食いの音がサビに伸びる
  assert.ok(r.notes.some(x=>x.t===sabi+PPQ/2));                 // サビの8分刻みは続く
});
test('範囲の書き出し：先頭のテンポ・拍子と、かかっている音の鳴らし直し',()=>{
  const s=demoSong(), tl=timeline(s), rg=rangeTicks(tl,{from:tl.secRanges[2].from,to:tl.secRanges[2].to});
  const r=renderSong(s,rg);
  assert.equal(r.tempos[0].bpm,124);assert.deepEqual(r.meters[0].meter,[4,4]);
  assert.ok(r.notes.every(x=>x.t>=0&&x.t+x.d<=r.length));
  assert.ok(r.notes.some(x=>x.t===0));
});
test('SMF：ヘッダ・トラック長・ノートオン／オフの対応',()=>{
  const s=newSong();s.sections=[newSection('A',1,1)];placeChord(s,0,newChord(0,0,B,0,''));
  const bytes=buildSmf(renderSong(s),'Test');
  assert.deepEqual([...bytes.slice(0,14)],[0x4d,0x54,0x68,0x64,0,0,0,6,0,0,0,1,1,0xe0]);
  const len=(bytes[18]<<24)|(bytes[19]<<16)|(bytes[20]<<8)|bytes[21];
  assert.equal(len,bytes.length-22);
  let i=22,on=0,off=0;const vl=()=>{let v=0,b;do{b=bytes[i++];v=(v<<7)|(b&127);}while(b&128);return v;};
  while(i<bytes.length){vl();const st=bytes[i++];if(st===0xff){i++;const l=vl();i+=l;}else{i+=2;if((st&0xf0)===0x90)on++;else off++;}}
  assert.equal(on,4);assert.equal(off,4);
});
test('コピー＆貼り付け',()=>{
  const s=newSong();s.sections=[newSection('A',1,4),newSection('B',2,4)];
  placeChord(s,0,newChord(0,0,B,0,''));placeChord(s,0,newChord(1,0,B,7,''));
  pasteAt(s,timeline(s).bars[3].start,copyRange(s,{from:0,to:2}));   // A の4小節目から → B の頭にまたがる
  assert.deepEqual(placedChords(s).map(x=>[x.si,x.c.bar,nameOf(s,x.c)]),[[0,0,'C'],[0,1,'G'],[0,3,'C'],[1,0,'G']]);
});
test('途中から始まるコード：バラード・アルペジオ・4分刻みでもベースと和音を鳴らす',()=>{
  for(const pat of ['ballad','arp','quarter','whole']){
    const s=newSong();s.pattern=pat;s.sections=[newSection('A',1,1)];
    placeChord(s,0,newChord(0,0,B/2,9,'m7'));placeChord(s,0,newChord(0,B/2,B/2,2,'m7'));   // Am7（2拍）→ Dm7（3拍目から）
    const at3=renderSong(s).notes.filter(x=>x.t===B/2).map(x=>x.n);
    assert.ok(at3.includes(38),pat+'：3拍目に D のベース');
    assert.ok([50,53,57,60].every(n=>at3.includes(n))||pat==='arp',pat+'：3拍目に Dm7 の和音');
    assert.ok(renderSong(s).notes.every(x=>x.t>=B/2||x.t+x.d<=B/2),pat+'：前のコードの音は3拍目で切れる');
  }
});
test('定番進行を入れる：上書き・2コードの小節・足りない小節は増やす',()=>{
  const s=newSong();s.sections=[newSection('A',1,4)];placeChord(s,0,newChord(2,0,B,4,'m'));
  const r=insertProgression(s,2,[[5,'M7'],[[2,'m7'],[7,'7']],[0,'']]);
  assert.deepEqual(r,{from:2,to:5});assert.equal(s.sections[0].bars,5);
  assert.deepEqual(placedChords(s).map(x=>[x.start/PPQ,nameOf(s,x.c)]),[[8,'FM7'],[12,'Dm7'],[14,'G7'],[16,'C']]);
});
test('コードごとのパターン：コード → セクション → 曲の順',()=>{
  const s=newSong();s.pattern='whole';s.sections=[newSection('A',1,2)];
  placeChord(s,0,newChord(0,0,B,0,''));placeChord(s,0,{...newChord(1,0,B,7,''),pattern:'quarter'});
  assert.deepEqual(placedChords(s).map(x=>x.pattern),['whole','quarter']);
  s.sections[0].pattern='eighth';
  assert.deepEqual(placedChords(s).map(x=>x.pattern),['eighth','quarter']);
  const hitsIn=(a,b)=>new Set(renderSong(s).notes.filter(n=>n.t>=a&&n.t<b).map(n=>n.t)).size;
  assert.equal(hitsIn(0,B),8);assert.equal(hitsIn(B,B*2),4);
  // コピー＆貼り付けでもパターンを保つ
  pasteAt(s,0,copyRange(s,{from:1,to:2}));
  assert.equal(placedChords(s)[0].pattern,'quarter');
});
test('セクションの結合：複製したサビを1つに、音は変わらない',()=>{
  const s=demoSong(), before=renderSong(s);
  s.sections.splice(3,0,cloneSection(s.sections[2]));        // サビを複製して2回続ける
  const dup=renderSong(s);
  assert.ok(mergeSections(s,2));
  assert.equal(s.sections.length,3);assert.equal(s.sections[2].bars,16);assert.equal(s.sections[2].name,'サビ');
  assert.deepEqual(renderSong(s),dup);                       // 結合しても MIDI は同じ
  assert.equal(s.sections[2].marks.filter(m=>m.bpm).length,2);  // 2つ目のサビ頭のテンポ変更も残る（同じ値なので pruneMarks をすれば消える）
  pruneMarks(s,2);assert.equal(s.sections[2].marks.length,1);
  assert.ok(before.notes.length>0);
});
test('セクションの結合：パターンが違うと後ろのコードに元のパターンを付ける',()=>{
  const s=newSong();s.pattern='whole';s.sections=[newSection('A',1,1),newSection('B',2,1)];
  s.sections[1].pattern='eighth';
  placeChord(s,0,newChord(0,0,B,0,''));placeChord(s,1,newChord(0,0,B,7,''));
  const r0=renderSong(s);mergeSections(s,0);
  assert.deepEqual(renderSong(s),r0);assert.equal(s.sections[0].chords[1].pattern,'eighth');
  assert.equal(mergeSections(s,0),false);                    // 次が無いときは何もしない
});
test('セクションの分割：結合の逆、またぐコードは2つに切る',()=>{
  const s=demoSong(), r0=renderSong(s);
  assert.ok(splitSection(s,1,4));                               // Aメロを 4＋4 に
  assert.deepEqual(s.sections.map(x=>x.name+x.bars),['Intro4','Aメロ4','Aメロ4','サビ8']);
  assert.deepEqual(renderSong(s),r0);                           // 小節線で分けたので MIDI は同じ
  mergeSections(s,1);assert.deepEqual(renderSong(s),r0);
  // 2小節のコードの途中で分ける
  const t=newSong();t.sections=[newSection('A',1,4)];placeChord(t,0,newChord(1,0,B*2,0,''));t.sections[0].marks=[{bar:3,pos:0,bpm:90}];
  splitSection(t,0,2);
  assert.deepEqual(t.sections.map(x=>x.chords.map(c=>[c.bar,c.len/B])),[[[1,1]],[[0,1]]]);
  assert.deepEqual(t.sections[1].marks,[{bar:1,pos:0,bpm:90}]);
  assert.equal(splitSection(t,0,0),false);assert.equal(splitSection(t,0,2),false);
});
test('ボイシング：ギターは弾けるフォーム（最低音＝ベース）、前のコードから近い形',()=>{
  const s=newSong();s.voicing='guitar';s.sections=[newSection('A',1,2)];
  placeChord(s,0,newChord(0,0,B,0,''));placeChord(s,0,newChord(1,0,B,7,''));
  const c=voicingOf(s,{root:0,q:''});
  assert.equal(c.bass%12,0);assert.ok(c.upper.length>=3&&c.upper.every(n=>n>c.bass&&n<=76));   // 1弦開放 E4＋15フレットまで
  assert.deepEqual([c.bass,...c.upper],c.form.notes);
  const r=renderSong(s), first=r.notes.filter(n=>n.t<STRUM_TICKS*6);
  assert.deepEqual(first.map(n=>n.n),[...c.form.notes]);                    // ダウン：低い弦から
  assert.deepEqual(first.map(n=>n.t),first.map((_,k)=>k*STRUM_TICKS));      // 弦ごとに少しずつずらす
  assert.ok(first.every(n=>n.t+n.d===B));                                   // 終わりはそろえる
  // ピアノは今までどおり
  s.voicing='piano';assert.deepEqual(renderSong(s).notes.filter(n=>n.t===0).map(n=>n.n),[36,48,52,55]);
});
test('ボイシング：ギターの8分刻みは裏拍でアップ（高い弦から）',()=>{
  const s=newSong();s.voicing='guitar';s.pattern='eighth';s.sections=[newSection('A',1,1)];placeChord(s,0,newChord(0,0,B,7,''));
  const up=renderSong(s).notes.filter(n=>n.t>=PPQ/2&&n.t<PPQ/2+STRUM_TICKS*6);
  assert.ok(up.length>=4);
  assert.deepEqual(up.map(n=>n.n),[...up.map(n=>n.n)].sort((a,b)=>b-a));
});
test('途中のキー変更：度数はその位置のキーが基準、コードも移調／音を保つ',()=>{
  const mk=()=>{const s=newSong();s.sections=[newSection('A',1,2),newSection('サビ',3,2)];
    placeChord(s,0,newChord(0,0,B,0,''));placeChord(s,0,newChord(1,0,B,7,''));placeChord(s,1,newChord(0,0,B,5,''));placeChord(s,1,newChord(1,0,B,7,''));return s;};
  // 移調（度数を保つ）：サビを D へ
  let s=mk();setKeyMark(s,1,0,{idx:2,mode:'major'},false);
  assert.deepEqual(placedChords(s).map(p=>nameOf(s,p.c,p.key)),['C','G','G','A']);
  assert.deepEqual(renderSong(s).notes.filter(n=>n.t===B*2).map(n=>n.n),[43,55,59,62]);   // G（D キーの IV）
  const tl=timeline(s);assert.deepEqual([tl.bars[1].key.idx,tl.bars[2].key.idx],[0,2]);
  assert.deepEqual(keyRegion(tl,3),{from:2,to:4,key:{idx:2,mode:'major'},mark:{si:1,bar:0}});
  // 音を保つ：サビの F・G はそのまま、度数だけ D キーの ♭III・IV に
  s=mk();setKeyMark(s,1,0,{idx:2,mode:'major'},true);
  assert.deepEqual(placedChords(s).map(p=>nameOf(s,p.c,p.key)),['C','G','F','G']);
  assert.deepEqual(s.sections[1].chords.map(c=>c.off),[3,5]);
  // 外す（音を保つ）と元の度数に戻る、直前と同じキーの変更点は消える
  setKeyMark(s,1,0,null,true);assert.deepEqual(s.sections[1].chords.map(c=>c.off),[5,7]);
  s.sections[1].marks.push({bar:0,pos:0,key:{idx:0,mode:'major'}});pruneMarks(s);assert.equal(s.sections[1].marks.length,0);
});
test('ギターのアルペジオ：頭はベースだけ、上の弦を上って下る、弦は鳴らしたまま',()=>{
  const s=newSong();s.voicing='guitar';s.pattern='arp';s.sections=[newSection('A',1,1)];placeChord(s,0,newChord(0,0,B,0,''));
  const form=voicingOf(s,{root:0,q:''}).form, [low,...up]=form.notes, r=renderSong(s).notes;
  assert.deepEqual(r.filter(n=>n.t===0).map(n=>n.n),[low]);                       // 1拍目はベースだけ
  const arp=r.filter(n=>n.t>0).sort((a,b)=>a.t-b.t);
  assert.equal(arp.length,7);
  const seq=[...up.keys(),...[...up.keys()].slice(1,-1).reverse()];
  assert.deepEqual(arp.map(n=>n.n),[...seq,...seq].slice(0,7).map(i=>up[i]));      // 上って下る
  assert.ok(arp.every(n=>form.notes.includes(n.n)));                               // フォームの外の音は無い
  assert.ok(arp[0].d>PPQ);                                                          // 鳴らしたまま（8分より長い）
  for(const n of arp){const nx=arp.find(m=>m.n===n.n&&m.t>n.t);assert.ok(n.t+n.d<=(nx?nx.t:B));}   // 同じ弦を弾き直す前に止める
  // バラード：伸ばす和音は外す（同じ音が重ならない）
  s.pattern='ballad';const b=renderSong(s).notes;
  assert.ok(b.every(n=>!b.some(m=>m!==n&&m.n===n.n&&m.t<n.t+n.d&&n.t<m.t+m.d)));
});
test('バラード：音の高さの順で 1・2・4・3（ピアノ・ギター）',()=>{
  for(const v of ['piano','guitar']){
    const s=newSong();s.voicing=v;s.pattern='ballad';s.sections=[newSection('A',1,1)];placeChord(s,0,newChord(0,0,B,0,''));
    const r=renderSong(s).notes, at=t=>Math.max(...r.filter(n=>n.t>=t&&n.t<t+STRUM_TICKS*6&&(n.t>0||n.n===Math.min(...r.filter(m=>m.t===0).map(m=>m.n)))).map(n=>n.n));
    const [a,b,c,d]=[0,PPQ,PPQ*2,PPQ*3].map(t=>t===0?Math.min(...r.filter(n=>n.t===0).map(n=>n.n)):at(t));
    assert.ok(a<b&&b<d&&d<c,v+'：'+[a,b,c,d].join(','));
  }
});
test('保存の名前：拡張子が無ければ付ける',()=>{
  assert.equal(withExtension('サビ案','.mid'),'サビ案.mid');
  assert.equal(withExtension('song.MID','.mid'),'song.MID');                 // 大文字でも付けない
  assert.equal(withExtension('song.mid','.chordsketch'),'song.mid.chordsketch');
  assert.equal(withExtension('  a/b:c?  ','.mid'),'a_b_c_.mid');             // 使えない文字は _
  assert.equal(withExtension('曲.','.chordsketch'),'曲.chordsketch');         // 末尾のドットは外す
  assert.equal(withExtension('','.mid','Song'),'Song.mid');
  assert.equal(withExtension('.mid','.mid','Song'),'Song.mid');
});
test('スケール：既定はモードのスケール、度数番号でロクリアンの ♭V を正しく書く',()=>{
  assert.equal(keyScale({idx:0,mode:'major'}),'major');assert.equal(keyScale({idx:9,mode:'minor'}),'nminor');
  assert.equal(keyScale({idx:0,mode:'major',scale:'dorian'}),'dorian');assert.equal(keyScale({idx:0,mode:'major',scale:'ct_M7'}),'major');   // コードトーンは使わない
  assert.ok(!sameKey({idx:0,mode:'major'},{idx:0,mode:'major',scale:'lydian'}));
  const s=newSong();s.key={idx:0,mode:'major',scale:'locrian'};s.sections=[newSection('A',1,1)];
  const [off,q,,deg]=diatonicOf('locrian',4)[4];                                    // ロクリアンの5度
  placeChord(s,0,{...newChord(0,0,B,off,q),deg});
  const p=placedChords(s)[0];
  assert.equal(nameOf(s,p.c,p.key),'G♭M7');assert.equal(chordDeg(off,q,undefined,deg),'♭VM7');
  // 定番進行もスケールに合わせて作り直せる（ドリアンの IVM7 → IV7）
  const bars=conformBars([[5,'M7'],[7,'7']],'major','dorian');
  assert.deepEqual(bars.map(b=>b[1]),['7','m7']);
  insertProgression(s,0,bars);assert.ok(s.sections[0].chords.every(c=>c.deg!=null));
});
test('ドラム：3拍子系（3/4・6/8・9/8）も大きな拍ごとに組み立てる',()=>{
  const ks=(kind,m)=>barDrums(kind,m).filter(([,k])=>k==='kick'||k==='snare').sort((a,b)=>a[0]-b[0]).map(([x,k])=>x+(k==='kick'?'K':'S')).join(' ');
  assert.equal(ks('8beat',[4,4]),'0K 1S 2K 2.5K 3S');                  // 4/4 は今までどおり
  assert.equal(ks('8beat',[3,4]),'0K 1S 2S');                           // ワルツ
  assert.equal(ks('8beat',[6,8]),'0K 3S');                              // 付点4分が2つ
  assert.equal(ks('8beat',[9,8]),'0K 3S 6S');
  assert.equal(ks('8beat',[12,8]),'0K 3S 6K 9S');
  assert.equal(ks('8beat',[5,4]),'0K 1S 2K 3S 4S');
  assert.deepEqual(pulsesOf([6,8]),{P:2,size:3,compound:true});assert.deepEqual(backbeat(7),['K','S','K','S','K','S','S']);
  const hats=(kind,m)=>barDrums(kind,m).filter(([,k])=>k.startsWith('hat')).map(([x])=>x).sort((a,b)=>a-b);
  assert.deepEqual(hats('8beat',[6,8]),[0,1,2,3,4,5]);                  // 6/8 は8分で刻む
  assert.deepEqual(hats('shuffle',[6,8]),[0,2,3,5]);                    // 3連の1つ目と3つ目
  assert.equal(hats('16beat',[3,4]).length,12);
  assert.ok(barDrums('8beat',[7,8]).every(([x])=>x<7));                 // 小節からはみ出さない
  assert.equal(ks('four',[4,4]),'0K 1K 1S 2K 3K 3S');                   // 4つ打ち
  assert.equal(ks('four',[6,8]),'0K 3K 3S');
});
test('別の曲の最後にセクションを付ける：コード名・位置はそのまま（キー・拍子が違えば変更点を付ける）',()=>{
  const a=demoSong();                                   // C メジャー 4/4
  const b=newSong();b.key={idx:2,mode:'major'};b.meter=[3,4];b.sections=[newSection('A',1,2)];placeChord(b,0,newChord(0,0,B*3/4,0,''));
  const names=(s,si)=>placedChords(s).filter(p=>p.si===si).map(p=>nameOf(s,p.c,p.key)+'@'+(p.start-timeline(s).bars[timeline(s).secRanges[si].from].start));
  const before=names(a,2);
  const sec=appendSectionFrom(a,2,b);
  assert.equal(b.sections.length,2);assert.equal(sec.name,'サビ');
  assert.deepEqual(names(b,1),before);                                                   // コード名も位置も同じ
  assert.ok(sec.marks.some(m=>m.key&&m.key.idx===0)&&sec.marks.some(m=>m.meter&&m.meter.join()==='4,4'));
  assert.equal(b.sections[0].chords.length,1);assert.equal(a.sections.length,3);         // 元の曲・付け先の前のセクションは変えない
  // 同じキー・拍子なら変更点は付けない（元からあるテンポの変更点はそのまま）
  const c=demoSong();appendSectionFrom(a,1,c);assert.deepEqual(c.sections.at(-1).marks,[]);
});
test('パターンを増やす：バンド・EDM、すべて小節の中に収まる、オフビートは拍の頭で鳴らさない',()=>{
  for(const p of PATTERNS){
    const s=newSong();s.pattern=p.id;s.sections=[newSection('A',1,2)];placeChord(s,0,newChord(0,0,B,0,''));placeChord(s,0,newChord(1,0,B,7,''));
    const r=renderSong(s).notes;
    assert.ok(r.length>0,p.id+'：音がある');
    assert.ok(r.every(n=>n.t>=0&&n.t+n.d<=B*2&&n.v>0&&n.v<=127),p.id+'：小節の中・ベロシティ');
    assert.ok(PATTERN_GROUPS.some(g=>g.id===p.group)&&p.short,p.id+'：まとまりと短い名前');
  }
  const s=newSong();s.pattern='offbeat';s.sections=[newSection('A',1,1)];placeChord(s,0,newChord(0,0,B,0,''));
  const on=renderSong(s).notes.filter(n=>n.t%PPQ===0);
  assert.equal(on.length,0);                                                  // 拍の頭には無い
  s.pattern='trance';assert.equal(new Set(renderSong(s).notes.filter(n=>n.n>=48).map(n=>n.t)).size,16);   // 16分で刻む
  s.pattern='waltz';s.meter=[3,4];s.sections=[newSection('A',1,1)];placeChord(s,0,newChord(0,0,B*3/4,0,''));
  assert.deepEqual([...new Set(renderSong(s).notes.map(n=>n.t))],[0,PPQ,PPQ*2]);   // ワルツ：1拍目ベース、2・3拍目和音
});
test('ファイル名',()=>{assert.equal(safeFileName('サビ F♯m7 B♭'),'F#m7_Bb');});
console.log(`${n} tests passed`);
