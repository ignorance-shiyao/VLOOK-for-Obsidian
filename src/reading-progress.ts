import { MarkdownView, TFile } from 'obsidian';
import type VlookPlugin from './main';
import {readingDuration,readingText,vlookWordCount} from './core/reading-time';

import type { ObserverWindow } from './core/dom';
export function readingPercent(scrollTop:number,scrollHeight:number,clientHeight:number):number {
    if(!Number.isFinite(scrollTop)||!Number.isFinite(scrollHeight)||!Number.isFinite(clientHeight)||clientHeight<=0)return 0;
    const distance=scrollHeight-clientHeight;
    if(distance<=1)return 100;
    return Math.max(0,Math.min(100,Math.round(scrollTop/distance*100)));
}

/** 原生阅读与编辑的滚动进度；完整预览继续使用原版自己的进度控件。 */
export class ReadingProgress {
    private disposed=false;
    private item:HTMLElement|null=null;
    private scroller:HTMLElement|null=null;
    private disconnect:(()=>void)|null=null;
    private frame:number|null=null;
    private win:Window|null=null;
    private view:MarkdownView|null=null;
    private lastSource:string|null=null;
    private embeds=new Map<string,string>();
    private duration='';
    private detail='';
    constructor(private plugin:VlookPlugin){}
    private queue=()=>{
        if(this.frame!==null)return;
        const win=this.win;if(!win)return;
        this.frame=win.requestAnimationFrame(()=>{this.frame=null;this.update();});
    };
    private resolveEmbed=(target:string)=>{
        const file=this.embedFile(target),cached=file?this.embeds.get(file.path):undefined;
        return file&&cached!==undefined?{id:file.path,source:cached}:null;
    };
    private embedFile(target:string){
        const file=this.plugin.app.metadataCache.getFirstLinkpathDest(target,this.view?.file?.path||'');
        return file instanceof TFile&&file.extension==='md'?file:null;
    }
    /** 先把嵌入笔记读齐（三层内逐层预取），再一次性统计，避免先显示偏小的数字。 */
    private async load(source:string,depth=0){
        if(depth>=3)return;
        const files=new Set<TFile>();
        for(const match of source.matchAll(/!\[\[([^\]\r\n|#]+)(?:[#|][^\]\r\n]*)?\]\]/g)){
            const file=this.embedFile(match[1].trim());
            if(file&&!this.embeds.has(file.path))files.add(file);
        }
        await Promise.all([...files].map(async file=>{
            const text=await this.plugin.app.vault.cachedRead(file).catch(()=>'');
            this.embeds.set(file.path,text);await this.load(text,depth+1);
        }));
    }
    private computing=0;
    private compute(source:string){
        const token=++this.computing;
        const finish=()=>{
            const counts=vlookWordCount(readingText(source,this.resolveEmbed));this.duration=readingDuration(counts.total);
            this.detail=`正文估算：${this.duration}；中日韩 ${counts.CJK}，非中日韩 ${counts.latin}（每分钟 200 字）`;
        };
        if(!source.includes('![['))return finish();
        void this.load(source).then(()=>{
            if(token!==this.computing||this.disposed)return;
            finish();this.queue();
        });
    }
    private checkedAt=0;
    private update(){
        if(!this.item||!this.scroller)return;
        const node=this.scroller;
        const percent=readingPercent(node.scrollTop,node.scrollHeight,node.clientHeight);
        // 源码比较与统计与滚动无关：每 400ms 至多检查一次，统计放到下一个事件循环并可被新的编辑取代
        const now=Date.now();
        if(now-this.checkedAt>=400||this.lastSource===null){
            this.checkedAt=now;
            const source=this.view?.editor?.getValue();
            if(source===undefined){this.lastSource=null;this.duration='';this.detail='';}
            else if(source!==this.lastSource){this.lastSource=source;this.compute(source);}
        }
        this.item.textContent=`阅读 ${percent}%${this.duration?` · 约 ${this.duration}`:''}`;
        this.item.title=this.detail;
        this.item.setAttribute('aria-valuenow',String(percent));
        this.item.setAttribute('aria-valuetext',`已阅读 ${percent}%${this.duration?`，预计阅读 ${this.duration}`:''}`);
    }
    private bind=()=>{
        if(this.disposed)return;
        const view=this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
        this.view=view;
        const next=view?.contentEl.querySelector<HTMLElement>(view.getMode()==='preview'?'.markdown-preview-view':'.cm-scroller')||null;
        if(this.item)this.item.hidden=!next;
        if(next===this.scroller){this.queue();return;}
        this.disconnect?.();this.disconnect=null;
        if(this.frame!==null&&this.win)this.win.cancelAnimationFrame(this.frame);
        this.frame=null;this.checkedAt=0;this.scroller=next;this.win=next?.ownerDocument.defaultView||null;
        if(!next||!this.win)return;
        const owner=this.win as ObserverWindow;
        const observer=new owner.ResizeObserver(this.queue);observer.observe(next);
        const mutations=new owner.MutationObserver(this.queue);mutations.observe(next,{subtree:true,childList:true});
        next.addEventListener('scroll',this.queue,{passive:true});
        this.disconnect=()=>{observer.disconnect();mutations.disconnect();next.removeEventListener('scroll',this.queue);};
        this.update();
    };
    register(){
        const p=this.plugin;
        this.item=p.addStatusBarItem();this.item.classList.add('vlook-reading-progress');
        this.item.setAttribute('role','progressbar');this.item.setAttribute('aria-label','当前文档阅读进度');
        this.item.setAttribute('aria-valuemin','0');this.item.setAttribute('aria-valuemax','100');
        p.registerEvent(p.app.workspace.on('active-leaf-change',this.bind));
        p.registerEvent(p.app.workspace.on('layout-change',this.bind));
        p.registerEvent(p.app.workspace.on('editor-change',this.bind));
        p.registerEvent(p.app.vault.on('modify',()=>this.queue()));
        p.app.workspace.onLayoutReady(this.bind);
        p.register(()=>{
            this.disposed=true;
            this.disconnect?.();if(this.frame!==null&&this.win)this.win.cancelAnimationFrame(this.frame);
            this.item?.remove();this.item=null;this.scroller=null;this.win=null;this.view=null;
        });
    }
}
