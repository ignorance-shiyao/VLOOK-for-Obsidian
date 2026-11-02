import { splitDocumentLibrary, parseDocumentLibraryLink } from '../../scripts/library-split.mjs';

export interface DocumentLibraryItem { title: string; href: string; description: string }

/** 兼容原版逗号分隔配置；也接受 Obsidian YAML 列表。 */
export function documentLibraryItems(value: unknown): DocumentLibraryItem[] {
    const values = Array.isArray(value) ? value : [value];
    const result: DocumentLibraryItem[] = [];
    for (const value of values) {
        if (typeof value !== 'string') continue;
        for (const part of splitDocumentLibrary(value)) {
            const text = part.trim();
            if (!text) continue;
            const match = parseDocumentLibraryLink(text);
            if (!match) {
                result.push({title:text, href:text, description:''});
                continue;
            }
            const href = match.href;
            const description = match.title;
            const title = (match.text || description || href).replace(/^==|==$/g, '');
            result.push({title, href, description});
        }
    }
    return result;
}

/** 只替换地址，保留原文的高亮标题、说明、分隔和 YAML 列表结构。 */
export function rewriteDocumentLibrary(value:unknown,rewrite:(href:string)=>string):unknown {
    if(Array.isArray(value))return value.map(item=>rewriteDocumentLibrary(item,rewrite));
    if(typeof value!=='string')return value;
    return splitDocumentLibrary(value).map(part=>{
        const text=part.trim();if(!text)return part;
        const match=parseDocumentLibraryLink(text);
        if(!match){const href=rewrite(text);return part.replace(text,()=>href);}
        const href=match.href;
        const mapped=rewrite(href);if(mapped===href)return part;
        const from=match.from;
        if(from<0)return part;
        const replacement=match.angle?`<${mapped}>`:mapped;
        return part.replace(text,()=>text.slice(0,from)+replacement+text.slice(match.to));
    }).join(',');
}
