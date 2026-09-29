(function () {
  'use strict';
  const PALETTE = ['#1f77b4','#d62728','#2ca02c','#9467bd','#ff7f0e','#17becf','#8c564b','#e377c2','#7f7f7f','#bcbd22'];

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function finitePairs(trace) {
    const out = [];
    for (let i = 0; i < trace.x.length; i++) if (trace.x[i] != null && trace.y[i] != null) out.push([trace.x[i], trace.y[i], i]);
    return out;
  }
  function bounds(model) {
    let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
    model.traces.forEach(t => {
      if (!t.visible) return;
      for (let i=0;i<t.x.length;i++) {
        const x=t.x[i], y=t.y[i]; if (x==null||y==null) continue;
        if (x<xmin) xmin=x; if(x>xmax) xmax=x; if(y<ymin) ymin=y; if(y>ymax) ymax=y;
      }
    });
    if (!Number.isFinite(xmin)) return {xmin:0,xmax:1,ymin:0,ymax:1};
    if (xmin===xmax) { xmin-=0.5; xmax+=0.5; }
    if (ymin===ymax) { ymin-=0.5; ymax+=0.5; }
    const xp=(xmax-xmin)*0.04, yp=(ymax-ymin)*0.06;
    return {xmin:xmin-xp,xmax:xmax+xp,ymin:ymin-yp,ymax:ymax+yp};
  }
  function niceStep(span, target=6) {
    const raw = span / target;
    const pow = Math.pow(10, Math.floor(Math.log10(raw)));
    const f = raw/pow;
    const n = f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10;
    return n*pow;
  }
  function ticks(a,b) {
    const step=niceStep(Math.abs(b-a));
    const first=Math.ceil(a/step)*step;
    const arr=[];
    for(let v=first;v<=b+step*1e-9 && arr.length<50;v+=step) arr.push(Math.abs(v)<step*1e-10?0:v);
    return arr;
  }
  function fmt(v) {
    if (v===0) return '0';
    const av=Math.abs(v);
    if (av>=1e4 || av<1e-3) return v.toExponential(2);
    return Number(v.toPrecision(5)).toString();
  }

  class PlotRenderer {
    constructor(canvas, tooltip, legend, zoomBox) {
      this.canvas=canvas; this.ctx=canvas.getContext('2d'); this.tooltip=tooltip; this.legend=legend; this.zoomBox=zoomBox;
      this.model=null; this.mode='zoom'; this.drag=null; this.hover=null; this.view=null; this.initial=null;
      this.margin={l:70,r:24,t:46,b:58};
      this.bind();
      this.ro=new ResizeObserver(()=>this.resize()); this.ro.observe(canvas.parentElement);
    }
    bind() {
      this.canvas.addEventListener('wheel',e=>this.onWheel(e),{passive:false});
      this.canvas.addEventListener('pointerdown',e=>this.onDown(e));
      this.canvas.addEventListener('pointermove',e=>this.onMove(e));
      this.canvas.addEventListener('pointerup',e=>this.onUp(e));
      this.canvas.addEventListener('pointercancel',()=>this.cancelDrag());
      this.canvas.addEventListener('dblclick',()=>this.reset());
      this.canvas.addEventListener('pointerleave',()=>{ if(!this.drag){this.tooltip.classList.add('hidden'); this.hover=null; this.draw();}});
    }
    setMode(mode){ this.mode=mode; this.cancelDrag(); }
    setModel(model){ this.model=model; const b=bounds(model); this.initial={...b};
      if(model.xRange) {this.initial.xmin=model.xRange[0];this.initial.xmax=model.xRange[1];}
      if(model.yRange) {this.initial.ymin=model.yRange[0];this.initial.ymax=model.yRange[1];}
      this.view={...this.initial}; this.buildLegend(); this.resize();
    }
    clear(){this.model=null;this.view=null;this.legend.textContent='';this.ctx.clearRect(0,0,this.canvas.width,this.canvas.height);}
    reset(){if(this.initial){this.view={...this.initial};this.draw();}}
    buildLegend(){
      this.legend.textContent='';
      this.model.traces.forEach((t,i)=>{
        const b=document.createElement('button'); b.type='button'; b.className='legendItem'; b.dataset.index=String(i);
        const sw=document.createElement('span'); sw.className='swatch'; sw.style.background=t.color||PALETTE[i%PALETTE.length];
        const tx=document.createElement('span'); tx.textContent=t.name||`Trace ${i+1}`;
        b.append(sw,tx); if(!t.visible) b.classList.add('muted');
        b.addEventListener('click',()=>{t.visible=!t.visible;b.classList.toggle('muted',!t.visible);this.draw();});
        this.legend.appendChild(b);
      });
    }
    resize(){
      const rect=this.canvas.parentElement.getBoundingClientRect(); const dpr=Math.max(1,Math.min(2,window.devicePixelRatio||1));
      const w=Math.max(320,Math.floor(rect.width)); const h=Math.max(220,Math.floor(rect.height));
      this.canvas.width=Math.floor(w*dpr);this.canvas.height=Math.floor(h*dpr);this.canvas.style.width=w+'px';this.canvas.style.height=h+'px';
      this.ctx.setTransform(dpr,0,0,dpr,0,0); this.cssW=w;this.cssH=h;this.draw();
    }
    area(){return {x:this.margin.l,y:this.margin.t,w:Math.max(10,this.cssW-this.margin.l-this.margin.r),h:Math.max(10,this.cssH-this.margin.t-this.margin.b)};}
    xpx(x){const a=this.area();return a.x+(x-this.view.xmin)/(this.view.xmax-this.view.xmin)*a.w;}
    ypx(y){const a=this.area();return a.y+a.h-(y-this.view.ymin)/(this.view.ymax-this.view.ymin)*a.h;}
    xval(px){const a=this.area();return this.view.xmin+(px-a.x)/a.w*(this.view.xmax-this.view.xmin);}
    yval(py){const a=this.area();return this.view.ymin+(a.y+a.h-py)/a.h*(this.view.ymax-this.view.ymin);}
    inside(x,y){const a=this.area();return x>=a.x&&x<=a.x+a.w&&y>=a.y&&y<=a.y+a.h;}
    draw(){
      if(!this.ctx||!this.cssW)return; const c=this.ctx; c.clearRect(0,0,this.cssW,this.cssH); c.fillStyle='#fff';c.fillRect(0,0,this.cssW,this.cssH);
      if(!this.model||!this.view)return;
      const a=this.area(); c.save();c.strokeStyle='#d9dde5';c.lineWidth=1;c.fillStyle='#6b7280';c.font='12px system-ui, sans-serif';
      c.textAlign='center'; c.textBaseline='top';
      for(const x of ticks(this.view.xmin,this.view.xmax)){const px=this.xpx(x);c.beginPath();c.moveTo(px,a.y);c.lineTo(px,a.y+a.h);c.stroke();c.fillText(fmt(x),px,a.y+a.h+8);}
      c.textAlign='right';c.textBaseline='middle';
      for(const y of ticks(this.view.ymin,this.view.ymax)){const py=this.ypx(y);c.beginPath();c.moveTo(a.x,py);c.lineTo(a.x+a.w,py);c.stroke();c.fillText(fmt(y),a.x-8,py);}
      c.strokeStyle='#4b5563';c.strokeRect(a.x,a.y,a.w,a.h);
      c.fillStyle='#111827';c.font='600 14px system-ui,sans-serif';c.textAlign='center';c.textBaseline='top';c.fillText(this.model.title||'',this.cssW/2,10);
      c.font='12px system-ui,sans-serif';c.fillText(this.model.xTitle||'x',a.x+a.w/2,this.cssH-22);
      c.save();c.translate(18,a.y+a.h/2);c.rotate(-Math.PI/2);c.fillText(this.model.yTitle||'y',0,0);c.restore();
      c.save();c.beginPath();c.rect(a.x,a.y,a.w,a.h);c.clip();
      this.model.traces.forEach((t,i)=>this.drawTrace(t,i)); c.restore();
      if(this.hover){c.fillStyle='#111827';c.beginPath();c.arc(this.hover.px,this.hover.py,3.5,0,Math.PI*2);c.fill();}
      c.restore();
    }
    drawTrace(t,i){ if(!t.visible)return; const c=this.ctx; const color=t.color||PALETTE[i%PALETTE.length]; const n=t.x.length; const maxDraw=25000; const stride=Math.max(1,Math.ceil(n/maxDraw));
      c.strokeStyle=color;c.fillStyle=color;c.lineWidth=t.width||1.5; c.setLineDash(t.dash==='dash'?[8,5]:t.dash==='dot'?[2,4]:t.dash==='dashdot'?[8,4,2,4]:[]);
      if(t.lines){c.beginPath();let started=false;for(let j=0;j<n;j+=stride){const x=t.x[j],y=t.y[j];if(x==null||y==null){started=false;continue;}if(x<this.view.xmin||x>this.view.xmax||y<this.view.ymin-(this.view.ymax-this.view.ymin)*2||y>this.view.ymax+(this.view.ymax-this.view.ymin)*2)continue;const px=this.xpx(x),py=this.ypx(y);if(!started){c.moveTo(px,py);started=true;}else c.lineTo(px,py);}c.stroke();}
      if(t.markers){const ms=t.markerSize||5; const mstride=Math.max(stride,Math.ceil(n/5000));for(let j=0;j<n;j+=mstride){const x=t.x[j],y=t.y[j];if(x==null||y==null||x<this.view.xmin||x>this.view.xmax||y<this.view.ymin||y>this.view.ymax)continue;c.beginPath();c.arc(this.xpx(x),this.ypx(y),ms/2,0,Math.PI*2);c.fill();}}
      c.setLineDash([]);
    }
    pos(e){const r=this.canvas.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top};}
    onWheel(e){if(!this.model)return;const p=this.pos(e);if(!this.inside(p.x,p.y))return;e.preventDefault();const factor=e.deltaY<0?0.82:1.22;const x=this.xval(p.x),y=this.yval(p.y);this.view.xmin=x+(this.view.xmin-x)*factor;this.view.xmax=x+(this.view.xmax-x)*factor;this.view.ymin=y+(this.view.ymin-y)*factor;this.view.ymax=y+(this.view.ymax-y)*factor;this.draw();}
    onDown(e){if(!this.model)return;const p=this.pos(e);if(!this.inside(p.x,p.y))return;this.canvas.setPointerCapture(e.pointerId);this.drag={start:p,last:p,view:{...this.view}};if(this.mode==='zoom'){this.zoomBox.classList.remove('hidden');this.updateZoomBox(p,p);}}
    onMove(e){if(!this.model)return;const p=this.pos(e);if(this.drag){if(this.mode==='pan'){const a=this.area();const dx=(p.x-this.drag.start.x)/a.w*(this.drag.view.xmax-this.drag.view.xmin);const dy=(p.y-this.drag.start.y)/a.h*(this.drag.view.ymax-this.drag.view.ymin);this.view.xmin=this.drag.view.xmin-dx;this.view.xmax=this.drag.view.xmax-dx;this.view.ymin=this.drag.view.ymin+dy;this.view.ymax=this.drag.view.ymax+dy;this.draw();}else{this.drag.last=p;this.updateZoomBox(this.drag.start,p);}return;}this.updateHover(p);}
    onUp(e){if(!this.drag)return;const p=this.pos(e);if(this.mode==='zoom'){const s=this.drag.start;this.zoomBox.classList.add('hidden');if(Math.abs(p.x-s.x)>8&&Math.abs(p.y-s.y)>8){const a=this.area();const x1=clamp(Math.min(s.x,p.x),a.x,a.x+a.w),x2=clamp(Math.max(s.x,p.x),a.x,a.x+a.w),y1=clamp(Math.min(s.y,p.y),a.y,a.y+a.h),y2=clamp(Math.max(s.y,p.y),a.y,a.y+a.h);this.view={xmin:this.xval(x1),xmax:this.xval(x2),ymin:this.yval(y2),ymax:this.yval(y1)};this.draw();}}this.drag=null;}
    cancelDrag(){this.drag=null;this.zoomBox.classList.add('hidden');}
    updateZoomBox(a,b){const l=Math.min(a.x,b.x),t=Math.min(a.y,b.y),w=Math.abs(a.x-b.x),h=Math.abs(a.y-b.y);Object.assign(this.zoomBox.style,{left:l+'px',top:t+'px',width:w+'px',height:h+'px'});}
    updateHover(p){if(!this.inside(p.x,p.y)){this.tooltip.classList.add('hidden');return;}let best=null,bestD=Infinity;const xTarget=this.xval(p.x);this.model.traces.forEach((t,ti)=>{if(!t.visible)return;const n=t.x.length;let idx=0;let monotonic=true;for(let k=1;k<Math.min(n,2000);k++){if(t.x[k]!=null&&t.x[k-1]!=null&&t.x[k]<t.x[k-1]){monotonic=false;break;}}if(monotonic){let lo=0,hi=n-1;while(lo<hi){const m=(lo+hi)>>1;const v=t.x[m]==null?Infinity:t.x[m];if(v<xTarget)lo=m+1;else hi=m;}idx=lo;const cand=[idx,idx-1,idx+1];for(const j of cand){if(j<0||j>=n||t.x[j]==null||t.y[j]==null)continue;const px=this.xpx(t.x[j]),py=this.ypx(t.y[j]);const d=(px-p.x)**2+(py-p.y)**2;if(d<bestD){bestD=d;best={ti,j,px,py,x:t.x[j],y:t.y[j],name:t.name};}}}else{const stride=Math.max(1,Math.ceil(n/10000));for(let j=0;j<n;j+=stride){if(t.x[j]==null||t.y[j]==null)continue;const px=this.xpx(t.x[j]),py=this.ypx(t.y[j]);const d=(px-p.x)**2+(py-p.y)**2;if(d<bestD){bestD=d;best={ti,j,px,py,x:t.x[j],y:t.y[j],name:t.name};}}}});
      if(best&&bestD<900){this.hover=best;this.tooltip.textContent=`${best.name}: x=${fmt(best.x)}  y=${fmt(best.y)}`;this.tooltip.style.left=Math.min(this.cssW-220,best.px+12)+'px';this.tooltip.style.top=Math.max(8,best.py-34)+'px';this.tooltip.classList.remove('hidden');}else{this.hover=null;this.tooltip.classList.add('hidden');}this.draw();}
  }
  window.PlotRenderer=PlotRenderer;
}());
