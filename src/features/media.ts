import {isLiteralContent} from '../core/literal-dom';
// 音频 / 视频：与图片语法一致 ![上题注](media.mp3?参数 "下题注")
// 移植自 vlook.js ExtAudio_init / ExtVideo：URL 参数 controls=mini、pause、duration、autoplay、loop、preload、width、height

import { resourceQuery } from "../core/url";
import type { RenderCtx } from "../core/context";
import { newEl, setHtml, svgIcon } from '../core/dom';
export const AUDIO_EXT = /\.(mp3|m4a|ogg|wav)$/i;
export const VIDEO_EXT = /\.(mp4|webm|ogv|mov|m4v)$/i;


const icon = (id: string) => svgIcon(id, 16, 16, "btn-fc");
let miniCounter = 0;

function applyCommon(el: HTMLMediaElement, p: Record<string, string>) {
    if (p.autoplay !== undefined) el.autoplay = true;
    if (p.loop !== undefined) el.loop = true;
    el.setAttribute('preload', p.preload === "true" ? "auto" : p.preload ?? "metadata");
}

function buildMiniAudio(audio: HTMLAudioElement, p: Record<string, string>, ctx: RenderCtx): HTMLElement {
    const Controller=audio.ownerDocument.defaultView?.AbortController||AbortController;
    const lifecycle=new Controller();
    const on=<K extends keyof HTMLElementEventMap>(target:HTMLElement,name:K,handler:(event:HTMLElementEventMap[K])=>void)=>target.addEventListener(name,handler,{signal:lifecycle.signal});
    const id = `vk-id-mini-audio${++miniCounter}`;
    audio.id = id;
    const ctl = newEl(audio.ownerDocument, "div");
    ctl.id = `${id}-control`;
    ctl.className = "v-audio-mini-control disabled";
    ctl.dataset.title = `mini audio ${miniCounter}`;
    const pauseMode = p.pause === "true";
    let playAttempt = 0;
    ctl.tabIndex = 0;
    ctl.setAttribute("role", "button");
    ctl.setAttribute("aria-controls", id);
    const state = (name:string, label:string) => {
        ctl.dataset.vlookAudioState=name;
        ctl.setAttribute("aria-label",label);
        ctl.setAttribute("aria-pressed",String(name==='playing'));
        ctl.setAttribute("aria-busy",String(name==='loading'));
        ctl.setAttribute("aria-disabled",String(ctl.classList.contains('disabled')));
    };
    const ready = () => {
        ctl.classList.remove("playing", "loading");setHtml(ctl,icon("icoPlay"));
        state('ready','播放音频');
    };
    on(ctl,"click", ev => {
        ev.preventDefault();ev.stopPropagation();ctl.focus({preventScroll:true});
        if (ctl.classList.contains("disabled")) return;
        if (audio.paused) {
            const mine = ++playAttempt;
            void audio.play().catch(() => {
                if(mine!==playAttempt||lifecycle.signal.aborted||!audio.paused||ctl.classList.contains('disabled'))return;
                ready();state('ready','无法播放音频，请重试');
            });
        } else if (pauseMode) audio.pause();
        else { audio.pause(); audio.currentTime = 0; ready(); }
    });
    on(ctl,'keydown',event=>{
        if((event.key!=='Enter'&&event.key!==' ')||event.ctrlKey||event.metaKey||event.altKey||event.shiftKey||event.isComposing)return;
        event.preventDefault();event.stopPropagation();if(!event.repeat)ctl.click();
    });
    let durationLabel: HTMLElement | null = null, durationSpace: Text | null = null;
    const clearDuration = () => {
        durationLabel?.remove(); durationSpace?.remove();
        durationLabel = null; durationSpace = null; delete audio.dataset.duration;
    };
    on(audio,"loadstart", () => {
        playAttempt++; clearDuration();
        ctl.classList.add("loading","disabled");ctl.classList.remove('playing');
        setHtml(ctl,icon("icoLoading"));state('loading','正在加载音频');
    });
    const duration = () => {
        if(p.duration!=="true")return;
        if(!Number.isFinite(audio.duration)||audio.duration<0){clearDuration();return;}
        const d=audio.duration,min=Math.floor(d/60),sec=Math.floor(d-min*60);
        if(!durationLabel){
            durationLabel=newEl(audio.ownerDocument, "sup"); durationLabel.className="v-duration";
            durationSpace=audio.ownerDocument.createTextNode(" "); ctl.after(durationSpace,durationLabel);
        }
        durationLabel.textContent=`${min>0?min+"′":""}${sec}″`;
        audio.dataset.duration="true";
    };
    on(audio,"canplay", () => {
        ctl.classList.remove("loading","disabled");
        if(audio.paused)ready();
        else {ctl.classList.add('playing');setHtml(ctl,icon(pauseMode?'icoPause':'icoStop'));state('playing',pauseMode?'暂停音频':'停止音频');}
        duration();
    });
    on(audio,'durationchange',duration);
    on(audio,"playing", () => {
        ctl.classList.remove('loading','disabled');ctl.classList.add("playing");
        setHtml(ctl,icon(pauseMode?"icoPause":"icoStop"));state('playing',pauseMode?'暂停音频':'停止音频');
    });
    const stopped = () => {
        playAttempt++;
        // load()/unload can emit pause after error or loadstart. It is not a successful recovery.
        if (ctl.classList.contains('disabled') || audio.error) return;
        ready();
    };
    on(audio,"pause", stopped);
    on(audio,"ended", stopped);
    on(audio,"error", () => {
        playAttempt++;
        ctl.classList.remove("loading","playing");ctl.classList.add("disabled");
        setHtml(ctl,icon("icoForbidden"));state('error','音频加载失败');
    });
    setHtml(ctl,icon("icoLoading"));state('loading','正在加载音频');
    ctx.registerCleanup?.(()=>{playAttempt++;clearDuration();lifecycle.abort();ctl.classList.add("disabled");ctl.tabIndex=-1;state('unloaded','播放器已卸载');});
    return ctl;
}

/** 把指向音视频的 <img> 转换为 <audio> / <video>（须在图片处理之前执行） */
export function processMedia(root: HTMLElement, ctx: RenderCtx): void {
    root.querySelectorAll<HTMLImageElement>("img[src]").forEach(img => {
        if(isLiteralContent(img))return;
        const src = img.getAttribute("src") || "";
        const path = src.split(/[?#]/)[0];
        const isAudio = AUDIO_EXT.test(path), isVideo = VIDEO_EXT.test(path);
        if (!isAudio && !isVideo) return;
        const p = resourceQuery(src);
        const el = newEl(img.ownerDocument, isAudio ? "audio" : "video");
        el.src = src;
        applyCommon(el, p);
        if (img.alt) el.dataset.caption = img.alt;
        if (img.title) el.title = img.title;
        if (isVideo) {
            el.controls = true;
            if (p.width) el.setAttribute("width", p.width);
            if (p.height) el.setAttribute("height", p.height);
            img.replaceWith(el);
            return;
        }
        if (p.controls === "mini") {
            const ctl = buildMiniAudio(el, p, ctx);
            img.replaceWith(el, ctl);
        } else {
            el.controls = true;
            img.replaceWith(el);
        }
    });
    if(ctx.registerCleanup){
        const media=Array.from(root.querySelectorAll<HTMLMediaElement>('audio,video')).filter(item=>!isLiteralContent(item));
        if(media.length)ctx.registerCleanup(()=>media.forEach(item=>{
            item.pause();
        }));
    }
}
