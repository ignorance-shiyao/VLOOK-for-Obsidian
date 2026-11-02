import { renderedSourceImages, matchRenderedImages } from '../core/rendered-image-source';
import { isLiteralContent } from '../core/literal-dom';

/** Source parameters override cached parameters by decoded key, preserving raw values/order. */
function mergeQuery(base:string,query:string):string {
    const hashAt=base.indexOf('#'),fragment=hashAt<0?'':base.slice(hashAt);
    const body=hashAt<0?base:base.slice(0,hashAt),question=body.indexOf('?');
    const path=question<0?body:body.slice(0,question),existing=question<0?'':body.slice(question+1);
    const source=new URLSearchParams(query);
    const kept=existing.split('&').filter(part=>{
        if(!part)return false;
        const key=new URLSearchParams(part).keys().next().value;
        return key===undefined||!source.has(key);
    });
    return path+'?'+[...kept,query].join('&')+fragment;
}

/** 同时保留 Markdown 与真实 HTML img 的源码顺序，代码示例不参与配对。 */
export function restoreImages(root:HTMLElement,markdown:string,resolve:(raw:string,current:string)=>string|null):void {
    const parsed=renderedSourceImages(markdown,root.ownerDocument);
    const images=Array.from(root.querySelectorAll<HTMLImageElement>('img')).filter(image=>!isLiteralContent(image,{allowKbd:true}));
    const paired=matchRenderedImages(images,parsed);
    images.forEach((image,n)=>{
        const ref=paired[n];if(!ref)return;
        const {raw,title}=ref;if(title&&!image.title)image.title=title;
        const current=image.getAttribute('src')||'',base=resolve(raw,current.split('#')[0]);
        if(base===null)return;
        const question=raw.split('#')[0].indexOf('?');
        const query=question<0?'':raw.split('#')[0].slice(question+1);
        const hash=raw.includes('#')?raw.slice(raw.indexOf('#')):'';
        let src=base;
        if(query)src=mergeQuery(src,query);
        if(hash)src=src.split('#')[0]+hash;
        image.setAttribute('src',src);
    });
}
