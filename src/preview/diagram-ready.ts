import {zenUmlEnabled} from '../core/zenuml-loader';
import {diagramElements} from '../core/diagram-dom';
import {sourceFences} from '../core/fenced-source';

/** Count actual fences, including quotes/lists; enclosing code examples stay plain code. */
export function sourceDiagramCount(source:string):number {
    const fences=sourceFences(source,'mermaid');
    return zenUmlEnabled()?fences.length:fences.filter(text=>!/^\s*zenuml\b/i.test(text)).length;
}

/** 等待宿主异步 Mermaid 渲染；缺图或错误图不能作为成功导出。 */
export function waitForDiagrams(root: HTMLElement, timeoutMs = 15000, stableMs = 100, sourceCount = 0, signal?: AbortSignal): Promise<void> {
    const win = root.ownerDocument.defaultView!;
    if(signal?.aborted)return Promise.reject(new win.DOMException('渲染已取消','AbortError'));
    const diagrams=()=>diagramElements(root);
    const expected = Math.max(diagrams().length,sourceCount);
    if (!expected) return Promise.resolve();
    return new Promise((resolve, reject) => {
        let done = false;
        let quiet: number | undefined;
        const finish = (error?: Error) => {
            if (done) return;
            done = true; observer.disconnect(); win.clearTimeout(deadline); win.clearTimeout(quiet);
            signal?.removeEventListener('abort',aborted);
            if (error) reject(error); else resolve();
        };
        const aborted=()=>finish(new win.DOMException('渲染已取消','AbortError'));
        const check = () => {
            const nodes = diagrams();
            if (nodes.some(node => node.matches('.pele-error') || node.querySelector(".pele-error,svg .error-icon,svg .error-text"))) {
                finish(new Error("Mermaid 图表渲染失败，请检查语法或宿主支持的图表类型。"));
                return;
            }
            if (nodes.length >= expected && nodes.every(node => !!node.querySelector("svg"))) finish();
        };
        const observer = new win.MutationObserver(() => {
            win.clearTimeout(quiet);
            quiet = win.setTimeout(check, stableMs);
        });
        const deadline = win.setTimeout(() => {
            const nodes=diagrams();
            const count = Math.max(expected,nodes.length)-nodes.filter(node => !!node.querySelector("svg")).length;
            finish(new Error(`Mermaid 图表渲染未就绪（${count} 个未完成），请完成渲染后重试。`));
        }, timeoutMs);
        signal?.addEventListener('abort',aborted,{once:true});
        observer.observe(root, {childList:true, subtree:true, attributes:true, characterData:true});
        quiet = win.setTimeout(check, stableMs);
    });
}
