import { pauseContainedMedia } from './media-handoff';

type MoveParent = HTMLElement & {moveBefore?: (node: Node, before: Node | null) => void};

/** Atomic moves preserve iframe browsing contexts in supporting Chromium versions. */
export function moveContent(parent: HTMLElement, node: HTMLElement, before: Node | null = null): void {
    if (parent.isConnected && node.isConnected && typeof (parent as MoveParent).moveBefore === 'function') {
        (parent as MoveParent).moveBefore!(node, before);
    } else parent.insertBefore(node, before);
}

export interface BorrowedContent {restore(allowRestore: boolean): void}

/** Only borrow when both outward and return moves can preserve the existing frame. */
export function borrowContent(node: HTMLElement, destination: HTMLElement): BorrowedContent | null {
    const parent = node.parentElement;
    if (!parent || !node.isConnected || !destination.isConnected || typeof (destination as MoveParent).moveBefore !== 'function' || typeof (parent as MoveParent).moveBefore !== 'function') return null;
    const marker = node.ownerDocument.createElement('div');
    marker.className = 'vlook-content-placeholder'; marker.textContent = '内容正在浮动窗口中显示';
    marker.style.minHeight = `${Math.min(node.getBoundingClientRect().height, 300)}px`;
    parent.insertBefore(marker, node); moveContent(destination, node);
    let restored = false;
    return {restore(allowRestore) {
        if (restored) return; restored = true;
        if (allowRestore && marker.isConnected && marker.parentElement) moveContent(marker.parentElement, node, marker);
        else { pauseContainedMedia(node); node.remove(); }
        marker.remove();
    }};
}
