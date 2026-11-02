import {sourceFences} from '../core/fenced-source';

/** Actual math fences in quotes/lists count; enclosing code examples do not. */
export function sourceMathFenceCount(source:string):number {
    return sourceFences(source,'math').length;
}

/** 等待真实公式输出，不能将仍含 TeX 的占位容器当作完成的导出内容。
 * 渲染器已输出的公式错误与 Typora 一致按原样保留，返回出错公式数，由调用方提示，不阻断导出。 */
export function waitForMath(root: HTMLElement, timeoutMs = 15000, stableMs = 100, signal?: AbortSignal, sourceCount=0): Promise<number> {
    const win = root.ownerDocument.defaultView!;
    if(signal?.aborted)return Promise.reject(new win.DOMException('渲染已取消','AbortError'));
    const formulas = () => Array.from(root.querySelectorAll('.math.math-inline,.math.math-block'));
    const expected=Math.max(formulas().length,sourceCount);
    if (!expected) return Promise.resolve(0);
    return new Promise((resolve, reject) => {
        let finished = false;
        let quiet: number | undefined;
        const errorSelector='mjx-merror,merror,[data-mml-node="merror"],.katex-error,.math-error';
        const finish = (error?: Error) => {
            if (finished) return;
            finished = true; observer.disconnect(); win.clearTimeout(deadline); win.clearTimeout(quiet);
            signal?.removeEventListener('abort',aborted);
            if (error) reject(error); else resolve(formulas().filter(node=>node.querySelector(errorSelector)).length);
        };
        const aborted=()=>finish(new win.DOMException('渲染已取消','AbortError'));
        const ready = (formula: Element) => !!formula.querySelector('mjx-container svg,mjx-container mjx-math,.MathJax_SVG svg,.MathJax,.katex');
        const readyFences=(nodes:Element[])=>new Set(nodes.filter(ready).map(node=>node.closest('[data-vlook-math-fence]')).filter(Boolean)).size;
        const check = () => {
            const nodes = formulas();
            if (nodes.length>=expected && nodes.every(ready) && readyFences(nodes)>=sourceCount) finish();
        };
        const observer = new win.MutationObserver(() => {
            win.clearTimeout(quiet); quiet = win.setTimeout(check, stableMs);
        });
        const deadline = win.setTimeout(() => {
            const nodes=formulas(),count=Math.max(Math.max(expected,nodes.length)-nodes.filter(ready).length,sourceCount-readyFences(nodes));
            finish(new Error(`公式渲染未就绪（${count} 个未完成），请完成渲染后重试。`));
        }, timeoutMs);
        signal?.addEventListener('abort',aborted,{once:true});
        observer.observe(root, {childList: true, subtree: true, attributes: true, characterData: true});
        quiet = win.setTimeout(check, stableMs);
    });
}
