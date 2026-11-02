// Full official runtime + production exported GIF initializer, fixed local resources only.
import {createServer} from 'node:http';
import {readFile,writeFile} from 'node:fs/promises';
import {setup} from '../test/harness.mjs';
import {adaptRuntime} from './runtime-transform.mjs';
const modules=await setup(),root=new URL('../',import.meta.url);
const runtime=adaptRuntime(await readFile(new URL('../upstream/released/plugin/plugin.txt',import.meta.url),'utf8'));
const css=await readFile(new URL('dist/css-typora/blue.css',root),'utf8'),base=await readFile(new URL('src/generated/typora-base.txt',root),'utf8');
const gif=await readFile(new URL('../upstream/released/samples/pic/vlook-theme-note.gif',import.meta.url));
const svg='<svg xmlns="http://www.w3.org/2000/svg" width="640" height="320"><rect width="640" height="320" fill="#3978e8"/><text x="80" y="170" fill="white" font-size="36">GIF COVER - click to play</text></svg>';
const page=`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="vlook-query" content="ws=0"><title>GIF 完整运行时验证</title><style>${base}</style><style>${css}</style>${runtime}</head><body class="typora-export"><div class="typora-export-content"><div id="write"><h1>GIF 完整运行时验证</h1><p>点击封面播放，空格停止。验证实际 currentSrc 与图片解码。</p><p><img alt="GIF 动画演示" src="/demo.svg?srcset=@2x#gif#400w"></p></div></div><script>(${modules.installExportGifControls.toString()})(document);</script></body></html>`;
await writeFile('/tmp/vlook-gif-export-runtime.html',page);
createServer((req,res)=>{const path=new URL(req.url,'http://localhost').pathname;if(path==='/'){res.setHeader('Content-Type','text/html;charset=utf-8');res.end(page)}else if(path==='/demo.gif'){res.setHeader('Content-Type','image/gif');res.end(gif)}else if(path==='/demo.svg'||path==='/demo@2x.svg'){res.setHeader('Content-Type','image/svg+xml');res.end(svg)}else{res.statusCode=404;res.end('missing')}}).listen(18764,'127.0.0.1',()=>console.log('http://127.0.0.1:18764/'));
