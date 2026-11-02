import type { Block, SourceIndex } from './source-index';
import { headingPlain } from './heading';

export interface SlideGroup {
    title:string;
    start:number;
    end:number;
    blocks:Block[];
    kind:'intro'|'chapter'|'footnotes';
}

/** 原版 SlideView 在 h1-h5 / 公共脚注区开始新卡片，h6 留在所在卡片。 */
export function slideGroups(index:SourceIndex,includeUnpublished=false):SlideGroup[] {
    const groups:SlideGroup[]=[];
    const footnoteBlocks:Block[]=[];
    let current:SlideGroup|undefined;
    for(const block of index.blocks) {
        if(block.type==='frontmatter' || (!includeUnpublished && block.unpub))continue;
        const footnotes=block.type==='paragraph' && /^ {0,3}\[\^[^\]]+\]:/.test(block.text);
        // 定义可出现在正文任意位置；宿主把它们集中渲染为公共脚注区。
        // 不能把定义后无新标题的正文吞进只展示脚注区的卡片。
        if(footnotes){footnoteBlocks.push(block);continue;}
        const chapter=block.type==='heading' && block.level!<=5;
        if(!current || chapter) {
            current={title:chapter?headingPlain(block.text):'封面与前言',start:block.start,end:block.end,blocks:[],kind:chapter?'chapter':'intro'};
            groups.push(current);
        }
        current.blocks.push(block);current.end=block.end;
    }
    if(footnoteBlocks.length)groups.push({title:'脚注',kind:'footnotes',blocks:footnoteBlocks,start:footnoteBlocks[0].start,end:footnoteBlocks[footnoteBlocks.length-1].end});
    return groups;
}
