import {htmlLiteralRanges} from './html-literal';
import { htmlMediaSources } from './html-media';
import { sourceImages } from './image-source';
import { resourceQuery } from './url';
import type { Block } from './source-index';
import {fenceParser as parser} from './fenced-source';

export interface MediaSource {pos: number; type: 'audio' | 'video'; native: boolean; alt: string}

/** Source-order players; tables retain their own caption in addition to these children. */
export function mediaSources(block: Block, source: string, doc?: Document, includeMini = false): MediaSource[] {
    let markup = block.text;
    const htmlRanges: {from: number; to: number}[] = [];
    if (block.type !== 'html') {
        const ranges: {from: number; to: number}[] = [];
        parser.parse(markup).iterate({enter(node) {
            if (['InlineCode', 'FencedCode', 'CodeBlock'].includes(node.name)) {
                ranges.push({from: node.from, to: node.to}); return false;
            }
            if (['HTMLTag', 'HTMLBlock', 'CommentBlock'].includes(node.name)) {
                htmlRanges.push({from: node.from, to: node.to}); return false;
            }
        }});
        for (const range of ranges.reverse()) markup = markup.slice(0, range.from)
            + markup.slice(range.from, range.to).replace(/[^\n]/g, ' ') + markup.slice(range.to);
    }
    let htmlMarkup = markup;
    if (block.type !== 'html') {
        htmlMarkup = markup.replace(/[^\n]/g, ' ');
        for (const range of htmlRanges) htmlMarkup = htmlMarkup.slice(0, range.from)
            + markup.slice(range.from, range.to) + htmlMarkup.slice(range.to);
    }
    const literalRanges=htmlLiteralRanges(htmlMarkup);
    const native = htmlMediaSources(htmlMarkup, doc, includeMini).map(ref => ({...ref, native: ref.tag === 'audio' || ref.tag === 'video'}));
    const images: MediaSource[] = block.type === 'html' ? [] : sourceImages(markup, source).filter(ref=>
        !htmlRanges.some(range=>ref.pos>=range.from&&ref.pos<range.to)&&!literalRanges.some(range=>ref.pos>=range.pos&&ref.pos<range.end)).flatMap(ref => {
        const path = ref.raw.split(/[?#]/)[0];
        const type = /\.(mp4|webm|ogv|mov|m4v)$/i.test(path) ? 'video'
            : /\.(mp3|m4a|ogg|wav)$/i.test(path) && (includeMini || resourceQuery(ref.raw).controls !== 'mini') ? 'audio' : undefined;
        return type ? [{pos: ref.pos, type, native: false, alt: ref.alt}] : [];
    });
    return [...native, ...images].sort((a,b) => a.pos - b.pos);
}
