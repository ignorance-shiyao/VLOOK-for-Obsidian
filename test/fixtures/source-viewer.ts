import {openSourceContentViewer} from '../../src/features/source-content-viewer';
import {getSourceIndex} from '../../src/core/source-index';
import {DEFAULT_SETTINGS,Query} from '../../src/core/context';
import {renderSection} from '../../src/render';

const source='![](first.svg) ![](sound.wav) ![](second.svg)',index=getSourceIndex(source,{captionGroup:false,captionNumber:true});
const root=document.querySelector<HTMLElement>('#source')!;
const slow=new URLSearchParams(location.search).get('slow')==='on';
const markup=('<p><img src="/first.svg"><audio src="/sound.wav" controls></audio><img src="/second.svg"></p>').replace('/first.svg',slow?'/slow-first.svg':'/first.svg');
const bus={on:()=>({}),offref(){}};
const app={fixtureMarkup:markup,workspace:{...bus,getLeavesOfType:()=>[],getActiveViewOfType:()=>null,getActiveFile:()=>({path:'fixture.md'}),openLinkText(){}},vault:bus};
const settings={...DEFAULT_SETTINGS,captions:false};
const ctx={app,settings,index,block:index.blocks[0],sourcePath:'fixture.md',query:new Query('capnum=on'),cssVar:()=>'',suppressContentViewers:true} as any;
root.innerHTML=markup;renderSection(root,ctx);
document.querySelector('#open-second')!.addEventListener('click',()=>openSourceContentViewer(root.querySelectorAll('img')[1],ctx));
document.querySelector('#open-audio')!.addEventListener('click',()=>openSourceContentViewer(root.querySelector('audio')!,ctx));
document.querySelector('#play-source')!.addEventListener('click',()=>void root.querySelector('audio')!.play());
const report=()=>{const dialog=document.querySelector<HTMLDialogElement>('dialog[open]');if(dialog&&!dialog.querySelector('#resize-proof')){const button=document.createElement('button');button.id='resize-proof';button.textContent='缩小浮窗（测试）';button.addEventListener('click',()=>{dialog.style.width='700px';dialog.style.height='400px';});dialog.querySelector('.vlook-content-controls')?.append(button);}
    document.querySelector('#state')!.textContent=`原文音频暂停 ${root.querySelector('audio')!.paused}；浮窗 ${document.querySelectorAll('dialog[open]').length}`;};
for(const event of ['play','pause'])root.querySelector('audio')!.addEventListener(event,report);
new MutationObserver(report).observe(document.body,{childList:true});report();
