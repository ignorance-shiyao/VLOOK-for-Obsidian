const LITERAL_TAGS=new Set(['CODE','PRE','SCRIPT','STYLE','TEXTAREA','KBD','MJX-CONTAINER','SVG']);

/** Inspect ancestors, not the candidate itself: inline code is valid Code Magic input. */
export function isLiteralContent(node:Node, options?:{allowKbd?:boolean}):boolean {
    for(let parent=node.parentElement;parent;parent=parent.parentElement){
        if(options?.allowKbd && parent.tagName.toUpperCase()==='KBD')continue;
        if(LITERAL_TAGS.has(parent.tagName.toUpperCase())||parent.classList.contains('math')||parent.classList.contains('frontmatter'))return true;
    }
    return false;
}
