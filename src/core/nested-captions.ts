import { parser } from '@lezer/markdown';
import type { Block, CaptionInfo } from './source-index';
import { figureSources } from './figure-source';
import { mediaSources } from './media-source';

/** Local sibling paragraphs only; never carry a caption out of a quote/list item. */
export function assignNestedCaptions(block: Block, source: string): void {
    if(!['blockquote','callout','list'].includes(block.type))return;
    const candidates=[
        ...figureSources(block,source).map((ref,n)=>({ref,info:block.figureCaptions?.[n]})),
        ...mediaSources(block,source).map((ref,n)=>({ref,info:block.mediaCaptions?.[n]})),
    ].sort((a,b)=>a.ref.pos-b.ref.pos);
    parser.parse(block.text).iterate({enter(node){
        if(node.name!=='Paragraph')return;
        const text=block.text.slice(node.from,node.to),match=text.match(/^([*_])==([^\n]+)==\1$/);
        if(!match)return;
        let next=node.node.nextSibling;
        while(next?.name==='QuoteMark')next=next.nextSibling;
        if(!next||!['Paragraph','HTMLBlock'].includes(next.name))return;
        const candidate=candidates.find(item=>item.ref.pos>=next.from&&item.ref.pos<next.to);
        if(!candidate?.info||candidate.ref.alt.trim())return;
        const parts=match[2].match(/^(.*?)_(.+)_$/);
        const plain=(value:string)=>value.trim().replace(/\\([\\`*_{}[\]()#+\-.!<>|~^=])/g,'$1');
        const info:CaptionInfo=candidate.info;info.cap1=plain(parts?parts[1]:match[2]);
        if(parts)info.cap2=plain(parts[2]);
    }});
}
