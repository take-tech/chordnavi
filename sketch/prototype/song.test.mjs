// song.js の単体テスト：node sketch/prototype/song.test.mjs
import assert from 'node:assert/strict';
import {demoSong,newSong,newSection,newChord,timeline,placedChords,renderSong,buildSmf,placeChord,resizeChord,insertBars,
  setMark,tickToSec,secToTick,copyRange,pasteAt,nameOf,rangeTicks,PPQ,safeFileName} from './song.js';

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
test('ファイル名',()=>{assert.equal(safeFileName('サビ F♯m7 B♭'),'F#m7_Bb');});
console.log(`${n} tests passed`);
