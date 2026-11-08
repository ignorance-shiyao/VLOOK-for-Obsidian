// ZenUML 不再内置：仅保留“未启用”状态，供围栏源码保留逻辑使用。
interface ZenUmlRenderer { renderToSvg: (source: string) => { svg: string } }

export const zenUmlEnabled = (): boolean => false;

export function zenUmlChunk(): Promise<{ core: ZenUmlRenderer }> {
    return Promise.reject(new Error("ZenUML 不再内置"));
}
