import fs from 'node:fs';
import {validatePluginBuild} from './validate-build.mjs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

/** Check every built asset; settings or other vault files are never read or changed. */
export function verifyInstalled(source,target) {
    let checked=0;const failures=[];
    const walk=(relative='')=>{
        for(const entry of fs.readdirSync(path.join(source,relative),{withFileTypes:true})){
            const item=path.join(relative,entry.name);
            if(entry.isDirectory()){walk(item);continue;}
            if(!entry.isFile())continue;
            const installed=path.join(target,item);
            if(!fs.existsSync(installed)||!fs.statSync(installed).isFile()){failures.push(`缺少 ${item}`);continue;}
            if(!fs.readFileSync(path.join(source,item)).equals(fs.readFileSync(installed)))failures.push(`内容不同 ${item}`);
            checked++;
        }
    };
    walk();
    if(failures.length)throw Error(`VLOOK 安装校验失败：\n${failures.join('\n')}`);
    return checked;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
    const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
    const vault=path.resolve(process.argv[2]||process.env.VLOOK_VAULT||path.join(root,'test-vault'));
    validatePluginBuild(path.join(root,'dist/plugin'));
    const checked=verifyInstalled(path.join(root,'dist/plugin'),path.join(vault,'.obsidian/plugins/vlook'));
    console.log(`✓ ${checked} 个构建文件与安装目录一致：${vault}`);
}
