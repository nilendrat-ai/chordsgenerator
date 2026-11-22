// node examples/node-basic.js "https://www.youtube.com/watch?v=VIDEO_ID"
import { writeFile } from 'node:fs/promises';
import { generateChordSheet } from '../src/index.js';

const source = process.argv[2];
if (!source) {
  console.error('Usage: node examples/node-basic.js <youtube-url | audio-file>');
  process.exit(1);
}

const { sheet, analysis, meta } = await generateChordSheet(source, {
  format: 'text',
  vocabulary: 'sevenths',
  capo: 'auto',
  onProgress: ({ stage }) => console.error(`… ${stage}`),
});

console.log(sheet);
console.error(`Key ${analysis.key.name}, ~${analysis.tempo} BPM, ${analysis.segments.length} chord segments`);

// The same analysis can be rendered again in any format without re-analysing:
// import { renderSheet } from '../src/index.js';
// await writeFile('song.cho', renderSheet(analysis, { format: 'chordpro', title: meta.title }));
await writeFile('chord-sheet.txt', sheet);
