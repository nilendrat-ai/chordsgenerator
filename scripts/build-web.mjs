/**
 * Builds the browser artefacts (no server needed at runtime):
 *   dist/yt-chord-sheet.esm.js       ES module of the core library (import in your own app)
 *   dist/yt-chord-sheet.min.js       classic script, global `YTChords` (also usable in Web Workers)
 *   dist/chord-sheet.html            the standalone web page, with the library inlined
 */
import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Where the page is published (used for the link preview, sitemap and robots.txt).
// Change this one line when the site moves, e.g. to https://chordsgenerator.js.org/
const SITE_URL = process.env.SITE_URL || 'https://nilendrat-ai.github.io/chordsgenerator/';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist');
await mkdir(out, { recursive: true });

const common = { bundle: true, platform: 'browser', target: ['es2020'], legalComments: 'none', logLevel: 'warning' };

await build({ ...common, entryPoints: [path.join(root, 'src/core.js')], format: 'esm', outfile: path.join(out, 'yt-chord-sheet.esm.js') });
await build({ ...common, entryPoints: [path.join(root, 'src/core.js')], format: 'iife', globalName: 'YTChords', minify: true, outfile: path.join(out, 'yt-chord-sheet.min.js') });

// The page bundle: analyser, live tracker and renderer, inlined into the page.
const page = await build({ ...common, entryPoints: [path.join(root, 'web/entry.js')], format: 'iife', globalName: 'YTChords', minify: true, write: false });
const lib = page.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const template = await readFile(path.join(root, 'web/template.html'), 'utf8');
if (!template.includes('/*__LIBRARY__*/')) throw new Error('template is missing the /*__LIBRARY__*/ marker');
const html = template.replace('/*__LIBRARY__*/', () => lib).replaceAll('__SITE_URL__', SITE_URL);
await writeFile(path.join(out, 'chord-sheet.html'), html);

const kb = (s) => `${(Buffer.byteLength(s) / 1024).toFixed(0)} KB`;
console.log(`dist/chord-sheet.html  ${kb(html)}  (library ${kb(lib)})`);

// Files for search engines.
await writeFile(path.join(out, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}sitemap.xml\n`);
await writeFile(
  path.join(out, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url>\n    <loc>${SITE_URL}</loc>\n    <lastmod>${new Date().toISOString().slice(0, 10)}</lastmod>\n  </url>\n</urlset>\n`,
);

// The link-preview picture (og.png): a screenshot of web/og.html with headless Chrome,
// which GitHub's Ubuntu runners have installed. Skipped with a note if Chrome isn't found.
const chrome = [process.env.CHROME_PATH, 'google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'].filter(Boolean)
  .find((c) => spawnSync(c, ['--version'], { stdio: 'ignore' }).status === 0);
if (chrome) {
  const r = spawnSync(chrome, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', '--force-device-scale-factor=1',
    '--window-size=1200,630', `--screenshot=${path.join(out, 'og.png')}`, pathToFileURL(path.join(root, 'web/og.html')).href,
  ], { stdio: 'ignore', timeout: 60000 });
  console.log(r.status === 0 ? 'dist/og.png  (link preview picture)' : 'og.png: Chrome could not take the screenshot; skipped');
} else {
  console.log('og.png: Chrome not found (set CHROME_PATH); skipped');
}
