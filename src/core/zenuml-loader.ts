// 按需加载 zenuml.js（见 src/zenuml-chunk.ts）：首次渲染 ZenUML 图表时读取并执行，之后复用。
interface ZenUmlChunk { mermaidZenuml: { loader: () => Promise<unknown> }; core: { renderToSvg: (source: string) => { svg: string } } }

const enabled = false;
export const zenUmlEnabled = (): boolean => enabled;

export function zenUmlChunk(): Promise<ZenUmlChunk> {
    return Promise.reject(new Error("ZenUML 不再内置"));
}

/** Mermaid 外部图表定义：检测与注册即时完成，渲染器在首次绘制时才加载。 */
export function lazyZenUmlDefinition(): { default: unknown } {
    return { default: { id: "zenuml", detector: (text: string) => /^\s*zenuml/.test(text), loader: async () => (await zenUmlChunk()).mermaidZenuml.loader() } };
}
