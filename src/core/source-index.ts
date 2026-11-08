import {vlookQueryParams} from './query-source';
import {parseFrontmatterYaml} from './frontmatter';
import { mediaSources } from './media-source';
import { figureSources } from './figure-source';
import { assignNestedCaptions } from './nested-captions';
// 文档源码索引：Obsidian 阅读视图按「块」分段渲染（且长文档会虚拟化），
// 单个块拿不到前后文 DOM。VLOOK 的跨块特性（标题编号、题注编号、页签组、分栏、封面）
// 改为基于整篇 Markdown 源码计算，再按行号对应到每个渲染块。

import { hasDirectStrike, unpublishedMatcher } from "./unpublished";
import { headingPlain, headingSource } from "./heading";
import { sourceImages } from "./image-source";
import { parseHeaderTemplate, HeaderNumberer, HeaderTemplate } from "./header-num";

export type BlockType =
    | "frontmatter" | "heading" | "hr" | "blockquote" | "callout" | "table" | "code" | "mermaid"
    | "math" | "list" | "html" | "image" | "paragraph" | "toc";

export interface Block {
    type: BlockType;
    start: number; // 起始行（含）
    end: number;   // 结束行（含）
    level?: number; // 标题级别
    lang?: string;  // 代码块语言
    text: string;   // 原始源码
    /** 标题编号（如 1.2.3） */
    headerNum?: string;
    headerNumNormal?: string;
    /** 封面 / 封底 */
    cover?: "front" | "back";
    /** 作为题注语法段落时，指向被题注的块下标 */
    captionFor?: number;
    /** 题注信息（被题注的块） */
    caption?: CaptionInfo;
    mediaCaptions?: CaptionInfo[];
    figureCaptions?: CaptionInfo[];
    /** 页签组：组 id 与序号（从 1 开始），以及作为页签组标记的段落 */
    tabGroup?: { id: number; index: number; count: number };
    tabMarker?: { id: number; count: number };
    /** 分栏：所在分栏组与列数 */
    columns?: { group: number; count: number; index: number; kind: "quote" | "list" };
    /** 作为分栏标记的 hr */
    columnMarker?: number;
    /** 所属最近的已编号章节（h1～h5，用于题注分组） */
    chapter?: string;
    /** 属于「不发布」的章节 */
    unpub?: boolean;
}

export interface CaptionInfo {
    kind: "table" | "figure" | "codeblock" | "formula" | "media";
    mediaType?: 'audio' | 'video';
    /** 文档内同类计数（从 1 开始） */
    counter: number;
    /** 显示的编号（考虑按章节分组） */
    num: string;
    cap1?: string;
    cap2?: string;
}

export interface IndexOptions {
    headerTemplate?: string;
    headerEnabled?: boolean;
    captionGroup: boolean;
    captionNumber: boolean;
}

const RE = {
    fence: /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)/,
    heading: /^ {0,3}(#{1,6})(?:\s+|$)(.*)$/,
    hr: /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/,
    quote: /^ {0,3}>/,
    callout: /^ {0,3}>\s*\[!([\w-]+)\]/,
    tableSep: /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/,
    list: /^ {0,3}(?:[-*+]|\d{1,9}[.)])(?:\s|$)/,
    html: /^ {0,3}<(iframe|video|audio|details|div|figure|table|center|p)\b/i,
    mathOpen: /^ {0,3}\$\$/,
    image: /^\s*!\[[^\]]*\]\(\s*<?[^)\s>]*>?(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)\s*$|^\s*!\[\[[^\]]+\]\]\s*$/,
    toc: /^\s*\[(toc|TOC)\]\s*$/,
    /** *==题注==* 或 _==题注==_ 独占一行 */
    caption: /^\s*([*_])==(.+)==\1\s*$/,
    /** *^tab^* 或 _^tab^_ 独占一行 */
    tabMarker: /^\s*([*_])\^([^^]+)\^\1\s*$/,
    blank: /^\s*$/,
};

export function scanBlocks(text: string): Block[] {
    const lines = text.split("\n");
    const blocks: Block[] = [];
    let i = 0;
    const push = (type: BlockType, start: number, end: number, extra: Partial<Block> = {}) => {
        blocks.push({ type, start, end, text: lines.slice(start, end + 1).join("\n"), ...extra });
    };
    // YAML Front Matter
    if (lines[0]?.trim() === "---") {
        let j = 1;
        while (j < lines.length && lines[j].trim() !== "---" && lines[j].trim() !== "...")
            j++;
        if (j < lines.length) {
            push("frontmatter", 0, j);
            i = j + 1;
        }
    }
    while (i < lines.length) {
        const line = lines[i];
        if (RE.blank.test(line)) { i++; continue; }
        let m: RegExpMatchArray | null;
        // Footnote continuation paragraphs, lists and fences belong to the definition,
        // even across blank lines; the slide footnote page renders them together.
        if (/^ {0,3}\[\^[^\]\r\n]+\]:/.test(line)) {
            let j=i+1,end=i;
            while(j<lines.length){
                if(RE.blank.test(lines[j])){j++;continue;}
                if(!/^(?: {4}| {0,3}\t)/.test(lines[j]))break;
                end=j++;
            }
            push('paragraph',i,end);i=end+1;continue;
        }
        // 代码块
        if ((m = line.match(RE.fence))) {
            const fence = m[1], lang = m[2].toLowerCase();
            let j = i + 1;
            while (j < lines.length && !new RegExp(`^ {0,3}${fence[0]}{${fence.length},}\\s*$`).test(lines[j]))
                j++;
            const type: BlockType = lang === "mermaid" ? "mermaid" : lang === "math" ? "math" : "code";
            push(type, i, Math.min(j, lines.length - 1), { lang });
            i = j + 1;
            continue;
        }
        // 公式块
        if (RE.mathOpen.test(line)) {
            let j = i;
            if (!/\$\$\s*$/.test(line.trim().slice(2)) || line.trim() === "$$") {
                j = i + 1;
                while (j < lines.length && !/\$\$\s*$/.test(lines[j]))
                    j++;
            }
            push("math", i, Math.min(j, lines.length - 1));
            i = j + 1;
            continue;
        }
        if ((m = line.match(RE.heading))) {
            push("heading", i, i, { level: m[1].length });
            i++;
            continue;
        }
        if (RE.hr.test(line)) {
            push("hr", i, i);
            i++;
            continue;
        }
        if (RE.quote.test(line)) {
            let j = i;
            while (j + 1 < lines.length && (RE.quote.test(lines[j + 1]) || (!RE.blank.test(lines[j + 1]) && !RE.heading.test(lines[j + 1]) && !RE.hr.test(lines[j + 1]) && !RE.fence.test(lines[j + 1]) && !RE.list.test(lines[j + 1]))))
                j++;
            push(RE.callout.test(line) ? "callout" : "blockquote", i, j);
            i = j + 1;
            continue;
        }
        if (line.includes("|") && i + 1 < lines.length && RE.tableSep.test(lines[i + 1]) && lines[i + 1].includes("-")) {
            let j = i + 1;
            while (j + 1 < lines.length && !RE.blank.test(lines[j + 1]) && lines[j + 1].includes("|"))
                j++;
            push("table", i, j);
            i = j + 1;
            continue;
        }
        if (RE.list.test(line)) {
            let j = i;
            while (j + 1 < lines.length) {
                const nx = lines[j + 1];
                if (RE.blank.test(nx)) {
                    // 空行后若仍是缩进内容或列表项，则属于同一列表
                    const nn = lines[j + 2];
                    if (nn !== undefined && (RE.list.test(nn) || /^\s{2,}\S/.test(nn))) { j += 1; continue; }
                    break;
                }
                if (RE.heading.test(nx) || RE.hr.test(nx) || (RE.fence.test(nx) && !/^\s/.test(nx)) || (RE.quote.test(nx) && !/^\s/.test(nx)))
                    break;
                j++;
            }
            push("list", i, j);
            i = j + 1;
            continue;
        }
        if ((m = line.match(RE.html))) {
            let j = i;
            while (j + 1 < lines.length && !RE.blank.test(lines[j + 1]))
                j++;
            push("html", i, j);
            i = j + 1;
            continue;
        }
        // 段落（含 setext 标题）
        let j = i;
        while (j + 1 < lines.length) {
            const nx = lines[j + 1];
            if (RE.blank.test(nx) || RE.heading.test(nx) || RE.fence.test(nx) || RE.quote.test(nx) || RE.mathOpen.test(nx))
                break;
            if (/^ {0,3}(=+|-+)\s*$/.test(nx)) {
                push("heading", i, j + 1, { level: nx.trim()[0] === "=" ? 1 : 2 });
                j = -1;
                break;
            }
            if (RE.hr.test(nx) || (RE.list.test(nx) && !/^\s/.test(nx)))
                break;
            j++;
        }
        if (j === -1) {
            i = blocks[blocks.length - 1].end + 1;
            continue;
        }
        const t = lines.slice(i, j + 1).join("\n");
        push(RE.toc.test(t) ? "toc" : (RE.image.test(t) || /^\s*!\[[^\]\n]+\](?:\[[^\]\n]*\])?\s*$/.test(t) && sourceImages(t, text).length === 1) ? "image" : "paragraph", i, j);
        i = j + 1;
    }
    return blocks;
}

/** 能被题注 / 页签组收纳的内容块 */
/** 去掉 Markdown 转义符（\\< → <） */
function unescapeMd(s: string): string {
    return s.replace(/\\([\\`*_{}[\]()#+\-.!<>|~^=])/g, "$1");
}

function captionKind(b: Block, source?: string): CaptionInfo["kind"] | null {
    switch (b.type) {
        case "table": return "table";
        case "code": return "codeblock";
        case "math": return "formula";
        case "mermaid": return "figure";
        case "paragraph": return mediaType(b,source)?'media':figureSources(b,source||b.text).length?'figure':null;
        case "image": {
            if(mediaType(b,source))return 'media';
            return figureSources(b,source||b.text).length?'figure':null;
        }
        case "html": return mediaType(b,source) ? "media" : figureSources(b,source||b.text).length ? "figure" : null;
        default: return null;
    }
}

function mediaTypes(b: Block, source?: string): ('audio' | 'video')[] {
    return mediaSources(b,source || b.text).map(ref=>ref.type);
}
function mediaType(b: Block, source?: string): 'audio' | 'video' | undefined { return mediaTypes(b,source)[0]; }

export class SourceIndex {
    readonly blocks: Block[];
    private byLine = new Map<number, number>();
    readonly frontmatter: Record<string, string> = {};

    constructor(readonly text: string, opts: IndexOptions) {
        this.blocks = scanBlocks(text);
        this.blocks.forEach((b, idx) => {
            for (let l = b.start; l <= b.end; l++)
                this.byLine.set(l, idx);
        });
        this.parseFrontmatter();
        this.markCover();
        this.numberHeaders(opts.headerEnabled === false ? undefined : this.frontmatter["vlook-header-autonum"] ?? opts.headerTemplate);
        const query = vlookQueryParams(this.frontmatter["vlook-query"] || "");
        this.markCaptions({...opts,
            captionGroup:query.has("capgroup") ? query.get("capgroup")?.toLowerCase() !== "off" : opts.captionGroup,
            captionNumber:query.has("capnum") ? query.get("capnum")?.toLowerCase() !== "off" : opts.captionNumber,
        });
        this.markTabGroups();
        this.markColumns();
        this.markUnpublished();
    }

    /** 不发布的章节：标题为删除线 ~~标题~~，或 YAML vlook-unpub 指定的标题 */
    private markUnpublished() {
        if(vlookQueryParams(this.frontmatter["vlook-query"]||"").get("unpub")?.toLowerCase()==="off")return;
        const matches=unpublishedMatcher(this.frontmatter["vlook-unpub"]);
        let unpubLevel = 0;
        for (const b of this.blocks) {
            if (b.type === "heading") {
                const title = headingSource(b.text);
                if (unpubLevel && b.level! <= unpubLevel) unpubLevel = 0;
                if (!unpubLevel && (hasDirectStrike(title) || matches(headingPlain(b.text))))
                    unpubLevel = b.level!;
            }
            if (unpubLevel) b.unpub = true;
        }
    }

    blockAt(line: number): Block | undefined {
        const i = this.byLine.get(line);
        return i === undefined ? undefined : this.blocks[i];
    }

    indexOf(b: Block): number {
        return this.blocks.indexOf(b);
    }

    private parseFrontmatter() {
        const fm = this.blocks[0]?.type === "frontmatter" ? this.blocks[0] : null;
        if (!fm)
            return;
        {
            const parsed=parseFrontmatterYaml(fm.text.split("\n").slice(1,-1).join("\n"));
            for(const [key,value] of Object.entries(parsed)){
                if(typeof value==="string")this.frontmatter[key]=value;
                else if(typeof value==="number"||typeof value==="boolean")this.frontmatter[key]=String(value);
                else if((key==="vlook-unpub"||key==="vlook-header-dup")&&Array.isArray(value)&&value.every(item=>typeof item==="string"))
                    this.frontmatter[key]=value.join(";");
            }
        }
    }

    private contentBlocks(): Block[] {
        return this.blocks.filter(b => b.type !== "frontmatter" && b.type !== "toc");
    }

    private markCover() {
        const content = this.contentBlocks();
        const first = content[0], last = content[content.length - 1];
        if (first?.type === "heading" && first.level === 6)
            first.cover = "front";
        if (last && last !== first && last.type === "heading" && last.level === 1)
            last.cover = "back";
    }

    private numberHeaders(tpl?: string) {
        const template: HeaderTemplate | null = parseHeaderTemplate(tpl);
        const numberer = new HeaderNumberer(template);
        let chapter = "";
        for (const b of this.blocks) {
            if (b.type === "heading" && b.level! <= 5 && !b.cover) {
                const r = numberer.next(b.level!);
                if (template) {
                    b.headerNum = r.text;
                    b.headerNumNormal = r.normal;
                }
                chapter = template ? r.normal : "";
            } else if (b.type === "heading" && b.level === 6 && !b.cover && template) {
                b.headerNum = numberer.h6Prefix();
            }
            b.chapter = chapter;
        }
    }

    private markCaptions(opts: IndexOptions) {
        const counters: Record<string, number> = {};
        const lastChapter: Record<string, string> = {};
        const chapterBase: Record<string, number> = {};
        // The original runtime processes native audio/video tags before image-style media.
        const containers = new Set(['html','table','blockquote','callout','list','paragraph','image']);
        for(const block of this.blocks)if(containers.has(block.type))for(const media of mediaSources(block,this.text)){
            if(!media.native)continue;
            const key=`media-${media.type}`;counters[key]=(counters[key]||0)+1;
        }
        const nextInfo = (b: Block, kind: CaptionInfo['kind'], subtype?: 'audio'|'video', native = false): CaptionInfo => {
            const key = kind === 'media' ? `${native?'native-':''}media-${subtype}` : kind;
            counters[key] = (counters[key] || 0) + 1;
            const counter = counters[key];
            let num = String(counter);
            if (opts.captionGroup && b.chapter && !native) {
                const group = b.chapter.replace(/[.,、|\-\s]+$/, '');
                if (lastChapter[key] !== group) { lastChapter[key] = group; chapterBase[key] = counter - 1; }
                num = `${group}-${counter - chapterBase[key]}`;
            }
            const info: CaptionInfo = {kind,counter,num:opts.captionNumber?num:''};
            if(subtype)info.mediaType=subtype;
            return info;
        };
        this.blocks.forEach((b, i) => {
            const kind = captionKind(b, this.text);
            if (kind === 'media' || containers.has(b.type)) {
                b.mediaCaptions = mediaSources(b,this.text).map(ref=>nextInfo(b,'media',ref.type,ref.native));
            }
            const figures=figureSources(b,this.text);
            if(figures.length)b.figureCaptions=figures.map(()=>nextInfo(b,'figure'));
            assignNestedCaptions(b,this.text);
            if (!kind) return;
            const infos = kind === 'media' ? b.mediaCaptions! : kind === 'figure' && b.figureCaptions?.length ? b.figureCaptions : [nextInfo(b,kind)];
            const info=infos[0];
            if(!info)return;
            if(kind==='media')b.mediaCaptions=infos;
            // 前一个块为题注语法段落
            const prev = this.blocks[i - 1];
            const m = prev && prev.type === "paragraph" && prev.end === prev.start ? prev.text.match(RE.caption) : null;
            const media=kind==='media'?mediaSources(b,this.text):[];
            const leading = kind==='figure'||kind==='media' ? [
                ...figures.map((ref,n)=>({ref,info:b.figureCaptions![n]})),
                ...media.map((ref,n)=>({ref,info:b.mediaCaptions![n]})),
            ].sort((a,b)=>a.ref.pos-b.ref.pos)[0] : undefined;
            const recipient=leading?.info||info;
            if (m && prev.end + 1 >= b.start - 1 && !leading?.ref.alt.trim()) {
                const inner = m[2];
                const m2 = inner.match(/^(.*?)_(.+)_$/);
                recipient.cap1 = unescapeMd((m2 ? m2[1] : inner).trim());
                if (m2)
                    recipient.cap2 = unescapeMd(m2[2].trim());
                prev.captionFor = i;
            }
            b.caption = info;
        });
    }

    private markTabGroups() {
        let id = 0;
        this.blocks.forEach((b, i) => {
            if (b.type !== "paragraph" || b.start !== b.end || !RE.tabMarker.test(b.text))
                return;
            // 收集后续连续的可收纳内容（题注段落随内容一起）
            const members: number[] = [];
            for (let j = i + 1; j < this.blocks.length; j++) {
                const nb = this.blocks[j];
                if (nb.captionFor !== undefined)
                    continue;
                const ok = captionKind(nb, this.text) !== null || nb.type === "callout"
                    || (nb.type === "blockquote" && /^\s*>\s*(\*\*|==)[^\n]*(\*\*|==)\s*$/m.test(nb.text.split("\n")[0]));
                if (!ok)
                    break;
                members.push(j);
            }
            if (members.length < 2)
                return;
            id++;
            b.tabMarker = { id, count: members.length };
            members.forEach((j, k) => {
                this.blocks[j].tabGroup = { id, index: k + 1, count: members.length };
                const cap = this.blocks[j - 1];
                if (cap && cap.captionFor === j)
                    cap.tabGroup = { id, index: k + 1, count: members.length };
            });
        });
    }

    private markColumns() {
        let group = 0;
        for (let i = 0; i < this.blocks.length; i++) {
            const b = this.blocks[i];
            if (b.type !== "hr")
                continue;
            // 连续的 hr 数量 = 列数 - 1
            let j = i;
            while (j + 1 < this.blocks.length && this.blocks[j + 1].type === "hr")
                j++;
            const count = j - i + 2;
            const next = this.blocks[j + 1];
            if (!next) { i = j; continue; }
            if (next.type === "list") {
                group++;
                for (let k = i; k <= j; k++) this.blocks[k].columnMarker = count;
                next.columns = { group, count, index: 1, kind: "list" };
            } else if (next.type === "blockquote" || next.type === "callout") {
                group++;
                for (let k = i; k <= j; k++) this.blocks[k].columnMarker = count;
                let idx = 0;
                for (let k = j + 1; k < this.blocks.length && (this.blocks[k].type === "blockquote" || this.blocks[k].type === "callout"); k++)
                    this.blocks[k].columns = { group, count, index: ++idx, kind: "quote" };
            }
            i = j;
        }
    }
}

// ---- 缓存：同一篇文档在一次渲染中会被多个块重复使用；多个视图交替渲染时保留最近几篇 ----
const CACHED_DOCUMENTS = 4;
const cache = new Map<string, Map<string, SourceIndex>>();

export function getSourceIndex(text: string, opts: IndexOptions): SourceIndex {
    const key = JSON.stringify(opts);
    const entries = cache.get(text) ?? new Map<string, SourceIndex>();
    let index = entries.get(key);
    if (!index) { index = new SourceIndex(text, opts); entries.set(key, index); }
    cache.delete(text); cache.set(text, entries);
    if (cache.size > CACHED_DOCUMENTS) cache.delete(cache.keys().next().value!);
    return index;
}
