/** 与原版 Fullscreen_disposeHotkey 一致；宿主控件优先保留自身键盘行为。 */
export function bindContentShortcuts(dialog:HTMLDialogElement,previous:HTMLButtonElement,next:HTMLButtonElement):void {
    dialog.addEventListener('keydown',event=>{
        if(event.defaultPrevented||event.ctrlKey||event.metaKey||event.altKey||event.shiftKey||event.isComposing)return;
        const target=event.target as Element;
        if(target.closest('input,textarea,select,.vlook-dropdown,[contenteditable]:not([contenteditable="false"]),[role="slider"],[role="combobox"],audio,video'))return;
        const backward=['ArrowLeft','ArrowUp',','].includes(event.key);
        const forward=['ArrowRight','ArrowDown','.'].includes(event.key);
        if(!backward&&!forward&&event.key!=='Escape')return;
        event.preventDefault();event.stopPropagation();
        if(event.key==='Escape')dialog.close();
        else (backward?previous:next).click();
    });
}
