import { viewMenuItem, viewMenuSection } from "./view-menu";
// 阅读视图代码块内容助手；保留原语法高亮 DOM，复制始终取原始文本。
import type { RenderCtx } from "../core/context";
import {bindCodeLine} from './code-line';

export function processCodeBlocks(root: HTMLElement, ctx: RenderCtx): void {
    root.querySelectorAll<HTMLElement>("pre").forEach(pre => {
        const code = pre.querySelector<HTMLElement>(":scope > code");
        if (!code || pre.dataset.vlookCode || pre.closest(".mermaid")) return;
        pre.dataset.vlookCode = "1";
        const source = code.textContent || "";
        const tools = viewMenuSection(pre, "vlook-code-tools", "代码操作", 3);
        let expandButton:HTMLButtonElement|undefined;
        const icons: Record<string, string> = {"复制代码":"copy","自动换行":"wrap-text","展开代码":"chevrons-up-down"};
        const button = (text: string, action: (b: HTMLButtonElement) => void) => viewMenuItem(tools, text, icons[text] || "code", action);
        const relabel = (b: HTMLButtonElement, text: string) => { b.querySelector(".vlook-view-label")!.textContent = text; b.setAttribute("aria-label", text); b.title = text; };
        button("复制代码", async b => {
            try {
                await navigator.clipboard.writeText(source);
                relabel(b, "已复制");
            } catch {
                const selection=code.ownerDocument.getSelection();
                if(selection&&code.isConnected){
                    pre.classList.remove('vlook-code-collapsed');
                    if(expandButton){relabel(expandButton,'折叠代码');expandButton.setAttribute('aria-expanded','true');}
                    const range=code.ownerDocument.createRange();range.selectNodeContents(code);
                    selection.removeAllRanges();selection.addRange(range);
                    relabel(b,"已选中");
                }else relabel(b,"复制失败");
            }
        });
        pre.classList.add("vlook-code-wrap");
        const wrapButton=button("自动换行", b => {
            const wrapped = pre.classList.toggle("vlook-code-wrap");
            relabel(b, wrapped ? "自动换行" : "横向滚动");
            b.setAttribute("aria-pressed", String(wrapped));
        });
        wrapButton.setAttribute('aria-pressed','true');
        if (source.trimEnd().split("\n").length > 20) {
            pre.classList.add("vlook-code-collapsed");
            expandButton=button("展开代码", b => {
                const collapsed = pre.classList.toggle("vlook-code-collapsed");
                relabel(b, collapsed ? "展开代码" : "折叠代码");
                b.setAttribute("aria-expanded", String(!collapsed));
            });
            expandButton.setAttribute('aria-expanded','false');
        }
        const cleanup=bindCodeLine(pre,code);ctx.registerCleanup?.(cleanup);
    });
}
