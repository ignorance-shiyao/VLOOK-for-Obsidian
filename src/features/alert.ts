// GitHub Style Alert：Obsidian 把 > [!NOTE] 渲染为 callout，
// 对 GSA 的 5 种类型转换为 Typora 的 .md-alert 结构，以套用 VLOOK 主题的 GSA 样式
// 移植自 vlook.js SupSubMagic_preprocess 中的 GSA 处理

import { h } from "../core/dom";
import { t } from "../core/i18n";

export const ALERT_TYPES: Record<string, { icon: string; key: "note" | "tip" | "important" | "warning" | "caution" }> = {
    note: { icon: "icoAlert-note", key: "note" },
    tip: { icon: "icoAlert-tip", key: "tip" },
    important: { icon: "icoAlert-important", key: "important" },
    warning: { icon: "icoAlert-warning", key: "warning" },
    caution: { icon: "icoAlert-Caution", key: "caution" },
};

export function processAlerts(root: HTMLElement): void {
    root.querySelectorAll<HTMLElement>(".callout[data-callout]").forEach(callout => {
        const type = (callout.dataset.callout || "").toLowerCase();
        const def = ALERT_TYPES[type];
        // 可折叠的 callout 保留 Obsidian 原生结构
        if (!def || callout.dataset.calloutFold) return;
        const titleInner = callout.querySelector(".callout-title-inner");
        const custom = (titleInner?.textContent || "").trim();
        const isDefaultTitle = !custom || custom.toLowerCase() === type;
        const alert = h("div", `md-alert md-alert-${type} ${type}`);
        const head = h("p");
        const label = h("span", `md-alert-text md-alert-text-${type}`,
            {}, `<svg width="16px" height="16px"><use xlink:href="#${def.icon}"></use></svg>`);
        label.append(isDefaultTitle ? t(def.key) : custom);
        head.append(label);
        alert.append(head);
        const content = callout.querySelector(".callout-content");
        if (content) alert.append(...Array.from(content.childNodes));
        // 保留可能存在的着色语法处理结果
        alert.dataset.callout = type;
        callout.replaceWith(alert);
    });
    // 引用块内嵌着色、小标题在 GSA 中取消（与原版一致）
    root.querySelectorAll<HTMLElement>(".md-alert").forEach(a => {
        a.querySelectorAll(".v-q, summary, strong[class*=title]").forEach(e => e.removeAttribute("class"));
    });
}
