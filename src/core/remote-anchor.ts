import { vlookAnchor } from './anchor';
import { decodeUrlPart } from './url';
import type { LinkMapGroup } from './link-map';

/** Original LinkTool_checkHashSet protocol; the target VLOOK page performs the check. */
export function remoteAnchorCheckUrl(group: LinkMapGroup): string | null {
    if (!/^https?:\/\//i.test(group.document) || !group.anchors.length) return null;
    let url: URL;
    try { url = new URL(group.document); } catch { return null; }
    url.hash = '';
    // Reopening a previous check must not retain its obsolete target set.
    for (const key of Array.from(url.searchParams.keys())) {
        if (/^hash\d+$/.test(key)) url.searchParams.delete(key);
    }
    const anchors = Array.from(new Set(group.anchors.map(item => vlookAnchor(decodeUrlPart(item.hash))).filter(Boolean)));
    if (!anchors.length) return null;
    url.searchParams.set('checkhash', '1');
    url.searchParams.set('checkcount', String(anchors.length));
    url.searchParams.set('ws', '0');
    anchors.forEach((anchor, n) => url.searchParams.set(`hash${n + 1}`, anchor));
    const result = url.toString();
    if (result.length > 8000) throw new Error('远程锚点检查地址超过原版 8000 字符上限，请减少该目标的锚点数量');
    return result;
}
