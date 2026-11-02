// Original-runtime numbering oracle. Fixed public sample only; no vault content is read.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {adaptRuntime} from './runtime-transform.mjs';
import {setup,html as fixtureHtml} from '../test/harness.mjs';
const root=new URL('../',import.meta.url);
const runtime=adaptRuntime(await readFile(new URL('../upstream/released/plugin/plugin.txt',import.meta.url),'utf8'));
const css=await readFile(new URL('dist/css-typora/blue.css',root),'utf8');
const base=await readFile(new URL('src/generated/typora-base.txt',root),'utf8');
const content=`<h6>VLOOK 媒体顺序回归</h6><h1>正文</h1>
<p><img alt="Markdown 音频一" src="/one.mp3"></p>
<audio alt="HTML 音频二" src="/two.mp3"></audio>
<p><img alt="Markdown 音频三" src="/three.mp3"></p>
<p><img alt="Markdown 视频一" src="/one.mp4"></p>
<video alt="HTML 视频二" src="/two.mp4"></video>
<p><img alt="Markdown 视频三" src="/three.mp4"></p><p>结束正文</p>`;
const second=`<h1>第二章</h1>
<p><img alt="Markdown 音频四" src="/four.mp3"></p><audio alt="HTML 音频五" src="/five.mp3"></audio><p><img alt="Markdown 音频六" src="/six.mp3"></p>
<p><img alt="Markdown 视频四" src="/four.mp4"></p><video alt="HTML 视频五" src="/five.mp4"></video><p><img alt="Markdown 视频六" src="/six.mp4"></p><p>结束正文</p>`;
const tableContent=`<h6>VLOOK 表格媒体回归</h6><h1>正文</h1>
<table><thead><tr><th>类型</th><th>内容</th></tr></thead><tbody>
<tr><td>Markdown 音频</td><td><img alt="表内音频" src="/cell.mp3"></td></tr>
<tr><td>原生视频</td><td><video alt="表内原生视频" src="/cell.mp4"></video></td></tr>
</tbody></table><p><img alt="正文音频" src="/after.mp3"></p><p><img alt="正文视频" src="/after.mp4"></p><p>结束正文</p>`;
const nestedContent=`<h6>VLOOK 嵌套媒体回归</h6><h1>正文</h1>
<blockquote><p><img alt="引用音频" src="/quote.mp3"></p><blockquote><video alt="嵌套原生视频" src="/nested.mp4"></video></blockquote></blockquote>
<ul><li><img alt="列表音频" src="/list.mp3"><ul><li><img alt="嵌套列表视频" src="/list.mp4"></li></ul></li></ul>
<p><img alt="正文音频" src="/after.mp3"></p><p><img alt="正文视频" src="/after.mp4"></p><p>结束正文</p>`;
const figureContent=`<h6>VLOOK 插图分组回归</h6><h1>第一章</h1>
<p><img alt="Markdown 一" src="/one.png"><img alt="HTML 二" src="/two.png"></p>
<p><img alt="图标" src="/icon.svg#icon"></p><p><img alt="Markdown 三" src="/three.png"></p>
<h1>第二章</h1><p><img alt="HTML 四" src="/four.png"></p><p><img alt="Markdown 五" src="/five.png"><img alt="HTML 六" src="/six.png"></p><p>结束正文</p>`;
const captionContent=`<h6>VLOOK 前置题注回归</h6><h1>正文</h1>
<p><em><mark>两图空题注</mark></em></p><p><img alt="" src="/a.png"><img alt="" src="/b.png"></p>
<p><em><mark>首图自带时前置</mark></em></p><p><img alt="首图自带" src="/c.png"><img alt="" src="/d.png"></p>
<p><em><mark>次图自带时前置</mark></em></p><p><img alt="" src="/e.png"><img alt="次图自带" src="/f.png"></p><p>结束正文</p>`;
const modules=await setup();
const makeHtml=(group,table=false,nested=false,figures=false,captions=false,extension=false)=>{
 const host=fixtureHtml(captions?captionContent:figures?figureContent:nested?nestedContent:table?tableContent:group?content.replace('<p>结束正文</p>',second):content);modules.toTyporaDom(host,true,!captions||extension);
 return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="vlook-query" content="ws=0&capnum=on&capgroup=${group?'on':'off'}"><meta name="vlook-header-autonum" content="h1{{###. }}"><title>原版媒体编号顺序回归</title><style>${base}</style><style>${css}</style>${runtime}</head><body class="typora-export"><div class="typora-export-content"><div id="write">${host.innerHTML}</div></div></body></html>`;
};
const plain=makeHtml(false),grouped=makeHtml(true),table=makeHtml(false,true),nested=makeHtml(false,false,true),figures=makeHtml(true,false,false,true),captions=makeHtml(false,false,false,false,true),captionExtended=makeHtml(false,false,false,false,true,true);
createServer((req,res)=>{const url=new URL(req.url,'http://127.0.0.1');if(url.pathname==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(url.searchParams.get('captions')==='extended'?captionExtended:url.searchParams.get('captions')==='on'?captions:url.searchParams.get('figures')==='on'?figures:url.searchParams.get('nested')==='on'?nested:url.searchParams.get('table')==='on'?table:url.searchParams.get('groups')==='on'?grouped:plain)}else{res.statusCode=404;res.end('missing sample resource')}}).listen(18749,'127.0.0.1',()=>console.log('Original media numbering: http://127.0.0.1:18749/ (?groups=on for chapter grouping)'));
