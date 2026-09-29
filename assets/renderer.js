(function () {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';
  const PALETTE = ['#1f77b4','#d62728','#2ca02c','#9467bd','#ff7f0e','#17becf','#8c564b','#e377c2','#7f7f7f','#bcbd22'];
  function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
  function fmt(v){if(v===0)return'0';const a=Math.abs(v);if(a>=1e4||a<1e-3)return v.toExponential(2);return Number(v.toPrecision(5)).toString();}
  function niceStep(span,target=5){if(!(span>0))return 1;const raw=span/target,p=Math.pow(10,Math.floor(Math.log10(raw))),f=raw/p;return(f<1.5?1:f<3?2:f<7?5:10)*p;}
  function ticks(a,b){const s=niceStep(Math.abs(b-a)),first=Math.ceil(a/s)*s,out=[];for(let v=first;v<=b+s*1e-9&&out.length<40;v+=s)out.push(Math.abs(v)<s*1e-10?0:v);return out;}
  function el(name, attrs={}){const n=document.createElementNS(NS,name);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,String(v));return n;}
  function textNode(parent, x, y, text, attrs={}){const n=el('text',{x,y,...attrs});n.textContent=text;parent.appendChild(n);return n;}

  function panelBounds(model,panelIndex){
    let xmin=Infinity,xmax=-Infinity,ymin=Infinity,ymax=-Infinity;
    model.traces.forEach(t=>{
      if(!t.visible||t.panel!==panelIndex)return;
      for(let i=0;i<t.x.length;i++){
        const x=t.x[i],y=t.y[i];if(x==null||y==null)continue;
        if(x<xmin)xmin=x;if(x>xmax)xmax=x;if(y<ymin)ymin=y;if(y>ymax)ymax=y;
      }
    });
    if(!Number.isFinite(xmin))return{xmin:0,xmax:1,ymin:0,ymax:1};
    if(xmin===xmax){xmin-=0.5;xmax+=0.5;}if(ymin===ymax){ymin-=0.5;ymax+=0.5;}
    const xp=(xmax-xmin)*0.035,yp=(ymax-ymin)*0.06;
    return{xmin:xmin-xp,xmax:xmax+xp,ymin:ymin-yp,ymax:ymax+yp};
  }

  class PlotRenderer{
    constructor(svg,tooltip,legend,zoomBox){
      this.svg=svg;this.tooltip=tooltip;this.legend=legend;this.zoomBox=zoomBox;
      this.model=null;this.mode='zoom';this.drag=null;this.hover=null;this.views=[];this.initial=[];
      this.margin={l:78,r:26};this.cssW=0;this.cssH=0;this._raf=0;
      this.bind();this.ro=new ResizeObserver(()=>this.resize());this.ro.observe(svg.parentElement);
    }
    bind(){
      this.svg.addEventListener('wheel',e=>this.onWheel(e),{passive:false});
      this.svg.addEventListener('pointerdown',e=>this.onDown(e));
      this.svg.addEventListener('pointermove',e=>this.onMove(e));
      this.svg.addEventListener('pointerup',e=>this.onUp(e));
      this.svg.addEventListener('pointercancel',()=>this.cancelDrag());
      this.svg.addEventListener('dblclick',()=>this.reset());
      this.svg.addEventListener('pointerleave',()=>{if(!this.drag){this.tooltip.classList.add('hidden');this.hover=null;this.scheduleDraw();}});
    }
    scheduleDraw(){if(this._raf)return;this._raf=requestAnimationFrame(()=>{this._raf=0;this.draw();});}
    setMode(mode){this.mode=mode;this.cancelDrag();}
    setModel(model){
      this.model=model;this.initial=model.panels.map((p,i)=>{
        const b=panelBounds(model,i);
        if(p.xRange){b.xmin=p.xRange[0];b.xmax=p.xRange[1];}
        if(p.yRange){b.ymin=p.yRange[0];b.ymax=p.yRange[1];}
        return b;
      });
      this.views=this.initial.map(v=>({...v}));this.buildLegend();this.resize();
    }
    clear(){this.model=null;this.views=[];this.initial=[];this.legend.textContent='';this.svg.replaceChildren();}
    reset(){if(this.initial.length){this.views=this.initial.map(v=>({...v}));this.scheduleDraw();}}
    buildLegend(){
      this.legend.textContent='';
      this.model.traces.forEach((t,i)=>{
        const b=document.createElement('button');b.type='button';b.className='legendItem';
        const sw=document.createElement('span');sw.className='swatch';sw.style.background=t.color||PALETTE[i%PALETTE.length];
        const tx=document.createElement('span');tx.textContent=t.name||`Trace ${i+1}`;
        b.append(sw,tx);if(!t.visible)b.classList.add('muted');
        b.addEventListener('click',()=>{t.visible=!t.visible;b.classList.toggle('muted',!t.visible);this.scheduleDraw();});
        this.legend.appendChild(b);
      });
    }
    resize(){
      const rect=this.svg.parentElement.getBoundingClientRect();
      const w=Math.max(320,Math.round(rect.width)),h=Math.max(220,Math.round(rect.height));
      this.cssW=w;this.cssH=h;
      this.svg.setAttribute('viewBox',`0 0 ${w} ${h}`);
      this.svg.setAttribute('width',String(w));this.svg.setAttribute('height',String(h));
      this.scheduleDraw();
    }
    layoutInfo(){
      const n=Math.max(1,this.model?this.model.panels.length:1),globalTitle=this.model&&this.model.title?28:6,gap=10,bottom=8;
      const available=Math.max(80,this.cssH-globalTitle-bottom-gap*(n-1));
      const slot=available/n;return{n,globalTitle,gap,bottom,slot};
    }
    area(panel){
      const L=this.layoutInfo(),top=L.globalTitle+panel*(L.slot+L.gap),titleH=22,xH=38;
      return{x:this.margin.l,y:top+titleH,w:Math.max(20,this.cssW-this.margin.l-this.margin.r),h:Math.max(24,L.slot-titleH-xH),slotTop:top,slotH:L.slot};
    }
    panelAt(x,y){if(!this.model)return-1;for(let p=0;p<this.model.panels.length;p++){const a=this.area(p);if(x>=a.x&&x<=a.x+a.w&&y>=a.y&&y<=a.y+a.h)return p;}return-1;}
    xpx(x,p){const a=this.area(p),v=this.views[p];return a.x+(x-v.xmin)/(v.xmax-v.xmin)*a.w;}
    ypx(y,p){const a=this.area(p),v=this.views[p];return a.y+a.h-(y-v.ymin)/(v.ymax-v.ymin)*a.h;}
    xval(px,p){const a=this.area(p),v=this.views[p];return v.xmin+(px-a.x)/a.w*(v.xmax-v.xmin);}
    yval(py,p){const a=this.area(p),v=this.views[p];return v.ymin+(a.y+a.h-py)/a.h*(v.ymax-v.ymin);}
    syncXFrom(panel,xmin,xmax){for(let p=0;p<this.views.length;p++){this.views[p].xmin=xmin;this.views[p].xmax=xmax;}}

    draw(){
      if(!this.cssW||!this.cssH)return;
      this.svg.replaceChildren();
      const bg=el('rect',{x:0,y:0,width:this.cssW,height:this.cssH,fill:'#fff'});this.svg.appendChild(bg);
      if(!this.model||!this.views.length)return;
      if(this.model.title)textNode(this.svg,this.cssW/2,17,this.model.title,{'font-family':'Segoe UI,system-ui,sans-serif','font-size':14,'font-weight':600,'text-anchor':'middle','dominant-baseline':'middle',fill:'#111827'});
      for(let p=0;p<this.model.panels.length;p++)this.drawPanel(p);
      if(this.hover)this.svg.appendChild(el('circle',{cx:this.hover.px,cy:this.hover.py,r:3.5,fill:'#111827','pointer-events':'none'}));
    }
    drawPanel(p){
      const a=this.area(p),v=this.views[p],pm=this.model.panels[p];
      const g=el('g',{'data-panel':p});this.svg.appendChild(g);
      const grid=el('g',{stroke:'#d9dde5','stroke-width':1,'shape-rendering':'crispEdges'});g.appendChild(grid);
      const labels=el('g',{fill:'#6b7280','font-family':'Segoe UI,system-ui,sans-serif','font-size':11});g.appendChild(labels);
      for(const x of ticks(v.xmin,v.xmax)){
        const px=this.xpx(x,p);grid.appendChild(el('line',{x1:px,y1:a.y,x2:px,y2:a.y+a.h}));
        textNode(labels,px,a.y+a.h+16,fmt(x),{'text-anchor':'middle'});
      }
      for(const y of ticks(v.ymin,v.ymax)){
        const py=this.ypx(y,p);grid.appendChild(el('line',{x1:a.x,y1:py,x2:a.x+a.w,y2:py}));
        textNode(labels,a.x-8,py+0.5,fmt(y),{'text-anchor':'end','dominant-baseline':'middle'});
      }
      g.appendChild(el('rect',{x:a.x,y:a.y,width:a.w,height:a.h,fill:'none',stroke:'#4b5563','stroke-width':1,'shape-rendering':'crispEdges'}));
      textNode(g,a.x+a.w/2,a.slotTop+12,pm.title||'',{'font-family':'Segoe UI,system-ui,sans-serif','font-size':12,'font-weight':600,'text-anchor':'middle','dominant-baseline':'middle',fill:'#111827'});
      textNode(g,a.x+a.w/2,a.y+a.h+31,pm.xTitle||'x',{'font-family':'Segoe UI,system-ui,sans-serif','font-size':11,'text-anchor':'middle','dominant-baseline':'middle',fill:'#111827'});
      const yt=textNode(g,18,a.y+a.h/2,pm.yTitle||'y',{'font-family':'Segoe UI,system-ui,sans-serif','font-size':11,'text-anchor':'middle','dominant-baseline':'middle',fill:'#111827'});yt.setAttribute('transform',`rotate(-90 18 ${a.y+a.h/2})`);

      const clipId=`clip-${p}-${Math.random().toString(36).slice(2)}`;
      const defs=el('defs');const cp=el('clipPath',{id:clipId});cp.appendChild(el('rect',{x:a.x,y:a.y,width:a.w,height:a.h}));defs.appendChild(cp);g.appendChild(defs);
      const traces=el('g',{'clip-path':`url(#${clipId})`});g.appendChild(traces);
      this.model.traces.forEach((t,i)=>{if(t.panel===p)this.drawTrace(traces,t,i,p);});
    }
    dashArray(dash){return dash==='dash'?'8 5':dash==='dot'?'2 4':dash==='dashdot'?'8 4 2 4':null;}
    drawTrace(parent,t,i,p){
      if(!t.visible)return;
      const color=t.color||PALETTE[i%PALETTE.length],v=this.views[p],n=t.x.length;
      const maxDraw=Math.max(1200,Math.min(7000,Math.ceil(this.area(p).w*3.0)));
      const stride=Math.max(1,Math.ceil(n/maxDraw));
      if(t.lines){
        let d='',started=false;
        for(let j=0;j<n;j+=stride){
          const x=t.x[j],y=t.y[j];
          if(x==null||y==null){started=false;continue;}
          if(x<v.xmin||x>v.xmax||y<v.ymin-(v.ymax-v.ymin)*2||y>v.ymax+(v.ymax-v.ymin)*2)continue;
          const px=this.xpx(x,p),py=this.ypx(y,p);
          d+=`${started?'L':'M'}${px.toFixed(2)} ${py.toFixed(2)} `;started=true;
        }
        if(d){const path=el('path',{d,fill:'none',stroke:color,'stroke-width':t.width||1.5,'stroke-linecap':'round','stroke-linejoin':'round','vector-effect':'non-scaling-stroke','pointer-events':'none'});const dash=this.dashArray(t.dash);if(dash)path.setAttribute('stroke-dasharray',dash);parent.appendChild(path);}
      }
      if(t.markers){
        const ms=t.markerSize||5,mstride=Math.max(stride,Math.ceil(n/1600));
        const mg=el('g',{fill:color,'pointer-events':'none'});
        for(let j=0;j<n;j+=mstride){const x=t.x[j],y=t.y[j];if(x==null||y==null||x<v.xmin||x>v.xmax||y<v.ymin||y>v.ymax)continue;mg.appendChild(el('circle',{cx:this.xpx(x,p),cy:this.ypx(y,p),r:ms/2}));}
        parent.appendChild(mg);
      }
    }
    pos(e){const r=this.svg.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top};}
    onWheel(e){
      if(!this.model)return;const q=this.pos(e),p=this.panelAt(q.x,q.y);if(p<0)return;e.preventDefault();
      const f=e.deltaY<0?0.82:1.22,x=this.xval(q.x,p),y=this.yval(q.y,p),v=this.views[p];
      const xmin=x+(v.xmin-x)*f,xmax=x+(v.xmax-x)*f;this.syncXFrom(p,xmin,xmax);
      v.ymin=y+(v.ymin-y)*f;v.ymax=y+(v.ymax-y)*f;this.scheduleDraw();
    }
    onDown(e){
      if(!this.model)return;const q=this.pos(e),p=this.panelAt(q.x,q.y);if(p<0)return;
      this.svg.setPointerCapture(e.pointerId);this.drag={panel:p,start:q,last:q,views:this.views.map(v=>({...v}))};
      if(this.mode==='zoom'){this.zoomBox.classList.remove('hidden');this.updateZoomBox(q,q,p);}
    }
    onMove(e){
      if(!this.model)return;const q=this.pos(e);
      if(this.drag){const p=this.drag.panel,a=this.area(p),base=this.drag.views[p];
        if(this.mode==='pan'){
          const dx=(q.x-this.drag.start.x)/a.w*(base.xmax-base.xmin),dy=(q.y-this.drag.start.y)/a.h*(base.ymax-base.ymin);
          for(let k=0;k<this.views.length;k++){const bk=this.drag.views[k];this.views[k].xmin=bk.xmin-dx;this.views[k].xmax=bk.xmax-dx;}
          this.views[p].ymin=base.ymin+dy;this.views[p].ymax=base.ymax+dy;this.scheduleDraw();
        }else{this.drag.last=q;this.updateZoomBox(this.drag.start,q,p);}return;
      }
      this.updateHover(q);
    }
    onUp(e){
      if(!this.drag)return;const q=this.pos(e),p=this.drag.panel;
      if(this.mode==='zoom'){
        const s=this.drag.start,a=this.area(p);this.zoomBox.classList.add('hidden');
        if(Math.abs(q.x-s.x)>8&&Math.abs(q.y-s.y)>8){
          const x1=clamp(Math.min(s.x,q.x),a.x,a.x+a.w),x2=clamp(Math.max(s.x,q.x),a.x,a.x+a.w),y1=clamp(Math.min(s.y,q.y),a.y,a.y+a.h),y2=clamp(Math.max(s.y,q.y),a.y,a.y+a.h);
          const xmin=this.xval(x1,p),xmax=this.xval(x2,p),ymin=this.yval(y2,p),ymax=this.yval(y1,p);
          this.syncXFrom(p,xmin,xmax);this.views[p].ymin=ymin;this.views[p].ymax=ymax;this.scheduleDraw();
        }
      }
      this.drag=null;
    }
    cancelDrag(){this.drag=null;this.zoomBox.classList.add('hidden');}
    updateZoomBox(a,b,p){
      const ar=this.area(p),x1=clamp(Math.min(a.x,b.x),ar.x,ar.x+ar.w),x2=clamp(Math.max(a.x,b.x),ar.x,ar.x+ar.w),y1=clamp(Math.min(a.y,b.y),ar.y,ar.y+ar.h),y2=clamp(Math.max(a.y,b.y),ar.y,ar.y+ar.h);
      Object.assign(this.zoomBox.style,{left:x1+'px',top:y1+'px',width:(x2-x1)+'px',height:(y2-y1)+'px'});
    }
    updateHover(q){
      const p=this.panelAt(q.x,q.y);if(p<0){this.tooltip.classList.add('hidden');this.hover=null;this.scheduleDraw();return;}
      let best=null,bestD=Infinity;const xTarget=this.xval(q.x,p);
      this.model.traces.forEach((t,ti)=>{
        if(!t.visible||t.panel!==p)return;const n=t.x.length;let monotonic=true;
        for(let k=1;k<Math.min(n,2000);k++){if(t.x[k]!=null&&t.x[k-1]!=null&&t.x[k]<t.x[k-1]){monotonic=false;break;}}
        if(monotonic){let lo=0,hi=n-1;while(lo<hi){const m=(lo+hi)>>1,v=t.x[m]==null?Infinity:t.x[m];if(v<xTarget)lo=m+1;else hi=m;}for(const j of[lo,lo-1,lo+1]){if(j<0||j>=n||t.x[j]==null||t.y[j]==null)continue;const px=this.xpx(t.x[j],p),py=this.ypx(t.y[j],p),d=(px-q.x)**2+(py-q.y)**2;if(d<bestD){bestD=d;best={ti,j,panel:p,px,py,x:t.x[j],y:t.y[j],name:t.name};}}}
        else{const stride=Math.max(1,Math.ceil(n/8000));for(let j=0;j<n;j+=stride){if(t.x[j]==null||t.y[j]==null)continue;const px=this.xpx(t.x[j],p),py=this.ypx(t.y[j],p),d=(px-q.x)**2+(py-q.y)**2;if(d<bestD){bestD=d;best={ti,j,panel:p,px,py,x:t.x[j],y:t.y[j],name:t.name};}}}
      });
      if(best&&bestD<900){this.hover=best;this.tooltip.textContent=`${best.name}: x=${fmt(best.x)}  y=${fmt(best.y)}`;this.tooltip.style.left=Math.min(this.cssW-240,best.px+12)+'px';this.tooltip.style.top=Math.max(8,best.py-34)+'px';this.tooltip.classList.remove('hidden');}
      else{this.hover=null;this.tooltip.classList.add('hidden');}
      this.scheduleDraw();
    }
  }
  window.PlotRenderer=PlotRenderer;
}());
