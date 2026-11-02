import {isLiteralContent} from '../core/literal-dom';
import { vlookAnchor } from '../core/anchor';
// 源码索引驱动的页内交叉引用，不依赖目标块是否已经被 Obsidian 虚拟化渲染。
import type { RenderCtx } from "../core/context";
import { captionTargets } from "../core/caption-targets";
import { headingPlain } from "./toc";
import { navigateViewLine, navigationSourceView, recordLineNavigation } from "../navigation-history";
import { getSourceIndex } from "../core/source-index";
import { quoteSourceTitles } from '../core/quote-source';
import { hasSourceAnchor } from '../core/link-audit';
import { equationSourceLine } from '../core/math-anchor';

const linkStates=new WeakMap<HTMLAnchorElement,{dispose:()=>void}>();

export function processLinks(root: HTMLElement, ctx: RenderCtx): void {
    const targets = new Map<string, {prefix:string;line:number}>();
    const key = vlookAnchor;
    for (const block of ctx.index?.blocks || []) {
        if (block.type === "heading") {
            const name = headingPlain(block.text);
            if (!targets.has(key(name))) targets.set(key(name), {prefix:block.headerNum || "",line:block.start});
        }
        for(const caption of captionTargets(block,ctx.index!.text)){
            if(!targets.has(key(caption.title)))targets.set(key(caption.title),{prefix:caption.num,line:caption.line});
        }
        if(['blockquote','callout','list'].includes(block.type))for(const item of quoteSourceTitles(block.text)){
            if(!targets.has(key(item.title)))targets.set(key(item.title),{prefix:'',line:block.start+item.line});
        }
    }
    root.querySelectorAll<HTMLAnchorElement>("a[href]").forEach(a => {
        linkStates.get(a)?.dispose();
        if(isLiteralContent(a)||a.closest('sup.footnote-ref,sup[data-footnote-id],sup.md-footnote')||a.classList.contains('footnote-backref')||a.classList.contains('footnote-link'))return;
        const attributes=new Map<string,{before:string|null;written:string}>();
        let click:((ev:MouseEvent)=>void)|undefined,addedMissing=false;
        const set=(name:string,value:string)=>{attributes.set(name,{before:a.getAttribute(name),written:value});a.setAttribute(name,value);};
        const state={dispose:()=>{
            if(linkStates.get(a)!==state)return;
            if(click)a.removeEventListener('click',click);
            for(const [name,attribute] of attributes)if(a.getAttribute(name)===attribute.written){
                if(attribute.before===null)a.removeAttribute(name);else a.setAttribute(name,attribute.before);
            }
            if(addedMissing)a.classList.remove('vlook-link-missing');
            linkStates.delete(a);
        }};
        linkStates.set(a,state);ctx.registerCleanup?.(state.dispose);
        set('data-vlook-link','1');
        const href = a.getAttribute("href") || "";
        if (/^https?:\/\//i.test(href)) { set('target','_blank');set('rel','noopener noreferrer'); }
        if (!href.startsWith("#") || href === "#" || !ctx.index || a.closest(".md-toc")) return;
        let anchor: string;
        try { anchor = decodeURIComponent(href.slice(1)); } catch { anchor = href.slice(1); }
        if (a.classList.contains("footnote-link") || a.classList.contains("footnote-backref") || anchor.startsWith("^")) return;
        const equation=anchor.startsWith('mjx-eqn:');
        const equationLine=equation?equationSourceLine(ctx.index,anchor):undefined;
        // Unresolved runtime-only IDs must not fall through to normalized headings.
        if(anchor.startsWith('mjx-')&&equationLine===undefined)return;
        const target = equationLine===undefined?targets.get(key(anchor)):{prefix:'',line:equationLine};
        if (target === undefined) {
            // 显式 HTML id/name 由原生导航处理，不能当作缺失的 Markdown 标题。
            if (hasSourceAnchor(ctx.index, anchor)) return;
            addedMissing=!a.classList.contains('vlook-link-missing');
            a.classList.add("vlook-link-missing");
            set("title", `未找到页内锚点：${anchor}`);
        } else {
            if (target.prefix) {
                set('data-vlook-ref',target.prefix);
                set("aria-label", `${target.prefix} ${a.textContent || anchor}`);
            }
            click=ev => {
                if(linkStates.get(a)!==state||!root.contains(a)||a.getAttribute('href')!==href)return;
                if (ev.altKey || ev.shiftKey || !ctx.app?.workspace.openLinkText) return;
                let line = target.line;
                const view = navigationSourceView(ctx.app,ctx.sourcePath,a);
                if(equation){
                    const host=view?.contentEl||root.closest('.markdown-reading-view,.markdown-source-view')||root;
                    // Keep precise native jumps to a tag inside an already rendered align block.
                    if(Array.from(host.querySelectorAll('[id]')).some(node=>node.id===anchor))return;
                }
                if (view?.file?.path === ctx.sourcePath) {
                    // 相邻区块编辑未必重建当前链接，点击时按最新源码重新定位。
                    const index = getSourceIndex(view.editor.getValue(),{captionGroup:false,captionNumber:true});
                    let latest:number|undefined=equation?equationSourceLine(index,anchor):undefined;
                    if(!equation)for(const block of index.blocks){
                        if (block.type === "heading" && key(headingPlain(block.text)) === key(anchor)){latest=block.start;break;}
                        const caption=captionTargets(block,index.text).find(item=>key(item.title)===key(anchor));
                        if(caption){latest=caption.line;break;}
                        if(['blockquote','callout','list'].includes(block.type)){
                            const quote=quoteSourceTitles(block.text).find(item=>key(item.title)===key(anchor));
                            if(quote){latest=block.start+quote.line;break;}
                        }
                    }
                    if (latest===undefined) return;
                    line = latest;
                }
                ev.preventDefault(); ev.stopPropagation();
                if(view?.contentEl?.contains(a) && !ev.metaKey && !ev.ctrlKey){navigateViewLine(view,line);return;}
                recordLineNavigation(ctx.app,ctx.sourcePath,line,view);
                void ctx.app.workspace.openLinkText(ctx.sourcePath,"",ev.metaKey||ev.ctrlKey,{eState:{line}});
            };
            a.addEventListener('click',click);
        }
    });
}
