import { registerDocumentEvent } from "./core/window-events";
import { MarkdownView } from 'obsidian';
import type VlookPlugin from './main';
import { navigateViewLine } from './navigation-history';
import { imageReferenceDefinitions } from './core/image-source';
import { getSourceIndex, type SourceIndex } from './core/source-index';
import { notify } from "./notify";

export function roamingLines(index:SourceIndex):number[] {
    const lines:number[]=[];
    const definitions=Array.from(imageReferenceDefinitions(index.text).values(),entry=>entry.source);
    for(const block of index.blocks){
        if(['frontmatter','hr','toc'].includes(block.type)||block.captionFor!==undefined)continue;
        if(block.type==='paragraph'&&!definitions.reduce((text,definition)=>text.replace(definition,''),block.text).trim())continue;
        if(block.type==='list'){
            block.text.split('\n').forEach((line,i)=>{if(/^\s*(?:[-*+]|\d+[.)])\s+/.test(line))lines.push(block.start+i);});
        }else if(block.type==='blockquote'||block.type==='callout'){
            let paragraph=false;
            block.text.split('\n').forEach((line,i)=>{
                const text=line.replace(/^\s*(?:>\s*)+/, '').trim();
                if(!text){paragraph=false;return;}
                if(!paragraph)lines.push(block.start+i);paragraph=true;
            });
        }else lines.push(block.start);
    }
    return lines;
}

export function roamingStep(event:Pick<KeyboardEvent,'shiftKey'|'metaKey'|'ctrlKey'|'altKey'>):number {
    return event.altKey?0:event.shiftKey?10:event.metaKey||event.ctrlKey?5:1;
}

/** 用当前源码段定位块内目标，引用段落不应始终高亮整个引用块。 */
export function roamingTarget(root:HTMLElement, sourceLines:string[]):HTMLElement {
    const listOrdinal=sourceLines.filter(line=>/^\s*(?:[-*+]|\d+[.)])\s+/.test(line)).length-1;
    if(listOrdinal>=0){const item=root.querySelectorAll<HTMLElement>('li')[listOrdinal];if(item)return item;}
    if(/^\s*>/.test(sourceLines[0]||'')){
        let ordinal=-1,paragraph=false;
        for(const line of sourceLines){
            if(!line.replace(/^\s*(?:>\s*)+/, '').trim()){paragraph=false;continue;}
            if(!paragraph)ordinal++;paragraph=true;
        }
        const item=root.querySelectorAll<HTMLElement>('blockquote > p,.callout-content > p,details > summary,details > p')[ordinal];
        if(item)return item;
    }
    return root;
}

export class ParagraphRoaming {
    private view:MarkdownView|null=null;
    private lines:number[]=[];
    private at=0;
    private observer:MutationObserver|null=null;
    private marked:HTMLElement|null=null;
    private previousTab:string|null=null;
    private sourceLines:string[]=[];
    constructor(private plugin:VlookPlugin){}
    clear(){
        this.observer?.disconnect();this.observer=null;
        this.marked?.classList.remove('vlook-roaming-current');this.marked=null;
        if(this.view){
            if(this.previousTab===null)this.view.contentEl.removeAttribute('tabindex');else this.view.contentEl.setAttribute('tabindex',this.previousTab);
        }
        this.view=null;this.lines=[];this.sourceLines=[];
    }
    private highlight(){
        const view=this.view;if(!view)return;
        this.marked?.classList.remove('vlook-roaming-current');this.marked=null;
        const line=this.lines[this.at];
        const root=Array.from(view.contentEl.querySelectorAll<HTMLElement>('[data-vlook-source-line]')).find(el=>Number(el.dataset.vlookSourceLine)<=line&&Number(el.dataset.vlookSourceEnd)>=line);
        if(!root)return;
        const start=Number(root.dataset.vlookSourceLine);
        this.marked=roamingTarget(root,this.sourceLines.slice(start,line+1));
        this.marked.classList.add('vlook-roaming-current');
    }
    private go(){
        if(!this.view)return;
        navigateViewLine(this.view,this.lines[this.at]);
        this.highlight();
        this.view.contentEl.ownerDocument.defaultView?.requestAnimationFrame(()=>this.highlight());
    }
    toggle(){
        if(this.view){this.clear();return;}
        const view=this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
        if(!view||view.getMode()!=='preview'){notify('请在 Markdown 阅读视图开启段落漫游');return;}
        const index=getSourceIndex(view.editor.getValue(),{captionGroup:false,captionNumber:true});
        this.lines=roamingLines(index);if(!this.lines.length)return;
        this.sourceLines=index.text.split("\n");
        this.view=view;this.previousTab=view.contentEl.getAttribute('tabindex');view.contentEl.tabIndex=-1;
        const middle=view.contentEl.getBoundingClientRect().top+view.contentEl.clientHeight/2;
        const roots=Array.from(view.contentEl.querySelectorAll<HTMLElement>('[data-vlook-source-line]')).filter(el=>el.getBoundingClientRect().height>0);
        const nearest=roots.sort((a,b)=>Math.abs(a.getBoundingClientRect().top-middle)-Math.abs(b.getBoundingClientRect().top-middle))[0];
        const line=Number(nearest?.dataset.vlookSourceLine||0);const at=this.lines.findIndex(item=>item>=line);this.at=at<0?this.lines.length-1:at;
        this.observer=new MutationObserver(()=>this.highlight());this.observer.observe(view.contentEl,{subtree:true,childList:true});
        view.contentEl.focus();this.go();notify('段落漫游：J/K 前后，Ctrl/Command 跳 5 段，Shift 跳 10 段，Esc 退出');
    }
    register(){
        const p=this.plugin;
        p.addCommand({id:'paragraph-roaming',name:'开启 / 关闭段落漫游',callback:()=>this.toggle()});
        registerDocumentEvent(p,'keydown',event=>{
            if(!this.view)return;
            if(event.key==='Escape'){this.clear();return;}
            const target=event.target as Element;
            if(target.closest?.('input,textarea,select,[contenteditable="true"],dialog,.modal-container')||this.view.getMode()!=='preview')return;
            const key=event.key.toLowerCase(),step=roamingStep(event);if(!step||!['j','k'].includes(key))return;
            event.preventDefault();event.stopPropagation();this.at=Math.max(0,Math.min(this.lines.length-1,this.at+(key==='j'?step:-step)));this.go();
        });
        p.registerEvent(p.app.workspace.on('active-leaf-change',()=>this.clear()));
        p.registerEvent(p.app.workspace.on('layout-change',()=>{if(this.view&&this.view.getMode()!=='preview')this.clear();}));
        p.registerEvent(p.app.vault.on('delete',file=>{if(file.path===this.view?.file?.path)this.clear();}));
        p.registerEvent(p.app.vault.on('rename',(_file,old)=>{if(old===this.view?.file?.path)this.clear();}));
        p.registerEvent(p.app.vault.on('modify',file=>{if(file.path===this.view?.file?.path)this.clear();}));
        p.register(()=>this.clear());
    }
}
