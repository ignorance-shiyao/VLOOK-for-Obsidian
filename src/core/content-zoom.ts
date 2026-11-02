const VISUAL='img,.mermaid svg,.md-diagram-panel svg,.math-block mjx-container,.math-block .katex-display,mjx-container[display="true"],.math-block svg';
const TOOLS='button,.vlook-code-tools,.vlook-view-menu';
/** 原生内容助手的图片、图表和公式缩放，不抢表格和媒体操作。 */
export class ContentZoom {
    private target:HTMLElement|SVGElement|null=null;
    private original='';
    private saved=new Map<string,{value:string;priority:string}>();
    private scale=1;private x=0;private y=0;
    private fit=1;private baseX=0;private baseY=0;private fitted=false;
    private imageLoaded=()=>{if(this.scale===1)this.fitToView();};
    private pointers=new Map<number,{x:number;y:number}>();
    private tapStarts=new Map<number,{x:number;y:number;time:number;eligible:boolean}>();
    private lastTap:{x:number;y:number;time:number}|null=null;
    private listeners:(()=>void)[]=[];
    private resize:ResizeObserver|null=null;
    constructor(private body:HTMLElement){
        this.on('wheel',((event:WheelEvent)=>{
            if(event.defaultPrevented||(event.target as Element)?.closest?.('button,input,select,a,audio,video')||!this.hit(event.target))return;
            event.preventDefault();this.lastTap=null;this.zoom(this.scale-event.deltaY*.005,event.clientX,event.clientY);
        }) as EventListener,{passive:false});
        this.on('dblclick',((event:MouseEvent)=>{
            if(!this.hit(event.target))return;event.preventDefault();this.lastTap=null;this.zoom(this.scale>1?1:2,event.clientX,event.clientY);
        }) as EventListener);
        this.on('pointerdown',((event:PointerEvent)=>{
            if(event.button!==0||!this.hit(event.target))return;
            event.preventDefault();this.pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
            this.tapStarts.set(event.pointerId,{x:event.clientX,y:event.clientY,time:Date.now(),eligible:!!event.pointerType&&event.pointerType!=='mouse'});
            if(event.pointerType==='mouse')this.lastTap=null;
            if(this.pointers.size>1){this.lastTap=null;for(const tap of this.tapStarts.values())tap.eligible=false;}
            this.target!.style.setProperty('cursor','grabbing','important');
            try{this.body.setPointerCapture(event.pointerId);}catch{/* 宿主已结束指针流 */}
        }) as EventListener);
        this.on('pointermove',((event:PointerEvent)=>{
            const old=this.pointers.get(event.pointerId);if(!old)return;event.preventDefault();
            const tap=this.tapStarts.get(event.pointerId);
            if(tap&&Math.hypot(event.clientX-tap.x,event.clientY-tap.y)>8){tap.eligible=false;this.lastTap=null;}
            const before=Array.from(this.pointers.values());
            this.pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
            const after=Array.from(this.pointers.values());
            if(before.length===2){
                const distance=(points:{x:number;y:number}[])=>Math.hypot(points[0].x-points[1].x,points[0].y-points[1].y);
                const from=distance(before),to=distance(after);
                if(from>0&&to>0)this.zoom(this.scale*to/from,(after[0].x+after[1].x)/2,(after[0].y+after[1].y)/2);
            }else if(before.length===1){this.x+=event.clientX-old.x;this.y+=event.clientY-old.y;this.paint();}
        }) as EventListener);
        const end=((event:PointerEvent)=>{
            if(!this.pointers.has(event.pointerId))return;
            const tap=this.tapStarts.get(event.pointerId);this.tapStarts.delete(event.pointerId);
            this.pointers.delete(event.pointerId);
            const now=Date.now();
            if(event.type==='pointerup'&&tap?.eligible&&now-tap.time<300&&Math.hypot(event.clientX-tap.x,event.clientY-tap.y)<=8){
                if(this.lastTap&&now-this.lastTap.time<300&&Math.hypot(event.clientX-this.lastTap.x,event.clientY-this.lastTap.y)<=24){
                    this.zoom(this.scale>1?1:2,event.clientX,event.clientY);this.lastTap=null;
                }else this.lastTap={x:event.clientX,y:event.clientY,time:now};
            }else this.lastTap=null;
            if(this.target&&!this.pointers.size)this.target.style.setProperty('cursor','grab','important');
            try{if(this.body.hasPointerCapture(event.pointerId))this.body.releasePointerCapture(event.pointerId);}catch{/* 指针已释放 */}
        }) as EventListener;
        for(const name of ['pointerup','pointercancel','lostpointercapture'])this.on(name,end);
        this.on('dragstart',((event:DragEvent)=>{if(this.hit(event.target))event.preventDefault();}) as EventListener);
        const Observer=body.ownerDocument.defaultView?.ResizeObserver;
        if(Observer){this.resize=new Observer(()=>{if(this.scale===1&&!this.pointers.size)this.fitToView();});this.resize.observe(body);}
        this.refresh();
    }
    private on(name:string,listener:EventListener,options?:AddEventListenerOptions){this.body.addEventListener(name,listener,options);this.listeners.push(()=>this.body.removeEventListener(name,listener,options));}
    private visualRoot(value:EventTarget|null|undefined){
        let candidate=(value as Element|null)?.closest?.(VISUAL) as HTMLElement|SVGElement|null;
        if(!candidate||!this.body.contains(candidate)||candidate.closest(TOOLS))return null;
        // Mermaid participant icons may contain nested SVG; MathJax may contain
        // SVG inside its container. Gestures must transform the whole diagram.
        for(let parent=candidate.parentElement;parent&&parent!==this.body;parent=parent.parentElement)
            if(parent.matches(VISUAL))candidate=parent;
        return candidate;
    }
    private visual(preferred?:EventTarget|null){
        const requested=this.visualRoot(preferred);
        if(this.target&&this.body.contains(this.target)&&(!requested||requested===this.target||this.pointers.size))return this.target;
        this.reset();
        const target=requested||Array.from(this.body.querySelectorAll<HTMLElement|SVGElement>(VISUAL)).find(el=>!el.closest(TOOLS));
        if(!target)return null;
        this.target=target;
        for(const property of ['transform','transform-origin','touch-action','cursor'])this.saved.set(property,{value:target.style.getPropertyValue(property),priority:target.style.getPropertyPriority(property)});
        const computed=target.ownerDocument.defaultView?.getComputedStyle(target).transform||target.style.transform;
        this.original=computed==='none'?'':computed;
        target.style.setProperty('transform-origin','0 0','important');target.style.setProperty('touch-action','none','important');target.style.setProperty('cursor','grab','important');
        target.addEventListener('load',this.imageLoaded);this.fitToView();return target;
    }
    refresh(preferred?:HTMLElement){const candidate=preferred?(preferred.matches(VISUAL)?preferred:preferred.querySelector<HTMLElement>(VISUAL)):undefined;if(preferred&&!candidate){this.reset();return;}const target=this.visual(candidate);if(target){target.removeEventListener('load',this.imageLoaded);target.addEventListener('load',this.imageLoaded);if(!this.fitted)this.fitToView();}}
    /** 把一倍视为适配可视区的基准，缩放仍保持原版 1–5 倍范围。 */
    fitToView(){
        const target=this.target;if(!target)return;
        const previous=target.style.transform,priority=target.style.getPropertyPriority('transform');target.style.setProperty('transform',this.original,'important');
        const rect=target.getBoundingClientRect(),area=this.body.getBoundingClientRect();
        const width=this.body.clientWidth,height=this.body.clientHeight;
        if(!rect.width||!rect.height||!width||!height){target.style.setProperty('transform',previous,priority);return;}
        this.fit=Math.min(1,width/rect.width,height/rect.height);
        this.baseX=area.left+this.body.clientLeft+(width-rect.width*this.fit)/2-rect.left;
        this.baseY=area.top+this.body.clientTop+(height-rect.height*this.fit)/2-rect.top;
        this.fitted=true;this.paint();
    }
    private hit(value:EventTarget|null){const target=this.visual(value),node=value as Node|null;return !!target&&!!node&&typeof node.nodeType==='number'&&(node===target||target.contains(node));}
    private zoom(next:number,cx:number,cy:number){
        const target=this.visual();if(!target||!Number.isFinite(next))return;
        next=Math.max(1,Math.min(5,next));const ratio=next/this.scale,rect=target.getBoundingClientRect();
        this.x+=(1-ratio)*(cx-rect.left);this.y+=(1-ratio)*(cy-rect.top);this.scale=next;
        if(next===1){this.x=0;this.y=0;this.fitToView();}this.paint();
    }
    private paint(){if(this.target)this.target.style.setProperty('transform',`translate(${this.baseX+this.x}px, ${this.baseY+this.y}px) scale(${this.scale*this.fit}) ${this.original}`.trim(),'important');}
    reset(){
        if(this.target){this.target.removeEventListener('load',this.imageLoaded);for(const [property,original] of this.saved)this.target.style.setProperty(property,original.value,original.priority);}
        for(const id of this.pointers.keys()){try{if(this.body.hasPointerCapture(id))this.body.releasePointerCapture(id);}catch{/* 已释放 */}}
        this.target=null;this.saved.clear();this.pointers.clear();this.tapStarts.clear();this.lastTap=null;this.scale=1;this.x=0;this.y=0;this.fit=1;this.baseX=0;this.baseY=0;this.fitted=false;
    }
    dispose(){this.resize?.disconnect();this.resize=null;this.reset();this.listeners.forEach(remove=>remove());this.listeners=[];}
}
