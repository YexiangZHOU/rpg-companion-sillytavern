// Dependency-free bundling for this small prototype's explicitly listed modules.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const directory = dirname(fileURLToPath(import.meta.url));
const repo = resolve(directory, '../..');
const modules = ['src/framework/state.mjs', 'src/framework/protocol.mjs', 'src/framework/panel.mjs', 'examples/universal-rpg/fixtures.mjs', 'examples/universal-rpg/demo.mjs'];
const source = modules.map(path => readFileSync(resolve(repo, path), 'utf8').replace(/^import .+;\r?\n/gm, '').replace(/^export /gm, '')).join('\n');
if (/<\/script/i.test(source)) throw new Error('Unexpected script closing sequence in preview sources');
const html = readFileSync(resolve(directory, 'index.html'), 'utf8').replace('/* PANEL_STYLE */', () => readFileSync(resolve(repo, 'src/framework/panel.css'), 'utf8')).replace('/* PREVIEW_MODULE */', () => source);
const output = resolve(process.argv[2] ?? resolve(directory, 'preview.html'));
mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, html);
console.log(`Built standalone preview: ${output}`);
