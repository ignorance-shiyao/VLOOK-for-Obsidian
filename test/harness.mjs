// 测试工具：用 esbuild 打包被测源码，在 jsdom 中运行
import esbuild from "esbuild";
import { JSDOM } from "jsdom";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export async function setup() {
    const dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true });
    const g = globalThis;
    for (const k of ["window", "document", "Node", "NodeFilter", "HTMLElement", "Element", "Text", "DOMParser", "getComputedStyle", "requestAnimationFrame", "navigator"]) {
        try { g[k] = k === "window" ? dom.window : dom.window[k]; } catch { /* navigator 只读 */ }
    }
    // Obsidian 为 Node 提供的跨窗口类型检查
    dom.window.Node.prototype.instanceOf = function (type) { return this instanceof type; };
    // Obsidian 提供的全局元素构造函数
    g.createDiv = () => dom.window.document.createElement("div");
    g.createSpan = () => dom.window.document.createElement("span");
    g.createEl = (tag) => dom.window.document.createElement(tag);
    g.createFragment = () => dom.window.document.createDocumentFragment();
    // Obsidian 提供的当前窗口全局
    g.activeDocument = dom.window.document; g.activeWindow = dom.window;
    const result = await esbuild.build({
        entryPoints: [path.join(here, "entry.ts")],
        bundle: true, write: false, format: "esm", platform: "neutral",
        loader: { ".txt": "text", ".css": "text" },
        plugins: [{
            name: "stub-obsidian",
            setup(b) {
                b.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "stub" }));
                b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: `import {getFrontMatterInfo} from "./frontmatter-stub"; export {getFrontMatterInfo}; import {parse as yamlParse} from "yaml"; import { StateField } from "@codemirror/state"; export const requestUrl = async ({ url }) => { const r = await window.fetch(url); return { status: r.status, text: await r.text(), arrayBuffer: new ArrayBuffer(0) }; }; export const getLanguage = () => { try { return globalThis.localStorage?.getItem("language") || "en"; } catch { return "en"; } }; export const editorLivePreviewField = StateField.define({create:()=>true,update:v=>v}); export const editorInfoField = StateField.define({create:()=>({file:{path:"test.md"}}),update:v=>v}); export class View {}; export class Component { static instances = []; constructor(){Component.instances.push(this)} load(){this.loaded=true} register(fn){(this.cleanups||=[]).push(fn)} unload(){this.loaded=false;for(const fn of this.cleanups||[])fn();this.cleanups=[]} }; export class FuzzySuggestModal {static last=null; constructor(app){this.app=app} setPlaceholder(){} open(){FuzzySuggestModal.last=this} }; export class Modal { constructor(app){this.app=app;this.contentEl=document.createElement('div');this.titleEl=document.createElement('h2')} open(){document.body.append(this.titleEl,this.contentEl);this.onOpen?.()} close(){this.onClose?.();this.titleEl.remove();this.contentEl.remove()} }; export class Setting { constructor(el){this.el=el} addButton(fn){const el=document.createElement('button');this.el.append(el);const button={setButtonText(t){el.textContent=t;return this},setIcon(){return this},setCta(){return this},onClick(fn){el.addEventListener('click',fn);return this}};fn(button);return this} }; export class MarkdownView {}; export class ItemView {}; export class FileView {}; export class Menu { static instances=[]; constructor(){this.items=[];Menu.instances.push(this)} addItem(fn){const item={setTitle(value){this.title=value;return this},setChecked(value){this.checked=value;return this},setIcon(){return this},onClick(fn){this.callback=fn;return this}};fn(item);this.items.push(item);return this} addSeparator(){return this} showAtMouseEvent(event){this.event=event} }; export const setIcon=()=>{}; export const getIcon=()=>null; export class TFile {}; export class TFolder {}; export const debounce=fn=>fn; export const normalizePath=p=>p; export const Platform={isDesktopApp:true}; export const renderMath=(tex,display)=>{const c=document.createElement('mjx-container');if(display)c.setAttribute('display','true');c.dataset.tex=tex;return c}; export const finishRenderMath=async()=>{}; export const parseYaml = yamlParse; export class Notice {}; export const MarkdownRenderer = {async render(_app, source, el){el.textContent=source}};`, resolveDir: here, loader: "js" }));
            },
        }],
    });
    const code = result.outputFiles[0].text;
    const url = "data:text/javascript;base64," + Buffer.from(code).toString("base64");
    return await import(url);
}

export function html(s) {
    const div = document.createElement("div");
    div.innerHTML = s.trim();
    // 与 Obsidian 后处理器一致：渲染时块元素尚未挂到文档上
    return div;
}

/** 自绘下拉选择器的测试句柄：value 读写与原生 select 一致（写入即点击对应选项）。 */
export function dropdown(root, label) {
    const el = typeof label === "number" ? root.querySelectorAll(".vlook-dropdown")[label] : root.querySelector(`[aria-label="${label}"]`)?.closest(".vlook-dropdown");
    const items = () => [...el.querySelectorAll('[role="option"]')];
    return {
        el,
        get options() { return items(); },
        get value() { return items().find(o => o.getAttribute("aria-selected") === "true")?.dataset.value; },
        set value(v) { items().find(o => o.dataset.value === v)?.click(); },
    };
}

/** ZenUML 渲染器单独成包：测试里按需构建一份（与 esbuild.config.mjs 的 zenuml.js 同源）。 */
let zenumlCode;
export async function zenumlChunkCode() {
    zenumlCode ??= esbuild.build({ entryPoints: [path.join(here, "../src/zenuml-chunk.ts")], bundle: true, format: "cjs", target: "es2020", write: false, logLevel: "silent" }).then(r => r.outputFiles[0].text);
    return zenumlCode;
}
