import {Dropdown} from '../core/dropdown';
import {renderZenUmlFallback} from './zenuml-fallback';
import { sourceDiagramCount, waitForDiagrams } from '../preview/diagram-ready';
import { sourceMathFenceCount, waitForMath } from '../preview/math-ready';
import { contentSelector, selectedContentItem } from '../core/content-selection';
import { ContentZoom } from '../core/content-zoom';
import { MediaHandoff, pauseContainedMedia } from '../core/media-handoff';
import { borrowContent, type BorrowedContent } from '../core/content-move';
import { bindContentShortcuts } from '../core/content-shortcuts';
import { Component, MarkdownRenderer, setIcon } from 'obsidian';
import type { RenderCtx } from '../core/context';
import { sourceContentItems, type SourceContentItem } from '../core/content-index';
import { referenceDefinitionsSource } from '../core/image-source';
import { renderSection } from '../render';
import { navigateViewLine, navigationSourceView } from '../navigation-history';
import { notify } from "../notify";

const ICONS:Record<string,string>={'上一项':'chevron-left','下一项':'chevron-right','回到文档位置':'locate-fixed','关闭':'x','原始大小':'scan'};
/** 全文索引 + 按需渲染，避免为了建立画廊强制挂载整篇长文档。 */
export function openSourceContentViewer(target:HTMLElement, ctx:RenderCtx): HTMLDialogElement {
    const doc = target.ownerDocument;
    const sourceView=ctx.app?navigationSourceView(ctx.app,ctx.sourcePath,target):null;
    const items = sourceContentItems(ctx.index!);
    const definitions=referenceDefinitionsSource(ctx.index!.text);
    const dialog = doc.createElement('dialog');
    dialog.className = 'vlook-content-viewer vlook-content-full';
    dialog.setAttribute('aria-label','VLOOK 全文内容浏览');
    const controls = doc.createElement('div'); controls.className = 'vlook-content-controls';
    const body = doc.createElement('div'); body.className = 'markdown-rendered vlook-content-body vlook-editor-render';
    const zoom=new ContentZoom(body);
    const status = doc.createElement('span'); status.setAttribute('role','status');
    let current = selectedContentItem(items,target,ctx.block?.start);
    let sequence = 0, closed = false;
    const subscriptions:(()=>void)[]=[];
    let component:Component | null = null;
    let media:MediaHandoff | null = null;
    let borrowed:BorrowedContent | null = null;
    const sourceUnchanged=()=>sourceView?.file?.path===ctx.sourcePath&&sourceView.editor.getValue()===ctx.index!.text;
    const pending=new Set<Component>();
    const focus = doc.activeElement as HTMLElement | null;
    const button = (label:string, action:()=>void) => {
        const b=doc.createElement('button');b.type='button';b.className='clickable-icon vlook-content-action';b.setAttribute('aria-label',label);setIcon(b,ICONS[label]??'circle');b.addEventListener('click',action);controls.append(b);return b;
    };
    const category=new Dropdown(doc,'内容分类');
    category.setOptions(['全部',...new Set(items.map(item=>item.kind))].map(kind=>({value:kind,label:kind})),current?.kind||'全部');
    const index=new Dropdown(doc,'全文内容索引','vlook-dropdown-wide');
    const filtered=()=>items.filter(item=>category.value==='全部'||item.kind===category.value);
    const previous=button('上一项',()=>{const list=filtered(),at=current?list.indexOf(current):-1;if(at>0){current=list[at-1];void load();}});
    const next=button('下一项',()=>{const list=filtered(),at=current?list.indexOf(current):-1;if(at+1<list.length){current=list[at+1];void load();}});
    const update=()=>{
        const list=filtered();
        index.setOptions(list.map((item,i)=>({value:String(i),label:`${i+1} / ${list.length} · ${item.title}`})),String(current?list.indexOf(current):-1));
        const at=current?list.indexOf(current):-1;previous.disabled=at<=0;next.disabled=at<0||at>=list.length-1;
    };
    const focusItem=(host:HTMLElement,item:SourceContentItem)=>{
        body.scrollTop=0;body.scrollLeft=0;
        if(!item.target){zoom.refresh(host);return;}
        const selector=contentSelector(item.target.kind);
        const tagged=Array.from(host.querySelectorAll<HTMLElement>('[data-vlook-content-index]')).find(el=>el.dataset.vlookContentKind===item.target!.kind&&Number(el.dataset.vlookContentIndex)===item.target!.index);
        const node=tagged||host.querySelectorAll<HTMLElement>(selector)[item.target.index];
        node?.scrollIntoView?.({block:'start',inline:'nearest'});
        zoom.refresh(node);
    };
    const load=async()=>{
        update();const mine=++sequence;const item=current;if(!item)return;
        status.textContent='正在渲染…';
        zoom.reset();borrowed?.restore(sourceUnchanged());borrowed=null;media?.release(false);media=null;component?.unload();component=null;body.replaceChildren();
        const originalBlock=target.closest<HTMLElement>('[data-vlook-source-line]');
        const origin=item.block.start===ctx.block?.start?(originalBlock?.dataset.vlookSourcePath===ctx.sourcePath?originalBlock:target):Array.from(sourceView?.contentEl.querySelectorAll<HTMLElement>('[data-vlook-source-line]')||[]).find(element=>Number(element.dataset.vlookSourceLine)===item.block.start&&element.dataset.vlookSourcePath===ctx.sourcePath);
        for(const pendingComponent of pending)pendingComponent.unload();pending.clear();
        const fresh=new Component();fresh.load();pending.add(fresh);
        const controller=new doc.defaultView!.AbortController();fresh.register(()=>controller.abort());
        const host=doc.createElement('div');host.className='vlook-editor-render';
        if(origin?.querySelector('iframe') || origin?.matches('iframe')){
            body.append(host);
            borrowed=borrowContent(origin,host);
            if(borrowed){pending.delete(fresh);fresh.unload();focusItem(host,item);status.textContent='';return;}
        }
        // Host renderers may defer layout-dependent diagrams until attached.
        if(host.parentElement!==body)body.replaceChildren(host);
        const handoff=origin?new MediaHandoff(origin):null;media=handoff;
        try {
            await MarkdownRenderer.render(ctx.app!,`<!--vlook-raw-render-->\n${item.block.text}\n\n${definitions}`,host,ctx.sourcePath,fresh);
            if(closed||mine!==sequence){pauseContainedMedia(host);host.replaceChildren();fresh.unload();return;}
            await renderZenUmlFallback(host,fresh,undefined,item.block.text);
            await Promise.all([waitForDiagrams(host,15000,100,sourceDiagramCount(item.block.text),controller.signal),waitForMath(host,15000,100,controller.signal,sourceMathFenceCount(item.block.text))]);
            if(closed||mine!==sequence){pauseContainedMedia(host);host.replaceChildren();fresh.unload();return;}
            renderSection(host,{...ctx,block:item.block,suppressContentViewers:true,registerCleanup:cleanup=>fresh.register(cleanup)});
            component=fresh;handoff?.attach(host);focusItem(host,item);status.textContent='';
        } catch(error){pauseContainedMedia(host);host.replaceChildren();handoff?.release(sourceUnchanged());fresh.unload();if(!closed&&mine===sequence)status.textContent=`内容渲染失败：${(error as Error).message||String(error)}`;}
        finally {pending.delete(fresh);}
    };
    category.onChange(()=>{const item=filtered()[0];if(item){current=item;void load();}});
    index.onChange(value=>{const item=filtered()[Number(value)];if(item){current=item;void load();}});
    controls.append(category.el,index.el,status);
    button('回到文档位置',()=>{
        const line=current?.line??current?.block.start;dialog.close();
        const view=sourceView;
        if(view?.file?.path===ctx.sourcePath&&line!==undefined){
            if(view.editor.getValue()!==ctx.index!.text){notify('文档已变更，请从原文重新打开内容助手');return;}
            navigateViewLine(view,line);
            if(view.getMode()==='source')view.editor.focus();
        }
    });
    button('关闭',()=>dialog.close());
    const cleanup=()=>{if(closed)return;closed=true;sequence++;zoom.dispose();borrowed?.restore(sourceUnchanged());borrowed=null;media?.release(sourceUnchanged());media=null;for(const unsubscribe of subscriptions)unsubscribe();for(const fresh of pending)fresh.unload();pending.clear();component?.unload();dialog.remove();doc.defaultView?.removeEventListener('beforeprint',close);if(focus?.isConnected)focus.focus({preventScroll:true});};
    const close=()=>dialog.close();
    dialog.addEventListener('close',cleanup,{once:true});
    doc.defaultView?.addEventListener('beforeprint',close,{once:true});
    const workspace=ctx.app!.workspace, vault=ctx.app!.vault;
    const leafRef=workspace.on('active-leaf-change',()=>{if(workspace.getActiveFile()?.path!==ctx.sourcePath)close();});
    const modifyRef=vault.on('modify',file=>{if(file.path===ctx.sourcePath)close();});
    const deleteRef=vault.on('delete',file=>{if(file.path===ctx.sourcePath||ctx.sourcePath.startsWith(file.path+'/'))close();});
    const renameRef=vault.on('rename',(_file,oldPath)=>{if(oldPath===ctx.sourcePath||ctx.sourcePath.startsWith(oldPath+'/'))close();});
    subscriptions.push(()=>workspace.offref(leafRef),()=>vault.offref(modifyRef),()=>vault.offref(deleteRef),()=>vault.offref(renameRef));
    bindContentShortcuts(dialog,previous,next);
    dialog.append(controls,body);doc.body.append(dialog);dialog.showModal();void load();return dialog;
}
