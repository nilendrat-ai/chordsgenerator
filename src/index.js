/**
 * yt-chord-sheet — generate chord sheets from YouTube videos or local audio.
 *
 *   import { generateChordSheet } from 'yt-chord-sheet';
 *   const { sheet } = await generateChordSheet('https://youtu.be/VIDEO_ID');
 *   console.log(sheet);
 */
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { analyzeAudio, DEFAULT_ANALYSIS_OPTIONS } from './analysis/analyze.js';
import { renderSheet } from './format/render.js';
import { parseLyrics } from './lyrics/parse.js';
import { downloadYouTube, isYouTubeUrl } from './sources/youtube.js';
import { decodeAudioFile } from './sources/decode.js';

export * from './core.js';
export { downloadYouTube, isYouTubeUrl, youTubeId } from './sources/youtube.js';
export { decodeAudioFile, decodeWav } from './sources/decode.js';

/**
 * Generate a chord sheet from a YouTube URL or a local audio/video file.
 *
 * @param {string} source YouTube URL or file path
 * @param {object} [options]
 * @param {'text'|'chordpro'|'markdown'|'json'} [options.format='text']
 * @param {boolean} [options.lyrics=true] align chords to YouTube captions when available
 * @param {string} [options.lyricsFile] .vtt / .lrc file with timed lyrics (overrides captions)
 * @param {string} [options.lang='en'] caption language
 * @param {string} [options.title] override the title
 * @param {string} [options.artist] override the artist
 * @param {'majmin'|'sevenths'|'full'|string[]} [options.vocabulary='majmin']
 * @param {number} [options.transpose=0] semitones
 * @param {'none'|'auto'|number} [options.capo='none']
 * @param {boolean} [options.simplify=false]
 * @param {boolean} [options.slashChords=false]
 * @param {number} [options.beatsPerBar=4]
 * @param {number} [options.tempo] force BPM
 * @param {string} [options.ytDlpPath='yt-dlp']
 * @param {string} [options.ffmpegPath='ffmpeg']
 * @param {string} [options.cookiesFromBrowser] forwarded to yt-dlp
 * @param {string} [options.cookies] cookies.txt path forwarded to yt-dlp
 * @param {string[]} [options.ytDlpArgs] extra yt-dlp args
 * @param {string} [options.workDir] keep downloads here instead of a temp dir
 * @param {(e: {stage: string, progress?: number, message?: string}) => void} [options.onProgress]
 * @returns {Promise<{sheet: string, format: string, analysis: object, lyrics: Array|null, meta: object}>}
 */
export async function generateChordSheet(source, options = {}) {
  const {
    format = 'text', lyrics: useLyrics = true, lyricsFile, lang = 'en', workDir, onProgress,
    ytDlpPath, ffmpegPath, cookiesFromBrowser, cookies, ytDlpArgs,
  } = options;
  const report = (stage, extra = {}) => onProgress?.({ stage, ...extra });
  const sampleRate = options.sampleRate ?? DEFAULT_ANALYSIS_OPTIONS.sampleRate;

  let tmpDir = null;
  try {
    let audioPath;
    let captionPath = null;
    let meta = { title: null, artist: null, url: null };

    if (isYouTubeUrl(source)) {
      tmpDir = workDir || (await mkdtemp(path.join(os.tmpdir(), 'yt-chords-')));
      report('download', { message: `Downloading audio from ${source}` });
      const dl = await downloadYouTube(source, {
        dir: tmpDir, ytDlpPath, captions: useLyrics && !lyricsFile, lang, cookiesFromBrowser, cookies, ytDlpArgs,
      });
      audioPath = dl.audioPath;
      captionPath = dl.captionPath;
      meta = dl.meta;
    } else {
      await stat(source).catch(() => {
        throw new Error(`"${source}" is neither a YouTube URL nor an existing file.`);
      });
      audioPath = source;
      meta.title = path.basename(source).replace(/\.[^.]+$/, '');
    }

    let lyrics = null;
    const lyricSource = lyricsFile || (useLyrics ? captionPath : null);
    if (lyricSource) {
      lyrics = parseLyrics(await readFile(lyricSource, 'utf8'), lyricSource);
      if (!lyrics.length) lyrics = null;
    }

    report('decode', { message: 'Decoding audio' });
    const { samples, sampleRate: sr } = await decodeAudioFile(audioPath, { ffmpegPath, sampleRate });
    if (!samples.length) throw new Error('Decoded audio is empty.');

    const analysis = analyzeAudio(samples, sr, {
      ...pick(options, Object.keys(DEFAULT_ANALYSIS_OPTIONS)),
      onProgress: (e) => report(e.stage, e),
    });

    const sheet = renderSheet(analysis, {
      format,
      lyrics,
      title: options.title ?? meta.title ?? 'Untitled',
      artist: options.artist ?? meta.artist,
      source: meta.url ?? null,
      transpose: options.transpose ?? 0,
      capo: options.capo ?? 'none',
      simplify: options.simplify ?? false,
      barsPerLine: options.barsPerLine ?? 4,
      timestamps: options.timestamps ?? true,
    });
    report('done');
    return { sheet, format, analysis, lyrics, meta };
  } finally {
    if (tmpDir && !workDir) await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj[k] !== undefined && k !== 'onProgress') out[k] = obj[k];
  return out;
}
