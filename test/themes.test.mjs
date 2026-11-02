import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {packThemes, assemble, shareParts} from '../scripts/pack-themes.mjs';

const shared = 'p{margin:0;padding:0;color:inherit}h1{font-size:2em;line-height:1.2;font-weight:700}';
const tail = 'table{border-collapse:collapse;width:100%}td{vertical-align:top;border:1px solid}';
const css = (name, color) => `@import url("https://fonts.example/${name}.css");:root{--ac:${color};--name:${name}}${shared}a{color:${color}}${tail}`;
const read = (dir, id) => fs.readFileSync(path.join(dir, `${id}.css`), 'utf8');
const parts = text => Object.fromEntries([...text.matchAll(/\/\*@vlook-part (\w+)\*\/\n((?:(?!\/\*@vlook-part)[\s\S])*)/g)].map(m => [m[1], m[2].replace(/\n$/, '')]));

test('主题拆分：公共规则写入 common.css，主题文件只含独有规则，组装后层叠与原文一致', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vlook-themes-'));
    try {
        const sources = {obsidian: {a: css('a', 'red'), b: css('b', 'blue')}, export: {a: css('a', 'pink'), b: css('b', 'navy')}};
        packThemes(sources, {a: {name: 'A', color: '#f00'}, b: {name: 'B', color: '#00f'}}, tmp);
        const common = parts(read(tmp, 'common'));
        assert.match(common.obsidian, /margin:0/);
        for (const id of ['a', 'b']) {
            const file = read(tmp, id);
            assert.deepEqual(JSON.parse(file.match(/^\/\*@vlook-theme (\{.*?\})\*\//)[1]), {name: id.toUpperCase(), color: id === 'a' ? '#f00' : '#00f'});
            const own = parts(file);
            assert.doesNotMatch(own.obsidian, /margin:0/);
            assert.match(own.obsidian, new RegExp(`--name:${id}`));
            const full = assemble(common.obsidian, own.obsidian);
            assert.ok(full.startsWith(`@import url("https://fonts.example/${id}.css");`));
            assert.match(full, /margin:0/);
        }
    } finally { fs.rmSync(tmp, {recursive: true, force: true}); }
});

test('主题拆分：前移会改变层叠结果的公共规则留在各主题内', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vlook-themes-'));
    try {
        const mk = color => `p{color:${color}}p{margin:0;padding:0;color:inherit}${tail}`;
        const sources = {obsidian: {a: mk('red'), b: mk('blue')}, export: {a: mk('red'), b: mk('blue')}};
        packThemes(sources, {a: {name: 'A', color: ''}, b: {name: 'B', color: ''}}, tmp);
        assert.doesNotMatch(parts(read(tmp, 'common')).obsidian, /color:inherit/);
        assert.match(parts(read(tmp, 'a')).obsidian, /color:inherit/);
    } finally { fs.rmSync(tmp, {recursive: true, force: true}); }
});

test('两部分共用的大体积根变量只存一份，层叠会变的不提取', () => {
    const big = 'url(data:image/png;base64,' + 'A'.repeat(2500) + ')';
    const parts = {obsidian: `body{--img:${big};--x:1}a{color:red}`, export: `:root{--img:${big};--y:2}b{color:blue}`};
    const out = shareParts(parts);
    assert.ok(out.shared.startsWith(':root,body{--img:'));
    assert.ok(!out.obsidian.includes('AAAA') && !out.export.includes('AAAA'));
    assert.match(out.obsidian, /--x:1/);assert.match(out.export, /--y:2/);
    // 同一变量先被另一个值设置、再由它设置：前移会让先前的值胜出，保持原样
    const clash = {obsidian: `body{--img:none}body{--img:${big}}`, export: `:root{--img:${big}}`};
    assert.equal(shareParts(clash).shared, '');
});
