function mediaNodes(root: HTMLElement): HTMLMediaElement[] {
    return [...(root.matches('audio,video') ? [root as HTMLMediaElement] : []), ...root.querySelectorAll<HTMLMediaElement>('audio,video')];
}

export function pauseContainedMedia(root: HTMLElement): void {
    mediaNodes(root).forEach(media => media.pause());
}

interface Playback {time: number; paused: boolean; volume: number; muted: boolean; rate: number}
const playback = (media: HTMLMediaElement): Playback => ({time: media.currentTime, paused: media.paused, volume: media.volume, muted: media.muted, rate: media.playbackRate});
function position(media: HTMLMediaElement, state: Playback): void {
    media.volume = state.volume; media.muted = state.muted; media.playbackRate = state.rate;
    try { media.currentTime = Number.isFinite(media.duration) ? Math.min(state.time, media.duration) : state.time; } catch { /* metadata 尚未加载时稍后重试 */ }
}
const play = (media: HTMLMediaElement) => { try { void media.play()?.catch(() => {}); } catch { /* 浏览器拒绝播放时保持暂停，不伪造播放成功 */ } };

/** Source-rendered fullscreen media temporarily owns playback; the original never plays underneath it. */
export class MediaHandoff {
    private entries: {original: HTMLMediaElement; state: Playback; clone?: HTMLMediaElement; loaded?: () => void}[];
    private closed = false;
    constructor(origin: HTMLElement) {
        this.entries = mediaNodes(origin).map(original => ({original, state: playback(original)}));
        this.entries.forEach(entry => entry.original.pause());
    }
    attach(root: HTMLElement): void {
        if (this.closed) return;
        const available = new Set(mediaNodes(root));
        for (const entry of this.entries) {
            const clone = Array.from(available).find(candidate => candidate.tagName === entry.original.tagName && candidate.src === entry.original.src);
            if (!clone) continue;
            available.delete(clone); entry.clone = clone;
            clone.autoplay = false;
            const loaded = () => position(clone, entry.state);
            entry.loaded = loaded; clone.addEventListener('loadedmetadata', loaded, {once: true});
            position(clone, entry.state);
            if (entry.state.paused) clone.pause(); else play(clone);
        }
    }
    release(resume: boolean): void {
        if (this.closed) return;
        this.closed = true;
        for (const entry of this.entries) {
            const state = entry.clone && entry.clone.readyState > 0 ? playback(entry.clone) : entry.state;
            if (entry.clone) {
                if (entry.loaded) entry.clone.removeEventListener('loadedmetadata', entry.loaded);
                entry.clone.pause();
            }
            // The source view may already have been replaced or closed.
            if (!entry.original.isConnected) continue;
            position(entry.original, state);
            if (resume && !state.paused) play(entry.original);
        }
    }
}
