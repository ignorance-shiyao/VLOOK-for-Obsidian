type AssetLoader=(url:string)=>Promise<Uint8Array>;
const IDS=['MJX-CHTML-styles','MathJax-CHTML-styles','MJX-QE-styles','MJX-ty-styles'];

async function loadAsset(url:string):Promise<Uint8Array>{
    const response=await fetch(url);
    if(!response.ok)throw Error(`数学字体读取失败：${response.status} ${url}`);
    return new Uint8Array(await response.arrayBuffer());
}
function base64(bytes:Uint8Array):string{
    let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
    return btoa(binary);
}

function stylesheetText(element:HTMLElement|null|undefined):string {
    if(!element)return '';
    // MathJax may append glyph rules with insertRule, leaving textContent stale.
    try{
        const rules=(element as HTMLStyleElement).sheet?.cssRules;
        if(rules?.length)return Array.from(rules,rule=>rule.cssText).join('\n');
    }catch{/* A detached engine snapshot may not expose a CSSStyleSheet. */}
    return element.textContent||'';
}

/** Snapshot dynamic CHTML rules and embed fonts so standalone HTML needs no host. */
export async function collectMathStyles(root:HTMLElement,load:AssetLoader=loadAsset):Promise<string>{
    if(!root.querySelector('mjx-container[jax="CHTML"],mjx-container mjx-math'))return '';
    const doc=root.ownerDocument;
    const engine=(doc.defaultView as Window&{MathJax?:{chtmlStylesheet?:()=>HTMLElement}}|null)?.MathJax;
    const current=engine?.chtmlStylesheet?.();
    const main=Array.from(new Set([stylesheetText(current),...IDS.slice(0,2).map(id=>stylesheetText(doc.getElementById(id)))])).join('\n');
    if(!main.trim())throw Error('公式 CHTML 样式尚未就绪，无法生成独立 HTML。');
    let css=[main,...IDS.slice(2).map(id=>stylesheetText(doc.getElementById(id)))].join('\n');
    const missing=Array.from(new Set(Array.from(root.querySelectorAll('mjx-c')).flatMap(node=>Array.from(node.classList).filter(name=>/^mjx-c[\da-f]+$/i.test(name)&&!css.includes(name)))));
    if(missing.length)throw Error(`公式字形样式尚未就绪：${missing.join(', ')}。请完成公式渲染后重试。`);
    const pattern=/url\(\s*(?:"([^"\n]*)"|'([^'\n]*)'|([^\s)]+))\s*\)/gi;
    const assets=new Map<string,string>();
    for(const match of css.matchAll(pattern)){
        const raw=match[1]??match[2]??match[3];
        if(/^data:/i.test(raw)||raw.startsWith('#'))continue;
        const url=new URL(raw,doc.baseURI).href;
        if(assets.has(url))continue;
        const extension=new URL(url).pathname.match(/\.(woff2?|ttf|otf)$/i)?.[1].toLowerCase();
        if(!extension)throw Error(`不支持的数学字体资源：${url}`);
        const mime=extension==='ttf'?'font/ttf':extension==='otf'?'font/otf':`font/${extension}`;
        assets.set(url,mime);
    }
    const resolved=new Map(await Promise.all(Array.from(assets,async([url,mime])=>{
        const bytes=await load(url);if(!bytes.length)throw Error(`数学字体为空：${url}`);
        return [url,`data:${mime};base64,${base64(bytes)}`] as const;
    })));
    css=css.replace(pattern,(full,_double,_single,_bare)=>{
        const raw=_double??_single??_bare;if(/^data:/i.test(raw)||raw.startsWith('#'))return full;
        return `url("${resolved.get(new URL(raw,doc.baseURI).href)}")`;
    });
    return css.replace(/<\/style/gi,'<\\/style');
}
