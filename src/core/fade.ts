// 主题与明暗切换的渐变：切换瞬间给根节点加 vlook-fading，让颜色相关属性在约 0.45s 内过渡

export const FADE_CSS = "html.vlook-fading,html.vlook-fading *,html.vlook-fading *::before,html.vlook-fading *::after{transition:background-color .45s ease,color .45s ease,border-color .45s ease,fill .45s ease,stroke .45s ease,box-shadow .45s ease,outline-color .45s ease!important}@media (prefers-reduced-motion:reduce){html.vlook-fading,html.vlook-fading *,html.vlook-fading *::before,html.vlook-fading *::after{transition:none!important}}";

const timers = new WeakMap<Element, number>();

/** 在发生颜色变化之前（或同一帧内）调用。 */
export function fade(doc: Document, ms = 650): void {
    const root = doc.documentElement, win = doc.defaultView;
    if (!win) return;
    root.classList.add("vlook-fading");
    win.clearTimeout(timers.get(root));
    timers.set(root, win.setTimeout(() => root.classList.remove("vlook-fading"), ms));
}

/** 监听宿主明暗（body 上 theme-dark / theme-light）变化，原生切换也渐变。变化在同一帧内被捕获，过渡随之生效。 */
export function observeSchemeFade(doc: Document): () => void {
    const body = doc.body;
    let dark = body.classList.contains("theme-dark");
    const observer = new MutationObserver(() => {
        const now = body.classList.contains("theme-dark");
        if (now !== dark) { dark = now; fade(doc); }
    });
    observer.observe(body, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
}
