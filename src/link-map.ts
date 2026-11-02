import { registerDocumentEvent } from "./core/window-events";
import { auditVaultLinks, auditLocalResources, type LinkAuditResult } from './core/link-audit';
import { FuzzySuggestModal, MarkdownView } from 'obsidian';
import type VlookPlugin from './main';
import { getSourceIndex } from './core/source-index';
import { linkMapGroups, type LinkMapGroup, type SourceLink } from './core/link-map';
import { navigateViewLine } from './navigation-history';
import { renderedResourceFailures } from './features/resource-status';
import { remoteAnchorCheckUrl } from './core/remote-anchor';
import { notify } from "./notify";

class LinkOccurrences extends FuzzySuggestModal<SourceLink>{
    private path:string|undefined;
    constructor(private view:MarkdownView,private source:string,private links:SourceLink[]){super(view.app);this.path=view.file?.path;this.setPlaceholder('搜索链接文字或锚点，选择后定位原文');}
    getItems(){return this.links;}
    getItemText(item:SourceLink){return `${item.title} · ${item.href} · 第 ${item.line+1} 行`;}
    onChooseItem(item:SourceLink){
        if(this.view.file?.path!==this.path||this.view.editor.getValue()!==this.source){notify('文档已变更，请重新打开链接地图');return;}
        navigateViewLine(this.view,item.line);if(this.view.getMode()==='source')this.view.editor.focus();
    }
}
class LinkMapModal extends FuzzySuggestModal<LinkMapGroup>{
    private path:string|undefined;
    constructor(private view:MarkdownView,private source:string,private groups:LinkMapGroup[]){super(view.app);this.path=view.file?.path;this.setPlaceholder('搜索目标文档或锚点；选择后查看引用位置');}
    getItems(){return this.groups;}
    getItemText(group:LinkMapGroup){return `${group.document} · ${group.links.length} 次引用 · ${group.anchors.length} 个锚点 ${group.anchors.map(anchor=>anchor.hash).join(' ')}`;}
    onChooseItem(group:LinkMapGroup){
        if(this.view.file?.path!==this.path||this.view.editor.getValue()!==this.source){notify('文档已变更，请重新打开链接地图');return;}
        new LinkOccurrences(this.view,this.source,group.links).open();
    }
}
class LinkAuditModal extends FuzzySuggestModal<LinkAuditResult>{
    private path:string|undefined;
    constructor(private view:MarkdownView,private source:string,private results:LinkAuditResult[]){super(view.app);this.path=view.file?.path;this.setPlaceholder('搜索检查结果：失效、规范提示、通过或未检查');}
    getItems(){return this.results;}
    getItemText(result:LinkAuditResult){return `${result.status==='ok'?'通过':result.status==='unchecked'?'未检查':result.status==='warning'?'提示':'失效'} · ${result.link.title} · ${result.link.href} · ${result.detail}`;}
    onChooseItem(result:LinkAuditResult){
        if(this.view.file?.path!==this.path||this.view.editor.getValue()!==this.source){notify('文档已变更，请重新检查链接');return;}
        navigateViewLine(this.view,result.link.line);if(this.view.getMode()==='source')this.view.editor.focus();
    }
}
export class RemoteAnchorModal extends FuzzySuggestModal<LinkMapGroup> {
    private path: string | undefined;
    constructor(private view: MarkdownView, private source: string, private groups: LinkMapGroup[]) {
        super(view.app); this.path = view.file?.path;
        this.setPlaceholder('选择后打开目标 VLOOK 检查页；检查结果在目标页面显示');
    }
    getItems() { return this.groups; }
    getItemText(group: LinkMapGroup) { return `${group.document} · ${group.anchors.length} 个锚点`; }
    onChooseItem(group: LinkMapGroup) {
        if (this.view.file?.path !== this.path || this.view.editor.getValue() !== this.source) {
            notify('文档已变更，请重新选择远程锚点检查'); return;
        }
        try {
            const url = remoteAnchorCheckUrl(group);
            if (url) (this.view.contentEl?.ownerDocument.defaultView ?? window).open(url, '_blank', 'noopener,noreferrer');
            else notify('请选择含锚点的 HTTP/HTTPS 文档，目标须启用 VLOOK');
        } catch (error) { notify((error as Error).message); }
    }
}
export function registerLinkMap(plugin:VlookPlugin){
    const open=()=>{
        const view=plugin.app.workspace.getActiveViewOfType(MarkdownView);if(!view?.file){notify('请先打开 Markdown 文档');return;}
        const source=view.editor.getValue(),index=getSourceIndex(source,{captionGroup:false,captionNumber:false}),groups=linkMapGroups(index);
        if(!groups.length){notify('当前文档没有可列出的文档链接');return;}
        new LinkMapModal(view,source,groups).open();
    };
    plugin.addCommand({id:'check-vault-links',name:'检查库内链接、锚点与资源',callback:async()=>{
        const view=plugin.app.workspace.getActiveViewOfType(MarkdownView);if(!view?.file){notify('请先打开 Markdown 文档');return;}
        const source=view.editor.getValue(),path=view.file.path;
        const results=await auditVaultLinks(plugin.app,view.file,source);
        if(view.file?.path!==path||view.editor.getValue()!==source){notify('检查期间文档已变更，请重新检查');return;}
        const current = [...auditLocalResources(plugin.app,view.file,source),...renderedResourceFailures(view.contentEl,path,source)];
        const seen = new Set(current.map(result=>JSON.stringify([result.link.line,result.link.href])));
        results.push(...current,...plugin.resourceHistory.results(path,source).filter(result=>!seen.has(JSON.stringify([result.link.line,result.link.href]))));
        if(!results.length){notify('当前文档没有可检查的链接');return;}
        const priority={'missing-file':0,'missing-anchor':0,'missing-resource':0,warning:1,unchecked:2,ok:3};
        results.sort((a,b)=>priority[a.status]-priority[b.status]);
        new LinkAuditModal(view,source,results).open();
    }});
    plugin.addCommand({id:'link-map',name:'链接地图（文档、锚点与引用位置）',callback:open});
    plugin.addCommand({id:'check-remote-anchors',name:'检查远程 VLOOK 文档锚点（打开目标检查页）',callback:()=>{
        const view=plugin.app.workspace.getActiveViewOfType(MarkdownView);if(!view?.file){notify('请先打开 Markdown 文档');return;}
        const source=view.editor.getValue();
        const groups=linkMapGroups(getSourceIndex(source,{captionGroup:false,captionNumber:false})).filter(group=>/^https?:\/\//i.test(group.document)&&group.anchors.length);
        if(!groups.length){notify('当前文档没有含锚点的远程 HTTP/HTTPS 链接');return;}
        new RemoteAnchorModal(view,source,groups).open();
    }});
    registerDocumentEvent(plugin,'keydown',event=>{
        if(event.defaultPrevented||event.repeat||event.isComposing||event.ctrlKey||event.metaKey||event.altKey||event.shiftKey||event.key.toLowerCase()!=='m')return;
        const target=event.target as Element;
        if(target.closest('input,textarea,select,button,[contenteditable]:not([contenteditable="false"]),dialog,.modal-container'))return;
        const view=plugin.app.workspace.getActiveViewOfType(MarkdownView);
        if(view?.getMode()==='preview'&&view.contentEl.contains(target)){event.preventDefault();open();}
    });
}
