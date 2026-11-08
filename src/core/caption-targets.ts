import type { Block } from './source-index';
import { sourceImages } from './image-source';
import { mediaSources } from './media-source';
import { figureSources } from './figure-source';

export interface CaptionTarget {title: string; num: string; line: number}

/** The complete set of caption anchors, including multiple standard players in one block. */
export function captionTargets(block: Block, source: string): CaptionTarget[] {
    if (!block.caption && !block.mediaCaptions?.length && !block.figureCaptions?.length) return [];
    const refs = sourceImages(block.text, source);
    const targets: CaptionTarget[] = [];
    if(block.figureCaptions?.length){
        const figures=figureSources(block,source,typeof document==='undefined'?undefined:activeDocument);
        figures.forEach((ref,n)=>{
            const info=block.figureCaptions![n],title=ref.alt||info?.cap1;
            if(info&&title)targets.push({title,num:info.num,line:block.start+block.text.slice(0,ref.pos).split('\n').length-1});
        });
    }
    if (block.mediaCaptions?.length) {
        const media = mediaSources(block, source, typeof document === 'undefined' ? undefined : activeDocument);
        if (media.length === block.mediaCaptions.length) {
            targets.push(...media.flatMap((ref, n) => {
                const info = block.mediaCaptions![n], title = ref.alt || info.cap1;
                return title ? [{title, num: info.num, line: block.start + block.text.slice(0, ref.pos).split('\n').length - 1}] : [];
            }));
            if (!block.caption || block.caption.kind === 'media') return targets;
        }
    }

    if (!block.caption || block.caption.kind==='figure' && block.figureCaptions?.length) return targets;
    const title = block.caption.cap1 || (block.caption.kind === 'table' ? undefined : refs[0]?.alt);
    return [...(title ? [{title, num: block.caption.num, line: block.start}] : []), ...targets];
}
