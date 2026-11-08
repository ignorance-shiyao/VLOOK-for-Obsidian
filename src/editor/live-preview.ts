import { editorThemeRevision, currentEditorTheme } from './theme-refresh';
import {buildProgress,progressValue} from '../features/inline-extras';
import {literalRanges} from './literal-blocks';
// 实时预览（编辑模式）中的行内语法渲染：光标不在该语法范围内时显示渲染效果
// 支持：标签 *`标签`*、多级标签 *名称`值`值2*、色号 _~Rd~_（含行首整段着色）、进度条 **==50==**、刮刮卡 *提示**内容***、
// 注音 字_^zì^_ / `{文字}(注音)`、通用下标 ~x~ / 上标 ^x^

import { Prec, RangeSetBuilder, StateField, type EditorState } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { editorInfoField, editorLivePreviewField } from "obsidian";
import type VlookPlugin from "../main";
import { sourceTaskProgress } from '../core/task-source';
import { getSourceIndex } from "../core/source-index";
import { COLOR_CODE, COLOR_TOO_LIGHT, gradColors, isSolid, splitColors } from "../core/color";
import { buildBadge, buildScratchCard, buildTag } from "../features/code-magic";
import { Query, readCssVar } from "../core/context";
import { openPhoneticLookup } from "../features/sup-sub-magic";

import { newEl } from '../core/dom';
const C = `(?:${COLOR_CODE})+!?`;
const RE_TAG = new RegExp(String.raw`(?<![*\w])([*_])\`([^\`\n]+)\`\1(?:_~(${C})~_)?`, "gi");
const RE_BADGE = new RegExp(String.raw`(?<![*\w])([*_])([^*_\`\n]*)\`([^\`\n]+)\`([^*_\`\n]*)\1(?:_~(${C})~_)?`, "gi");
const RE_PROGRESS = new RegExp(String.raw`\*\*==([-+]?\d+(?:\.\d+)?|[?？])==\*\*(?:_~(${C})~_)?`, 'gi');
const RE_SCRATCH = new RegExp(String.raw`(?<!\*)\*([^*\n]*)\*\*([^*\n]+)\*\*\*(?:_~(${C})~_)?`, "gi");
const RE_PHONETIC = /([^\s_*\\])_\^([^^\n]+)\^_/g;
const RE_PHONETIC_CODE = /`\{([^}`\n]+)\}\(([^)`\n]+)\)`/g;
const RE_LINE_COLOR = new RegExp(String.raw`^(\s*(?:>\s*)*)_~(${C})~_\s*`, "i");
const RE_SUB = /(?<![~_])~([^\s~_](?:[^~\n]*[^\s~_])?)~(?![~_])/g;
const RE_SUP = /(?<![\^_[])\^([^\s^_[\]](?:[^^\n[\]]*[^\s^_[\]])?)\^(?![_\]])/g;
const RE_COLOR = new RegExp(String.raw`(\*\*[^*\n]+\*\*|==[^=\n]+==|(?<!\*)\*[^*\n]+\*(?!\*)|<u>[^<\n]+<\/u>)_~(${C})~_`, "gi");

function ctxFor(plugin: VlookPlugin, frontmatterQuery?: string, themeQuery = readCssVar("--vlook-query")) {
    return {
        app: plugin.app, settings: plugin.settings, sourcePath: plugin.app.workspace.getActiveFile()?.path || "",
        frontmatterQuery,
        themeRevision:0,
        query: new Query(themeQuery, frontmatterQuery),
        cssVar: (n: string) => readCssVar(n),
    };
}

function scopedContext(ctx: ReturnType<typeof ctxFor>, doc: Document) {
    return {...ctx, query:new Query(readCssVar("--vlook-query",doc.body),ctx.frontmatterQuery),
        cssVar:(name:string)=>readCssVar(name,doc.body)};
}

function colorStyle(color: string): string {
    if (isSolid(color)) return `color: var(--ac-${color}${COLOR_TOO_LIGHT.test(color) ? "-tt" : ""})`;
    return `background-image: linear-gradient(90deg,${gradColors(splitColors(color))}); -webkit-background-clip: text; background-clip: text; color: transparent`;
}

function colorEm(color?: string, doc: Document = activeDocument): HTMLElement | null {
    if (!color) return null;
    const em = newEl(doc, "em");
    em.replaceChildren(Object.assign(newEl(em.ownerDocument, 'sub'), {textContent: color}));
    return em;
}

class InlineWidget extends WidgetType {
    constructor(private key: string, private build: (doc:Document) => HTMLElement) { super(); }
    eq(other: InlineWidget) { return other.key === this.key; }
    toDOM(view?: EditorView) {
        const doc = view?.dom?.ownerDocument || activeDocument;
        const host = newEl(doc, "span");
        host.className = "markdown-rendered vlook-inline";
        host.append(this.build(doc));
        return host;
    }
    ignoreEvent() { return false; }
}

function renderInHost(doc: Document, fn: (host: HTMLElement) => void): HTMLElement {
    const box = newEl(doc, "span");
    fn(box);
    return box;
}

interface Hit { from: number; to: number; deco: Decoration }

function escapedAt(text:string,position:number):boolean {
    const code=text.charCodeAt(position);
    if(!((code>=33&&code<=47)||(code>=58&&code<=64)||(code>=91&&code<=96)||(code>=123&&code<=126)))return false;
    let slashes=0;
    for(let i=position-1;i>=0&&text[i]==='\\';i--)slashes++;
    return slashes%2===1;
}

function scanLine(text: string, offset: number, plugin: VlookPlugin, autoPercent: number | null = null, ctx = ctxFor(plugin), inlineCodes:{from:number;to:number}[]=[]): Hit[] {
    const contextKey = JSON.stringify([plugin.settings,ctx.frontmatterQuery,ctx.themeRevision]);
    const inlineWidget = (key:string, build:(doc:Document)=>HTMLElement) => new InlineWidget(`${key}:${contextKey}`,build);
    const hits: Hit[] = [];
    const taken: [number, number][] = [];
    const free = (a: number, b: number) => taken.every(([x, y]) => b <= x || a >= y);
    const add = (a: number, b: number, deco: Decoration,codeMagic=false,formatting=false) => {
        if (!free(a, b)||escapedAt(text,a)) return;
        const overlaps=inlineCodes.filter(code=>code.from<offset+b&&code.to>offset+a);
        if(codeMagic){
            if(!overlaps.length||overlaps.some(code=>code.from<offset+a||code.to>offset+b))return;
        }else if(overlaps.length&&(!formatting||overlaps.some(code=>code.from<offset+a||code.to>offset+b)))return;
        taken.push([a, b]);
        hits.push({ from: offset + a, to: offset + b, deco });
    };
    const addCode=(a:number,b:number,deco:Decoration)=>add(a,b,deco,true);
    let m: RegExpExecArray | null;

    RE_PROGRESS.lastIndex = 0;
    while ((m = RE_PROGRESS.exec(text))) {
        const color = m[2];
        const numeric = /[?？]/.test(m[1]) ? autoPercent : progressValue(m[1]);
        if (numeric === null) continue;
        const value = String(numeric);
        add(m.index, m.index + m[0].length, Decoration.replace({
            widget: inlineWidget(`pg:${m[0]}:${value}`, doc => renderInHost(doc, box => {
                const strong = newEl(doc, "strong");
                const label = newEl(doc, "label");
                if(color){
                    const code=color.toLowerCase().replace(/!$/, '');
                    strong.setAttribute('data-rb-text',code);
                    strong.style.color=`var(--ac-${code})`;
                }
                strong.append(label,value);
                buildProgress(strong,numeric);
                box.append(strong);
            })),
        }));
    }

    RE_SCRATCH.lastIndex = 0;
    while ((m = RE_SCRATCH.exec(text))) {
        const [all, tip, hidden, color] = m;
        if(escapedAt(text,m.index+1+tip.length+2+hidden.length))continue;
        add(m.index, m.index + all.length, Decoration.replace({
            widget: inlineWidget(`sc:${all}`, doc => renderInHost(doc, box => {
                const span = newEl(doc, "span");
                box.append(span);
                const c = colorEm(color, doc);
                if (c) box.append(c);
                buildScratchCard(span, tip.trim(), hidden, scopedContext(ctx,doc));
            })),
        }));
    }

    RE_TAG.lastIndex = 0;
    while ((m = RE_TAG.exec(text))) {
        const [all, , label, color] = m;
        addCode(m.index, m.index + all.length, Decoration.replace({
            widget: inlineWidget(`tag:${all}`, doc => renderInHost(doc, box => {
                const code = newEl(doc, "code");
                code.textContent = label;
                box.append(code);
                const c = colorEm(color, doc);
                if (c) box.append(c);
                buildTag(code, scopedContext(ctx,doc));
            })),
        }));
    }

    RE_BADGE.lastIndex = 0;
    while ((m = RE_BADGE.exec(text))) {
        const [all, , name, value, value2, color] = m;
        if (!name.trim() && !value2.trim()) continue;
        addCode(m.index, m.index + all.length, Decoration.replace({
            widget: inlineWidget(`bd:${all}`, doc => renderInHost(doc, box => {
                const span = newEl(doc, "span");
                box.append(span);
                const c = colorEm(color, doc);
                if (c) box.append(c);
                if (!name.trim()) buildBadge(span, "", value, value2.trim(), scopedContext(ctx,doc));
                else buildBadge(span, name.trim(), value, value2.trim() || undefined, scopedContext(ctx,doc));
            })),
        }));
    }

    RE_PHONETIC.lastIndex = 0;
    while ((m = RE_PHONETIC.exec(text))) {
        const [all, ch, sym] = m;
        add(m.index, m.index + all.length, Decoration.replace({
            widget: inlineWidget(`ph:${all}`, doc => renderInHost(doc, box => {
                const ruby = newEl(doc, "ruby");
                const rt = newEl(doc, "rt");
                rt.textContent = sym;
                rt.addEventListener("click", ev => openPhoneticLookup(ch, sym, ev));
                ruby.append(ch, rt);
                box.append(ruby);
            })),
        }));
    }

    // 代码式注音 `{文字}(注音)`
    RE_PHONETIC_CODE.lastIndex = 0;
    while ((m = RE_PHONETIC_CODE.exec(text))) {
        const [all, word, sym] = m;
        addCode(m.index, m.index + all.length, Decoration.replace({
            widget: inlineWidget(`pc:${all}`, doc => renderInHost(doc, box => {
                const ruby = newEl(doc, "ruby");
                const rt = newEl(doc, "rt");
                rt.textContent = sym;
                rt.addEventListener("click", ev => openPhoneticLookup(word, sym, ev));
                ruby.append(word, rt);
                box.append(ruby);
            })),
        }));
    }

    // 段落整体着色：行首（可在引用块内）的色号
    const lc = text.match(RE_LINE_COLOR);
    if (lc && text.length > lc[0].length) {
        const color = lc[2].toLowerCase().replace(/!$/, "");
        const start = lc[1].length;
        add(start, lc[0].length, Decoration.replace({}));
        add(lc[0].length, text.length, Decoration.mark({ attributes: { style: colorStyle(color) }, class: "vlook-lp-colored" }),false,true);
    }

    // 色号：给前面的格式文本着色，并隐藏色号本身
    RE_COLOR.lastIndex = 0;
    while ((m = RE_COLOR.exec(text))) {
        const [all, target, colorRaw] = m;
        const color = colorRaw.toLowerCase().replace(/!$/, "");
        const codeStart = m.index + target.length;
        if (!free(m.index, m.index + all.length)||escapedAt(text,m.index)) continue;
        add(m.index, codeStart, Decoration.mark({ attributes: { style: colorStyle(color) }, class: "vlook-lp-colored" }),false,true);
        add(codeStart, m.index + all.length, Decoration.replace({}));
    }

    // 通用下标 / 上标 ~x~ ^x^（Obsidian 原生不支持）
    if (plugin.settings.genericSubSup) {
        for (const [re, tag] of [[RE_SUB, "sub"], [RE_SUP, "sup"]] as const) {
            re.lastIndex = 0;
            while ((m = re.exec(text))) {
                const [all, inner] = m;
                if(escapedAt(text,m.index+all.length-1))continue;
                add(m.index, m.index + all.length, Decoration.replace({
                    widget: inlineWidget(`${tag}:${all}`, doc => renderInHost(doc, box => {
                        box.append(Object.assign(newEl(doc, tag), { textContent: inner }));
                    })),
                }));
            }
        }
    }
    return hits.sort((a, b) => a.from - b.from || a.to - b.to);
}

export function livePreviewExtension(plugin: VlookPlugin) {
    const build = (state: EditorState): DecorationSet => {
        const builder = new RangeSetBuilder<Decoration>();
        if (!plugin.settings.livePreview || !state.field(editorLivePreviewField, false)) return builder.finish();
        const index = getSourceIndex(state.doc.toString(), {captionGroup:false, captionNumber:false});
        const ctx = {...ctxFor(plugin,index.frontmatter["vlook-query"],currentEditorTheme(state).query), themeRevision:state.field(editorThemeRevision,false)||0, sourcePath:state.field(editorInfoField, false)?.file?.path || ""};
        const taskProgress=sourceTaskProgress(state.doc.toString());
        const literal=literalRanges(state.doc.toString()),literals=literal.blocks;
        let literalIndex=0,codeIndex=0;
        for (let number = 1; number <= state.doc.lines; number++) {
            const line = state.doc.line(number);
            if (!line.length || !/[*_~^`]/.test(line.text)) continue;
            while(literalIndex<literals.length&&literals[literalIndex].to<=line.from)literalIndex++;
            if(literals[literalIndex]?.from<=line.to)continue;
            const block = index.blockAt(number - 1);
            if (!block || ["code", "mermaid", "math", "frontmatter", "html", "image"].includes(block.type)) continue;
            if (state.selection.ranges.some(r => r.from <= line.to && r.to >= line.from)) continue;
            const percent = taskProgress.get(number-1)??null;
            while(codeIndex<literal.inline.length&&literal.inline[codeIndex].to<=line.from)codeIndex++;
            const codes=[];
            for(let i=codeIndex;i<literal.inline.length&&literal.inline[i].from<=line.to;i++)codes.push(literal.inline[i]);
            for (const hit of scanLine(line.text, line.from, plugin, percent, ctx,codes)) builder.add(hit.from, hit.to, hit.deco);
        }
        return builder.finish();
    };
    return StateField.define<DecorationSet>({create:build, update:(_old, tr) => build(tr.state), provide:f => Prec.highest(EditorView.decorations.from(f))});
}
