import {borrowContent} from '../../src/core/content-move';
import {MediaHandoff} from '../../src/core/media-handoff';
import {processResourceStatus,renderedResourceFailures} from '../../src/features/resource-status';
import {processMedia} from '../../src/features/media';
import {ICON_SPRITE} from '../../src/generated/icons';
import {ResourceFailureHistory} from '../../src/core/resource-history';
import type {RenderCtx} from '../../src/core/context';

const sprite=document.createElement('div');sprite.hidden=true;sprite.innerHTML=ICON_SPRITE;document.body.append(sprite);
const history=new ResourceFailureHistory(),source='资源浏览器回归';
const roots=Array.from(document.querySelectorAll<HTMLElement>('[data-resource]'));
const update=()=>{
    const failures=roots.flatMap(root=>renderedResourceFailures(root,'fixture.md',source));
    document.querySelector('#summary')!.textContent=`当前失败 ${failures.length}，历史待恢复 ${history.results('fixture.md',source).length}`;
};
for(const root of roots){
    processMedia(root,{} as RenderCtx);
    processResourceStatus(root,{sourcePath:'fixture.md',block:{start:0,end:0},index:{text:source},resourceHistory:history} as RenderCtx);
    root.addEventListener('click',()=>queueMicrotask(update),true);
    for(const resource of root.querySelectorAll('img,audio,video'))for(const event of ['error','load','loadeddata'])resource.addEventListener(event,update);
}
update();

const video=document.querySelector<HTMLVideoElement>('#video-valid video')!;
video.muted=true;
const videoState=()=>{document.querySelector('#video-state')!.textContent=`就绪 ${video.readyState}，尺寸 ${video.videoWidth}×${video.videoHeight}，状态 ${video.paused?'暂停':'播放'}，进度 ${video.currentTime.toFixed(2)}秒`;};
for(const event of ['loadeddata','playing','pause','timeupdate'])video.addEventListener(event,videoState);
document.querySelector('#video-play')!.addEventListener('click',()=>{void video.play().catch(error=>{document.querySelector('#video-state')!.textContent=error.message;});});
document.querySelector('#video-pause')!.addEventListener('click',()=>video.pause());
videoState();

document.querySelector('#video-handoff')!.addEventListener('click',()=>{
    const handoff=new MediaHandoff(document.querySelector<HTMLElement>('#video-valid')!);
    const dialog=document.createElement('dialog');dialog.style.padding='24px';
    const clone=document.createElement('video');clone.src=video.src;clone.controls=true;clone.width=480;
    const result=document.createElement('p');result.id='handoff-live';
    const update=()=>{result.textContent=`原文暂停 ${video.paused}；全屏暂停 ${clone.paused}；全屏进度 ${clone.currentTime.toFixed(2)}秒`;};
    for(const event of ['playing','pause','timeupdate'])clone.addEventListener(event,update);
    const close=document.createElement('button');close.type='button';close.textContent='关闭并归还播放';
    close.addEventListener('click',()=>dialog.close());
    dialog.addEventListener('close',()=>{handoff.release(true);document.querySelector('#handoff-result')!.textContent=`已归还：原文暂停 ${video.paused}，全屏暂停 ${clone.paused}，原文进度 ${video.currentTime.toFixed(2)}秒`;dialog.remove();},{once:true});
    dialog.append(clone,result,close);document.body.append(dialog);dialog.showModal();handoff.attach(dialog);update();
});

const frame=document.querySelector<HTMLIFrameElement>('#embedded-proof iframe')!;
let frameLoads=frame.contentDocument?.URL===frame.src&&frame.contentDocument.readyState==='complete'?1:0;
const frameReport=()=>{document.querySelector('#frame-loads')!.textContent=`iframe 载入次数 ${frameLoads}`;};
frame.addEventListener('load',()=>{frameLoads++;frameReport();});frameReport();
document.querySelector('#frame-borrow')!.addEventListener('click',()=>{
    const dialog=document.createElement('dialog');dialog.style.padding='24px';const host=document.createElement('div');
    const close=document.createElement('button');close.type='button';close.textContent='归还原 iframe';
    dialog.append(host,close);document.body.append(dialog);
    const borrowed=borrowContent(frame,host);
    if(!borrowed){document.querySelector('#frame-loads')!.textContent='当前内核不支持保留状态移动';dialog.remove();return;}
    close.addEventListener('click',()=>dialog.close());dialog.addEventListener('close',()=>{borrowed.restore(true);dialog.remove();frameReport();},{once:true});
    dialog.showModal();
});
