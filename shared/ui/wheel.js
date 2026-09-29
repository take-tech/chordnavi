/* 五度圏（ChordNavi・ChordSketch で共通）。外周＝メジャー、内周＝マイナー。
   クリックしたキーが上に来るよう回す（最短方向・約750ms のイージング、reduced-motion のときは即時）。
   上に固定したオーバーレイでダイアトニックの位置と度数、中央にキー名などを出す。UI の状態は持たない */
import {MAJ_LABEL,MIN_LABEL,WHEEL_CELLS} from './theory.js';

const NS='http://www.w3.org/2000/svg';
// 色に var(--…) を渡したときは style で指定する（テーマを切り替えると描き直さずに色が変わる）
function el(tag,attrs={},parent){const e=document.createElementNS(NS,tag);for(const k in attrs){const v=attrs[k];if(typeof v==='string'&&v.startsWith('var('))e.style.setProperty(k,v);else e.setAttribute(k,v);}if(parent)parent.appendChild(e);return e;}
function txt(parent,x,y,s,attrs={}){const t=el('text',{x,y,'text-anchor':'middle','dominant-baseline':'central',...attrs},parent);t.textContent=s;return t;}

const P=(r,a)=>[r*Math.sin(a*Math.PI/180),-r*Math.cos(a*Math.PI/180)];
function arc(r0,r1,a0,a1){
  const [x0,y0]=P(r1,a0),[x1,y1]=P(r1,a1),[x2,y2]=P(r0,a1),[x3,y3]=P(r0,a0);
  return `M${x0},${y0}A${r1},${r1} 0 0 1 ${x1},${y1}L${x2},${y2}A${r0},${r0} 0 0 0 ${x3},${y3}Z`;
}
const R={c:66,i0:68,i1:118,o0:120,o1:192};

/**
 * svg（viewBox="-210 -215 420 425"）に五度圏を描く。onSelect(idx, mode) は扇形を押したとき（Enter・Space でも）。
 * 戻り値：
 *   setOverlay(mode)      … ダイアトニックの位置と度数（'major'｜'minor'）
 *   center                … 中央の文字 {key, sig, mode}（SVG の text。textContent・属性を直接変える）
 *   rotateTo(idx,instant) … idx のキーが上に来るよう回す（instant なら回転なし）
 *   setRotation(idx)      … アニメーションを止めて、すぐその向きにする（状態の復元など）
 *   target                … 最後に回した先のキー（位置 0〜11）
 */
export function createWheel(svg,{onSelect}){
  const gWedges=el('g',{},svg), gOverlay=el('g',{'pointer-events':'none'},svg), gLabels=el('g',{'pointer-events':'none'},svg), gStatic=el('g',{'pointer-events':'none'},svg);
  const labelNodes=[];
  for(let i=0;i<12;i++){
    const a0=i*30-15,a1=i*30+15;
    const o=el('path',{d:arc(R.o0,R.o1,a0,a1),fill:'var(--wheel-outer)',stroke:'var(--bg)','stroke-width':2,class:'wedge',tabindex:0,role:'button','aria-label':MAJ_LABEL[i]+' メジャー'},gWedges);
    const n=el('path',{d:arc(R.i0,R.i1,a0,a1),fill:'var(--wheel-inner)',stroke:'var(--bg)','stroke-width':2,class:'wedge',tabindex:0,role:'button','aria-label':MIN_LABEL[i]+' マイナー'},gWedges);
    o.addEventListener('click',()=>onSelect(i,'major'));
    n.addEventListener('click',()=>onSelect(i,'minor'));
    for(const [node,m] of [[o,'major'],[n,'minor']])
      node.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();onSelect(i,m);}});
    const long=i===6;
    const [ox,oy]=P(163,i*30), [ix,iy]=P(100,i*30);
    labelNodes.push({t:txt(gLabels,ox,oy,MAJ_LABEL[i],{fill:'#fff','font-size':long?13:22,'font-weight':700}),x:ox,y:oy});
    labelNodes.push({t:txt(gLabels,ix,iy,MIN_LABEL[i],{fill:'#fff','font-size':long?9:14,'font-weight':500}),x:ix,y:iy});
  }
  el('circle',{r:R.c,fill:'var(--panel)',stroke:'var(--line)'},svg);
  const center={
    key:txt(svg,0,-12,'',{fill:'var(--ink)','font-size':26,'font-weight':900}),
    sig:txt(svg,0,16,'',{fill:'var(--muted)','font-size':11}),
    mode:txt(svg,0,32,'',{fill:'var(--muted)','font-size':11})
  };
  el('path',{d:'M-9,-212 L9,-212 L0,-197 Z',fill:'#E3A21A'},svg);

  function setOverlay(mode){
    gOverlay.innerHTML='';gStatic.innerHTML='';
    for(const [rel,outer,deg,isT] of WHEEL_CELLS[mode]){
      const a=rel*30, r0=outer?R.o0:R.i0, r1=outer?R.o1:R.i1;
      el('path',{d:arc(r0,r1,a-15,a+15),fill:isT?'#E3A21A':'#2E8C80','fill-opacity':isT?.9:(rel===2?.35:.6)},gOverlay);
      const [x,y]=P(outer?134:80,a);
      txt(gStatic,x,y,deg,{fill:'#fff','font-size':outer?11:9,'font-weight':700,opacity:.95});
    }
  }
  let rot=0,anim=null;
  const api={setOverlay,center,target:null,rotateTo,setRotation};
  function applyRot(r){
    const tr=`rotate(${r})`;
    gWedges.setAttribute('transform',tr);gLabels.setAttribute('transform',tr);
    for(const n of labelNodes)n.t.setAttribute('transform',`rotate(${-r},${n.x},${n.y})`);
  }
  function rotateTo(idx,instant=false){
    api.target=idx;
    const target=-idx*30;
    const d=((target-rot)%360+540)%360-180;
    const from=rot,to=rot+d,dur=instant||matchMedia('(prefers-reduced-motion: reduce)').matches?0:750,t0=performance.now();
    cancelAnimationFrame(anim);
    const step=now=>{
      const p=dur?Math.min(1,(now-t0)/dur):1, e=1-Math.pow(1-p,3);
      rot=from+(to-from)*e;applyRot(rot);
      if(p<1)anim=requestAnimationFrame(step);else rot=to;
    };
    anim=requestAnimationFrame(step);
  }
  function setRotation(idx){api.target=idx;cancelAnimationFrame(anim);rot=-idx*30;applyRot(rot);}
  return api;
}
