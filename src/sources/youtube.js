/**
 * YouTube audio + caption download via yt-dlp.
 */
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { run } from './exec.js';

const YT_RE = /^(?:https?:\/\/)?(?:www\.|m\.|music\.)?(?:youtube\.com\/(?:watch\?|shorts\/|live\/|embed\/)|youtu\.be\/)/i;

export const isYouTubeUrl = (s) => typeof s === 'string' && YT_RE.test(s.trim());

/** Extract the 11-char video id from a URL or return the input if it already is one. */
export function youTubeId(s) {
  const m = /(?:v=|youtu\.be\/|shorts\/|live\/|embed\/)([\w-]{11})/.exec(s) || /^([\w-]{11})$/.exec(s);
  return m ? m[1] : null;
}

/**
 * Download the best audio stream (and captions) for a YouTube URL.
 * @param {string} url
 * @param {object} opts
 * @param {string} opts.dir working directory (must exist)
 * @param {string} [opts.ytDlpPath='yt-dlp']
 * @param {boolean} [opts.captions=true]
 * @param {string} [opts.lang='en'] caption language prefix
 * @param {string} [opts.cookiesFromBrowser] e.g. 'chrome' — passed to --cookies-from-browser
 * @param {string} [opts.cookies] path to a cookies.txt file
 * @param {string[]} [opts.ytDlpArgs] extra arguments
 * @returns {Promise<{audioPath: string, captionPath: string|null, meta: object}>}
 */
export async function downloadYouTube(url, opts) {
  const { dir, ytDlpPath = 'yt-dlp', captions = true, lang = 'en', cookiesFromBrowser, cookies, ytDlpArgs = [], onLog } = opts;
  const args = [
    '--no-playlist', '--no-progress', '--no-warnings',
    '-f', 'bestaudio/best',
    '-o', path.join(dir, 'audio.%(ext)s'),
    '--no-simulate', '--dump-json',
  ];
  if (captions) args.push('--write-subs', '--write-auto-subs', '--sub-langs', `${lang},${lang}-orig,${lang}.*`, '--sub-format', 'vtt');
  if (cookiesFromBrowser) args.push('--cookies-from-browser', cookiesFromBrowser);
  if (cookies) args.push('--cookies', cookies);
  args.push(...ytDlpArgs, '--', url);

  const { stdout } = await run(ytDlpPath, args, { tool: 'yt-dlp', onStderr: onLog });
  let info = {};
  const jsonLine = stdout.toString('utf8').trim().split('\n').reverse().find((l) => l.startsWith('{'));
  try {
    info = jsonLine ? JSON.parse(jsonLine) : {};
  } catch {
    /* metadata is optional */
  }

  const files = await readdir(dir);
  const audio = files.find((f) => f.startsWith('audio.') && !/\.(vtt|json|part|ytdl)$/i.test(f));
  if (!audio) throw new Error('yt-dlp finished but no audio file was produced.');
  const vtts = files.filter((f) => f.endsWith('.vtt'));
  // Prefer exact language, then "-orig" (original-language auto captions), then any variant.
  const caption = vtts.find((f) => f === `audio.${lang}.vtt`) || vtts.find((f) => f === `audio.${lang}-orig.vtt`) || vtts[0] || null;

  return {
    audioPath: path.join(dir, audio),
    captionPath: caption ? path.join(dir, caption) : null,
    meta: {
      id: info.id ?? youTubeId(url),
      title: info.track || info.title || null,
      artist: info.artist || info.creator || info.uploader || info.channel || null,
      duration: info.duration ?? null,
      url: info.webpage_url || url,
    },
  };
}
