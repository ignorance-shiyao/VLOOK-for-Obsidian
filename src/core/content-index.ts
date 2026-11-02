import { figureSources } from './figure-source';
import { mediaSources } from './media-source';
import type { Block, SourceIndex } from './source-index';
import { sourceImages } from './image-source';
import { AUDIO_EXT, VIDEO_EXT } from '../features/media';
export interface SourceContentItem { block: Block; kind: string; title: string; line?: number; target?: {kind: 'figure'|'media'; index: number} }

/** 来自全文，不依赖阅读视图或 CodeMirror 当前挂载了哪些区块。 */
export function sourceContentItems(index: SourceIndex): SourceContentItem[] {
    const names: Record<string,string> = {table:'表格',code:'代码',mermaid:'插图',math:'公式'};
    return index.blocks.flatMap(block => {
        const figures=figureSources(block,index.text,typeof document==='undefined'?undefined:document);
        const media=mediaSources(block,index.text,typeof document==='undefined'?undefined:document);
        const children=[
            ...figures.map((ref,n)=>({ref,kind:'插图',info:block.figureCaptions?.[n],target:{kind:'figure' as const,index:n}})),
            ...media.map((ref,n)=>({ref,kind:'多媒体',info:block.mediaCaptions?.[n],target:{kind:'media' as const,index:n}})),
        ].sort((a,b)=>a.ref.pos-b.ref.pos).map(item=>{
            const line=block.start+block.text.slice(0,item.ref.pos).split('\n').length-1;
            const alt=/^\d+(?:x\d+)?$/.test(item.ref.alt)?'':item.ref.alt;
            return {block,kind:item.kind,title:alt||item.info?.cap1||`${item.kind} · 第 ${line+1} 行`,line,target:item.target};
        });
        if(children.length){
            if(names[block.type])return [{block,kind:names[block.type],title:block.caption?.cap1||`${names[block.type]} · 第 ${block.start+1} 行`},...children];
            return children;
        }
        let kind = names[block.type];
        let alt = '';
        if (/^(?:html|paragraph|image)$/.test(block.type)) {
            // 不把行内代码中的语法示例当作真实嵌入。
            const text = block.text.replace(/(`+)[\s\S]*?\1/g, '');
            const refs = sourceImages(text, index.text).filter(ref => {
                const path = ref.raw.split(/[?#]/)[0];
                return !/\.(?:md|canvas|base)$/i.test(path) && (/\.(?:png|jpe?g|gif|svg|webp|bmp|avif|mp3|m4a|ogg|wav|mp4|webm|ogv|mov|m4v)$/i.test(path) || text.slice(ref.pos).startsWith('![') && !text.slice(ref.pos).startsWith('![['));
            });
            if (/<(?:audio|video|iframe)\b/i.test(text) || refs.some(ref => {
                let path = ref.raw.split(/[?#]/)[0];
                try {path = decodeURIComponent(path);} catch { /* 保留原路径 */ }
                return AUDIO_EXT.test(path) || VIDEO_EXT.test(path);
            })) kind = '多媒体';
            else if (refs.length || /<img\b/i.test(text)) kind = '插图';
            alt = refs[0]?.alt || text.match(/<img\b[^>]*\balt=["']([^"']*)/i)?.[1] || '';
            if (/^\d+(?:x\d+)?$/.test(alt)) alt = ''; // Wiki 图片尺寸不是题注。
        }
        if (!kind) return [];
        const title = block.caption?.cap1 || block.caption?.cap2 || alt || `${kind} · 第 ${block.start + 1} 行`;
        return [{block,kind,title}];
    });
}
