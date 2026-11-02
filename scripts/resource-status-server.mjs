// Controlled HTTP responses for real browser regression. No filesystem writes or vault access.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
const root=new URL('../',import.meta.url);
const bundle=await build({entryPoints:[new URL('test/fixtures/resource-status.ts',root).pathname],bundle:true,write:false,format:'esm',platform:'browser'});
const html=await readFile(new URL('test/fixtures/resource-status.html',root));
const css=await readFile(new URL('styles/plugin.css',root));
const video=await readFile(new URL('../upstream/docs/media/a_sky_full_of_stars-480p.mp4',import.meta.url));
const svg='<svg xmlns="http://www.w3.org/2000/svg" width="120" height="64"><rect width="120" height="64" rx="8" fill="#165dff"/><text x="60" y="39" text-anchor="middle" fill="white" font-size="22">OK</text></svg>';
// One second of silent PCM: test actual decoding/playback without emitting sound.
const wav=Buffer.alloc(44+16000);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(16000,40);
let requests=0,audioRequests=0;
const server=createServer((req,res)=>{
 const path=new URL(req.url,'http://127.0.0.1').pathname;
 res.setHeader('Cache-Control','no-store');
 const send=(type,data)=>{res.setHeader('Content-Type',type);res.end(data)};
 if(path==='/')return send('text/html; charset=utf-8',new URL(req.url,'http://127.0.0.1').searchParams.get('frameorigin')==='cross'?html.toString().replace('iframe src="/frame-proof"','iframe src="http://localhost:18748/frame-proof"'):html);
 if(path==='/frame-proof')return send('text/html; charset=utf-8',`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><body style="font:18px system-ui"><p id="count">页面内计数 0</p><button onclick="document.getElementById('count').textContent='页面内计数 '+(++window.count)" type="button">增加计数</button><script>window.count=0</script></body></html>`);
 if(path==='/plugin.css')return send('text/css',css);
 if(path==='/resource-status.bundle.js')return send('text/javascript',bundle.outputFiles[0].contents);
 if(path==='/sample.mp4'){
  const match=req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
  res.setHeader('Accept-Ranges','bytes');res.setHeader('Content-Type','video/mp4');
  if(match){const start=Number(match[1]),end=match[2]?Math.min(Number(match[2]),video.length-1):video.length-1;
   if(start>=video.length||end<start){res.statusCode=416;res.setHeader('Content-Range',`bytes */${video.length}`);return res.end()}
   res.statusCode=206;res.setHeader('Content-Range',`bytes ${start}-${end}/${video.length}`);res.setHeader('Content-Length',end-start+1);return res.end(video.subarray(start,end+1));
  }return res.end(video);
 }
 if(path==='/ok.wav')return send('audio/wav',wav);
 if(path==='/retry.wav'){
  if(req.headers['sec-fetch-dest']==='image'){res.statusCode=404;return res.end('not an image')}
  if(++audioRequests===1){res.statusCode=404;return res.end('first audio request fails')}
  return setTimeout(()=>send('audio/wav',wav),1500);
 }
 if(path==='/retry.svg'&&++requests===1){res.statusCode=404;return res.end('first request fails')}
 if(path==='/retry.svg')return setTimeout(()=>send('image/svg+xml',svg),1500);
 if(path==='/ok.svg')return send('image/svg+xml',svg);
 res.statusCode=404;res.end('missing');
});
server.listen(18748,'127.0.0.1',()=>console.log('Resource regression: http://127.0.0.1:18748/ (restart server to reset first failure)'));
