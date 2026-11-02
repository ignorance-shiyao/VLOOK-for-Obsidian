// 多彩提示：成功 / 警告 / 错误 / 信息四种，配色取自主题色，明暗模式自适应

import { Notice } from "obsidian";

export type NoticeKind = "success" | "warning" | "error" | "info";

const GLYPHS: Record<NoticeKind, string> = {
    success: '<path d="M7.2 12.6l3.1 3.1 6.5-6.7"/>',
    warning: '<path d="M12 7v6.2M12 16.6v.01"/>',
    error: '<path d="M8.6 8.6l6.8 6.8M15.4 8.6l-6.8 6.8"/>',
    info: '<path d="M12 11v6M12 7.6v.01"/>',
};
const icon_ = (kind: NoticeKind): string => `<svg viewBox="0 0 24 24" width="22" height="22"><circle cx="12" cy="12" r="11" fill="currentColor"/><g fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${GLYPHS[kind]}</g></svg>`;
const CLOSE = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>';

/** 按文案推断类型 */
export function noticeKind(text: string): NoticeKind {
    if (/失败|错误|出错|未找到|无法|不存在|不支持/.test(text)) return "error";
    if (/^(VLOOK：)?已(导出|清除)|成功/.test(text)) return "success";
    if (/请|已变更|已变化|已切换|已失效|失效|没有|未配置|尚无|不再/.test(text)) return "warning";
    return "info";
}

function body(message: string | DocumentFragment, kind: NoticeKind): { fragment: DocumentFragment; wrap: HTMLElement; close: HTMLElement } {
    const wrap = document.createElement("div");
    wrap.className = "vlook-notice-body";
    const icon = document.createElement("span");
    icon.className = "vlook-notice-icon";
    icon.innerHTML = icon_(kind);
    const text = document.createElement("div");
    text.className = "vlook-notice-text";
    if (typeof message === "string") text.textContent = message; else text.append(message);
    const close = document.createElement("button");
    close.className = "vlook-notice-close";
    close.setAttribute("aria-label", "关闭");
    close.innerHTML = CLOSE;
    wrap.append(icon, text, close);
    const fragment = document.createDocumentFragment();
    fragment.append(wrap);
    return { fragment, wrap, close };
}

function mark(wrap: HTMLElement, kind: NoticeKind): void {
    const el = wrap.closest(".notice");
    if (!el) return;
    el.classList.remove("vlook-notice-success", "vlook-notice-warning", "vlook-notice-error", "vlook-notice-info");
    el.classList.add("vlook-notice", `vlook-notice-${kind}`);
}

/** 与 `new Notice(message, timeout)` 用法一致；返回 Notice 以便 hide / 更新。 */
export function notify(message: string | DocumentFragment, timeout?: number, kind?: NoticeKind): Notice {
    const type = kind ?? (typeof message === "string" ? noticeKind(message) : "info");
    const { fragment, wrap, close } = body(message, type);
    const notice = new Notice(fragment, timeout ?? (type === "error" ? 8000 : undefined));
    close.addEventListener("click", event => { event.stopPropagation(); notice.hide(); });
    mark(wrap, type);
    return notice;
}

/** 更新进行中的提示文案与类型 */
export function renotify(notice: Notice, message: string, kind?: NoticeKind): void {
    const type = kind ?? noticeKind(message);
    const { fragment, wrap, close } = body(message, type);
    notice.setMessage(fragment);
    close.addEventListener("click", event => { event.stopPropagation(); notice.hide(); });
    mark(wrap, type);
}
