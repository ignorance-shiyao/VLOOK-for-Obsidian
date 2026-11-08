import {getSourceIndex} from '../core/source-index';
import {renderZenUmlFallback} from './zenuml-fallback';

/** Obsidian mounts its collected footnotes outside ordinary section postprocessors. */
export function watchFootnoteDiagrams(host:HTMLElement,readSource:()=>Promise<string|null>,
    load?:Parameters<typeof renderZenUmlFallback>[2]):()=>void {
    const win=host.ownerDocument.defaultView!;
    const controller=new win.AbortController();
    const attempted=new WeakMap<HTMLElement,string>();
    let queued=false,running=false,again=false;
    const scan=async()=>{
        if(controller.signal.aborted)return;
        if(running){again=true;return;}
        running=true;
        try{
            const roots=Array.from(host.querySelectorAll<HTMLElement>('.markdown-preview-view .footnotes'));
            for(const root of roots){
                if(!root.querySelector('.mermaid:not([data-vlook-diagram-kind="zenuml"]),pre > code.language-mermaid'))continue;
                const signature=root.innerHTML;
                if(attempted.get(root)===signature)continue;
                const source=await readSource();
                if(source===null||controller.signal.aborted||!host.contains(root)||root.innerHTML!==signature)continue;
                attempted.set(root,signature);
                const index=getSourceIndex(source,{captionGroup:false,captionNumber:true});
                const definitions=index.blocks.filter(block=>block.type==='paragraph'&&/^ {0,3}\[\^[^\]]+\]:/.test(block.text)).map(block=>block.text).join('\n\n');
                await renderZenUmlFallback(root,{register:cleanup=>controller.signal.addEventListener('abort',cleanup,{once:true})},load,definitions);
            }
        }catch(error){if(!controller.signal.aborted)console.error('[VLOOK] footnote diagram',error);}
        finally{running=false;if(again){again=false;schedule();}}
    };
    const schedule=()=>{if(queued||controller.signal.aborted)return;queued=true;win.queueMicrotask(()=>{queued=false;void scan()});};
    const observer=new win.MutationObserver(records=>{
        if(records.some(record=>(record.target.instanceOf(win.Element)&&record.target.closest('.footnotes'))||Array.from(record.addedNodes).some(node=>node.instanceOf(win.Element)&&(node.matches('.footnotes')||node.querySelector('.footnotes')))))schedule();
    });
    observer.observe(host,{childList:true,subtree:true,characterData:true});schedule();
    return ()=>{controller.abort();observer.disconnect();};
}
