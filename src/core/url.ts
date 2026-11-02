/** 仅对已分隔的 URL 路径或参数使用，字面百分号不应中断整篇渲染。 */
export function decodeUrlPart(value: string): string {
    try { return decodeURIComponent(value.replace(/%(?![0-9a-f]{2})/gi, "%25")); } catch { return value; }
}

/** 文件名里的 #、? 属于路径，不得变成 URL 片段或参数。 */
export function encodeResourcePath(path: string): string {
    return path.split('/').map(part => encodeURIComponent(part)).join('/');
}

/** 不截断值里的等号或问号，并容忍内容作者写入的字面百分号。 */
export function resourceQuery(src: string): Record<string, string> {
    const beforeHash = src.split('#')[0];
    const question = beforeHash.indexOf('?');
    const out: Record<string, string> = {};
    if (question < 0) return out;
    for (const entry of beforeHash.slice(question + 1).split('&')) {
        const equals = entry.indexOf('=');
        const key = equals < 0 ? entry : entry.slice(0, equals);
        if (!key) continue;
        out[decodeUrlPart(key)] = decodeUrlPart(equals < 0 ? '' : entry.slice(equals + 1));
    }
    return out;
}
