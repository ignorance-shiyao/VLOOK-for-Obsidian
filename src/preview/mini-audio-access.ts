/** Self-contained enhancement of the official runtime's generated mini controls. */
export function enhanceExportMiniAudio(root: ParentNode): void {
    const doc = root.nodeType === 9 ? root as Document : (root as Node).ownerDocument;
    const win = doc?.defaultView;
    if (!doc || !win) return;
    const bound = new Map<HTMLElement, () => void>();
    const scan = () => root.querySelectorAll<HTMLElement>('.v-audio-mini-control[id]').forEach(control => {
        if(control.closest("pre,code,svg,mjx-container,script,style,textarea,kbd,.math,.frontmatter"))return;
        const existing = bound.get(control);
        if (existing) {existing(); return;}
        if (control.dataset.vlookMiniAccess === '1') return;
        const id = control.id.replace(/-control$/, ''), audio = doc.getElementById(id) as HTMLAudioElement | null;
        if (!audio || audio.tagName !== 'AUDIO') return;
        control.dataset.vlookMiniAccess = '1';
        control.tabIndex = 0; control.setAttribute('role','button'); control.setAttribute('aria-controls',id);
        const update = () => {
            const disabled = control.classList.contains('disabled') || !!audio.error;
            const busy = control.classList.contains('loading');
            const playing = !audio.paused && !audio.ended && !disabled;
            control.setAttribute('aria-disabled',String(disabled));
            control.setAttribute('aria-busy',String(busy));
            control.setAttribute('aria-pressed',String(playing));
            control.setAttribute('aria-label',audio.error ? '音频加载失败' : busy ? '正在加载音频' : playing ? (control.dataset.pause === 'true' ? '暂停音频' : '停止音频') : '播放音频');
        };
        bound.set(control, update);
        control.addEventListener('keydown', event => {
            if (!['Enter',' '].includes(event.key) || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.isComposing) return;
            event.preventDefault(); event.stopPropagation();
            if (!event.repeat && control.getAttribute('aria-disabled') !== 'true') control.click();
        });
        for (const event of ['loadstart','canplay','playing','pause','ended','error','emptied']) audio.addEventListener(event,update);
        update();
    });
    const observer = new win.MutationObserver(scan);
    const observe = () => observer.observe(root as Node,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});
    scan(); observe();
    win.addEventListener('pagehide',()=>observer.disconnect());
    win.addEventListener('pageshow',()=>{scan();observe();});
}
