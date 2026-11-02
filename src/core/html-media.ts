import {htmlLiteralRanges} from './html-literal';
import { isVideoEmbed } from './video-embed';
import { resourceQuery } from './url';
import { parseHtml } from "./dom";

export interface HtmlMediaSource {pos: number; tag: string; type: 'audio' | 'video'; alt: string; title?: string}

/** Tokenize complete tags so quoted examples, comments and raw text do not become media. */
export function htmlMediaSources(source: string, doc?: Document, includeMini = false): HtmlMediaSource[] {
    const markup = source.replace(/<!--[\s\S]*?(?:-->|$)|<(script|style|textarea|title)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, value => value.replace(/[^\n]/g, ' '));
    const ignored=htmlLiteralRanges(markup);
    return Array.from(markup.matchAll(/<\/?[A-Za-z][\w:-]*\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/g)).flatMap(token => {
        if(ignored.some(range=>token.index!>=range.pos&&token.index!<range.end))return [];
        const tag = token[0].match(/^<(audio|video|iframe|img)\b/i)?.[1].toLowerCase();
        if (!tag) return [];
        const attrs = Array.from(token[0].slice(tag.length + 1).matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g));
        const attr = attrs.find(item => item[1].toLowerCase() === 'src');
        const src = (attr?.[2] ?? attr?.[3] ?? attr?.[4] ?? '').replace(/&(?:amp|#38|#x26);/gi, '&');
        let type: 'audio'|'video' = tag === 'audio' ? 'audio' : 'video';
        if (tag === 'img') {
            const path = src.split(/[?#]/)[0];
            if (/\.(mp3|m4a|ogg|wav)$/i.test(path) && (includeMini || resourceQuery(src).controls !== 'mini')) type = 'audio';
            else if (!/\.(mp4|webm|ogv|mov|m4v)$/i.test(path)) return [];
        }
        // Match the reading renderer: ordinary embedded documents are not video captions.
        // Tokenize attributes rather than matching src text inside another quoted attribute.
        if (tag === 'iframe') {
            if (!isVideoEmbed(src)) return [];
        }
        const attribute=(name:string)=>{const item=attrs.find(value=>value[1].toLowerCase()===name);return item?(item[2]??item[3]??item[4]??''):undefined;};
        let alt = attribute('alt') || '', title = attribute('title');
        if (doc) {
            const template = {content:parseHtml(doc, token[0])};
            const element = template.content.firstElementChild;
            alt = element?.getAttribute('alt') || ''; title = element?.getAttribute('title') || undefined;
        }
        return [{pos: token.index!, tag, type, alt, title}];
    });
}
