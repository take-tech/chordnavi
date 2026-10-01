/* ChordSketch：メロディーのピアノロール（シートと切り替えて表示する）。
   横に流れるタイムラインの上にセクション・小節番号・コードの帯、その下にピアノロール。
   行にはカーソルの位置のキーのスケールの音と、そこで鳴っているコードの構成音を色で出す（ガイド）。
   道具（ui.mTool）：「描く」は何もないところを押す→音を置く（横に引くと長さ）、⇧＋ドラッグ→囲んで選ぶ。
   「選ぶ」は何もないところをドラッグ→囲んで選ぶ（⇧で追加）、押すだけ→選択を外してカーソル。
   ⌘（Windows は Ctrl）を押している間は、何もないところでは描く⇔選ぶが入れ替わり、音の上ではクリックでそこで分ける。
   ⌥（Alt）を押しながら音をドラッグすると複製を動かす。
   ドラッグ中にスクロールの端に近づくと自動でスクロールする（drag）。
   どちらでも：音をドラッグ→動かす（右端は長さ）、音をダブルクリック→消す、鍵盤を押す→試聴、
   小節番号を横にドラッグ→小節の範囲を選ぶ（範囲の中で始まる音も選ぶ）。キーは onKey（Delete・矢印・⌘A/C/X/V/D・Esc） */
import {PPQ,SECTION_COLORS,placedChords,placedNotes,addNote,removeNotes,newNote,MELODY_LOW,MELODY_HIGH,keyScale} from './song.js';
import {CHORD,mod12,noteName,scaleById,tonicOf,isFlatKey} from '../../shared/ui/theory.js';

// スナップと入力の長さ（tick。4分音符＝480）
export const M_SNAPS=[{id:'4',name:'4分',t:480},{id:'8',name:'8分',t:240},{id:'16',name:'16分',t:120},{id:'8t',name:'3連8分',t:160}];
export const M_LENS=[{id:'1',name:'全音符',t:1920},{id:'2',name:'2分',t:960},{id:'4.',name:'付点4分',t:720},{id:'4',name:'4分',t:480},
  {id:'8.',name:'付点8分',t:360},{id:'8',name:'8分',t:240},{id:'8t',name:'3連8分',t:160},{id:'16',name:'16分',t:120}];
// 横の拡大：4分音符あたりの横幅（px）。表示のスライダー（0〜100）とは対数でつなぐ
export const ZOOM_MIN=10, ZOOM_MAX=150, ZOOM_DEFAULT=34;
export const clampZoom=z=>Math.max(ZOOM_MIN,Math.min(ZOOM_MAX,+z||ZOOM_DEFAULT));
export const zoomToSlider=z=>Math.round(Math.log(clampZoom(z)/ZOOM_MIN)/Math.log(ZOOM_MAX/ZOOM_MIN)*100);
export const sliderToZoom=v=>ZOOM_MIN*Math.pow(ZOOM_MAX/ZOOM_MIN,v/100);
const ROW=14, KEYW=46, HEAD=62, LOW=MELODY_LOW, HIGH=MELODY_HIGH, ROWS=HIGH-LOW+1;
const BLACK=new Set([1,3,6,8,10]);
// コードの構成音の、ルートからの度数の書き方（半音の数 → 表記）。分数コードのベースは B
const TONE_LABEL=['R','♭9','9','♭3','3','11','♭5','5','♯5','6','♭7','7'];

// ctx：song()・tl()・ui・commit(fn)・changed()・preview(midi)・cursorAbs()・setCursorAbs(abs)・isPlaying()・fmtPos(abs)
export function createRoll(root,ctx){
  let nsel=new Set();                 // 選んでいる音の id
  let clip=null;                      // コピーした音（先頭からの tick と鳴る音）
  let scrollX=0, scrollY=(HIGH-79)*ROW, first=true;
  let playhead=null, lastClick={id:null,t:0};
  const snapT=()=>(M_SNAPS.find(x=>x.id===ctx.ui.mSnap)||M_SNAPS[1]).t;
  const lenT=()=>(M_LENS.find(x=>x.id===ctx.ui.mLen)||M_LENS[5]).t;
  const ppt=()=>clampZoom(ctx.ui.mZoom)/PPQ;   // 1 tick あたりの px
  const y=midi=>(HIGH-midi)*ROW;
  const barAt=abs=>{const tl=ctx.tl();return tl.bars.find(b=>abs>=b.start&&abs<b.start+b.ticks)||tl.bars.at(-1);};
  // 小節の頭を基準にスナップ（7/8 などでも拍の頭がずれない）
  const snapFloor=abs=>{const b=barAt(abs);if(!b)return 0;const st=snapT();return b.start+Math.floor((abs-b.start)/st)*st;};
  const snapRound=abs=>{const b=barAt(abs);if(!b)return 0;const st=snapT();return b.start+Math.round((abs-b.start)/st)*st;};
  const h=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e;};
  const box=(cls,x,yy,w,hh)=>{const e=h('div',cls);e.style.cssText=`left:${x}px;top:${yy}px;width:${w}px;height:${hh}px`;return e;};
  // 横の位置・幅は tick で持ち、1 tick あたりの px（root の --ppt）を掛けて CSS が並べる。拡大を変えるときは --ppt を変えるだけで済む（描き直さない）
  const X=t=>`calc(var(--ppt) * ${t}px)`;
  const tbox=(cls,t0,yy,tw,hh,minus=0,min=0)=>{
    const e=h('div',cls), w=minus||min?`max(${min}px, calc(var(--ppt) * ${tw}px - ${minus}px))`:X(tw);
    e.style.cssText=`left:${X(t0)};top:${yy}px;width:${w};height:${hh}px`;return e;
  };
  const midiName=(m,flat)=>noteName(m,flat)+(Math.floor(m/12)-1);
  let grid=null, scroller=null;

  function render(){
    const song=ctx.song(), tl=ctx.tl(), px=ppt(), W=X(tl.total), H=ROWS*ROW;
    if(scroller){scrollX=scroller.scrollLeft;scrollY=scroller.scrollTop;}
    clearTimeout(zoomTimer);
    root.innerHTML='';root.style.setProperty('--ppt',px);
    scroller=h('div','rs');const inner=h('div','ri');inner.style.width=`calc(var(--ppt) * ${tl.total}px + ${KEYW}px)`;inner.style.height=HEAD+H+'px';
    scroller.appendChild(inner);root.appendChild(scroller);
    const flat=isFlatKey(song.key.idx);

    /* 上の帯：セクション・小節番号（押すとカーソル）・コード */
    const head=h('div','rh');head.style.width=inner.style.width;
    const corner=h('div','rc');corner.append(h('span','',''));
    const hg=h('div','rhg');hg.style.width=W;
    tl.secRanges.forEach(({from,to},si)=>{
      if(from===to)return;
      const s=song.sections[si], t0=tl.bars[from].start, t1=tl.bars[to-1].start+tl.bars[to-1].ticks;
      const e=tbox('rsec',t0,0,t1-t0,18);e.style.setProperty('--c',SECTION_COLORS[s.color]||SECTION_COLORS[0]);
      e.append(h('span','',s.name));e.title=s.name;hg.appendChild(e);
    });
    const rg0=ctx.range();
    for(const b of tl.bars){
      const on=rg0&&b.gi>=rg0.from&&b.gi<rg0.to;
      const e=tbox('rbar'+(on?' on':''),b.start,18,b.ticks,16);e.append(h('span','',String(b.gi+1)));
      e.dataset.gi=b.gi;e.title='押してカーソル・横にドラッグで範囲';hg.appendChild(e);
    }
    const pcs=placedChords(song,tl);
    for(const p of pcs){
      const e=tbox('rchord',p.start,36,p.end-p.start,24,2,2);e.dataset.id=p.c.id;
      e.append(h('span','',ctx.chordName(p)));e.title=ctx.chordName(p);hg.appendChild(e);
    }
    hg.addEventListener('pointerdown',e=>{
      if(e.button!==0)return;
      const r=hg.getBoundingClientRect(), k=r.width/hg.offsetWidth, abs=(e.clientX-r.left)/k/ppt();
      if(e.target.closest('.rbar'))return barRange(e,abs,k);
      ctx.setCursorAbs(Math.max(0,Math.min(tl.total-1,snapFloor(abs))));
    });
    head.append(corner,hg);inner.appendChild(head);

    /* 左の鍵盤（押すと試聴） */
    const keys=h('div','rk');keys.style.height=H+'px';
    for(let m=HIGH;m>=LOW;m--){
      const k=box('rkey'+(BLACK.has(m%12)?' black':'')+(m%12===0?' c':''),0,y(m),KEYW,ROW);
      if(m%12===0)k.append(h('span','',midiName(m,flat)));
      k.dataset.m=m;keys.appendChild(k);
    }
    keys.addEventListener('pointerdown',e=>{const k=e.target.closest('.rkey');if(k)ctx.preview(+k.dataset.m);});
    inner.appendChild(keys);

    /* ピアノロール */
    grid=h('div','rg');grid.style.width=W;grid.style.height=H+'px';
    // 行：スケールのガイドがオフなら黒鍵の行を少し暗く。オンならスケールの外の行を灰色にする（スケールの音の行は白いまま）
    const gs=ctx.ui.guideScale;
    for(let m=HIGH;m>=LOW;m--){const e=box('rrow'+(!gs&&BLACK.has(m%12)?' black':''),0,y(m),0,ROW);e.style.width='100%';grid.appendChild(e);}
    if(gs){
      let i=0;
      while(i<tl.bars.length){   // キーが続く範囲ごと
        const k=tl.bars[i].key;let j=i+1;
        while(j<tl.bars.length&&tl.bars[j].key===k)j++;
        const t=tonicOf(k.idx,k.mode), iv=new Set(scaleById(keyScale(k)).iv.map(x=>mod12(t+x)));
        const t0=tl.bars[i].start, t1=tl.bars[j-1].start+tl.bars[j-1].ticks;
        for(let m=LOW;m<=HIGH;m++){
          if(!iv.has(m%12))grid.appendChild(tbox('gout',t0,y(m),t1-t0,ROW));
          else if(m%12===t)grid.appendChild(tbox('gtonic',t0,y(m),t1-t0,ROW));
        }
        i=j;
      }
    }
    // ガイド：そこで鳴っているコードの構成音（ルートは濃く）。コードの頭に、ルートからの度数（R・3・5・♭7…）を書く
    if(ctx.ui.guideChord)for(const p of pcs){
      const ch=p.ch, tones=new Map((CHORD[ch.q]?.iv||[]).map(x=>[mod12(ch.root+x),TONE_LABEL[mod12(x)]]));
      if(ch.bass!=null&&!tones.has(ch.bass))tones.set(ch.bass,'B');
      const w=(p.end-p.start)*px;
      for(let m=LOW;m<=HIGH;m++){
        const lb=tones.get(m%12);if(lb==null)continue;
        const e=tbox('gtone'+(m%12===ch.root?' root':''),p.start,y(m),p.end-p.start,ROW);
        if(w>=22)e.append(h('span','',lb));
        grid.appendChild(e);
      }
    }
    // 小節線・拍の線
    for(const b of tl.bars){
      const e=tbox('gbar',b.start,0,b.ticks,H);
      e.style.setProperty('--beat',X(PPQ*4/b.meter[1]));
      grid.appendChild(e);
    }
    // 音
    for(const x of placedNotes(song,tl)){
      const w=Math.max(3,(x.end-x.start)*px-1);
      const e=tbox('note'+(nsel.has(x.m.id)?' sel':''),x.start,y(x.midi),x.end-x.start,ROW-1,1,3);
      e.dataset.id=x.m.id;
      if(w>=30)e.append(h('span','',midiName(x.midi,flat)));
      e.title=`${midiName(x.midi,flat)}・${ctx.fmtPos(x.start)}`;
      grid.appendChild(e);
    }
    // 選んでいる小節の範囲
    if(rg0){const a=tl.bars[rg0.from], z=tl.bars[rg0.to-1];if(a&&z)grid.appendChild(tbox('rrange',a.start,0,z.start+z.ticks-a.start,H));}
    // カーソル
    const cur=box('rcursor',0,0,2,H);cur.style.left=X(ctx.cursorAbs());grid.appendChild(cur);
    playhead=box('rplay',0,0,2,H);playhead.hidden=true;grid.appendChild(playhead);
    inner.appendChild(grid);
    grid.addEventListener('pointerdown',onDown);
    grid.addEventListener('contextmenu',e=>e.preventDefault());   // macOS の Ctrl＋クリック

    scroller.scrollLeft=scrollX;scroller.scrollTop=scrollY;
    if(first){first=false;scroller.scrollTop=scrollY;}
    scroller.addEventListener('scroll',()=>{scrollX=scroller.scrollLeft;scrollY=scroller.scrollTop;});
  }

  // 横の拡大を z（4分音符あたりの px）にする。anchorX（画面の x）の下の位置がずれないようにスクロールを合わせる（省くと見えている範囲の左端）。
  // --ppt を変えるだけで並べ直す（ピンチがなめらかになるように描き直さない）。止まって 200ms たったら描き直す（音名・度数を出す幅の判定）
  let zoomTimer=0;
  function setZoom(z,anchorX=null){
    z=clampZoom(z);
    if(!scroller||Math.abs(z-clampZoom(ctx.ui.mZoom))<.01)return;
    const r=scroller.getBoundingClientRect(), k=r.width/(scroller.offsetWidth||1);
    const off=anchorX==null?0:Math.max(0,(anchorX-r.left)/k-KEYW);   // 鍵盤の右からの距離（px）
    const tick=(scroller.scrollLeft+off)/ppt();
    ctx.ui.mZoom=z;
    root.style.setProperty('--ppt',ppt());
    scroller.scrollLeft=Math.max(0,tick*ppt()-off);scrollX=scroller.scrollLeft;
    ctx.zoomChanged?.();
    clearTimeout(zoomTimer);zoomTimer=setTimeout(render,200);
  }
  // トラックパッドの2本指で広げる・つまむ：Chrome・WebView2 は ctrl 付きのホイール、Safari・WKWebView はジェスチャー
  root.addEventListener('wheel',e=>{
    if(!e.ctrlKey)return;
    e.preventDefault();
    setZoom(clampZoom(ctx.ui.mZoom)*Math.exp(-e.deltaY*.01),e.clientX);
  },{passive:false});
  let gestureZ=null;
  root.addEventListener('gesturestart',e=>{e.preventDefault();gestureZ=clampZoom(ctx.ui.mZoom);});
  root.addEventListener('gesturechange',e=>{e.preventDefault();if(gestureZ!=null)setZoom(gestureZ*e.scale,e.clientX);});
  root.addEventListener('gestureend',e=>{e.preventDefault();gestureZ=null;});

  // 画面上の点 → 曲の tick・音の高さ（画面の拡大縮小を戻す）
  function hit(ev){
    const r=grid.getBoundingClientRect(), k=r.width/grid.offsetWidth;
    const abs=(ev.clientX-r.left)/k/ppt(), row=Math.floor((ev.clientY-r.top)/k/ROW);
    return {abs:Math.max(0,Math.min(ctx.tl().total-1,abs)),midi:Math.max(LOW,Math.min(HIGH,HIGH-row)),k};
  }
  const noteData=()=>placedNotes(ctx.song(),ctx.tl());
  // ドラッグの共通：move・up を登録し、ポインタがスクロールの端（上の帯・左の鍵盤の内側）に近いあいだは自動でスクロールして move を呼び直す
  function drag(move,up){
    let last=null;
    const mv=ev=>{last=ev;move(ev);};
    const timer=setInterval(()=>{
      if(!last||!scroller)return;
      const r=scroller.getBoundingClientRect(), k=r.width/(scroller.offsetWidth||1), edge=28*k;
      const L=r.left+KEYW*k, T=r.top+HEAD*k, R=r.right-10*k, B=r.bottom-10*k;
      const speed=d=>Math.sign(d)*Math.min(40,6+Math.abs(d)/k*.6);
      let dx=0,dy=0;
      if(last.clientX>R-edge)dx=speed(last.clientX-(R-edge));else if(last.clientX<L+edge)dx=speed(last.clientX-(L+edge));
      if(last.clientY>B-edge)dy=speed(last.clientY-(B-edge));else if(last.clientY<T+edge)dy=speed(last.clientY-(T+edge));
      if(!dx&&!dy)return;
      const x0=scroller.scrollLeft, y0=scroller.scrollTop;
      scroller.scrollLeft+=dx;scroller.scrollTop+=dy;
      if(scroller.scrollLeft!==x0||scroller.scrollTop!==y0)move(last);
    },30);
    const u=ev=>{clearInterval(timer);removeEventListener('pointermove',mv);removeEventListener('pointerup',u);up(ev);};
    addEventListener('pointermove',mv);addEventListener('pointerup',u);
  }
  // 今の道具（⌘・Ctrl を押しているあいだは入れ替わる）
  const toolOf=e=>{const t=ctx.ui.mTool==='select'?'select':'draw';return e&&(e.metaKey||e.ctrlKey)?(t==='draw'?'select':'draw'):t;};

  function onDown(e){
    if(e.button!==0)return;
    e.preventDefault();ctx.focus();
    const el=e.target.closest('.note'), p0=hit(e);
    if(el)return e.metaKey||e.ctrlKey?splitNotes(new Set([el.dataset.id]),snapRound(p0.abs)):grabNote(e,el,p0);   // ⌘＋クリック：そこで分ける
    if(e.shiftKey||toolOf(e)==='select')return rubberBand(e,p0);
    drawNote(e,p0);
  }
  // 小節番号を横にドラッグ：小節の範囲を選ぶ（押しただけならカーソル）。範囲の中で始まる音も選ぶ
  function barRange(e,abs0,k){
    const tl=ctx.tl(), bar=a=>(tl.bars.find(b=>a>=b.start&&a<b.start+b.ticks)||tl.bars.at(-1)).gi;
    const g0=bar(abs0), x0=e.clientX;let moved=false;
    const hg=e.currentTarget||e.target.closest('.rhg');
    const move=ev=>{
      if(!moved&&Math.abs(ev.clientX-x0)<4)return;
      moved=true;
      const r=hg.getBoundingClientRect(), g=bar(Math.max(0,(ev.clientX-r.left)/k/ppt()));
      const from=Math.min(g0,g), to=Math.max(g0,g)+1, cur=ctx.range();
      if(cur&&cur.from===from&&cur.to===to)return;
      selectRange({from,to});
    };
    const up=()=>{
      removeEventListener('pointermove',move);removeEventListener('pointerup',up);
      if(!moved)ctx.setCursorAbs(Math.max(0,Math.min(tl.total-1,snapFloor(abs0))));
    };
    drag(move,up);
  }
  function selectRange(r){
    const tl=ctx.tl(), lo=tl.bars[r.from].start, hi=r.to>=tl.bars.length?tl.total:tl.bars[r.to].start;
    nsel=new Set(noteData().filter(x=>x.start>=lo&&x.start<hi).map(x=>x.m.id));
    ctx.setRange(r);
  }
  // 何もないところ：音を置く。押したまま右へ引くと長さ（スナップ単位）
  function drawNote(e,p0){
    const tl=ctx.tl(), start=snapFloor(p0.abs), st=snapT();
    let len=lenT();
    const temp=box('note sel drawing',start*ppt(),y(p0.midi),Math.max(3,len*ppt()-1),ROW-1);grid.appendChild(temp);
    ctx.preview(p0.midi);
    let moved=false;
    const move=ev=>{
      const p=hit(ev);
      if(!moved&&Math.abs(p.abs-p0.abs)*ppt()<4)return;
      moved=true;
      len=Math.max(st,snapRound(p.abs)-start);
      temp.style.width=Math.max(3,len*ppt()-1)+'px';
    };
    const up=()=>{
      removeEventListener('pointermove',move);removeEventListener('pointerup',up);
      let id=null;
      ctx.commit(()=>{const n=addNote(ctx.song(),tl,start,len,p0.midi);id=n?.id;});
      nsel=new Set(id?[id]:[]);
      ctx.setCursorAbs(Math.min(tl.total-1,start+len),false);
      ctx.changed();
    };
    drag(move,up);
  }
  // ⇧＋ドラッグ：囲んだ音を選ぶ
  function rubberBand(e,p0){
    const band=box('rband',0,0,0,0);grid.appendChild(band);
    const x0=p0.abs*ppt(), y0=(HIGH-p0.midi)*ROW;
    const base=e.shiftKey?new Set(nsel):new Set();
    let moved=false;
    const move=ev=>{
      if(!moved&&Math.abs(hit(ev).abs-p0.abs)*ppt()<4&&hit(ev).midi===p0.midi)return;
      moved=true;
      const p=hit(ev), x1=p.abs*ppt(), y1=(HIGH-p.midi+1)*ROW;
      const l=Math.min(x0,x1), t=Math.min(y0,y1), w=Math.abs(x1-x0), hh=Math.abs(y1-y0)+ROW;
      band.style.cssText=`left:${l}px;top:${t}px;width:${w}px;height:${hh}px`;
      const lo=Math.min(p0.abs,p.abs), hi=Math.max(p0.abs,p.abs), mlo=Math.min(p0.midi,p.midi), mhi=Math.max(p0.midi,p.midi);
      nsel=new Set(base);
      for(const x of noteData())if(x.end>lo&&x.start<hi&&x.midi>=mlo&&x.midi<=mhi)nsel.add(x.m.id);
      grid.querySelectorAll('.note').forEach(n=>n.classList.toggle('sel',nsel.has(n.dataset.id)));
    };
    const up=()=>{
      removeEventListener('pointermove',move);removeEventListener('pointerup',up);band.remove();
      if(!moved&&!e.shiftKey){nsel=new Set();ctx.setCursorAbs(snapFloor(p0.abs));return;}   // 押しただけ：選択を外してカーソル
      ctx.changed(false);
    };
    drag(move,up);
  }
  // 音を押す：選ぶ（⇧で追加・外す）、ドラッグで動かす（右端は長さ）、ダブルクリックで消す。
  // ⌥（Alt）を押しながらドラッグ：複製を動かす（元の音は残す。選んでいる音をまとめて）
  function grabNote(e,el,p0){
    const id=el.dataset.id, now=performance.now();
    // ダブルクリック：前に同じ音を「動かさずに」押して離してから 350ms 以内（動かした直後に押しても消さない）
    if(lastClick.id===id&&now-lastClick.t<350){lastClick={id:null,t:0};ctx.commit(()=>removeNotes(ctx.song(),new Set([id])));nsel.delete(id);ctx.changed();return;}
    lastClick={id:null,t:0};
    if(e.shiftKey){nsel.has(id)?nsel.delete(id):nsel.add(id);ctx.changed(false);return;}
    if(!nsel.has(id))nsel=new Set([id]);
    const all=noteData(), me=all.find(x=>x.m.id===id);if(!me)return;
    ctx.preview(me.midi);
    const r=el.getBoundingClientRect(), resize=e.clientX>r.right-6, copy=!resize&&e.altKey;
    const picked=all.filter(x=>nsel.has(x.m.id));
    let els=[...grid.querySelectorAll('.note')].filter(n=>nsel.has(n.dataset.id));
    els.forEach(n=>n.classList.add('sel'));
    // 複製：動かしているあいだは写しを出して、元の音はそのまま見せる（動かし始めてから作る）
    const startCopy=()=>{els=els.map(n=>{const c=n.cloneNode(true);c.classList.add('copy');grid.appendChild(c);n.classList.remove('sel');return c;});};
    const st=snapT(), total=ctx.tl().total;
    let dt=0, dp=0, dl=0, moved=false, lastMidi=me.midi;
    const move=ev=>{
      const p=hit(ev);
      if(!moved&&Math.hypot((p.abs-p0.abs)*ppt(),(p.midi-p0.midi)*ROW)<4)return;
      if(!moved&&copy)startCopy();
      moved=true;
      if(resize){
        dl=Math.max(st,snapRound(me.end+(p.abs-p0.abs))-me.start)-(me.end-me.start);
        els.forEach(n=>{const x=picked.find(q=>q.m.id===n.dataset.id);n.style.width=Math.max(3,Math.max(st,x.end-x.start+dl)*ppt()-1)+'px';});
        return;
      }
      dt=snapRound(me.start+(p.abs-p0.abs))-me.start;
      dt=Math.max(-Math.min(...picked.map(x=>x.start)),Math.min(total-1-Math.max(...picked.map(x=>x.start)),dt));
      dp=Math.max(LOW-Math.min(...picked.map(x=>x.midi)),Math.min(HIGH-Math.max(...picked.map(x=>x.midi)),p.midi-p0.midi));
      els.forEach(n=>{n.style.transform=`translate(${dt*ppt()}px,${-dp*ROW}px)`;});
      if(me.midi+dp!==lastMidi){lastMidi=me.midi+dp;ctx.preview(lastMidi);}
    };
    const up=()=>{
      removeEventListener('pointermove',move);removeEventListener('pointerup',up);
      if(!moved){lastClick={id,t:now};ctx.changed(false);return;}
      if(copy&&!dt&&!dp){ctx.changed(false);return;}   // 同じ場所に落としたら複製しない
      const ids=[];
      ctx.commit(()=>{
        const song=ctx.song(), tl=ctx.tl();
        if(!copy)removeNotes(song,new Set(picked.map(x=>x.m.id)));
        for(const x of picked){
          const n=addNote(song,tl,x.start+dt,resize?Math.max(st,x.end-x.start+dl):x.end-x.start,x.midi+dp,{v:x.m.v,...(copy?{}:{id:x.m.id})});
          if(n)ids.push(n.id);
        }
      });
      if(copy)nsel=new Set(ids);   // 複製したほうを選ぶ
      ctx.changed();
    };
    drag(move,up);
  }

  // 選んでいる音を動かす・変える（矢印キー）。fn(x) → {start,len,midi}
  function editSel(fn){
    const picked=noteData().filter(x=>nsel.has(x.m.id));if(!picked.length)return false;
    const tl=ctx.tl();
    const next=picked.map(x=>({x,...fn(x)}));
    if(next.some(n=>n.start<0||n.start>=tl.total||n.midi<LOW||n.midi>HIGH))return true;
    ctx.commit(()=>{
      const song=ctx.song();
      removeNotes(song,new Set(picked.map(x=>x.m.id)));
      for(const n of next)addNote(song,tl,n.start,n.len,n.midi,{v:n.x.m.v,id:n.x.m.id});
    });
    if(next.length===1)ctx.preview(next[0].midi);
    ctx.changed();
    return true;
  }
  // キー操作（メロディーの画面のとき）。扱ったら true
  function onKey(e){
    const mod=e.metaKey||e.ctrlKey, k=e.key.toLowerCase(), st=snapT();
    if(mod&&k==='a'){e.preventDefault();selectRange({from:0,to:ctx.tl().bars.length});return true;}
    if(mod&&(k==='c'||k==='x')){
      e.preventDefault();
      const picked=noteData().filter(x=>nsel.has(x.m.id));if(!picked.length)return true;
      const t0=Math.min(...picked.map(x=>x.start));
      clip=picked.map(x=>({at:x.start-t0,len:x.end-x.start,midi:x.midi,v:x.m.v}));
      if(k==='x'){ctx.commit(()=>removeNotes(ctx.song(),nsel));nsel=new Set();ctx.changed();}
      return true;
    }
    if(mod&&k==='v'){
      e.preventDefault();if(!clip)return true;
      const at=ctx.cursorAbs(), ids=[];
      ctx.commit(()=>{for(const c of clip){const n=addNote(ctx.song(),ctx.tl(),at+c.at,c.len,c.midi,{v:c.v});if(n)ids.push(n.id);}});
      nsel=new Set(ids);
      const end=Math.max(...clip.map(c=>c.at+c.len));
      ctx.setCursorAbs(Math.min(ctx.tl().total-1,at+end),false);ctx.changed();
      return true;
    }
    if(mod&&k==='d'){   // すぐ後ろに複製
      e.preventDefault();
      const picked=noteData().filter(x=>nsel.has(x.m.id));if(!picked.length)return true;
      const t0=Math.min(...picked.map(x=>x.start)), t1=Math.max(...picked.map(x=>x.end)), ids=[];
      ctx.commit(()=>{for(const x of picked){const n=addNote(ctx.song(),ctx.tl(),x.start+(t1-t0),x.end-x.start,x.midi,{v:x.m.v});if(n)ids.push(n.id);}});
      nsel=new Set(ids);ctx.changed();
      return true;
    }
    if(mod)return false;
    if(k==='q'){e.preventDefault();quantizeSelection();return true;}
    if(e.key==='Escape'&&(nsel.size||ctx.range())){nsel=new Set();ctx.setRange(null);return true;}
    if((e.key==='Delete'||e.key==='Backspace')&&nsel.size){
      e.preventDefault();ctx.commit(()=>removeNotes(ctx.song(),nsel));nsel=new Set();ctx.changed();return true;
    }
    if(e.key==='ArrowUp'||e.key==='ArrowDown'){
      if(!nsel.size)return false;
      e.preventDefault();const d=(e.key==='ArrowUp'?1:-1)*(e.shiftKey?12:1);
      return editSel(x=>({start:x.start,len:x.end-x.start,midi:x.midi+d}));
    }
    if(e.key==='ArrowLeft'||e.key==='ArrowRight'){
      const d=e.key==='ArrowRight'?1:-1;
      if(nsel.size){
        e.preventDefault();
        // ⇧：長さ、なし：位置（スナップ単位）
        if(e.shiftKey)return editSel(x=>({start:x.start,len:Math.max(st,x.end-x.start+d*st),midi:x.midi}));
        return editSel(x=>({start:x.start+d*st,len:x.end-x.start,midi:x.midi}));
      }
      e.preventDefault();
      const tl=ctx.tl(), c=ctx.cursorAbs(), next=d>0?snapFloor(c)+st:(snapFloor(c)<c?snapFloor(c):snapFloor(Math.max(0,c-1)));
      ctx.setCursorAbs(Math.max(0,Math.min(tl.total-1,next)));
      return true;
    }
    return false;
  }

  // 再生位置（null で消す）。見えている範囲の外に出たら横にスクロールする
  function setPlayhead(abs){
    if(!playhead||!scroller)return;
    if(abs==null){playhead.hidden=true;grid?.querySelectorAll('.note.playing').forEach(n=>n.classList.remove('playing'));return;}
    const x=abs*ppt();
    playhead.hidden=false;playhead.style.left=X(abs);
    const view=scroller.clientWidth-KEYW;
    if(x<scroller.scrollLeft||x>scroller.scrollLeft+view-20)scroller.scrollLeft=Math.max(0,x-view*.15);
    const on=new Set(noteData().filter(n=>abs>=n.start&&abs<n.end).map(n=>n.m.id));
    grid.querySelectorAll('.note').forEach(n=>n.classList.toggle('playing',on.has(n.dataset.id)));
    grid.parentNode.querySelectorAll('.rchord').forEach(c=>c.classList.toggle('playing',c.dataset.id===ctx.playingChord()));
  }
  // カーソルが見える位置までスクロール
  function reveal(abs){
    if(!scroller)return;
    const x=abs*ppt(), view=scroller.clientWidth-KEYW;
    if(x<scroller.scrollLeft||x>scroller.scrollLeft+view-20)scroller.scrollLeft=Math.max(0,x-view*.3);
  }
  // 範囲の中の音の数と、選んでいる数
  const selection=()=>({count:nsel.size,notes:noteData().filter(x=>nsel.has(x.m.id))});
  const clearSelection=()=>{nsel=new Set();};
  // 結合：選んだ音を1つにする（いちばん前の音の高さで、最初から最後まで。頭がそろっていれば高いほう）
  function joinSelection(){
    const picked=noteData().filter(x=>nsel.has(x.m.id));if(picked.length<2)return;
    const first=[...picked].sort((a,b)=>a.start-b.start||b.midi-a.midi)[0], end=Math.max(...picked.map(x=>x.end));
    ctx.commit(()=>{
      removeNotes(ctx.song(),new Set(picked.map(x=>x.m.id)));
      addNote(ctx.song(),ctx.tl(),first.start,end-first.start,first.midi,{v:first.m.v,id:first.m.id});
    });
    nsel=new Set([first.m.id]);ctx.preview(first.midi);ctx.changed();
  }
  // 分割：音を2つに分ける。at を省くと、カーソルが音の中ならカーソル、外なら真ん中（スナップに合わせる）
  function splitNotes(ids,at=null){
    const cur=ctx.cursorAbs();
    const plan=noteData().filter(x=>ids.has(x.m.id)).map(x=>{
      let a=at??(cur>x.start&&cur<x.end?cur:snapRound((x.start+x.end)/2));
      if(!(a>x.start&&a<x.end))a=Math.round((x.start+x.end)/2);
      return a>x.start&&a<x.end?{x,a}:null;
    }).filter(Boolean);
    if(!plan.length){ctx.toast?.('分けられる長さがありません');return;}
    const ids2=[];
    ctx.commit(()=>{
      const song=ctx.song(), tl=ctx.tl();
      removeNotes(song,new Set(plan.map(p=>p.x.m.id)));
      for(const {x,a} of plan){
        addNote(song,tl,x.start,a-x.start,x.midi,{v:x.m.v,id:x.m.id});ids2.push(x.m.id);
        const b=addNote(song,tl,a,x.end-a,x.midi,{v:x.m.v});if(b)ids2.push(b.id);
      }
    });
    nsel=new Set(ids2);ctx.changed();
  }
  const splitSelection=()=>splitNotes(new Set(nsel));
  // クオンタイズ：選んだ音の頭と終わりをスナップにそろえる（長さは1スナップ以上）
  function quantizeSelection(){
    const picked=noteData().filter(x=>nsel.has(x.m.id));
    if(!picked.length){ctx.toast?.('クオンタイズする音を選んでください');return;}
    const st=snapT(), total=ctx.tl().total;
    ctx.commit(()=>{
      const song=ctx.song(), tl=ctx.tl();
      removeNotes(song,new Set(picked.map(x=>x.m.id)));
      for(const x of picked){
        const s0=Math.min(total-1,snapRound(x.start)), e0=Math.max(s0+st,snapRound(x.end));
        addNote(song,tl,s0,e0-s0,x.midi,{v:x.m.v,id:x.m.id});
      }
    });
    ctx.changed();
  }
  // 録音中の音（{start,end,midi}）を重ねて出す（描き直さずに、その層だけ入れ替える）
  function setRecNotes(list){
    if(!grid)return;
    grid.querySelectorAll('.note.rec').forEach(n=>n.remove());
    const px=ppt();
    for(const x of list||[]){
      if(x.midi<LOW||x.midi>HIGH)continue;
      grid.appendChild(box('note rec',x.start*px,y(x.midi),Math.max(3,(x.end-x.start)*px-1),ROW-1));
    }
  }
  // 選んでいる音を消す
  function deleteSelection(){if(!nsel.size)return;ctx.commit(()=>removeNotes(ctx.song(),nsel));nsel=new Set();ctx.changed();}
  // ステップ入力：カーソルの位置に音（和音なら全部）を置いて、入力の長さだけ進む
  function stepInput(midis){
    const tl=ctx.tl(), at=ctx.cursorAbs(), len=lenT(), ids=[];
    ctx.commit(()=>{for(const m of midis){if(m<LOW||m>HIGH)continue;const n=addNote(ctx.song(),tl,at,len,m);if(n)ids.push(n.id);}});
    nsel=new Set(ids);
    ctx.setCursorAbs(Math.min(tl.total-1,at+len),false);ctx.changed();reveal(ctx.cursorAbs());
  }
  // 休符：カーソルを入力の長さだけ進める
  function stepRest(){const tl=ctx.tl();ctx.setCursorAbs(Math.min(tl.total-1,ctx.cursorAbs()+lenT()));reveal(ctx.cursorAbs());}

  return {render,setZoom,onKey,setPlayhead,reveal,selection,clearSelection,deleteSelection,selectRange,joinSelection,splitSelection,quantizeSelection,setRecNotes,stepInput,stepRest,newNote};
}
