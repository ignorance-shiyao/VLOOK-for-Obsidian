// 按需加载 zenuml.js（见 src/zenuml-chunk.ts）：首次渲染 ZenUML 图表时读取并执行，之后复用。
interface ZenUmlChunk { mermaidZenuml: { loader: () => Promise<unknown> }; core: { renderToSvg: (source: string) => { svg: string } } }

let enabled = false;
export function setZenUmlEnabled(value: boolean): void { enabled = value; }
export const zenUmlEnabled = (): boolean => enabled;

let read: (() => Promise<string | null>) | null = null;
let loaded: Promise<ZenUmlChunk> | null = null;

export function setZenUmlSource(source: () => Promise<string | null>): void { read = source; }

export function zenUmlChunk(): Promise<ZenUmlChunk> {
    loaded ??= (async () => {
        if (!enabled) throw new Error("ZenUML 未启用");
        const code = await read?.();
        if (!code) throw new Error("缺少 zenuml.js，请重新安装插件");
        const module = { exports: {} as ZenUmlChunk };
        new Function("module", "exports", code)(module, module.exports);
        return module.exports;
    })();
    loaded.catch(() => { loaded = null; });
    return loaded;
}

/** Mermaid 外部图表定义：检测与注册即时完成，渲染器在首次绘制时才加载。 */
export function lazyZenUmlDefinition(): { default: unknown } {
    return { default: { id: "zenuml", detector: (text: string) => /^\s*zenuml/.test(text), loader: async () => (await zenUmlChunk()).mermaidZenuml.loader() } };
}
