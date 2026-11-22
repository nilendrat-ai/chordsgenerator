#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { writeFile } from 'node:fs/promises';
import { generateChordSheet } from '../src/index.js';

const HELP = `ytchords — generate a chord sheet from a YouTube video or audio file

Usage:
  ytchords <youtube-url | audio-file> [options]

Output:
  -f, --format <fmt>       text | chordpro | markdown | json        (default: text)
  -o, --output <file>      write to a file instead of stdout

Chords:
  -v, --vocab <set>        majmin | sevenths | full                 (default: majmin)
  -t, --transpose <n>      transpose by n semitones
  -c, --capo <n|auto>      show shapes for a capo position ("auto" picks the easiest)
      --simplify           reduce everything to major/minor triads
      --slash              detect slash chords (C/E, D/F#)
      --beats-per-bar <n>  default 4
      --tempo <bpm>        force a tempo instead of detecting it

Metadata:
      --title <text>       override the title
      --artist <text>      override the artist

Lyrics:
      --no-lyrics          don't fetch/align YouTube captions
      --lyrics <file>      use a .vtt or .lrc file for lyrics
      --lang <code>        caption language (default: en)

YouTube / tools:
      --cookies-from-browser <name>   forwarded to yt-dlp (e.g. chrome, firefox)
      --cookies <file>                cookies.txt forwarded to yt-dlp
      --yt-dlp <path>                 path to yt-dlp
      --ffmpeg <path>                 path to ffmpeg
  -q, --quiet              no progress output
  -h, --help
`;

let parsed;
try {
  parsed = parseArgs({
  allowPositionals: true,
  options: {
    format: { type: 'string', short: 'f', default: 'text' },
    output: { type: 'string', short: 'o' },
    vocab: { type: 'string', short: 'v', default: 'majmin' },
    transpose: { type: 'string', short: 't', default: '0' },
    capo: { type: 'string', short: 'c', default: 'none' },
    simplify: { type: 'boolean', default: false },
    slash: { type: 'boolean', default: false },
    'beats-per-bar': { type: 'string', default: '4' },
    tempo: { type: 'string' },
    'no-lyrics': { type: 'boolean', default: false },
    lyrics: { type: 'string' },
    lang: { type: 'string', default: 'en' },
    'cookies-from-browser': { type: 'string' },
    cookies: { type: 'string' },
    'yt-dlp': { type: 'string' },
    ffmpeg: { type: 'string' },
    quiet: { type: 'boolean', short: 'q', default: false },
    help: { type: 'boolean', short: 'h', default: false },
    title: { type: 'string' },
    artist: { type: 'string' },
  },
  });
} catch (err) {
  process.stderr.write(`Error: ${err.message.split('.')[0]}.\n\n${HELP}`);
  process.exit(1);
}
const { values, positionals } = parsed;

if (values.help || positionals.length !== 1) {
  process.stdout.write(HELP);
  process.exit(values.help ? 0 : 1);
}

const STAGES = { download: 'Downloading', decode: 'Decoding audio', resample: 'Resampling', chroma: 'Extracting harmony', beats: 'Tracking beats', chords: 'Recognising chords', done: 'Done' };
let lastStage = null;
const onProgress = values.quiet ? undefined : ({ stage }) => {
  if (stage === lastStage || !STAGES[stage]) return;
  lastStage = stage;
  process.stderr.write(`• ${STAGES[stage]}\n`);
};

try {
  const { sheet } = await generateChordSheet(positionals[0], {
    format: values.format,
    vocabulary: values.vocab,
    transpose: parseInt(values.transpose, 10) || 0,
    capo: values.capo === 'auto' || values.capo === 'none' ? values.capo : parseInt(values.capo, 10) || 0,
    simplify: values.simplify,
    slashChords: values.slash,
    beatsPerBar: parseInt(values['beats-per-bar'], 10) || 4,
    tempo: values.tempo ? parseFloat(values.tempo) : null,
    lyrics: !values['no-lyrics'],
    lyricsFile: values.lyrics,
    lang: values.lang,
    title: values.title,
    artist: values.artist,
    cookiesFromBrowser: values['cookies-from-browser'],
    cookies: values.cookies,
    ytDlpPath: values['yt-dlp'],
    ffmpegPath: values.ffmpeg,
    onProgress,
  });
  if (values.output) {
    await writeFile(values.output, sheet);
    if (!values.quiet) process.stderr.write(`Saved ${values.output}\n`);
  } else process.stdout.write(sheet);
} catch (err) {
  process.stderr.write(`Error: ${err.message}\n`);
  process.exit(1);
}
