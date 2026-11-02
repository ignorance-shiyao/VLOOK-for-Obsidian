import {MarkdownRenderer,type App,type Component} from 'obsidian';

/** Route VLOOK/GitLab math fences through the host's MathJax, preserving TeX. */
export async function renderMathFence(app:App,source:string,el:HTMLElement,path:string,component:Component):Promise<void> {
    el.dataset.vlookMathFence='1';
    await MarkdownRenderer.render(app,`<!--vlook-raw-render-->\n$$\n${source}\n$$`,el,path,component);
}
