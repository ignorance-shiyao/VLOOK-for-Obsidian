/** Caption wrappers may inherit .mermaid. Count the actual innermost renderer once. */
export function diagramElements(root: HTMLElement): HTMLElement[] {
    const found: HTMLElement[] = root.matches('.mermaid') ? [root] : [];
    root.querySelectorAll<HTMLElement>('.mermaid,pre > code.language-mermaid').forEach(node => { found.push(node); });
    return found.filter((node: HTMLElement) => node.localName==='code' ? !node.closest('.mermaid') : !node.querySelector('.mermaid'));
}
