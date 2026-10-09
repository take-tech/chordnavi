// コード譜の「メロディー：五線譜」（リードシート）。VexFlow（vendor/vexflow.js、MIT）で1段ずつ SVG に描く。
// 1段4小節：上にコード名、まん中にト音記号の五線（メロディー）、下に度数。メロディーの無い小節は拍の数だけスラッシュ。
// 音の長さは16分（拍によっては3連8分）にそろえて書き、拍・小節線・段をまたぐ音はタイでつなぐ（曲のデータは変えない）。
// コード名・度数は決まった高さに書き、近すぎて重なるときは2段目に逃がす（それでも重なれば右へずらす）。省略はしない
import {placedChords,placedNotes,nameOf,beatTicksOf,meterFamily,SECTION_COLORS} from './song.js';
import {chordDeg,MAJ_LABEL,MIN_LABEL,isFlatKey} from '../../shared/ui/theory.js';

let VF=null;
// VexFlow とフォント（Bravura・Academico。SIL OFL）を一度だけ読む
export async function loadLeadSheet(){
  if(VF)return VF;
  if(!window.VexFlow)await new Promise((ok,ng)=>{const s=document.createElement('script');s.src=new URL('vendor/vexflow.js',import.meta.url).href;s.onload=ok;s.onerror=ng;document.head.appendChild(s);});
  await Promise.all([['Bravura','vendor/bravura.woff2'],['Academico','vendor/academico.woff2']].map(([n,u])=>new FontFace(n,`url(${new URL(u,import.meta.url).href})`).load().then(f=>document.fonts.add(f))));
  VF=window.VexFlow;VF.setFonts('Bravura','Academico');
  return VF;
}

const Q=480;   // 4分音符の tick
// tick → VexFlow の長さ（付点を含む。16分まで）
const DUR=[[1920,'w'],[1440,'hd'],[960,'h'],[720,'qd'],[480,'q'],[360,'8d'],[240,'8'],[180,'16d'],[120,'16']];
const keySpec=key=>((key.mode==='minor'?MIN_LABEL:MAJ_LABEL)[key.idx].split('/')[isFlatKey(key.idx)?1:0]??(key.mode==='minor'?MIN_LABEL:MAJ_LABEL)[key.idx].split('/')[0])
  .replace(/♯/g,'#').replace(/♭/g,'b');
const SHARP=['c','c#','d','d#','e','f','f#','g','g#','a','a#','b'], FLAT=['c','db','d','eb','e','f','gb','g','ab','a','bb','b'];
const vfKey=(midi,flat)=>(flat?FLAT:SHARP)[midi%12]+'/'+(Math.floor(midi/12)-1);
const FONT='"Hiragino Sans","Yu Gothic UI","Noto Sans JP",sans-serif';

// 拍子の「拍」と、またいではいけない強い区切り（4/4 は小節の真ん中、6/8 などは付点4分の拍）
function meterInfo(m){
  const fam=meterFamily(m), beat=fam==='compound'?720:beatTicksOf(m), bar=m[0]*1920/m[1];
  const strong=m[0]===4&&m[1]===4?[960]:fam==='compound'?[...Array(Math.round(bar/720)).keys()].slice(1).map(k=>k*720):[];
  return {beat,bar,strong,compound:fam==='compound'};
}
// t（小節の頭から）から長さ r を、書ける長さに分ける（拍の中にとどめる・強い区切りをまたがない）
function splitDur(t,r,mi){
  const out=[];
  while(r>0){
    const nextBeat=(Math.floor(t/mi.beat)+1)*mi.beat;
    let pick=null;
    for(const [d,s] of DUR){
      if(d>r||d>mi.bar)continue;
      if(d===mi.bar){if(t!==0)continue;pick=[d,s];break;}   // 小節いっぱいの音は区切らない
      if(t%mi.beat!==0){if(t+d>nextBeat)continue;}
      else if(mi.strong.some(x=>t<x&&t+d>x))continue;
      pick=[d,s];break;
    }
    if(!pick)pick=[120,'16'];
    out.push({t,d:pick[0],dur:pick[1]});t+=pick[0];r-=pick[0];
  }
  return out;
}
// 小節の中の音を、拍ごとに16分か3連8分のどちらかの格子にそろえる。返すのは [{t,e,midis,tieIn,tieOut}]
function quantizeBar(notes,b,mi){
  const ev=notes.map(n=>({s:Math.max(n.start,b.start)-b.start,e:Math.min(n.end,b.start+b.ticks)-b.start,midi:n.midi,tieIn:n.start<b.start,tieOut:n.end>b.start+b.ticks}));
  // 拍ごとの格子：拍の中で始まる・終わる位置が3連（160）にぴったりで16分（120）にない拍だけ3連
  const nb=Math.ceil(b.ticks/mi.beat), trip=[];
  for(let k=0;k<nb;k++){
    const lo=k*mi.beat, hi=lo+mi.beat, pts=ev.flatMap(x=>[x.s,x.e]).filter(p=>p>lo&&p<hi).map(p=>p-lo);
    const err=g=>pts.reduce((a,p)=>a+Math.abs(p-Math.round(p/g)*g),0);
    trip.push(!mi.compound&&mi.beat===Q&&pts.length&&err(160)<err(120)-1);
  }
  const snap=p=>{const k=Math.min(nb-1,Math.floor(p/mi.beat)), g=trip[k]?160:120, lo=k*mi.beat;return Math.min(b.ticks,lo+Math.round((p-lo)/g)*g);};
  // 終わりは小節の終わりまで（小節の終わりに丸まった音は無くなる。和音の2音目以降も小節の外へ出さない）
  for(const x of ev){x.s=snap(x.s);x.e=Math.min(b.ticks,Math.max(snap(x.e),x.s+(trip[Math.min(nb-1,Math.floor(x.s/mi.beat))]?160:120)));}
  // 同じ位置で始まる音はまとめる（和音）。重なる音は前の音を次の頭で切る
  ev.sort((a,b)=>a.s-b.s||a.midi-b.midi);
  const out=[];
  for(const x of ev){
    const last=out.at(-1);
    if(last&&last.s===x.s){last.midis.push(x.midi);last.e=Math.max(last.e,x.e);last.tieOut||=x.tieOut;continue;}
    if(last&&last.e>x.s){last.e=x.s;last.tieOut=false;}
    out.push({s:x.s,e:Math.min(x.e,b.ticks),midis:[x.midi],tieIn:x.tieIn,tieOut:x.tieOut});
  }
  return {ev:out.filter(x=>x.e>x.s),trip};
}

// 1小節の音符（VexFlow の StaveNote）を作る。返すのは {notes, at（各音符の頭の tick）, tuplets, beams, first, last}
function buildBar(V,b,mi,q,flat,shift){
  const notes=[], at=[], tieChains=[], tuplets=[];
  const mk=(t,d,dur,midis,rest)=>{
    const n=new V.StaveNote({keys:rest?['b/4']:midis.map(m=>vfKey(m+shift,flat)),duration:dur+(rest?'r':''),autoStem:!rest});
    if(dur.includes('d'))V.Dot.buildAndAttach([n],{all:true});
    notes.push(n);at.push(t);return n;
  };
  // 3連の拍は、その拍の中を 160 刻みで書く
  const nb=q.trip.length;
  let t=0;
  const fill=(to,ev)=>{   // t から to まで（休符 or 音）
    while(t<to){
      const k=Math.floor(t/mi.beat);
      if(q.trip[k]){
        const end=Math.min(to,(k+1)*mi.beat), d=end-t, group=[];
        // 3連の中：160＝8分、320＝4分（3連）
        for(let u=t;u<end;){const dd=end-u>=320&&(u-k*mi.beat)%320===0?320:160;group.push(mk(u,dd,dd===320?'q':'8',ev?.midis,!ev));u+=dd;}
        if(ev&&group.length)tieChains.push(group);
        (q.tripNotes||(q.tripNotes=new Map())).set(k,[...(q.tripNotes.get(k)||[]),...group]);
        t=end;
      }else{
        const end=Math.min(to,(k+1)*mi.beat*1e3);   // 3連でない拍は、次の3連の拍の頭まで続けて分けてよい
        let lim=to;for(let j=k;j<nb;j++)if(q.trip[j]){lim=Math.min(lim,j*mi.beat);break;}
        const segs=splitDur(t,Math.min(lim,end)-t,mi), group=segs.map(s=>mk(s.t,s.d,s.dur,ev?.midis,!ev));
        if(ev&&group.length)tieChains.push(group);
        t=Math.min(lim,end);
      }
    }
  };
  const chainOf=new Map();
  for(const x of q.ev){
    if(x.s>t)fill(x.s,null);
    const before=notes.length;fill(x.e,x);
    chainOf.set(x,notes.slice(before));
  }
  if(t<b.ticks)fill(b.ticks,null);
  for(const [k,g] of q.tripNotes||[])if(g.length)tuplets.push(new V.Tuplet(g,{numNotes:3,notesOccupied:2,bracketed:true}));
  const firstEv=q.ev[0], lastEv=q.ev.at(-1);
  return {notes,at,tieChains,tuplets,
    first:firstEv&&firstEv.s===0&&firstEv.tieIn?chainOf.get(firstEv)[0]:null,
    last:lastEv&&lastEv.e===b.ticks&&lastEv.tieOut?chainOf.get(lastEv).at(-1):null};
}
// メロディーの無い小節：拍の数だけスラッシュ（符尾なし）
function slashBar(V,b,mi){
  const notes=[], at=[];
  const n=Math.round(b.ticks/mi.beat), dur=mi.compound?'qd':mi.beat===Q?'q':mi.beat===240?'8':'h';
  // 符尾・旗は描かない（斜めの線だけ。音符に見えないように）
  const none={strokeStyle:'transparent',fillStyle:'transparent'};
  for(let k=0;k<n;k++){const s=new V.StaveNote({keys:['b/4'],duration:dur,type:'s'});s.setStemStyle(none);s.setFlagStyle?.(none);
    if(dur.includes('d'))V.Dot.buildAndAttach([s],{all:true});notes.push(s);at.push(k*mi.beat);}
  return {notes,at,tieChains:[],tuplets:[],first:null,last:null,slash:true};
}

// 文字の幅を測る（コード名・度数の重なりを調べる）。描くのと同じ SVG で測る（canvas と SVG では幅が少し違う）
let mctx=null;
const textW=(s,px,weight)=>{if(!s)return 0;mctx.setFont(FONT,px,weight>=700?'bold':'');return mctx.measureText(s).width;};
// コード名を、ルート・種類（右上に小さく）・分数のベースに分ける
const splitName=name=>{const m=name.match(/^([A-G][♯♭]?)([^/]*)(\/.*)?$/);return m?[m[1],m[2]||'',m[3]||'']:[name,'',''];};
const CH_PX=15, SUP_PX=10.5, DEG_PX=10;
const chordW=name=>{const [r,q,bs]=splitName(name);return textW(r,CH_PX,700)+(q?textW(q,SUP_PX,700)+1:0)+(bs?textW(bs,CH_PX,700):0);};
// 重ならないように段に振り分ける：items は x の順。1段目に入らなければ2段目、どちらにも入らなければ空いている段の後ろへずらす
function tierLayout(items,gap=6){
  const ends=[-1e9,-1e9];
  for(const it of items){
    let tier=ends.findIndex(e=>it.x>=e+gap);
    if(tier<0){tier=ends[0]<=ends[1]?0:1;it.x=ends[tier]+gap;}
    it.tier=tier;ends[tier]=it.x+it.w;
  }
  return items.some(i=>i.tier===1)?2:1;
}

// 曲全体のリードシートを container に描く。withDeg：度数も書く
export function renderLeadSheet(container,song,tl,{withDeg,width}){
  const V=VF, W=Math.floor(width||703);
  const pcs=placedChords(song,tl), notes=placedNotes(song,tl);
  // 低い音が多いメロディーは「下に8の付いたト音記号」で1オクターブ上に書く
  const low=notes.length&&notes.filter(n=>n.midi<57).length>notes.length*.4, shift=low?12:0;
  {const tmp=document.createElement('div');tmp.style.cssText='position:absolute;left:-9999px;top:0';document.body.appendChild(tmp);
   const r0=new V.Renderer(tmp,V.Renderer.Backends.SVG);r0.resize(10,10);mctx=r0.getContext();
   container._lsTmp?.remove();container._lsTmp=tmp;}   // 測るための見えない SVG（コード名の幅）
  let prevLast=null, prevMeter=null, prevKey=null;
  song.sections.forEach((s,si)=>{
    const {from,to}=tl.secRanges[si];if(from===to)return;
    const ps=document.createElement('div');ps.className='psec';ps.style.setProperty('--c',SECTION_COLORS[s.color%SECTION_COLORS.length]);
    const lbl=document.createElement('div');lbl.className='plabel';lbl.textContent=s.name;ps.appendChild(lbl);
    // 1. 小節ごとの音符・コード名を作り、要る幅を見積もる
    const all=[];
    for(let gi=from;gi<to;gi++){
      const b=tl.bars[gi], mi=meterInfo(b.meter), flat=isFlatKey(b.key.idx);
      const inBar=notes.filter(n=>n.end>b.start&&n.start<b.start+b.ticks);
      const built=inBar.length?buildBar(V,b,mi,quantizeBar(inBar,b,mi),flat,shift):slashBar(V,b,mi);
      const voice=new V.Voice({numBeats:b.meter[0],beatValue:b.meter[1]}).setMode(V.Voice.Mode.SOFT).addTickables(built.notes);
      if(!built.slash)V.Accidental.applyAccidentals([voice],keySpec(b.key));
      const chords=pcs.filter(p=>p.start>=b.start&&p.start<b.start+b.ticks).map(p=>({t:p.start-b.start,name:nameOf(song,p.c,p.key),deg:chordDeg(p.c.off,p.c.q,p.c.boff,p.c.deg)}));
      const meterChange=gi===0||!prevMeter||prevMeter.join('/')!==b.meter.join('/');
      const keyCancel=b.keyMark&&prevKey?keySpec(prevKey):null;
      const marks=[];for(const m of song.sections[b.si].marks)if(m.bar===b.bar&&m.bpm&&gi!==0)marks.push(`♩=${m.bpm}`);
      prevMeter=b.meter;prevKey=b.key;
      // 音符に要る幅
      const nw0=new V.Formatter().joinVoices([voice]).preCalculateMinTotalWidth([voice]), nw=nw0+16, nwPref=nw0*1.5+24;   // 詰めて書ける幅・ゆったり書く幅
      // コード名・度数に要る幅：tick の割合で並べたとき、1段なら次の名前、2段なら2つ先の名前（と小節の終わり）までに入る幅
      const fit=(ws,step)=>{const fr=chords.map(c=>c.t/b.ticks);let need=0;
        ws.forEach((w,k)=>{const nx=k+step<fr.length?fr[k+step]:1, last=k+1<fr.length?1:1;need=Math.max(need,(w+8)/Math.max(.02,nx-fr[k]),(w+4)/Math.max(.02,last-fr[k]));});return need;};
      const cws=chords.map(c=>chordW(c.name)), dws=withDeg?chords.map(c=>textW(c.deg,DEG_PX,400)):[];
      const min=Math.max(nw,fit(cws,2),fit(dws,2),60), pref=Math.max(min,nwPref,fit(cws,1),fit(dws,1));
      all.push({gi,b,mi,built,voice,chords,meterChange,keyMark:b.keyMark,keyCancel,marks,min,pref});
    }
    const mods=(x,first)=>{const st=new V.Stave(0,0,500);if(first)st.addClef('treble',undefined,low?'8vb':undefined);if(first||x.keyMark)st.addKeySignature(keySpec(x.b.key),x.keyCancel||undefined);if(x.meterChange)st.addTimeSignature(x.b.meter.join('/'));return st.getNoteStartX()-st.getX()+12;};
    // 2. 段に分ける：ふつうは4小節。コード名が多くて入りきらないときは、その段の小節を減らす（1小節でも入らなければ文字を小さくする）
    const rows=[];
    for(let k=0;k<all.length;){
      const row=[all[k]];let tot=mods(all[k],true)+all[k].min;
      while(row.length<4&&k+row.length<all.length){const x=all[k+row.length], add=mods(x,false)+x.min;if(tot+add>W)break;row.push(x);tot+=add;}
      rows.push({bars:row,dense:row.length<4&&k+row.length<all.length});k+=row.length;
    }
    for(const R of rows){
      const bars=R.bars, base=bars.map((x,j)=>mods(x,j===0)+x.min), extra=bars.map((x,j)=>x.pref-x.min);
      // 段の幅：4小節ならいっぱい。セクションの終わりで短い段は小節の数に合わせる（ただし要る幅より狭くしない）
      const rowW=R.dense||bars.length===4?W:Math.min(W,Math.max(W*bars.length/4,base.reduce((a,c)=>a+c,0)));
      let free=rowW-base.reduce((a,c)=>a+c,0);
      // 余りは、まずコード名を1段に並べられる幅へ、残りは均等に
      const ex=extra.reduce((a,c)=>a+c,0), give=free>0?Math.min(free,ex):0;
      const widths=base.map((w,j)=>w+(ex?extra[j]*give/ex:0));free-=give;
      if(free>0)widths.forEach((w,j)=>widths[j]=w+free/bars.length);
      const scale=free<0?rowW/widths.reduce((a,c)=>a+c,0):1;   // 1小節でも入りきらない
      if(scale<1)widths.forEach((w,j)=>widths[j]=w*scale);
      // 3. 描く（y はあとで全体の高さに合わせて詰める）
      const holder=document.createElement('div');holder.className='lrow';
      const renderer=new V.Renderer(holder,V.Renderer.Backends.SVG);renderer.resize(W,400);
      const ctx=renderer.getContext();mctx=ctx;
      const STAFF_Y=150;   // 五線の上の線（仮）。描いたあとで上下の余白を切る
      let x=0;const placed=[];
      bars.forEach((B,j)=>{
        const st=new V.Stave(x,STAFF_Y-40,widths[j]);
        if(j===0)st.addClef('treble',undefined,low?'8vb':undefined);
        if(j===0||B.keyMark)st.addKeySignature(keySpec(B.b.key),B.keyCancel||undefined);
        if(B.meterChange)st.addTimeSignature(B.b.meter.join('/'));
        const lastOfSec=B.gi===to-1, lastOfSong=B.gi===tl.bars.length-1;
        if(lastOfSong)st.setEndBarType(V.Barline.type.END);else if(lastOfSec)st.setEndBarType(V.Barline.type.DOUBLE);
        st.setContext(ctx).draw();
        B.voice.setStave(st);B.built.notes.forEach(n=>n.setStave(st));   // 音符にも五線を（位置 getAbsoluteX が五線の頭からになるように）
        new V.Formatter().joinVoices([B.voice]).formatToStave([B.voice],st);
        // 音符をなるべく拍の位置（tick の割合）に並べる（コード名の位置と合うように）。詰めて書いた間隔より狭くはしない。
        // 小節に入りきらなければ、ふつうの並べ方に近づける
        {const ns=B.built.notes, sx=st.getNoteStartX(), ex=st.getNoteEndX()-10, f=ns.map(n=>n.getAbsoluteX());
         if(ns.length){
           const tail=Math.min(st.getNoteEndX()-f.at(-1),(ns.at(-1).getWidth?.()||14)+14);   // 最後の音符の後ろに残す幅
           const place=a=>{const xs=[];for(let i=0;i<ns.length;i++){const pr=sx+B.built.at[i]/B.b.ticks*(ex-sx)+6, want=f[i]+(pr-f[i])*a;xs.push(i?Math.max(want,xs[i-1]+(f[i]-f[i-1])):Math.max(want,f[0]));}return xs;};
           let a=1,xs=place(a);
           for(let k=0;k<8&&xs.at(-1)>st.getNoteEndX()-tail+.5;k++){a*=.6;xs=place(a);}
           if(xs.at(-1)>st.getNoteEndX()-tail+.5)xs=f;
           ns.forEach((n,i)=>{const tc=n.getTickContext();tc.setX(tc.getX()+xs[i]-f[i]);});   // 拍の位置へ動かす（xShift だと符頭が二重にずれる）
         }}
        const inTuplet=n=>B.built.tuplets.some(tp=>tp.getNotes?.().includes(n));
        const beams=B.built.slash?[]:V.Beam.generateBeams(B.built.notes.filter(n=>!inTuplet(n)),{groups:[B.mi.compound?new V.Fraction(3,8):new V.Fraction(1,4)]});
        for(const tp of B.built.tuplets){const tn=tp.getNotes?.()||[];if(tn.length>1&&tn.every(n=>!n.isRest()&&n.getDuration()==='8'))beams.push(new V.Beam(tn));}
        B.voice.draw(ctx,st);
        beams.forEach(bm=>bm.setContext(ctx).draw());
        B.built.tuplets.forEach(tp=>tp.setContext(ctx).draw());
        // タイ：小節の中の分けた音・前の小節からの続き（段の頭なら左から短く）
        for(const ch of B.built.tieChains)for(let i=0;i+1<ch.length;i++)new V.StaveTie({firstNote:ch[i],lastNote:ch[i+1],firstIndexes:ch[i].getKeys().map((_,k)=>k),lastIndexes:ch[i+1].getKeys().map((_,k)=>k)}).setContext(ctx).draw();
        if(B.built.first){
          if(prevLast&&j>0)new V.StaveTie({firstNote:prevLast,lastNote:B.built.first,firstIndexes:[0],lastIndexes:[0]}).setContext(ctx).draw();
          else new V.StaveTie({lastNote:B.built.first,lastIndexes:[0]}).setContext(ctx).draw();
        }
        if(B.built.last&&j===bars.length-1)new V.StaveTie({firstNote:B.built.last,firstIndexes:[0]}).setContext(ctx).draw();
        prevLast=B.built.last;
        // コード名の x：その tick に始まる音符があればその位置、なければ前後の音符の間を tick で割り振る
        const pts=[[0,st.getNoteStartX()],...B.built.notes.map((n,i)=>[B.built.at[i],n.getAbsoluteX()]),[B.b.ticks,st.getNoteEndX()]];
        const xAt=t=>{for(let i=0;i+1<pts.length;i++){const [t0,x0]=pts[i],[t1,x1]=pts[i+1];if(t>=t0&&t<=t1)return t1===t0?x0:x0+(x1-x0)*(t-t0)/(t1-t0);}return pts.at(-1)[1];};
        for(const c of B.chords)placed.push({x:xAt(c.t)-2,c,bar:B,end:x+widths[j]-2});
        if(j===0){ctx.save();ctx.setFont(FONT,9,'');ctx.setFillStyle('#999');ctx.fillText(String(B.gi+1),x+2,STAFF_Y-26);ctx.restore();}
        B.marksX=x+(st.getNoteStartX()-st.getX());
        x+=widths[j];
      });
      // 4. 音符の上下の端（コード名・度数をそれより外に）
      let top=STAFF_Y, bottom=STAFF_Y+40;
      for(const B of bars)for(const n of B.built.notes){const bb=n.getBoundingBox?.();if(bb){top=Math.min(top,bb.getY());bottom=Math.max(bottom,bb.getY()+bb.getH());}}
      for(const B of bars)if(B.built.tuplets.length)top=Math.min(top,STAFF_Y-24);
      // 5. コード名：重ならないよう段に振り分け（省略しない）。それでも入らないとき（1小節でも入りきらない段）は文字を小さく
      const chPx=Math.max(10,CH_PX*Math.min(1,scale)), supPx=chPx*SUP_PX/CH_PX;
      const cw=name=>{const [r,q,bs]=splitName(name);return textW(r,chPx,700)+(q?textW(q,supPx,700)+1:0)+(bs?textW(bs,chPx,700):0);};
      const items=placed.map(p=>({x:p.x,w:cw(p.c.name),p})).sort((a,b)=>a.x-b.x);
      const tiers=tierLayout(items);
      // 右の端からはみ出す名前は、左へ寄せる（前の名前と重なるなら、もう一方の段へ）
      for(const it of items)if(it.x+it.w>W)it.x=Math.max(0,W-it.w);
      const base0=Math.min(STAFF_Y-12,top-6), hasMarks=bars.some(B=>B.marks.length);
      ctx.save();ctx.setFillStyle('#000');
      for(const it of items){
        const yy=tiers===2&&it.tier===0?base0-chPx-4:base0;
        const [rt,qq,bs]=splitName(it.p.c.name);let xx=it.x;
        ctx.setFont(FONT,chPx,'bold');ctx.fillText(rt,xx,yy);xx+=textW(rt,chPx,700);
        if(qq){ctx.setFont(FONT,supPx,'bold');ctx.fillText(qq,xx+1,yy-chPx*.4);xx+=textW(qq,supPx,700)+1;}
        if(bs){ctx.setFont(FONT,chPx,'bold');ctx.fillText(bs,xx,yy);}
      }
      const topText=base0-(tiers===2?chPx+4:0)-chPx-4;
      for(const B of bars)if(B.marks.length){ctx.setFont(FONT,10,'bold');ctx.fillText(B.marks.join('  '),B.marksX,topText);}
      // 6. 度数：五線（と低い音）の下。重ならないよう同じように振り分け
      let degBottom=bottom;
      if(withDeg){
        const ds=placed.map(p=>({x:p.x,w:textW(p.c.deg,DEG_PX,400),p})).sort((a,b)=>a.x-b.x);
        const dt=tierLayout(ds,5), db0=Math.max(STAFF_Y+40+16,bottom+12);
        for(const it of ds)if(it.x+it.w>W)it.x=Math.max(0,W-it.w);
        ctx.setFont(FONT,DEG_PX,'');ctx.setFillStyle('#666');
        for(const it of ds)ctx.fillText(it.p.c.deg,it.x,db0+(it.tier===1?13:0));
        degBottom=db0+(dt===2?13:0)+4;
      }
      ctx.restore();
      // 7. 上下の余白を切る（viewBox）
      const y0=Math.min(top,hasMarks?topText-12:base0-(tiers===2?chPx+4:0)-chPx-2)-4, y1=Math.max(bottom,degBottom)+6;
      const svg=holder.querySelector('svg');svg.setAttribute('viewBox',`0 ${y0} ${W} ${y1-y0}`);svg.setAttribute('height',y1-y0);svg.setAttribute('width',W);
      svg.style.width=W+'px';svg.style.height=(y1-y0)+'px';
      ps.appendChild(holder);
    }
    container.appendChild(ps);
  });
}
