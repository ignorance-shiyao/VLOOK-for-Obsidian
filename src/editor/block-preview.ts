import {renderZenUmlFallback} from '../features/zenuml-fallback';
import { editorThemeRevision, currentEditorTheme } from './theme-refresh';
import { sourceDiagramCount, waitForDiagrams } from '../preview/diagram-ready';
import { sourceMathFenceCount, waitForMath } from '../preview/math-ready';
import { pauseContainedMedia } from '../core/media-handoff';
import { mediaSources } from '../core/media-source';
// 块级实时预览使用 StateField（ViewPlugin 的装饰器不能替换整块）。
// 索引来自全文，渲染按块复用阅读视图流水线；进入选区即可恢复原文编辑。
import { Prec, StateField, type EditorState } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { Component, MarkdownRenderer, editorInfoField, editorLivePreviewField } from "obsidian";
import type VlookPlugin from "../main";
import { getSourceIndex, type Block, type SourceIndex } from "../core/source-index";
import { Query, readCssVar, type VlookSettings } from "../core/context";
import { referenceDefinitionsSource } from "../core/image-source";
import { renderSection } from "../render";
import { sourceTasks } from "../core/task-source";

export interface BlockPreviewPlan { start: number; end: number; blocks: Block[] }

export function blockPreviewPlans(index: SourceIndex, settings: VlookSettings): BlockPreviewPlan[] {
    const plans: BlockPreviewPlan[] = [];
    const blocks = index.blocks;
    for (let i = 0; i < blocks.length; i++) {
        const b = blocks[i];
        let last = i;
        if (settings.tabGroups && b.tabMarker) {
            const id = b.tabMarker.id;
            while (last + 1 < blocks.length && blocks[last + 1].tabGroup?.id === id) last++;
        } else if (settings.columns && b.columnMarker) {
            while (last + 1 < blocks.length && blocks[last + 1].columnMarker) last++;
            const group = blocks[last + 1]?.columns?.group;
            if (group !== undefined) while (last + 1 < blocks.length && blocks[last + 1].columns?.group === group) last++;
        } else if (settings.captions && b.captionFor !== undefined) {
            last = b.captionFor;
        } else if (!(b.type === "table" || b.type === "blockquote" || b.type === "callout" || b.type === "toc"
            || b.type === "image" || b.type === "mermaid" || b.type === "math" || b.type === "code"
            || (['paragraph','html','list'].includes(b.type) && (!!b.figureCaptions?.length || !!b.mediaCaptions?.length || mediaSources(b,index.text,undefined,true).length>0))
            || (b.type === "paragraph" && ((b.text.trim() === "---page" || /<(?:kbd|u)\b/i.test(b.text)) || /[*_]==[^\n]+==[*_]/.test(b.text)))
            || (settings.cover && (b.cover || (b.type === "frontmatter" && index.frontmatter.title && !blocks.some(x => x.cover === "front"))))
            || (settings.captions && b.caption?.cap1))) continue;
        plans.push({start:b.start, end:blocks[last].end, blocks:blocks.slice(i, last + 1)});
        i = last;
    }
    return plans;
}

const coverStates = new WeakSet<EditorState>();
const liveBlocks = new WeakMap<HTMLElement, {component:Component; disposed:boolean}>();

class BlockWidget extends WidgetType {
    constructor(private plugin: VlookPlugin, private plan: BlockPreviewPlan, private index: SourceIndex,
        private sourcePath: string, private from: number, private key: string) { super(); }
    eq(other: BlockWidget) { return this.plugin === other.plugin && this.key === other.key && this.from === other.from && this.sourcePath === other.sourcePath; }
    toDOM(view: EditorView) {
        const doc = view.dom?.ownerDocument || document;
        const cssVar = (name:string) => readCssVar(name,doc.body);
        const themeQuery = new Query(cssVar("--vlook-query"));
        const index = getSourceIndex(this.index.text, {headerEnabled:this.plugin.settings.headerAutoNum,
            headerTemplate:cssVar("--vlook-header-autonum") || undefined,
            captionGroup:themeQuery.get("capgroup") !== "off",captionNumber:themeQuery.get("capnum") !== "off"});
        const host = doc.createElement("div");
        host.className = "markdown-rendered vlook-editor-block";
        const body = doc.createElement("div");
        body.className = "vlook-editor-render";
        host.append(body);
        const component = new Component(); component.load();
        const controller=new host.ownerDocument.defaultView!.AbortController();component.register(()=>controller.abort());
        const life = {component, disposed:false}; liveBlocks.set(host, life);
        host.tabIndex=0;
        host.setAttribute('role','group');
        const editBlock=(target:Element|null)=>{
            if(life.disposed)return;
            const section=sections.find(({el})=>target&&el.contains(target));
            const line=section ? section.block.start+1 : this.plan.start+1;
            const anchor=view.state.doc.line(Math.min(line,view.state.doc.lines)).from;
            view.dispatch({selection:{anchor},scrollIntoView:true});view.focus();
        };
        const onDoubleClick=(event:MouseEvent)=>{
            const target=event.target instanceof doc.defaultView!.Element?event.target:null;
            const interactive=target?.closest('a,button,input,select,textarea,audio,video,[role="button"],[role="tab"],[contenteditable="true"]');
            if(interactive&&host.contains(interactive))return;
            event.preventDefault();event.stopPropagation();editBlock(target);
        };
        host.addEventListener('dblclick',onDoubleClick,{capture:true});
        // Obsidian can consume editor events before the widget's own capture phase.
        const documentDouble=(event:MouseEvent)=>{if(event.target instanceof doc.defaultView!.Node&&host.contains(event.target))onDoubleClick(event);};
        doc.addEventListener('dblclick',documentDouble,true);
        component.register(()=>doc.removeEventListener('dblclick',documentDouble,true));
        host.addEventListener('keydown',event=>{
            if(event.target!==host||event.key!=='Enter')return;
            event.preventDefault();event.stopPropagation();editBlock(host);
        });
        const sections = this.plan.blocks.map(planned => {
            const block = index.blockAt(planned.start) || planned;
            const el = doc.createElement("div"); el.className = "vlook-editor-section";
            body.append(el); return {block, el};
        });
        const query = new Query(cssVar("--vlook-query"), index.frontmatter["vlook-query"]);
        const definitions=referenceDefinitionsSource(index.text);
        void (async () => {
            for (const {block, el} of sections) {
                if (life.disposed) return;
                if (block.type !== "frontmatter") await MarkdownRenderer.render(this.plugin.app, `<!--vlook-raw-render-->\n${block.text}\n\n${definitions}`, el, this.sourcePath, component);
                if (life.disposed) {pauseContainedMedia(el);el.replaceChildren();return;}
                await renderZenUmlFallback(el,component,undefined,block.text);
                await Promise.all([waitForDiagrams(el,15000,100,sourceDiagramCount(block.text),controller.signal),waitForMath(el,15000,100,controller.signal,sourceMathFenceCount(block.text))]);
                if (life.disposed) {pauseContainedMedia(el);el.replaceChildren();return;}
                renderSection(el, {app:this.plugin.app, settings:this.plugin.settings, sourcePath:this.sourcePath,
                    block, index, query, cssVar, resourceHistory:this.plugin.resourceHistory, registerCleanup:cleanup=>component.register(cleanup)});
                // Renderer 生成的任务复选框没有编辑器源码绑定；按源码行回写，避免只修改预览 DOM。
                const tasks = sourceTasks(block.text);
                el.querySelectorAll<HTMLInputElement>("input.task-list-item-checkbox").forEach((input, i) => {
                    const task = tasks[i]; if (!task) return;
                    input.disabled = false;
                    input.addEventListener("click", event => {
                        event.preventDefault(); event.stopImmediatePropagation();
                        const number=block.start+task.line+1;
                        if(number>view.state.doc.lines)return;
                        const line = view.state.doc.line(number);
                        const original=block.text.split("\n")[task.line].replace(/\r$/,"");
                        if(line.text.slice(0,task.ch)!==original.slice(0,task.ch)||line.text.slice(task.ch+1)!==original.slice(task.ch+1)||!/[ xX]/.test(line.text[task.ch]||""))return;
                        const from = line.from + task.ch;
                        view.dispatch({changes:{from, to:from + 1, insert:line.text[task.ch] === " " ? "x" : " "}});
                    }, {capture:true});
                });
            }
            view.requestMeasure();
        })().catch(error => {
            pauseContainedMedia(body);
            if (life.disposed) {body.replaceChildren();return;}
            body.textContent = `VLOOK 区块渲染失败：${error.message || error}`;
            console.error("[VLOOK] editor block", error);
            view.requestMeasure();
        });
        return host;
    }
    destroy(dom: HTMLElement) {
        const life = liveBlocks.get(dom);
        if (life) { life.disposed = true; life.component.unload(); liveBlocks.delete(dom); }
    }
    ignoreEvent() { return true; }
}

export function blockPreviewExtension(plugin: VlookPlugin) {
    const build = (state: EditorState): DecorationSet => {
        if (!plugin.settings.livePreview || !state.field(editorLivePreviewField, false)) return Decoration.none;
        const sourcePath = state.field(editorInfoField, false)?.file?.path || "";
        const source = state.doc.toString();
        const theme = currentEditorTheme(state);
        const query = new Query(theme.query);
        const index = getSourceIndex(source, {headerEnabled:plugin.settings.headerAutoNum, headerTemplate:theme.headerTemplate || undefined,
            captionGroup:query.get("capgroup") !== "off", captionNumber:query.get("capnum") !== "off"});
        const documentQuery = new Query(theme.query, index.frontmatter["vlook-query"]);
        const ranges = [];
        const replaced: {start:number;end:number}[] = [];
        // 区块只在自身内容、位置、全局设置或引用定义变化时重建；其他区块的普通编辑不打断媒体播放与交互状态
        const baseKey = JSON.stringify(plugin.settings) + ":" + (state.field(editorThemeRevision,false)||0) + ":" + referenceDefinitionsSource(source);
        for (const plan of blockPreviewPlans(index, plugin.settings)) {
            const from = state.doc.line(plan.start + 1).from, to = state.doc.line(plan.end + 1).to;
            const key = baseKey + JSON.stringify(plan);
            // 文档初开时光标停在 0，不应让封面退回 YAML 原文
            const cover = plan.blocks[0].type === "frontmatter";
            if (state.selection.ranges.some(r => cover ? r.to > from && r.from <= to && !(r.empty && r.from === from) : r.from <= to && r.to >= from)) continue;
            replaced.push({start:plan.start,end:plan.end});
            if (cover) {
                // YAML 区由 Obsidian 的属性容器接管，封面挂在其后，并隐藏该容器
                const after = plan.end + 2 <= state.doc.lines;
                const at = after ? state.doc.line(plan.end + 2).from : state.doc.length;
                ranges.push(Decoration.widget({block:true, side:after ? -1 : 1, widget:new BlockWidget(plugin, plan, index, sourcePath, from, key)}).range(at));
                coverStates.add(state);
                for (let line=plan.start;line<=plan.end;line++) ranges.push(Decoration.line({class:"vlook-fm-hidden"}).range(state.doc.line(line+1).from));
                continue;
            }
            // 全文索引变化会影响跨块编号、页签与题注，必须刷新已存在的 widget。
            ranges.push(Decoration.replace({block:true, widget:new BlockWidget(plugin, plan, index, sourcePath, from, key)}).range(from, to));
        }
        let replacementIndex = 0;
        for (const block of index.blocks) {
            const unpublished = block.unpub && documentQuery.get("unpub") !== "off";
            for (let line=block.start;line<=block.end;line++) {
                // 替换区块由阅读流水线提示；只为仍可编辑的源码行添加装饰。
                while (replacementIndex < replaced.length && replaced[replacementIndex].end < line) replacementIndex++;
                if (replacementIndex < replaced.length && line >= replaced[replacementIndex].start) continue;
                const attrs: Record<string, string> = {};
                if (line===block.start && block.type === "heading" && !block.cover && plugin.settings.headerAutoNum && block.headerNum)
                    attrs["data-vlook-header-num"] = block.headerNum;
                if (unpublished) attrs["class"] = "vlook-unpub";
                if (Object.keys(attrs).length) ranges.push(Decoration.line({attributes:attrs}).range(state.doc.line(line+1).from));
            }
        }
        return Decoration.set(ranges, true);
    };
    return StateField.define<DecorationSet>({create:build, update:(_old, tr) => build(tr.state), provide:f => [Prec.highest(EditorView.decorations.from(f)),
        EditorView.editorAttributes.compute([f], state => (coverStates.has(state) ? {class:"vlook-fm-cover"} : {}) as Record<string, string>)]});
}
