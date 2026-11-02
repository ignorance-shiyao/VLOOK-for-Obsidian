import { MarkdownView } from 'obsidian';
import type VlookPlugin from './main';
import { navigateViewLine } from './navigation-history';
import { notify } from "./notify";

export interface ReadingPosition { line:number; signature:string; updated:number }
export function readingSignature(source:string):string {
    let hash=2166136261;
    for(let i=0;i<source.length;i++)hash=Math.imul(hash^source.charCodeAt(i),16777619);
    return `${source.length}:${hash>>>0}`;
}
export function resumeLine(value:unknown,source:string):number|undefined {
    const entry=value as ReadingPosition|undefined;
    if(!entry || !Number.isInteger(entry.line) || entry.line<0 || entry.line>=source.split('\n').length || entry.signature!==readingSignature(source))return;
    return entry.line;
}

/** 原生阅读位置与设置一起保存，不引入额外 vault 文件。 */
export class ResumeReading {
    private view:MarkdownView|null=null;
    private scroller:HTMLElement|null=null;
    private boundPath:string|null=null;
    private pending:{path:string;entry:ReadingPosition}|null=null;
    private timer:ReturnType<typeof setTimeout>|null=null;
    private disposed=false;
    private ignoredPath:string|null=null;
    private writes:Promise<void>=Promise.resolve();
    private signatureSource:string|null=null;
    private signatureValue='';
    constructor(private plugin:VlookPlugin){}
    private persist(){
        this.writes=this.writes.then(()=>this.plugin.saveData(this.plugin.settings)).catch(error=>console.error('[VLOOK] reading position',error));
    }
    private capture():{path:string;entry:ReadingPosition}|null {
        const view=this.view,node=this.scroller;
        if(!view?.file || view.file.path!==this.boundPath || this.ignoredPath===view.file.path || !node || node.scrollTop<=1000)return null;
        const top=node.getBoundingClientRect().top;
        const candidates=Array.from(view.contentEl.querySelectorAll<HTMLElement>('[data-vlook-source-line]'))
            .filter(el=>!el.dataset.vlookSourcePath || el.dataset.vlookSourcePath===view.file!.path)
            .filter(el=>el.getBoundingClientRect().bottom>top&&el.getBoundingClientRect().height>0)
            .sort((a,b)=>Math.abs(a.getBoundingClientRect().top-top)-Math.abs(b.getBoundingClientRect().top-top));
        if(!candidates.length)return null;
        const line=Number(candidates[0].dataset.vlookSourceLine),source=view.editor.getValue();
        if(!Number.isInteger(line)||line<0||line>=source.split('\n').length)return null;
        if(source!==this.signatureSource){this.signatureSource=source;this.signatureValue=readingSignature(source);}
        return {path:view.file.path,entry:{line,signature:this.signatureValue,updated:Date.now()}};
    }
    private save=()=>{
        if(this.timer!==null){clearTimeout(this.timer);this.timer=null;}
        const snapshot=this.pending || this.capture();this.pending=null;
        if(!snapshot || snapshot.path===this.ignoredPath)return;
        const entries=this.plugin.settings.readingPositions ||= {},old=entries[snapshot.path];
        if(old?.line===snapshot.entry.line&&old.signature===snapshot.entry.signature)return;
        entries[snapshot.path]=snapshot.entry;
        const keys=Object.keys(entries).sort((a,b)=>entries[b].updated-entries[a].updated);
        for(const key of keys.slice(100))delete entries[key];
        this.persist();
    };
    private queue=()=>{
        this.ignoredPath=null;
        const snapshot=this.capture();if(snapshot)this.pending=snapshot;
        if(this.timer!==null)clearTimeout(this.timer);this.timer=setTimeout(this.save,1000);
    };
    private bind=()=>{
        if(this.disposed)return;
        const view=this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
        const next=view?.getMode()==='preview'?view:null;
        const node=next?.contentEl.querySelector<HTMLElement>('.markdown-preview-view')||null;
        if(next===this.view&&node===this.scroller&&next?.file?.path===this.boundPath)return;
        this.save();this.scroller?.removeEventListener('scroll',this.queue);
        this.view=next;this.scroller=node;this.boundPath=next?.file?.path || null;node?.addEventListener('scroll',this.queue,{passive:true});
    };
    register(){
        const p=this.plugin;
        p.addCommand({id:'resume-reading',name:'继续上次阅读',callback:()=>{
            const view=p.app.workspace.getActiveViewOfType(MarkdownView);
            if(!view?.file)return;
            const entry=p.settings.readingPositions?.[view.file.path];
            const line=resumeLine(entry,view.editor.getValue());
            if(line===undefined){notify(entry?'文档已变化，旧阅读位置已失效':'尚无保存的阅读位置');return;}
            navigateViewLine(view,line);
        }});
        p.addCommand({id:'forget-reading-position',name:'清除当前文档阅读位置',callback:()=>{
            const path=p.app.workspace.getActiveFile()?.path;
            if(path&&p.settings.readingPositions){
                this.ignoredPath=path;this.pending=null;if(this.timer!==null){clearTimeout(this.timer);this.timer=null;}
                delete p.settings.readingPositions[path];this.persist();notify('已清除阅读位置');
            }
        }});
        p.registerEvent(p.app.workspace.on('active-leaf-change',this.bind));
        p.registerEvent(p.app.workspace.on('layout-change',this.bind));
        p.registerEvent(p.app.workspace.on('file-open',this.bind));
        p.registerEvent(p.app.vault.on('rename',(file,old)=>{
            const entries=p.settings.readingPositions || {};
            for(const [path,value] of Object.entries(entries))if(path===old||path.startsWith(old+'/')){
                delete entries[path];entries[file.path+path.slice(old.length)]=value;
            }
            const rename=(path:string|null)=>path&&(path===old||path.startsWith(old+'/'))?file.path+path.slice(old.length):path;
            this.ignoredPath=rename(this.ignoredPath);this.boundPath=rename(this.boundPath);
            if(this.pending)this.pending.path=rename(this.pending.path)!;
            this.persist();
        }));
        p.registerEvent(p.app.vault.on('delete',file=>{
            const entries=p.settings.readingPositions || {};
            for(const path of Object.keys(entries))if(path===file.path||path.startsWith(file.path+'/'))delete entries[path];
            if(this.boundPath&&(this.boundPath===file.path||this.boundPath.startsWith(file.path+'/')))this.ignoredPath=this.boundPath;
            if(this.pending&&(this.pending.path===file.path||this.pending.path.startsWith(file.path+'/')))this.pending=null;
            this.persist();
        }));
        p.app.workspace.onLayoutReady(this.bind);
        p.register(()=>{this.save();this.disposed=true;this.scroller?.removeEventListener('scroll',this.queue);this.view=null;this.scroller=null;});
    }
}
