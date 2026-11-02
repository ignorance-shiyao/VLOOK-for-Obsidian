#!/usr/bin/env node
// Read-only PDF acceptance gate. Requires Poppler; never rewrites the supplied PDF.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

const args = process.argv.slice(2), input = args.shift();
const expected = [], excluded = [];
if (!input) {
    console.error('Usage: node scripts/check-pdf.mjs file.pdf [--expect text] [--exclude text]');
    process.exit(2);
}
while (args.length) {
    const flag = args.shift(), value = args.shift();
    if (value === undefined || !['--expect', '--exclude'].includes(flag)) {
        console.error('Only --expect text and --exclude text are supported.'); process.exit(2);
    }
    (flag === '--expect' ? expected : excluded).push(value);
}
try {
    const path = resolve(input), bytes = readFileSync(path);
    const run = (command, parameters) => execFileSync(command, parameters, {encoding: 'utf8', maxBuffer: 64 * 1024 * 1024});
    const text = run('pdftotext', [path, '-']);
    const fonts = run('pdffonts', [path]).trim().split('\n').slice(2).filter(Boolean);
    const metadata = run('pdfinfo', [path]);
    // Ignore layout whitespace when checking phrases that may wrap across PDF text runs.
    const compact = value => value.replace(/\s+/gu, '');
    const searchable = compact(text);
    const missing = expected.filter(value => !searchable.includes(compact(value)));
    const leaked = excluded.filter(value => searchable.includes(compact(value)));
    const result = {
        path, sha256: createHash('sha256').update(bytes).digest('hex'),
        pages: Number(metadata.match(/^Pages:\s+(\d+)/m)?.[1] || 0),
        textCharacters: text.trim().length,
        chineseCharacters: (text.match(/\p{Script=Han}/gu) || []).length,
        fontCount: fonts.length, missing, leaked,
        passed: searchable.length > 0 && !missing.length && !leaked.length,
        limits: '仅验证可提取文字；不能证明版式正确，也不能证明不可提取的图形中没有不发布内容。',
    };
    console.log(JSON.stringify(result, null, 2));
    if (!result.passed) process.exitCode = 1;
} catch (error) {
    console.error(`PDF check failed: ${error.message}`);
    process.exitCode = 2;
}
