// Read only the installed application archive. No vault or preferences are accessed.
import {open,writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const version=process.argv[2];
if(process.platform!=='darwin'||!/^\d+\.\d+\.\d+$/.test(version||''))throw Error('用法（macOS）：node scripts/extract-host-mermaid.mjs <已确认运行的 Obsidian 版本>');
const archive=join(homedir(),'Library/Application Support/obsidian',`obsidian-${version}.asar`),file=await open(archive,'r');
try{
 const header=Buffer.alloc(16);await file.read(header,0,16,0);
 const size=header.readUInt32LE(12),base=8+header.readUInt32LE(4);
 if(size>64*1024*1024)throw Error('不支持的 ASAR 头部大小');
 const json=Buffer.alloc(size);await file.read(json,0,size,16);const tree=JSON.parse(json.toString());
 const read=async(path)=>{let entry=tree;for(const part of path.split('/'))entry=entry.files?.[part];if(!entry||entry.unpacked||!Number.isSafeInteger(entry.size)||entry.size>32*1024*1024)throw Error(`不支持的内置条目：${path}`);const bytes=Buffer.alloc(entry.size);await file.read(bytes,0,bytes.length,base+Number(entry.offset));return bytes;};
 const pkg=JSON.parse((await read('package.json')).toString());if(pkg.version!==version)throw Error(`版本不一致：请求 ${version}，包内 ${pkg.version}`);
 const engine=await read('lib/mermaid.min.js'),sha256=createHash('sha256').update(engine).digest('hex');
 await writeFile('/tmp/vlook-host-mermaid.min.js',engine);
 const metadata={obsidian:version,engineSource:engine.toString('utf8',0,150).split('\n')[0],sha256,bytes:engine.length};
 await writeFile('/tmp/vlook-host-mermaid-meta.json',JSON.stringify(metadata,null,2)+'\n');console.log(JSON.stringify(metadata));
}finally{await file.close();}
