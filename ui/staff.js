/* 大譜表（ト音記号＋ヘ音記号）の SVG 描画。音の綴りは呼び出し側（鍵盤と同じ表記）から受け取る */

const NS='http://www.w3.org/2000/svg';
function el(tag,attrs={},parent){const e=document.createElementNS(NS,tag);for(const k in attrs)e.setAttribute(k,attrs[k]);if(parent)parent.appendChild(e);return e;}
function txt(parent,x,y,s,attrs={}){const t=el('text',{x,y,'text-anchor':'middle','dominant-baseline':'central',...attrs},parent);t.textContent=s;return t;}

// 鍵盤と同じ縦横比（viewBox 884×120）にしてパネルの高さを変えない
export const STAFF_W=884, STAFF_H=120;
const GAP=7, STEP=GAP/2;
const LETTERS='CDEFGAB', NATURAL_PC=[0,2,4,5,7,9,11];
const TREBLE={bottomStep:30,bottomY:46};   // 第1線 E4
const BASS  ={bottomStep:18,bottomY:100};  // 第1線 G2
const LABEL_Y=64;                          // 大譜表の間（ト音側の音名・度数）
const SHARP_ORDER=[38,35,39,36,33,37,34];  // F5 C5 G5 D5 A4 E5 B4（ト音記号上の位置）
const FLAT_ORDER =[34,37,33,36,32,35,31];  // B4 E5 A4 D5 G4 C5 F4
const ACC_OFFSET={'𝄪':2,'♯':1,'':0,'♭':-1,'𝄫':-2};
const CLEF_FONT='"Apple Symbols","Segoe UI Symbol","Noto Music",serif';

// midi と音名（例 'B♭'）→ 譜表上の位置（C0 を 0 とする全音階ステップ）
function position(midi,name){
  const letter=name[0], acc=name.slice(1);   // '𝄪' '𝄫' はサロゲートペアだが slice(1) で丸ごと取れる
  const li=LETTERS.indexOf(letter);
  const natural=midi-(ACC_OFFSET[acc]??0);
  const octave=Math.floor((natural-NATURAL_PC[li])/12)-1;
  return {letter,acc,step:(octave+1)*7+li-7};
}
const stepY=(staff,step)=>staff.bottomY-(step-staff.bottomStep)*STEP;

function drawStaffLines(svg,staff){
  for(let i=0;i<5;i++){const y=staff.bottomY-i*GAP;el('line',{x1:10,y1:y,x2:STAFF_W-10,y2:y,stroke:'#5B6275','stroke-width':1},svg);}
}

function drawKeySignature(svg,sig,x0){
  const order=sig.acc==='♯'?SHARP_ORDER:FLAT_ORDER;
  for(let i=0;i<sig.count;i++){
    const x=x0+i*9;
    txt(svg,x,stepY(TREBLE,order[i]),sig.acc,{fill:'#1E2742','font-size':15});
    txt(svg,x,stepY(BASS,order[i]-14),sig.acc,{fill:'#1E2742','font-size':15});
  }
  return x0+sig.count*9;
}

// 調号で既に付いている変化記号（音名 → '♯'|'♭'|''）
function signatureMap(sig){
  const letters=sig.acc==='♯'?'FCGDAEB':'BEADGCF', map={};
  for(const l of LETTERS)map[l]='';
  for(let i=0;i<sig.count;i++)map[letters[i]]=sig.acc;
  return map;
}

function drawLedgers(svg,staff,step,x){
  const top=staff.bottomStep+8, bottom=staff.bottomStep;
  for(let s=bottom-2;s>=step;s-=2)el('line',{x1:x-9,y1:stepY(staff,s),x2:x+9,y2:stepY(staff,s),stroke:'#5B6275','stroke-width':1},svg);
  for(let s=top+2;s<=step;s+=2)el('line',{x1:x-9,y1:stepY(staff,s),x2:x+9,y2:stepY(staff,s),stroke:'#5B6275','stroke-width':1},svg);
}

/**
 * notes: [{midi, name, fill, op, label, col, clef?}] — col は横位置の列番号（同じ列の音は和音として縦に積む）
 *   clef（'treble'|'bass'）省略時は C4 以上をト音記号に置く
 * 描画オプション: sig（keySignature の戻り値）, columns（列数）, labelSide（'below'|'right'）
 */
export function renderStaff(svg,{sig,notes,columns,labelSide='below'}){
  svg.innerHTML='';
  svg.setAttribute('viewBox',`0 0 ${STAFF_W} ${STAFF_H}`);
  drawStaffLines(svg,TREBLE);drawStaffLines(svg,BASS);
  el('line',{x1:10,y1:stepY(TREBLE,38),x2:10,y2:BASS.bottomY,stroke:'#5B6275','stroke-width':1.5},svg);
  txt(svg,30,stepY(TREBLE,32)-2,'𝄞',{fill:'#1E2742','font-size':58,'font-family':CLEF_FONT});
  txt(svg,30,stepY(BASS,24)+4,'𝄢',{fill:'#1E2742','font-size':30,'font-family':CLEF_FONT});
  const x0=drawKeySignature(svg,sig,58)+24;
  const colW=(STAFF_W-30-x0)/Math.max(1,columns), sigMap=signatureMap(sig);

  // 列ごとに、低い音から配置（2度でぶつかる音符は右へずらす）
  const inEffect={};   // 小節内の臨時記号：`${letter}${step}` → 現在有効な変化記号
  for(let c=0;c<columns;c++){
    const x=x0+colW*(c+.5);
    const col=notes.filter(n=>n.col===c).map(n=>({...n,...position(n.midi,n.name),staff:(n.clef??(n.midi<60?'bass':'treble'))==='bass'?BASS:TREBLE}))
      .sort((a,b)=>a.step-b.step);
    let prevStep=null,prevShift=false,accCol=0,labelStep=null,labelAlt=false;
    for(const n of col){
      const y=stepY(n.staff,n.step);
      const shift=prevStep!=null&&n.step-prevStep===1&&!prevShift;
      const nx=x+(shift?11:0);
      drawLedgers(svg,n.staff,n.step,nx);

      const key=n.letter+n.step, current=inEffect[key]??sigMap[n.letter];
      if(current!==n.acc){
        const sym=n.acc||'♮';
        txt(svg,x-14-(accCol%3)*8,y,sym,{fill:'#1E2742','font-size':14,opacity:n.op});
        accCol++;inEffect[key]=n.acc;
      }
      el('ellipse',{cx:nx,cy:y,rx:5.4,ry:3.9,transform:`rotate(-20,${nx},${y})`,fill:n.fill,opacity:n.op,stroke:'#1E2742','stroke-width':.8},svg);
      if(n.label){
        const attrs={fill:n.fill,'font-size':10,'font-weight':700,opacity:n.op===1?1:.6};
        if(labelSide==='right'){
          // 3度で積んだ音はラベルが重なるので左右にずらす
          const y0=labelStep==null?null:stepY(labelStep.staff,labelStep.step);
          labelAlt=y0!=null&&Math.abs(y-y0)<10&&!labelAlt;
          txt(svg,x+(labelAlt?48:24),y,n.label,{...attrs,'text-anchor':'start'});
          labelStep=n;
        }
        else if(n.staff===TREBLE)txt(svg,x,LABEL_Y,n.label,attrs);
      }
      prevStep=n.step;prevShift=shift;
    }
  }
}
