import type { SourceContentItem } from './content-index';

export const contentSelector=(kind:'figure'|'media')=>kind==='figure'
    ? '.v-caption.figure,.v-caption.mermaid'
    : '.v-caption[data-fig-type="audio"],.v-caption[data-fig-type="video"]';

/** Prefer the rendered object's ordinal; titles may be empty or repeated. */
export function selectedContentItem(items:SourceContentItem[],target:HTMLElement,line?:number):SourceContentItem|undefined {
    const block=target.closest<HTMLElement>('[data-vlook-source-line]');
    const structural=target.matches('table,pre,.math-block')||['table','codeblock','formula'].includes(target.dataset.cntr||'');
    const tagged=structural?null:target.closest<HTMLElement>('[data-vlook-content-index]')||target.querySelector<HTMLElement>('[data-vlook-content-index]');
    if(tagged){
        const item=items.find(item=>item.block.start===line&&item.target&&item.target.kind===tagged.dataset.vlookContentKind&&item.target.index===Number(tagged.dataset.vlookContentIndex));
        if(item)return item;
    }
    const caption=target.closest<HTMLElement>('.v-caption')||target.querySelector<HTMLElement>('.v-caption');
    if(block&&caption){
        for(const kind of ['figure','media'] as const){
            const ordinal=Array.from(block.querySelectorAll(contentSelector(kind))).indexOf(caption);
            if(ordinal<0)continue;
            const item=items.find(item=>item.block.start===line&&item.target?.kind===kind&&item.target.index===ordinal);
            if(item)return item;
        }
    }
    const title=target.closest<HTMLElement>('[data-cap-for-id]')?.dataset.capForId;
    return items.find(item=>item.block.start===line&&item.title===title)||items.find(item=>item.block.start===line)||items[0];
}
