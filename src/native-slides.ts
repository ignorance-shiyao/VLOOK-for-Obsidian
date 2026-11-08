import {Dropdown} from './core/dropdown';
import { registerDocumentEvent } from "./core/window-events";
import { vlookAnchor } from './core/anchor';
import { equationSourceLine } from './core/math-anchor';
import { quoteSourceTitles } from './core/quote-source';
import { Component, MarkdownRenderer, MarkdownView, Platform } from 'obsidian';
import type VlookPlugin from './main';
import { Query, readCssVar } from './core/context';
import { getSourceIndex } from './core/source-index';
import { slideGroups } from './core/slide-groups';
import { referenceDefinitionsSource } from './core/image-source';
import { renderReadySection } from './features/ready-section';
import { pauseContainedMedia } from './core/media-handoff';
import { slideFootnoteSeed, indexSlideFootnotes } from './core/slide-footnotes';
import { sourceTasks } from './core/task-source';
import { headingPlain } from './core/heading';
import { captionTargets } from './core/caption-targets';
import { notify } from "./notify";
import { refreshTaskProgress } from './features/inline-extras';

import { newEl } from './core/dom';
export class NativeSlides {
    private closeCurrent:(()=>void)|null=null;
    constructor(private plugin:VlookPlugin){}
    close(){this.closeCurrent?.();}
    toggle(){
        if(this.closeCurrent){this.close();return;}
        const p=this.plugin,view=p.app.workspace.getActiveViewOfType(MarkdownView);
        if(!view?.file||view.getMode()!=='preview'){notify('请在 Markdown 阅读视图开启幻灯片');return;}
        const path=view.file.path,source=view.editor.getValue();
        const doc=view.contentEl.ownerDocument;
        const cssVar=(name:string)=>readCssVar(name,doc.body);
        const theme=cssVar('--vlook-query'),baseQuery=new Query(theme);
        const index=getSourceIndex(source,{captionGroup:baseQuery.get('capgroup')!=='off',captionNumber:baseQuery.get('capnum')!=='off',headerEnabled:p.settings.headerAutoNum,headerTemplate:cssVar('--vlook-header-autonum')||undefined});
        const query=new Query(theme,index.frontmatter['vlook-query']);
        const groups=slideGroups(index,query.get('unpub')==='off');
        if(!groups.length){notify('没有可显示的幻灯片内容');return;}
        const focus=doc.activeElement as HTMLElement|null;
        const notifyPresentation=()=>{doc.dispatchEvent(new doc.defaultView!.Event('vlook-presentation-change'));};
        const scroller=view.contentEl.querySelector<HTMLElement>('.markdown-preview-view');
        const position={top:scroller?.scrollTop||0,left:scroller?.scrollLeft||0};
        const dialog=newEl(doc, 'dialog');dialog.className='vlook-native-slides';dialog.setAttribute('aria-label','VLOOK 幻灯片');
        const controls=newEl(doc, 'nav');controls.className='vlook-slide-controls';controls.setAttribute('aria-label','幻灯片导航');
        const status=newEl(doc, 'span');status.setAttribute('role','status');
        const body=newEl(doc, 'div');body.className='markdown-rendered vlook-editor-render vlook-slide-body';
        const chooser=new Dropdown(doc,'选择幻灯片','vlook-dropdown-wide');
        chooser.setOptions(groups.map((group,n)=>({value:String(n),label:`${n+1}. ${group.title}`})),'0');
        let at=0,sequence=0,closed=false,component:Component|null=null;
        let footnoteReturn:{page:number;top:number}|null=null;
        const pending=new Set<Component>();
        const definitions=referenceDefinitionsSource(source);
        const footnotes=index.blocks.filter(block=>block.type==='paragraph'&&/^ {0,3}\[\^[^\]]+\]:/.test(block.text)).map(block=>block.text).join('\n\n');
        const seed=slideFootnoteSeed(footnotes,index.blocks.filter(block=>block.type!=='frontmatter').map(block=>block.text).join('\n\n'));
        const subscriptions:(()=>void)[]=[];
        const cleanup=()=>{
            if(closed)return;closed=true;sequence++;
            for(const unsubscribe of subscriptions)unsubscribe();
            component?.unload();component=null;for(const value of pending)value.unload();pending.clear();
            dialog.remove();this.closeCurrent=null;
            notifyPresentation();
            if(scroller?.isConnected){scroller.scrollTop=position.top;scroller.scrollLeft=position.left;}
            if(focus?.isConnected)focus.focus({preventScroll:true});
        };
        const close=()=>{if(dialog.open)dialog.close();else cleanup();};this.closeCurrent=close;
        const button=(label:string,action:()=>void)=>{const element=newEl(doc, 'button');element.type='button';element.textContent=label;element.addEventListener('click',action);controls.append(element);return element;};
        const previous=button('上一页',()=>go(at-1)),next=button('下一页',()=>go(at+1));
        const render=async(targetLine?:number,restoreTop?:number,footnoteId?:string,footnoteOrdinal?:string)=>{
            const mine=++sequence,group=groups[at];
            previous.disabled=at===0;next.disabled=at===groups.length-1;chooser.value=String(at);
            status.textContent=`${at+1} / ${groups.length} · 正在渲染`;
            for(const value of pending)value.unload();pending.clear();
            const fresh=new Component();fresh.load();pending.add(fresh);
            // 新页在后台渲染完成后再替换旧页，避免切换时出现空白闪烁。
            const stage=newEl(doc, 'div');stage.className='vlook-slide-card vlook-slide-pending';body.append(stage);
            try{
                if(group.kind==='footnotes'){
                    await MarkdownRenderer.render(p.app,`<!--vlook-raw-render-->\n${seed}${footnotes}`,stage,path,fresh);
                    if(closed||mine!==sequence){pauseContainedMedia(stage);stage.remove();fresh.unload();return;}
                    indexSlideFootnotes(stage);
                    const area=stage.querySelector('section.footnotes');
                    if(area)stage.replaceChildren(area);
                    await renderReadySection(stage,{app:p.app,settings:p.settings,resourceHistory:p.resourceHistory,sourcePath:path,index,query,cssVar,suppressContentViewers:true,registerCleanup:fn=>fresh.register(fn)},footnotes);
                }else{
                    // 先建齐所有兄弟区块，保留页签 / 分栏跨块关系。
                    const sections=group.blocks.map(block=>{const element=newEl(doc, 'div');stage.append(element);return {block,element};});
                    for(const {block,element} of sections){
                        await MarkdownRenderer.render(p.app,`<!--vlook-raw-render-->\n${seed}${block.text}\n\n${definitions}\n\n${footnotes}`,element,path,fresh);
                        if(closed||mine!==sequence){pauseContainedMedia(stage);stage.remove();fresh.unload();return;}
                        indexSlideFootnotes(element);
                        element.querySelectorAll('section.footnotes').forEach(area=>area.remove());
                        await renderReadySection(element,{app:p.app,settings:p.settings,resourceHistory:p.resourceHistory,sourcePath:path,index,block,query,cssVar,suppressContentViewers:true,registerCleanup:fn=>fresh.register(fn)});
                        const tasks=sourceTasks(block.text);
                        element.querySelectorAll<HTMLInputElement>('input.task-list-item-checkbox').forEach((input,n)=>{
                            const task=tasks[n];
                            if(!task){input.disabled=true;return;}
                            input.disabled=false;
                            input.addEventListener('click',event=>{
                                event.preventDefault();event.stopImmediatePropagation();
                                if(closed)return;
                                if(view.file?.path!==path||view.editor.getValue()!==source){
                                    notify('文档已变更，请重新开启幻灯片后勾选');return;
                                }
                                const from={line:block.start+task.line,ch:task.ch};
                                view.editor.replaceRange(task.checked?' ':'x',from,{line:from.line,ch:from.ch+1});
                                // preventDefault 会在事件结束时回滚浏览器的勾选，随后同步成功写入的状态。
                                queueMicrotask(()=>{if(closed)return;input.checked=!task.checked;refreshTaskProgress(input);});
                            },{capture:true});
                        });
                    }
                }
                if(closed||mine!==sequence){pauseContainedMedia(stage);stage.remove();fresh.unload();return;}
                const old=component;component=fresh;
                for(const child of Array.from(body.children))if(child!==stage){pauseContainedMedia(child as HTMLElement);child.remove();}
                old?.unload();
                stage.classList.remove('vlook-slide-pending');stage.classList.add('vlook-slide-in');
                body.scrollTop=restoreTop??0;body.scrollLeft=0;
                if(targetLine!==undefined){
                    const target=Array.from(stage.querySelectorAll<HTMLElement>('[data-vlook-source-line]')).find(el=>Number(el.dataset.vlookSourceLine)<=targetLine&&Number(el.dataset.vlookSourceEnd??el.dataset.vlookSourceLine)>=targetLine);
                    if(target)body.scrollTop+=target.getBoundingClientRect().top-body.getBoundingClientRect().top;
                }
                if(footnoteId||footnoteOrdinal!==undefined){
                    const target=(footnoteOrdinal!==undefined?Array.from(stage.querySelectorAll<HTMLElement>('[data-vlook-footnote]')).find(el=>el.tagName==='LI'&&el.dataset.vlookFootnote===footnoteOrdinal):undefined) || Array.from(stage.querySelectorAll<HTMLElement>('[id]')).find(el=>el.id===footnoteId);
                    if(target){
                        body.scrollTop+=target.getBoundingClientRect().top-body.getBoundingClientRect().top;
                        target.tabIndex=-1;target.focus({preventScroll:true});
                    }
                }
                status.textContent=`${at+1} / ${groups.length} · ${group.title}`;
            }catch(error){pauseContainedMedia(stage);stage.remove();fresh.unload();if(!closed&&mine===sequence)status.textContent=`幻灯片渲染失败：${(error as Error).message||String(error)}`;}
            finally{pending.delete(fresh);}
        };
        const go=(target:number,line?:number,top?:number,footnoteId?:string,footnoteOrdinal?:string)=>{if(target<0||target>=groups.length)return;at=target;void render(line,top,footnoteId,footnoteOrdinal);};
        controls.append(chooser.el,status);button('退出幻灯片',close);
        status.addEventListener('dblclick',()=>{
            if(status.querySelector('input'))return;
            const input=newEl(doc, 'input');input.type='number';input.min='1';input.max=String(groups.length);input.value=String(at+1);input.className='vlook-slide-jump';input.setAttribute('aria-label','跳转页码');
            const restore=status.textContent;status.replaceChildren(input);input.focus();input.select();
            let done=false;
            const finish=(commit:boolean)=>{
                if(done)return;done=true;
                const n=Math.round(Number(input.value));
                status.textContent=restore;
                if(commit&&Number.isFinite(n)&&n>=1&&n<=groups.length&&n-1!==at)go(n-1);
                dialog.focus({preventScroll:true});
            };
            input.addEventListener('keydown',event=>{event.stopPropagation();if(event.key==='Enter'){event.preventDefault();finish(true);}else if(event.key==='Escape'){event.preventDefault();finish(false);}});
            input.addEventListener('blur',()=>finish(false));
        });
        const requestEffect=(effect:'laser'|'spotlight')=>{doc.dispatchEvent(new doc.defaultView!.CustomEvent('vlook-presentation-effect',{detail:effect}));};
        button('激光笔',()=>requestEffect('laser'));
        const spotlight=button('聚光灯',()=>requestEffect('spotlight'));if(!Platform.isMobile)spotlight.title='按 Shift 切换聚光灯大小';
        chooser.onChange(value=>go(Number(value)));
        dialog.addEventListener('close',cleanup,{once:true});
        dialog.addEventListener('keydown',event=>{
            if((event.target as Element).closest('input,textarea,select,[contenteditable="true"]'))return;
            if(event.ctrlKey||event.metaKey||event.altKey||event.repeat)return;
            if(event.key==='Escape'||event.key.toLowerCase()==='s'){event.preventDefault();event.stopPropagation();close();}
            else if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();event.stopPropagation();go(at+(event.key==='ArrowLeft'?-1:1));}
        });
        dialog.addEventListener('click',event=>{
            if(event.metaKey||event.ctrlKey||event.altKey||event.shiftKey)return;
            const anchor=(event.target as Element).closest<HTMLAnchorElement>('a[href]');
            if(!anchor)return;
            const accept=()=>{event.preventDefault();event.stopImmediatePropagation();};
            if(anchor.matches('.footnote-backref')&&footnoteReturn){
                accept();go(footnoteReturn.page,undefined,footnoteReturn.top);return;
            }
            if(anchor.matches('sup.footnote-ref a,a.footnote-link')){
                const target=groups.findIndex(group=>group.kind==='footnotes');
                if(target>=0){
                    accept();footnoteReturn={page:at,top:body.scrollTop};
                    let id=(anchor.getAttribute('href')||'').replace(/^.*#/, '');
                    try{id=decodeURIComponent(id);}catch{/* 保留原锚点 */}
                    go(target,undefined,undefined,id,anchor.dataset.vlookFootnote);
                }return;
            }
            const href=anchor.getAttribute('href')||'';
            if(!href.startsWith('#')||href==='#')return;
            let name=href.slice(1);try{name=decodeURIComponent(name);}catch{/* 保留原始锚点 */}
            if(name.startsWith('mjx-')){
                const line=equationSourceLine(index,name);
                const target=line===undefined?-1:groups.findIndex(group=>group.blocks.some(block=>block.start<=line&&block.end>=line));
                if(target>=0){accept();go(target,line,undefined,name);}
                return;
            }
            const key=vlookAnchor;
            let line=anchor.dataset.vlookTargetLine!==undefined?Number(anchor.dataset.vlookTargetLine):undefined;
            if(line===undefined)for(const block of index.blocks){
                if(block.type==='heading'&&key(headingPlain(block.text))===key(name)){line=block.start;break;}
                const caption=captionTargets(block,index.text).find(item=>key(item.title)===key(name));
                if(caption){line=caption.line;break;}
                if(['blockquote','callout','list'].includes(block.type)){
                    const quote=quoteSourceTitles(block.text).find(item=>key(item.title)===key(name));
                    if(quote){line=block.start+quote.line;break;}
                }
            }
            const target=line===undefined?-1:groups.findIndex(group=>group.blocks.some(block=>block.start<=line&&block.end>=line));
            if(target>=0){accept();go(target,line);}
        },true);
        const leaf=p.app.workspace.on('active-leaf-change',close);subscriptions.push(()=>p.app.workspace.offref(leaf));
        const modified=p.app.vault.on('modify',file=>{if(file.path===path)close();});
        const deleted=p.app.vault.on('delete',file=>{if(file.path===path||path.startsWith(file.path+'/'))close();});
        subscriptions.push(()=>p.app.vault.offref(modified),()=>p.app.vault.offref(deleted));
        const renamed=p.app.vault.on('rename',(_file,old)=>{if(path===old||path.startsWith(old+'/'))close();});subscriptions.push(()=>p.app.vault.offref(renamed));
        doc.defaultView?.addEventListener('beforeprint',close,{once:true});subscriptions.push(()=>doc.defaultView?.removeEventListener('beforeprint',close));
        dialog.append(body,controls);doc.body.append(dialog);dialog.showModal();notifyPresentation();void render();
    }
    register(){
        const p=this.plugin;p.addCommand({id:'native-slides',name:'开启 / 关闭原生幻灯片',callback:()=>this.toggle()});
        registerDocumentEvent(p,'keydown',event=>{
            if(event.repeat||event.ctrlKey||event.metaKey||event.altKey||event.key.toLowerCase()!=='s')return;
            const target=event.target as Element;if(target.closest('input,textarea,select,[contenteditable="true"],.modal-container,dialog'))return;
            const view=p.app.workspace.getActiveViewOfType(MarkdownView);
            if(view?.getMode()==='preview'&&view.contentEl.contains(target)){event.preventDefault();this.toggle();}
        });
        registerDocumentEvent(p,'change',event=>{const t=event.target as Element|null;if(t?.matches?.('input.task-list-item-checkbox'))window.setTimeout(()=>refreshTaskProgress(t),0);});
        p.register(()=>this.close());
    }
}
