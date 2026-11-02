import { splitDocumentLibrary, parseDocumentLibraryLink } from './library-split.mjs';

/** Keep the upstream print options; wait for browser resource layout before opening print. */
export async function printRuntimeWhenReady(win, beforePrint) {
    const doc=win.document, marker='data-vlook-print-pending';
    if(doc.documentElement.hasAttribute(marker))return;
    doc.documentElement.setAttribute(marker,'');
    let timer;
    try {
        beforePrint();
        const images=Array.from(doc.querySelectorAll('#write img'));
        // Printing must also load pictures outside the current viewport.
        for(const image of images)image.loading='eager';
        const resources=Promise.all([
            doc.fonts?.ready,
            ...images.map(image=>typeof image.decode==='function'
                ?image.decode().catch(()=>{}) // Upstream already reports broken pictures; keep that policy.
                :Promise.resolve()),
        ]);
        await Promise.race([resources.then(()=>new Promise(resolve=>win.requestAnimationFrame(()=>win.requestAnimationFrame(resolve)))),new Promise((_,reject)=>{
            timer=win.setTimeout(()=>reject(new Error('打印资源等待超时，请检查字体和图片后重试。')),15000);
        })]);
        // Obsidian 预览注入直接写入 PDF 的宿主入口；独立 HTML 仍走浏览器打印。
        const host=win.__vlookPrintToPdf;
        if(typeof host!=='function'||await host()===false)win.print();
    } catch(error) {
        win.console.error('[VLOOK print]',error);
        win.alert(error instanceof Error?error.message:String(error));
    } finally {
        win.clearTimeout(timer);
        doc.documentElement.removeAttribute(marker);
    }
}

/** 只改写 URL 路径末尾的 .md，不触碰目录名、查询参数和锚点。 */
export function rewriteRuntimeLinks(doc, globalExtension) {
    if(globalExtension==='off')return;
    doc.querySelectorAll('a[href]').forEach(anchor=>{
        if(anchor.hasAttribute('data-vlook-resolved-link'))return;
        const href=anchor.getAttribute('href')||'';
        const parts=href.match(/^([^?#]*)(\?[^#]*)?(#.*)?$/);
        if(!parts||!(/\.md$/i).test(parts[1]))return;
        const local=new URLSearchParams(parts[2]||'').get('xmd');
        if(local==='off')return;
        const extension=local||globalExtension||'html';
        if(!/^[\w-]+$/.test(extension))return;
        anchor.setAttribute('href',parts[1].replace(/\.md$/i,'.'+extension)+(parts[2]||'')+(parts[3]||''));
    });
}

/** Same exact-title / regex syntax as the native unpublished matcher. */
export function pushRuntimeRules(data, exact, expressions) {
    for(const part of String(data).split(';').map(value=>value.trim()).filter(Boolean)){
        const match=part.match(/^\/(.*)\/([a-z]*)$/);
        if(!match){exact.push(part);continue;}
        try {expressions.push(new RegExp(match[1],match[2]));} catch { /* Invalid rules do not abort document initialization. */ }
    }
}
export function matchRuntimeRules(text, expressions) {
    return expressions.some(expression=>{expression.lastIndex=0;return expression.test(text);});
}

// srcdoc 地址、文档统计和宿主已解析链接的兼容适配。
export function adaptRuntime(source) {
    const locationGetter = /function\s+([\w$]+)\(\)\{return\s+([\w$]+)\.href\}/g;
    const getters = [...source.matchAll(locationGetter)];
    if (getters.length !== 1) throw new Error('VLOOK URL 适配点发生变化，请核查上游运行时');
    let result = source.replace(locationGetter, (_all, name, location) =>
        `function ${name}(){return window.location.href==="about:srcdoc"?(document.querySelector('meta[name="vlook-document-url"]')?.content||document.baseURI):${location}.href}`);
    const report = /function\s+([\w$]+)\(\)\{let [^{}]*"\?p=vlook[^{}]*\}/g;
    const reporters = [...result.matchAll(report)];
    if (reporters.length !== 1) throw new Error('VLOOK 统计适配点发生变化，请核查上游运行时');
    result = result.replace(report, (_all, name) => `function ${name}(){}`);
    const converter=/function\s+([\w$]+)\(\)\{let ([\w$]+)=([\w$]+)\(([\w$]+)\),([\w$]+)="\."\+([\w$]+);[^{}]*\{[^{}]*"\.md"[^{}]*\}\)\)\)\}/g;
    const converters=[...result.matchAll(converter)];
    if(converters.length!==1)throw new Error('VLOOK 链接转换适配点发生变化，请核查上游运行时');
    result=result.replace(converter,(_all,name,_local,getQuery,key)=>`function ${name}(){(${rewriteRuntimeLinks.toString()})(document,${getQuery}(${key}))}`);
    const librarySplitter=/function\s+([\w$]+)\(([\w$]+)\)\{return \2\.sp\(\/,\(\?=[^\n{}]*?\/\)\}/g;
    if([...result.matchAll(librarySplitter)].length!==1)throw new Error('VLOOK 文库分隔适配点发生变化，请核查上游运行时');
    result=result.replace(librarySplitter,(_all,name,arg)=>`function ${name}(${arg}){return (${splitDocumentLibrary.toString()})(${arg})}`);
    const marker='(?<title1>';
    if(result.split(marker).length!==2)throw new Error('VLOOK 文库链接解析适配点发生变化，请核查上游运行时');
    const at=result.indexOf(marker),start=result.lastIndexOf('function ',at),end=result.indexOf('function ',at);
    const original=result.slice(start,end),signature=original.match(/^function ([\w$]+)\(([\w$]+)\)\{let /);
    if(!signature||!['page:','hash:','text:','title:'].every(field=>original.includes(field)))throw new Error('VLOOK 文库链接解析函数发生变化，请核查上游运行时');
    result=result.slice(0,start)+`function ${signature[1]}(${signature[2]}){return (${parseDocumentLibraryLink.toString()})(${signature[2]})}`+result.slice(end);
    const escapeRegExp=text=>text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    const legacy=String.raw`/^(\[([^\]]+)]\(([^)\s]+)(\s+"([^"]+)")?\))$/`;
    const currentEntry=new RegExp(`([\\w$]+)=([\\w$]+)\\.m\\(${escapeRegExp(legacy)}\\),([\\w$]+)=\\1===([\\w$]+)\\?\\3=\\2:([\\w$]+)\\(\\1\\[3\\]\\)`,'g');
    const currentMatches=[...result.matchAll(currentEntry)];
    if(currentMatches.length!==1)throw new Error('VLOOK 当前文库识别适配点发生变化，请核查上游运行时');
    const [,parsed,item]=currentMatches[0];
    result=result.replace(currentEntry,(_all,parsed,item,page,nil,stripHash)=>`${parsed}=${signature[1]}(${item}),${page}=${parsed}===${nil}?${stripHash}(${item}):${parsed}.page`);
    const currentTitle=new RegExp(`([\\w$]+)\\.title=${escapeRegExp(parsed)}\\[2\\]`,'g');
    if([...result.matchAll(currentTitle)].length!==1)throw new Error('VLOOK 当前文库标题适配点发生变化，请核查上游运行时');
    result=result.replace(currentTitle,(_all,owner)=>`${owner}.title=${parsed}?.text||${parsed}?.title||${item}`);
    const rules=/function\s+([\w$]+)\(([\w$]+),([\w$]+),([\w$]+)\)\{let [^{}]*\.x\(\)\.sp\(";"\);[^{}]*new RegExp\([^{}]*\.substring\(1,[^{}]*\}/g;
    if([...result.matchAll(rules)].length!==1)throw new Error('VLOOK 章节规则解析适配点发生变化，请核查上游运行时');
    result=result.replace(rules,(_all,name,data,exact,expressions)=>`function ${name}(${data},${exact},${expressions}){(${pushRuntimeRules.toString()})(${data},${exact},${expressions})}`);
    const matcher=/function ([\w$]+)\(([\w$]+),([\w$]+)\)\{for\(let ([\w$]+)=0;\4<[\w$]+\(\3\);\4\+\+\)if\(\2\.m\(\3\[\4\]\)!==[\w$]+\)return [\w$]+;return [\w$]+\}/g;
    if([...result.matchAll(matcher)].length!==1)throw new Error('VLOOK 章节规则匹配适配点发生变化，请核查上游运行时');
    result=result.replace(matcher,(_all,name,text,expressions)=>`function ${name}(${text},${expressions}){return (${matchRuntimeRules.toString()})(${text},${expressions})}`);
    // 移动端与桌面端保持同等功能：工具栏不再整体隐藏，状态栏不自动收起，文档信息与链接检查结果照常显示。
    const mobileGetter=/function\s+([\w$]+)\(\)\{return [\w$]+\.device\.mobile\}/g, mobileGetters=[...result.matchAll(mobileGetter)];
    if(mobileGetters.length!==1)throw new Error('VLOOK 移动端判断适配点发生变化，请核查上游运行时');
    const mobile=mobileGetters[0][1].replace(/\$/g,'\\$');
    const toolbarHide=new RegExp(`([\\w$]+)\\.adjust=\\(\\)=>\\{if\\(([\\w$]+)!==([\\w$]+)\\)return null;if\\(${mobile}\\(\\)\\)return \\1\\.ui\\.hide\\(\\),null;`,'g');
    if([...result.matchAll(toolbarHide)].length!==1)throw new Error('VLOOK 移动端工具栏适配点发生变化，请核查上游运行时');
    result=result.replace(toolbarHide,(_all,owner,mode,max)=>`${owner}.adjust=()=>{if(${mode}!==${max})return null;`);
    const statusClose=new RegExp(`\\(${mobile}\\(\\)\\|\\|([\\w$]+)!==([\\w$]+)\\|\\|`,'g');
    if([...result.matchAll(statusClose)].length!==1)throw new Error('VLOOK 移动端状态栏适配点发生变化，请核查上游运行时');
    result=result.replace(statusClose,(_all,mode,max)=>`(${mode}!==${max}||`);
    const statusInfo=new RegExp(`([\\w$]+)!==([\\w$]+)\\|\\|${mobile}\\(\\)\\)\\{let ([\\w$]+);([\\w$]+)\\.hide\\(\\),([\\w$]+)\\.hide\\(\\),`,'g');
    if([...result.matchAll(statusInfo)].length!==1)throw new Error('VLOOK 移动端状态栏信息适配点发生变化，请核查上游运行时');
    result=result.replace(statusInfo,(_all,mode,max,letName,a,b)=>`${mode}!==${max}){let ${letName};${a}.hide(),${b}.hide(),`);
    // 宿主直接写入 PDF 时，打印按钮不再提示“另存为 PDF”。
    const printLabel='["启动打印（选择：另存为 PDF）","Start Printing (select: Save as PDF)"]';
    if(result.split(printLabel).length!==2)throw new Error('VLOOK 打印按钮文案适配点发生变化，请核查上游运行时');
    result=result.replace(printLabel,`(window.__vlookPrintToPdf?["导出 PDF","Export PDF"]:${printLabel})`);
    const printAction=/function ([\w$]+)\(\)\{([\w$]+)\(\),([\w$]+)\.print\(\)\}/g;
    if([...result.matchAll(printAction)].length!==1)throw new Error('VLOOK 打印入口适配点发生变化，请核查上游运行时');
    result=result.replace(printAction,(_all,name,before,win)=>`function ${name}(){void (${printRuntimeWhenReady.toString()})(${win},${before})}`);
    return result;
}
