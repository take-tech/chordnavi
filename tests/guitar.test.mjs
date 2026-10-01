// ギターのフォーム探索（shared/ui/guitar.js）とチューニングのテスト：node tests/guitar.test.mjs
import assert from 'node:assert/strict';
import {guitarVoicings,threePositions,nearestVoicing,OPEN_MIDI} from '../shared/ui/guitar.js';
// よく使うチューニング（添字 0＝1弦）
const TUNINGS=[
  {id:'standard',strings:[64,59,55,50,45,40]},{id:'half',strings:[63,58,54,49,44,39]},{id:'whole',strings:[62,57,53,48,43,38]},
  {id:'dropD',strings:[64,59,55,50,45,38]},{id:'dropC',strings:[62,57,53,48,43,36]},{id:'dadgad',strings:[62,57,55,50,45,38]},
  {id:'openG',strings:[62,59,55,50,43,38]},{id:'openD',strings:[62,57,54,50,45,38]},{id:'openE',strings:[64,59,56,52,47,40]},
  {id:'std7',strings:[64,59,55,50,45,40,35]},{id:'dropA7',strings:[64,59,55,50,45,40,33]},
  {id:'std8',strings:[64,59,55,50,45,40,35,30]},{id:'dropE8',strings:[64,59,55,50,45,40,35,28]},
];
import {CHORD} from '../shared/ui/theory.js';
let n=0;const t=(name,fn)=>{fn();n++;console.log('ok',name);};

t('チューニングを渡さなければレギュラー（前と同じ結果）',()=>{
  assert.deepEqual(guitarVoicings({root:0,q:''}),guitarVoicings({root:0,q:''},OPEN_MIDI));
  assert.deepEqual(threePositions({root:0,q:''})[0].frets,[0,1,0,2,3,null]);   // C のオープン
});
t('どのチューニングでも、すべてのコードの形が見つかる',()=>{
  for(const tu of TUNINGS)for(const q of Object.keys(CHORD))for(let r=0;r<12;r++)
    assert.ok(guitarVoicings({root:r,q},tu.strings).length,`${tu.id} ${r} ${q}`);
});
t('弦の本数に合わせたフレットの並び、ベースはいちばん低い音',()=>{
  for(const tu of TUNINGS){
    const v=threePositions({root:7,q:'7'},tu.strings)[0];
    assert.equal(v.frets.length,tu.strings.length);
    const notes=v.frets.map((f,s)=>f==null?null:tu.strings[s]+f).filter(x=>x!=null);
    assert.equal(Math.min(...notes),tu.strings[v.bassString]+v.frets[v.bassString]);
  }
});
t('7・8弦：鳴らす弦は 6 本まで、A2 より下はルートと 5 度だけ',()=>{
  const t8=TUNINGS.find(x=>x.id==='std8').strings;
  for(let r=0;r<12;r++)for(const q of ['','m','7','M7','m7']){
    for(const v of guitarVoicings({root:r,q},t8).slice(0,20)){
      const played=v.frets.map((f,s)=>f==null?null:s).filter(s=>s!=null);
      assert.ok(Math.max(...played)-Math.min(...played)<6);
      for(const s of played)if(s!==v.bassString&&t8[s]+v.frets[s]<45)assert.ok([r,(r+7)%12].includes((t8[s]+v.frets[s])%12));
    }
  }
});
t('オープン G：G は開放弦だけで弾ける',()=>{
  const tg=TUNINGS.find(x=>x.id==='openG').strings;
  assert.ok(guitarVoicings({root:7,q:''},tg).some(v=>v.frets.every(f=>f==null||f===0)));
  assert.ok(nearestVoicing({root:7,q:''},1,null,tg));
});
console.log(`${n} tests passed`);
