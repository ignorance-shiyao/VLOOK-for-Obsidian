import { resourceQuery } from '../core/url';
import { isVideoEmbed } from '../core/video-embed';

/** Preserve the port's leading-content caption extension before the original runtime runs. */
export function prepareImageCaptions(root: HTMLElement): void {
    root.querySelectorAll<HTMLParagraphElement>('p').forEach(marker=>{
        if(marker.children.length!==1||marker.firstElementChild?.tagName!=='EM')return;
        const emphasis=marker.firstElementChild;
        if(emphasis.children.length!==1||emphasis.firstElementChild?.tagName!=='MARK')return;
        const mark=emphasis.firstElementChild;
        if(marker.textContent?.trim()!==emphasis.textContent?.trim())return;
        const next=marker.nextElementSibling;
        if(!next||!['P','DIV','FIGURE','IFRAME','IMG'].includes(next.tagName))return;
        // A leading caption for a table/list/quote belongs to that structure, not a child image.
        if(next.querySelector('table,pre,blockquote,ul,ol'))return;
        // 原生 <audio>/<video> 标签在 Typora 中不分配题注，前置段落保持原样
        const candidates=next.matches('img,iframe')?[next as HTMLElement]:Array.from(next.querySelectorAll<HTMLElement>('img,iframe'));
        const image=candidates.find(el=>{
            const src=el.getAttribute('src')||'';
            if(el.closest('kbd'))return false;
            if(el.tagName==='IFRAME')return isVideoEmbed(src);
            if(el.tagName!=='IMG')return true;
            return !/#(?:icon|logo|card)/.test(src)&&!( /\.(mp3|m4a|ogg|wav)$/i.test(src.split(/[?#]/)[0])&&resourceQuery(src).controls==='mini');
        });
        if(!image||image.getAttribute('alt')?.trim())return;
        const copy=mark.cloneNode(true) as HTMLElement;
        const tail=copy.lastElementChild;
        let secondary:string|undefined;
        if(tail?.tagName==='EM'&&!tail.nextSibling?.textContent?.trim()){
            secondary=tail.textContent?.trim();tail.remove();
        }
        let primary=copy.textContent?.trim()||'';
        const literal=primary.match(/^(.*?)_([^_]+)_$/);
        if(!secondary&&literal){primary=literal[1].trim();secondary=literal[2].trim();}
        if(!primary)return;
        image.setAttribute('alt',primary);
        if(secondary)image.setAttribute('title',secondary);
        marker.remove();
    });
}
