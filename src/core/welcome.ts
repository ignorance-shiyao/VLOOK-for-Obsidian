// 欢迎页：vlook-welcome 自定义内容与 ws 显示模式
export type WelcomeMode = { kind: "off" } | { kind: "auto" } | { kind: "wait" } | { kind: "delay"; seconds: number };

export function welcomeMode(option: string | null): WelcomeMode {
    if (option === "off") return { kind: "off" };
    if (option === "wait") return { kind: "wait" };
    const seconds = Number(option);
    if (Number.isInteger(seconds) && seconds >= 1 && seconds <= 60) return { kind: "delay", seconds };
    return { kind: "auto" };
}

const BLOCKED = "script,iframe,object,embed,style,link,meta,base,form";

/** 欢迎页内容允许 HTML 标记，但不允许脚本、外部嵌入与事件属性。 */
export function sanitizeWelcome(html: string, doc: Document): DocumentFragment {
    const parsed = new DOMParser().parseFromString(html, "text/html");
    parsed.body.querySelectorAll(BLOCKED).forEach(el => el.remove());
    parsed.body.querySelectorAll("*").forEach(el => {
        for (const attr of Array.from(el.attributes)) {
            if (/^on/i.test(attr.name) || (/^(href|src|xlink:href|formaction|action|srcdoc)$/i.test(attr.name) && /^(javascript|vbscript|data:text\/html)/i.test(Array.from(attr.value).filter(ch => { const c = ch.charCodeAt(0); return c > 32 && (c < 127 || c > 159); }).join("")))) el.removeAttribute(attr.name);
        }
    });
    const fragment = doc.createDocumentFragment();
    for (const node of Array.from(parsed.body.childNodes)) fragment.append(doc.importNode(node, true));
    return fragment;
}
