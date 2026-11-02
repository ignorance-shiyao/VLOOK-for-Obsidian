import { registerDocumentEvent } from "./core/window-events";
import { MarkdownView } from 'obsidian';
import type VlookPlugin from './main';
import { notify } from "./notify";

/** 仅添加临时界面类，不折叠侧栏或写入用户工作区布局。 */
export class QuietView {
    private leaf:HTMLElement|null=null;
    private doc:Document|null=null;
    private focus:HTMLElement|null=null;
    constructor(private plugin:VlookPlugin){}
    clear(){
        this.leaf?.classList.remove('vlook-quiet-leaf');
        this.doc?.body.classList.remove('vlook-quiet-view');
        this.leaf=null;this.doc=null;
        if(this.focus?.isConnected)this.focus.focus({preventScroll:true});this.focus=null;
    }
    toggle(){
        if(this.leaf){this.clear();return;}
        const view=this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
        if(!view||view.getMode()!=='preview'){notify('请在 Markdown 阅读视图开启宁静视图');return;}
        const leaf=view.containerEl.closest<HTMLElement>('.workspace-leaf');if(!leaf)return;
        this.leaf=leaf;this.doc=leaf.ownerDocument;this.focus=this.doc.activeElement as HTMLElement|null;
        leaf.classList.add('vlook-quiet-leaf');this.doc.body.classList.add('vlook-quiet-view');
        notify('宁静视图已开启，Z 或 Esc 退出');
    }
    register(){
        const p=this.plugin;
        p.addCommand({id:'quiet-view',name:'开启 / 关闭宁静视图',callback:()=>this.toggle()});
        registerDocumentEvent(p,'keydown',event=>{
            const target=event.target as Element;
            if(target.closest?.('input,textarea,select,[contenteditable="true"],.modal-container,dialog'))return;
            if(this.leaf&&event.key==='Escape'){event.preventDefault();this.clear();return;}
            if(event.repeat||event.ctrlKey||event.metaKey||event.altKey||event.key.toLowerCase()!=='z')return;
            const view=p.app.workspace.getActiveViewOfType(MarkdownView);
            if(!view||view.getMode()!=='preview'||!view.contentEl.contains(target))return;
            event.preventDefault();this.toggle();
        });
        p.registerEvent(p.app.workspace.on('active-leaf-change',()=>this.clear()));
        p.registerEvent(p.app.workspace.on('layout-change',()=>{
            if(!this.leaf)return;
            const view=p.app.workspace.getActiveViewOfType(MarkdownView);
            if(!view||view.getMode()!=='preview'||!this.leaf.contains(view.containerEl))this.clear();
        }));
        p.register(()=>this.clear());
    }
}
