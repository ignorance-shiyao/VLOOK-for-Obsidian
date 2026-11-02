/** Self-contained: serialized into preview/export HTML before DOM-ready runtime transforms. */
export function installExportGifControls(root: ParentNode): void {
    root.querySelectorAll<HTMLImageElement>('img[src*="#gif"]').forEach(img => {
        if(img.closest("pre,code,svg,mjx-container,script,style,textarea,.math,.frontmatter"))return;
        const win = img.ownerDocument.defaultView;
        if (!win || img.dataset.vlookGifControl === '1') return;
        img.dataset.vlookGifControl = '1';
        let cover = img.getAttribute('src') || '', set = img.getAttribute('srcset');
        let playing = false, writtenSrc = cover, writtenSet = set;
        const linked = !!img.closest('a[href],button');
        const render = () => {
            writtenSrc = playing ? cover.replace(/\.[^./?#]+(?=[?#]|$)/, '.gif') : cover;
            writtenSet = playing ? null : set;
            if (img.getAttribute('src') !== writtenSrc) img.setAttribute('src', writtenSrc);
            if (writtenSet) img.setAttribute('srcset', writtenSet); else img.removeAttribute('srcset');
            img.dataset.playing = String(playing);
            if (!linked) img.setAttribute('aria-pressed', String(playing));
        };
        // The official theme runtime may replace both src and srcset while playing.
        const sync = () => {
            const src = img.getAttribute('src') || '', srcset = img.getAttribute('srcset');
            if (src === writtenSrc && srcset === writtenSet) return;
            if (src !== writtenSrc) cover = src;
            set = srcset;
            render();
        };
        const observer = new win.MutationObserver(sync);
        const observe = () => observer.observe(img, {attributes:true, attributeFilter:['src','srcset']});
        observe();
        const toggle = () => {sync(); playing = !playing; render();};
        img.classList.add('v-gif-cover', 'vlook-clickable');
        if (!linked) {img.setAttribute('role','button'); img.tabIndex = 0;}
        img.addEventListener('click', event => {
            if (!linked) {event.preventDefault(); event.stopImmediatePropagation();}
            toggle();
        }, true);
        img.addEventListener('keydown', event => {
            if (linked || !['Enter',' '].includes(event.key) || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.isComposing) return;
            event.preventDefault(); event.stopPropagation(); if (!event.repeat) toggle();
        });
        render();
        win.addEventListener('pagehide', () => observer.disconnect());
        win.addEventListener('pageshow', () => {sync(); observe();});
    });
}
