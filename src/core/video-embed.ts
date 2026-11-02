/** Platforms supported by the original gSelector_iframeVideo, without matching unrelated query text. */
export function isVideoEmbed(src: string): boolean {
    let url: URL;
    try { url = new URL(src, 'https://vlook.invalid'); } catch { return false; }
    if (!['http:', 'https:'].includes(url.protocol)) return false;
    const host = url.hostname.toLowerCase();
    const matches = (domain: string) => host === domain || host.endsWith('.' + domain);
    return matches('bilibili.com') && url.pathname.includes('/player')
        || matches('douyin.com') && url.pathname.includes('/player')
        || matches('ixigua.com') && url.pathname.includes('/iframe')
        || matches('qq.com') && url.pathname.includes('/txp/iframe')
        || matches('youtube.com') && url.pathname.includes('/embed');
}
