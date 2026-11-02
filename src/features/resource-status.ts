import type { RenderCtx } from '../core/context';
import type { LinkAuditResult } from '../core/link-audit';

const bound = new WeakSet<Element>();
const locations = new WeakMap<Element, {path: string; line: number; end: number; text: string}>();

/** 只报告本视图、同源码区块中实际收到失败事件的资源，不推断虚拟化区块。 */
export function renderedResourceFailures(root: HTMLElement, path: string, source: string): LinkAuditResult[] {
    const lines = source.split('\n');
    return Array.from(root.querySelectorAll<HTMLImageElement | HTMLMediaElement>('[data-vlook-resource-error="1"]')).flatMap(resource => {
        const location = locations.get(resource);
        if (!location || location.path !== path || lines.slice(location.line, location.end + 1).join('\n') !== location.text) return [];
        const href = resource.getAttribute('src') || resource.querySelector('source[src]')?.getAttribute('src') || '';
        const title = resource.getAttribute('alt') || resource.title || (resource.tagName === 'IMG' ? '图片' : resource.tagName === 'AUDIO' ? '音频' : '视频');
        return [{link: {title, href, line: location.line}, status: 'missing-resource' as const, detail: '当前视图已渲染资源加载失败（未渲染资源未检查）'}];
    });
}

/** 原生渲染没有官方 LinkTool 的资源错误面板，在资源旁保留可操作的失败提示。 */
export function processResourceStatus(root: HTMLElement, ctx: RenderCtx): void {
    root.querySelectorAll<HTMLImageElement | HTMLMediaElement>('img[src],audio,video').forEach(resource => {
        if (bound.has(resource)) return;
        bound.add(resource);
        if (ctx.block && ctx.index) locations.set(resource, {
            path: ctx.sourcePath, line: ctx.block.start, end: ctx.block.end,
            text: ctx.index.text.split('\n').slice(ctx.block.start, ctx.block.end + 1).join('\n'),
        });
        let status: HTMLElement | undefined;
        const clear = () => { status?.remove(); status = undefined; delete resource.dataset.vlookResourceError; };
        const href = () => resource.getAttribute('src') || resource.querySelector('source[src]')?.getAttribute('src') || '';
        const recovered = () => {
            const location = locations.get(resource);
            if (location && ctx.index) ctx.resourceHistory?.recovered(ctx.sourcePath, ctx.index.text, location.line, href());
            clear();
        };
        const failed = () => {
            const name = resource.tagName === 'IMG' ? '图片' : resource.tagName === 'AUDIO' ? '音频' : '视频';
            if (status) {
                status.removeAttribute('aria-busy');
                status.querySelector('span')!.textContent = `${name}加载失败`;
                status.querySelector('button')!.disabled = false;
                return;
            }
            resource.dataset.vlookResourceError = '1';
            status = resource.ownerDocument.createElement('span');
            status.className = 'vlook-resource-error';
            status.setAttribute('role', 'status');
            const location = locations.get(resource);
            if (location && ctx.index) ctx.resourceHistory?.record(ctx.sourcePath, ctx.index.text, {
                link: {title: resource.getAttribute('alt') || resource.title || name, href: href(), line: location.line},
                status: 'missing-resource', detail: '资源加载失败',
            });
            const label = resource.ownerDocument.createElement('span');
            label.textContent = `${name}加载失败`;
            const retry = resource.ownerDocument.createElement('button');
            retry.type = 'button'; retry.textContent = '重试';
            retry.setAttribute('aria-label', `重新加载${name}`);
            retry.addEventListener('click', event => {
                event.preventDefault(); event.stopPropagation();
                if (retry.disabled) return;
                status?.setAttribute('aria-busy', 'true');
                label.textContent = `正在重新加载${name}`; retry.disabled = true;
                if (resource.tagName === 'IMG') {
                    const image = resource as HTMLImageElement;
                    image.src = image.getAttribute('src') || '';
                } else (resource as HTMLMediaElement).load();
            });
            status.append(label, retry); resource.after(status);
        };
        const successEvent = resource.tagName === 'IMG' ? 'load' : 'loadeddata';
        resource.addEventListener('error', failed);
        resource.addEventListener(successEvent, recovered);
        if (resource.tagName === 'IMG' && (resource as HTMLImageElement).naturalWidth > 0 && (resource as HTMLImageElement).complete) recovered();
        if (resource.tagName !== 'IMG' && (resource as HTMLMediaElement).readyState >= 2 && !(resource as HTMLMediaElement).error) recovered();
        if (resource.tagName === 'IMG') {
            const image = resource as HTMLImageElement;
            if (image.getAttribute('src') && image.complete && image.naturalWidth === 0) failed();
        } else if ((resource as HTMLMediaElement).error) failed();
        ctx.registerCleanup?.(() => {
            resource.removeEventListener('error', failed);
            resource.removeEventListener(successEvent, recovered);
            clear(); bound.delete(resource); locations.delete(resource);
        });
    });
}
