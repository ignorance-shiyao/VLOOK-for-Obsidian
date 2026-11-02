import {renderZenUmlFallback} from './zenuml-fallback';
import type { RenderCtx } from '../core/context';
import { sourceDiagramCount, waitForDiagrams } from '../preview/diagram-ready';
import { sourceMathFenceCount, waitForMath } from '../preview/math-ready';
import { renderSection } from '../render';

const pendingSections=new WeakMap<HTMLElement,AbortController>();

/** Called in the background: reading-view mounting must not wait on layout-dependent SVG. */
export async function renderReadySection(root:HTMLElement,ctx:RenderCtx,source?:string):Promise<void> {
    pendingSections.get(root)?.abort();
    pendingSections.delete(root);
    // A host may post-process only part of a larger quote/list section.
    const count=source!==undefined?sourceDiagramCount(source):ctx.block?.type==='mermaid'?sourceDiagramCount(ctx.block.text):0;
    const mathCount=source!==undefined?sourceMathFenceCount(source):ctx.block?.type==='math'?sourceMathFenceCount(ctx.block.text):0;
    const pending=count>0||mathCount>0||!!root.querySelector('.mermaid,pre > code.language-mermaid,.math.math-inline,.math.math-block');
    if(!pending){renderSection(root,ctx);return;}
    const controller=new root.ownerDocument.defaultView!.AbortController();
    pendingSections.set(root,controller);
    let disposed=false;
    ctx.registerCleanup?.(()=>{
        disposed=true;controller.abort();
        if(pendingSections.get(root)===controller)pendingSections.delete(root);
    });
    try{
        await renderZenUmlFallback(root,{register:cleanup=>controller.signal.addEventListener('abort',cleanup,{once:true})},undefined,source??ctx.block?.text??'');
        await Promise.all([waitForDiagrams(root,15000,100,count,controller.signal),waitForMath(root,15000,100,controller.signal,mathCount)]);
        // The host owns this DOM; cancelled work must not clear a potentially reused section.
        if(!disposed&&pendingSections.get(root)===controller)renderSection(root,ctx);
    }finally{
        if(pendingSections.get(root)===controller)pendingSections.delete(root);
    }
}
