// Read-only application resources. No notes or preferences are accessed.
import {open,mkdir,writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
const version=process.argv[2];
if(process.platform!=='darwin'||!/^\d+\.\d+\.\d+$/.test(version||''))throw Error('用法：node scripts/extract-host-mathjax.mjs <已确认运行的版本>');
const file=await open(join(homedir(),'Library/Application Support/obsidian',`obsidian-${version}.asar`),'r');
try{
 const h=Buffer.alloc(16);await file.read(h,0,16,0);const size=h.readUInt32LE(12),base=8+h.readUInt32LE(4);if(size>64*1024*1024)throw Error('无效头部');
 const bytes=Buffer.alloc(size);await file.read(bytes,0,size,16);const tree=JSON.parse(bytes);
 const read=async path=>{let entry=tree;for(const part of path.split('/'))entry=entry.files?.[part];if(!entry||entry.unpacked||!Number.isSafeInteger(entry.size)||entry.size>32*1024*1024)throw Error(`不支持的条目 ${path}`);const out=Buffer.alloc(entry.size);await file.read(out,0,out.length,base+Number(entry.offset));return out;};
 const pkg=JSON.parse(await read('package.json'));if(pkg.version!==version)throw Error('包版本不一致');
 const root='/tmp/vlook-host-mathjax';const assets=[];
 const walk=async(node,path='')=>{for(const [name,entry] of Object.entries(node.files||{})){if(name==='.'||name==='..'||name.includes('/'))throw Error('无效路径');const relative=path+name;if(entry.files)await walk(entry,relative+'/');else if(relative==='obsidian-mathjax.js'||/^(?:tex-font|mhchem-font-extension)\/chtml\/woff2\/[\w-]+\.woff2$/.test(relative)){const data=await read('lib/mathjax/'+relative),target=join(root,relative);await mkdir(dirname(target),{recursive:true});await writeFile(target,data);assets.push({path:relative,bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')});}}};
 await walk(tree.files.lib.files.mathjax);
 if(!assets.some(a=>a.path==='obsidian-mathjax.js'))throw Error('缺少数学引擎');
 await writeFile(join(root,'manifest.json'),JSON.stringify({obsidian:version,assets},null,2));console.log(JSON.stringify({obsidian:version,assets:assets.length,engine:assets.find(a=>a.path==='obsidian-mathjax.js')}));
}finally{await file.close();}
