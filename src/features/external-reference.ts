import {isLiteralContent} from '../core/literal-dom';
import {Query,type RenderCtx} from '../core/context';
import {getSourceIndex} from '../core/source-index';
import {vlookAnchor} from '../core/anchor';
import {headingPlain} from '../core/heading';
import {captionTargets} from '../core/caption-targets';
import {resolveVaultLink} from '../preview/links';
interface ReferenceRequest{href:string;priorRef?:string;priorAria:string|null;prefix?:string;aria?:string}
const requests=new WeakMap<HTMLAnchorElement,ReferenceRequest>();
function restoreReference(anchor:HTMLAnchorElement,request:ReferenceRequest){
    if(request.prefix&&anchor.dataset.vlookRef===request.prefix){if(request.priorRef===undefined)delete anchor.dataset.vlookRef;else anchor.dataset.vlookRef=request.priorRef;}
    if(request.aria&&anchor.getAttribute('aria-label')===request.aria){if(request.priorAria===null)anchor.removeAttribute('aria-label');else anchor.setAttribute('aria-label',request.priorAria);}
}

/** Local cross-document numbering; leave opening behavior to Obsidian. */
export async function processExternalReferences(root:HTMLElement,ctx:RenderCtx):Promise<void>{
    if(!ctx.app?.vault?.cachedRead||!ctx.app.metadataCache?.getFirstLinkpathDest)return;
    const app=ctx.app;
    const defaults=new Query(ctx.cssVar('--vlook-query'));
    let disposed=false;
    const owned:Array<{anchor:HTMLAnchorElement;request:ReferenceRequest}>=[];
    ctx.registerCleanup?.(()=>{
        disposed=true;
        for(const {anchor,request} of owned)if(requests.get(anchor)===request){restoreReference(anchor,request);requests.delete(anchor);delete anchor.dataset.vlookExternalRef;}
    });
    const reads=new Map<string,Promise<ReturnType<typeof getSourceIndex>>>();
    const jobs:Array<Promise<void>>=[];
    root.querySelectorAll<HTMLAnchorElement>('a[href]').forEach(anchor=>{
        const previous=requests.get(anchor);
        if(isLiteralContent(anchor)||anchor.closest('sup.footnote-ref,sup[data-footnote-id],sup.md-footnote')){
            if(previous){restoreReference(anchor,previous);requests.delete(anchor);delete anchor.dataset.vlookExternalRef;}
            return;
        }
        const href=anchor.dataset.href||anchor.getAttribute('href')||'';
        if(previous?.href===href&&anchor.dataset.vlookExternalRef!=='unavailable')return;
        if(previous){restoreReference(anchor,previous);requests.delete(anchor);delete anchor.dataset.vlookExternalRef;}
        let resolved:ReturnType<typeof resolveVaultLink>;
        try{resolved=resolveVaultLink(app,href,ctx.sourcePath);}catch{anchor.dataset.vlookExternalRef='unavailable';return;}
        if(!resolved?.hash||resolved.hash==='#'||resolved.file.path===ctx.sourcePath)return;
        let hash=resolved.hash.slice(1);try{hash=decodeURIComponent(hash);}catch{/* 保留原值 */}
        if(hash.startsWith('mjx-')||hash.startsWith('^'))return;
        const request:ReferenceRequest={href,priorRef:anchor.dataset.vlookRef,priorAria:anchor.getAttribute('aria-label')};requests.set(anchor,request);owned.push({anchor,request});
        const current=()=>!disposed&&requests.get(anchor)===request&&root.contains(anchor)&&(anchor.dataset.href||anchor.getAttribute('href')||'')===href;
        anchor.dataset.vlookExternalRef='pending';
        let read=reads.get(resolved.file.path);
        if(!read){
            const file=resolved.file;
            read=Promise.resolve().then(()=>app.vault.cachedRead(file)).then(source=>getSourceIndex(source,{
                headerEnabled:ctx.settings.headerAutoNum,headerTemplate:ctx.cssVar('--vlook-header-autonum')||undefined,
                captionGroup:defaults.get('capgroup')!=='off',captionNumber:defaults.get('capnum')!=='off',
            }));reads.set(resolved.file.path,read);
        }
        jobs.push((async()=>{
            try{
                const index=await read;if(!current())return;
                let prefix='';
                for(const block of index.blocks){
                    if(block.type==='heading'&&vlookAnchor(headingPlain(block.text))===vlookAnchor(hash)){prefix=block.headerNum||'';break;}
                    const caption=captionTargets(block,index.text).find(item=>vlookAnchor(item.title)===vlookAnchor(hash));
                    if(caption){prefix=caption.num;break;}
                }
                if(prefix){request.prefix=prefix;request.aria=`${prefix} ${anchor.textContent||hash}`;anchor.dataset.vlookRef=prefix;anchor.setAttribute('aria-label',request.aria);}
                anchor.dataset.vlookExternalRef=prefix?'numbered':'no-prefix';
            }catch{if(current())anchor.dataset.vlookExternalRef='unavailable';}
        })());
    });
    await Promise.all(jobs);
}
