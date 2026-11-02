/** Caption wrappers may inherit .mermaid. Count the actual innermost renderer once. */
export function diagramElements(root:HTMLElement):HTMLElement[] {
    return [...(root.matches('.mermaid')?[root]:[]),...Array.from(root.querySelectorAll<HTMLElement>('.mermaid,pre > code.language-mermaid'))]
        .filter(node=>node.matches('code')?!node.closest('.mermaid'):!node.querySelector('.mermaid'));
}
