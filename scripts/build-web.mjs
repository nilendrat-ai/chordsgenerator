/**
 * Builds the browser artefacts (no server needed at runtime):
 *   dist/yt-chord-sheet.esm.js       ES module of the core library (import in your own app)
 *   dist/yt-chord-sheet.min.js       classic script, global `YTChords` (also usable in Web Workers)
 *   dist/chord-sheet.html            the standalone web page, with the library inlined
 */
import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist');
await mkdir(out, { recursive: true });

const common = { bundle: true, platform: 'browser', target: ['es2020'], legalComments: 'none', logLevel: 'warning' };

await build({ ...common, entryPoints: [path.join(root, 'src/core.js')], format: 'esm', outfile: path.join(out, 'yt-chord-sheet.esm.js') });
await build({ ...common, entryPoints: [path.join(root, 'src/core.js')], format: 'iife', globalName: 'YTChords', minify: true, outfile: path.join(out, 'yt-chord-sheet.min.js') });

// The page bundle also carries the synthesised demo song.
const page = await build({ ...common, entryPoints: [path.join(root, 'web/entry.js')], format: 'iife', globalName: 'YTChords', minify: true, write: false });
const lib = page.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const template = await readFile(path.join(root, 'web/template.html'), 'utf8');
if (!template.includes('/*__LIBRARY__*/')) throw new Error('template is missing the /*__LIBRARY__*/ marker');
const html = template.replace('/*__LIBRARY__*/', () => lib);
await writeFile(path.join(out, 'chord-sheet.html'), html);

const kb = (s) => `${(Buffer.byteLength(s) / 1024).toFixed(0)} KB`;
console.log(`dist/chord-sheet.html  ${kb(html)}  (library ${kb(lib)})`);
