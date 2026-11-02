// Browser UI regression for the real viewer; fixed renderer fixture, no vault access.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
const root=new URL('../',import.meta.url);
const bundle=await build({entryPoints:[new URL('test/fixtures/source-viewer.ts',root).pathname],bundle:true,write:false,format:'esm',platform:'browser',plugins:[{name:'fixed-host',setup(b){b.onResolve({filter:/^obsidian$/},()=>({path:'obsidian',namespace:'fixed'}));b.onLoad({filter:/.*/,namespace:'fixed'},()=>({contents:`export class Component {load(){} register(fn){(this.cleanups||=[]).push(fn)} unload(){for(const fn of this.cleanups||[])fn();this.cleanups=[]}} export class MarkdownView {} export class Notice {} export class FuzzySuggestModal {} export const MarkdownRenderer={async render(app,_source,el){el.innerHTML=app.fixtureMarkup}};`,loader:'js'}));}}]});
const css=await readFile(new URL('styles/plugin.css',root),'utf8');
const wav=Buffer.alloc(44+160000);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(160000,40);
createServer((req,res)=>{
 const path=new URL(req.url,'http://127.0.0.1').pathname;const send=(type,data)=>{res.setHeader('Content-Type',type);res.end(data)};
 if(path==='/bundle.js')return send('text/javascript',bundle.outputFiles[0].contents);
 if(path==='/sound.wav')return send('audio/wav',wav);
 if(path==='/slow-first.svg'){return setTimeout(()=>send('image/svg+xml','<svg xmlns="http://www.w3.org/2000/svg" width="600" height="700"><rect width="600" height="700" fill="#dbeafe"/><text x="100" y="350" font-size="54">SLOW FIRST</text></svg>'),3500);}
 if(path==='/first.svg'||path==='/second.svg')return send('image/svg+xml',`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="700"><rect width="600" height="700" fill="${path==='/first.svg'?'#dbeafe':'#bfdbfe'}"/><text x="100" y="350" font-size="54">${path==='/first.svg'?'FIRST':'SECOND'}</text></svg>`);
 if(path==='/')return send('text/html; charset=utf-8',`<!doctype html><html><meta charset="utf-8"><style>${css}body{font:16px system-ui;margin:24px}#source img{display:block;width:600px}dialog{background:white;color:#172b4d;max-height:85vh}.vlook-content-body img{display:block;width:600px}button,select{padding:8px}</style><h1>全文浏览实际交互回归</h1><p>固定宿主渲染样例；真实浏览器运行生产 viewer / render / media，非 Obsidian 实机验收。</p><button id="open-second">从第二张无题注图片打开</button><button id="play-source">播放原文静音音频</button><button id="open-audio">从音频打开</button><p id="state"></p><div id="source"></div><script type="module" src="/bundle.js"></script></html>`);
 res.statusCode=404;res.end('missing');
}).listen(18750,'127.0.0.1',()=>console.log('Viewer regression: http://127.0.0.1:18750/'));
