import fs from 'node:fs';
import path from 'node:path';

/** 随插件内置的主题文件：公共样式与默认主题；其余主题由用户放入或下载。 */
export const THEME_ASSETS=['themes/common.css','themes/blue.css'];
export const PLUGIN_ASSETS=['main.js','zenuml.js','manifest.json','styles.css',...THEME_ASSETS];

function requireFiles(root,files){
    const failures=[];
    for(const relative of files){
        const file=path.join(root,relative);
        if(!fs.existsSync(file)||!fs.statSync(file).isFile())failures.push(`缺少 ${relative}`);
        else if(fs.statSync(file).size===0)failures.push(`空文件 ${relative}`);
    }
    if(failures.length)throw Error(`VLOOK 构建产物不完整，未安装：\n${failures.join('\n')}`);
    return files.length;
}
export function validateThemeBuild(root){return requireFiles(root,THEME_ASSETS)}
export function validatePluginBuild(root){
    const count=requireFiles(root,PLUGIN_ASSETS);
    let manifest;
    try{manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'))}catch{throw Error('VLOOK manifest.json 无法解析，未安装')}
    if(manifest.id!=='vlook'||typeof manifest.version!=='string'||!manifest.version.trim())throw Error('VLOOK 插件清单无效，未安装');
    return count;
}
