import { requestUrl } from "obsidian";

/** 读取资源：网络地址走 requestUrl（不受跨域限制）；app:// 等本地资源地址只能由页面自身读取。 */
export async function readResource(url: string, signal?: AbortSignal): Promise<{ ok: boolean; status: number; text(): Promise<string>; bytes(): Promise<ArrayBuffer> }> {
    if (/^https?:/i.test(url)) {
        const res = await requestUrl({ url, throw: false });
        return { ok: res.status >= 200 && res.status < 300, status: res.status, text: () => Promise.resolve(res.text), bytes: () => Promise.resolve(res.arrayBuffer) };
    }
    const res = await window.fetch(url, { signal });
    return { ok: res.ok, status: res.status, text: () => res.text(), bytes: () => res.arrayBuffer() };
}
