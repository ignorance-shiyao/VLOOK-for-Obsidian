import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {verifyInstalled} from '../scripts/verify-installed.mjs';

test('安装校验覆盖嵌套配色文件，保持目标设置不变',()=>{
    const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'vlook-install-'));
    try{
        const source=path.join(tmp,'source'),target=path.join(tmp,'target');
        for(const dir of [source,target]){fs.mkdirSync(path.join(dir,'css'),{recursive:true});fs.writeFileSync(path.join(dir,'main.js'),'bundle');fs.writeFileSync(path.join(dir,'css/blue.css'),'theme');}
        const settings=path.join(target,'data.json');fs.writeFileSync(settings,'{"style":"blue"}');
        assert.equal(verifyInstalled(source,target),2);assert.equal(fs.readFileSync(settings,'utf8'),'{"style":"blue"}');
        fs.writeFileSync(path.join(target,'css/blue.css'),'old theme');assert.throws(()=>verifyInstalled(source,target),/内容不同.*blue\.css/);
    }finally{fs.rmSync(tmp,{recursive:true,force:true});}
});

test('安装校验明确报告缺失产物',()=>{
    const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'vlook-install-'));
    try{
        fs.mkdirSync(path.join(tmp,'source'));fs.mkdirSync(path.join(tmp,'target'));fs.writeFileSync(path.join(tmp,'source/main.js'),'bundle');
        assert.throws(()=>verifyInstalled(path.join(tmp,'source'),path.join(tmp,'target')),/缺少 main\.js/);
    }finally{fs.rmSync(tmp,{recursive:true,force:true});}
});

test('安装前验证全部内置配色、非空产物及清单，缺失/损坏时停止',async()=>{
    const {PLUGIN_ASSETS,validatePluginBuild,validateThemeBuild}=await import('../scripts/validate-build.mjs');
    const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'vlook-build-'));
    try{
        for(const relative of PLUGIN_ASSETS){const file=path.join(tmp,relative);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,relative==='manifest.json'?'{}':'built asset');}
        assert.throws(()=>validatePluginBuild(tmp),/清单无效/);
        fs.writeFileSync(path.join(tmp,'manifest.json'),JSON.stringify({id:'vlook',version:'0.1.0'}));
        assert.equal(validatePluginBuild(tmp),5);assert.equal(validateThemeBuild(tmp),2);
        fs.writeFileSync(path.join(tmp,'themes/blue.css'),'');assert.throws(()=>validatePluginBuild(tmp),/空文件 themes\/blue.css/);
        fs.rmSync(path.join(tmp,'themes/common.css'));assert.throws(()=>validateThemeBuild(tmp),/缺少 themes\/common.css/);
    }finally{fs.rmSync(tmp,{recursive:true,force:true});}
});

test('宿主配色内联原版字体定义，不使用被 CSP 禁止的外部样式表',{skip:!fs.existsSync(new URL('../upstream/released/themes',import.meta.url))},async()=>{
    const {transformCss}=await import('../scripts/css-transform.mjs');
    const css=await transformCss('@import url("vlook/pages-dev/fs-serif-min.css");#write p{color:red}');
    assert.match(css,/@font-face/);assert.match(css,/font-family:WanShiQuanXing/);
    assert.match(css,/https:\/\/openfonts\.pages\.dev\/v\//);
    assert.doesNotMatch(css,/@import[^;]*openfonts/);
    assert.match(css,/markdown-rendered/);
});
