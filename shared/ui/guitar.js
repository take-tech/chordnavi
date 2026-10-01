/* ギターのコードフォーム（ボイシング）を探す。UI は持たない純粋な関数だけ。
   チューニングは開放弦の音（MIDI）の並びで、添字 0＝1弦（いちばん高い弦）〜 末尾＝いちばん低い弦（6〜8弦）。
   フレット null はミュート。チューニングを渡さなければレギュラー（6弦）。ChordNavi は弦ごとに半音ずつ変えられる（6〜8弦）。 */
import {CHORD,mod12} from './theory.js';

export const OPEN_MIDI=[64,59,55,50,45,40];
// 1つの形で鳴らす弦は、ベースの弦から高いほうへ最大 6 本（7・8弦でも手の届く幅）
const WINDOW=6;
const LOW_CLEAR=45;   // A2
const MAX_FRET=15, SPAN=3, MAX_FINGERS=4;

const cache=new Map();

/**
 * 弾ける形をすべて探して、良い順に返す。
 * ・最低音（ベースを置く弦）がルート（分数コードは指定のベース）
 * ・押さえる範囲は 3 フレット以内、指は 4 本以内（同じフレットの複数弦はセーハで 1 本と数える）
 * ・4 弦以上鳴らす。途中のミュートは 1 本まで、高音側のミュートは 2 本まで
 * ・構成音はすべて入れる（4 音以上のコードは 5 度を省略してよい）
 */
export function guitarVoicings(ch,tuning=OPEN_MIDI){
  const key=`${tuning.join(',')}|${ch.root}:${ch.q}:${ch.bass??''}`;
  if(cache.has(key))return cache.get(key);
  // 低い音域の決まり（下）を守ると形が無いときだけ、決まりを外して探し直す
  let list=search(ch,tuning,true);
  if(!list.length)list=search(ch,tuning,false);
  cache.set(key,list);
  return list;
}

function search(ch,tuning,clearLow){
  const iv=CHORD[ch.q].iv, root=ch.root, bassPc=ch.bass??root;
  const tones=[...new Set(iv.map(i=>mod12(root+i)))];
  const fifth=iv.includes(7)&&tones.length>=4?mod12(root+7):null;   // 省略してよい 5 度
  const required=tones.filter(p=>p!==fifth);
  const isTone=pc=>tones.includes(pc);
  const found=new Map();

  const n=tuning.length;
  for(let bs=n-1;bs>=3;bs--){                     // ベースを置く弦：いちばん低い弦〜4弦（6弦なら 6・5・4弦）
    const top=Math.max(0,bs-WINDOW+1);            // 鳴らせるいちばん高い弦（これより高い弦はミュート）
    for(let fb=0;fb<=MAX_FRET-2;fb++){
      if(mod12(tuning[bs]+fb)!==bassPc)continue;
      const bassMidi=tuning[bs]+fb;
      // 押さえる範囲（lo〜lo+3）。ベースが開放なら低いフレットの範囲だけ
      const los=fb===0?[1,2]:range(Math.max(1,fb-SPAN),fb);
      for(const lo of los){
        const hi=lo+SPAN, allowOpen=lo<=4;
        const options=[];
        for(let s=bs-1;s>=top;s--){
          const opt=[null];
          if(allowOpen&&isTone(mod12(tuning[s])))opt.push(0);
          for(let f=lo;f<=hi&&f<=MAX_FRET;f++)if(isTone(mod12(tuning[s]+f)))opt.push(f);
          options.push({s,opt});
        }
        product(options,frets=>{
          const full=Array(n).fill(null);
          full[bs]=fb;
          for(const [s,f] of frets)full[s]=f;
          const v=evaluate(full,bs,top,bassMidi,required,tones,root,fifth,tuning,clearLow);
          if(v){const k=full.join(',');if(!found.has(k)||found.get(k).score>v.score)found.set(k,v);}
        });
      }
    }
  }
  return [...found.values()].sort((a,b)=>a.score-b.score);
}

function evaluate(frets,bs,win,bassMidi,required,tones,root,fifth,tuning,clearLow){
  const played=[];
  for(let s=0;s<=bs;s++)if(frets[s]!=null)played.push(s);
  const notes=played.map(s=>tuning[s]+frets[s]);
  // ベースより低い音は出さない
  for(const s of played)if(s!==bs&&tuning[s]+frets[s]<=bassMidi)return null;
  // A2 より低い音域（7・8弦・低いチューニング）では、ベースの上はルートと 5 度だけ（3 度などは濁る）
  if(clearLow)for(const s of played)if(s!==bs&&tuning[s]+frets[s]<LOW_CLEAR&&![root,mod12(root+7)].includes(mod12(tuning[s]+frets[s])))return null;
  const pcs=new Set(notes.map(mod12));
  if(!pcs.has(root)||!required.every(p=>pcs.has(p)))return null;

  const top=played[0];                                       // 一番高い弦
  let inner=0;for(let s=top;s<bs;s++)if(frets[s]==null)inner++;
  const trailing=top-win;                                    // 高い弦の側のミュート数（鳴らせる幅の中で）
  if(inner>1||trailing>2||played.length<4)return null;

  const fretted=played.map(s=>frets[s]).filter(f=>f>0);
  const lo=fretted.length?Math.min(...fretted):0, hi=fretted.length?Math.max(...fretted):0;
  let atMin=0;
  if(fretted.length){
    if(hi-lo>SPAN)return null;
    atMin=fretted.filter(f=>f===lo).length;
    const fingers=atMin>=2?1+fretted.length-atMin:fretted.length;
    if(fingers>MAX_FINGERS)return null;
  }
  const opens=played.filter(s=>frets[s]===0).length;
  // 開放弦はローポジション（押さえるのが 4 フレットまで）のときだけ
  if(opens&&hi>4)return null;
  const openPosition=hi<=3;
  const bassFret=frets[bs];
  // ベースのフレットでセーハしている形は、その上の弦を開放で鳴らせない
  if(opens&&bassFret>0&&bassFret===lo&&atMin>=2)return null;
  // ハイポジションでベースの指より低いフレットを押さえる形は手を広げすぎる
  const behind=bassFret>=4?played.filter(s=>s!==bs&&frets[s]>0&&frets[s]<bassFret).length:0;
  const missingFifth=fifth!=null&&!pcs.has(fifth);
  const score=lo*0.4+inner*3+trailing*1.5+(6-played.length)*0.8+(missingFifth?1.5:0)
    +(opens?(openPosition?-1:opens*2.5):0)+behind*1.5
    -(bassFret>0&&bassFret===lo&&atMin>=2?0.5:0);   // ベースから押さえるセーハの形
  return {frets:[...frets],bassString:bs,lo,open:opens>0,center:fretted.length?(Math.min(...fretted)+Math.max(...fretted))/2:0,
          notes:[...played].reverse().map(s=>tuning[s]+frets[s]),score};
}

function range(a,b){const r=[];for(let i=a;i<=b;i++)r.push(i);return r;}
function product(options,cb,i=0,acc=[]){
  if(i===options.length){cb(acc);return;}
  const {s,opt}=options[i];
  for(const f of opt){acc.push([s,f]);product(options,cb,i+1,acc);acc.pop();}
}

// 代表的な 3 ポジション：低いほうの 3 本（6弦なら 6・5・4弦ルート）のそれぞれで一番良い形（低い順に並べる）
export function threePositions(ch,tuning=OPEN_MIDI){
  const all=guitarVoicings(ch,tuning), picks=[], n=tuning.length;
  for(const bs of [n-1,n-2,n-3]){const v=all.find(x=>x.bassString===bs);if(v)picks.push(v);}
  return picks.sort((a,b)=>a.lo-b.lo);
}

// 進行用：狙ったあたりのフレット（ロー 0〜・ミドル 5〜・ハイ 9〜）で、前のコードから手の移動が少ない形
export const TAB_AREAS={low:1,mid:5,high:9};
export function nearestVoicing(ch,target,prev,tuning=OPEN_MIDI){
  const all=guitarVoicings(ch,tuning);
  let best=null,bestCost=Infinity;
  for(const v of all.slice(0,80)){
    const cost=Math.abs(v.center-target)*1.2+v.score*0.5+(prev?Math.abs(v.center-prev.center)*0.6:0);
    if(cost<bestCost){best=v;bestCost=cost;}
  }
  return best;
}
