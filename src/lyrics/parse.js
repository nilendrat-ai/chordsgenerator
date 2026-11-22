/**
 * Lyric/caption parsers producing a common shape:
 *   [{ start, end, text, words: [{ text, start }] }]
 * Supports WebVTT (including YouTube auto-captions with per-word timing) and LRC.
 */

const TS = /(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/;

function toSeconds(m) {
  const h = m[1] ? +m[1] : 0;
  return h * 3600 + +m[2] * 60 + +m[3] + +m[4].padEnd(3, '0') / 1000;
}

function cleanText(s) {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[♪♫]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const isNoise = (text) => !text || /^[\[(][^\])]*[\])]$/.test(text); // "[Music]", "(applause)"

function spreadWords(text, start, end) {
  const parts = text.split(' ').filter(Boolean);
  const total = text.length || 1;
  const span = Math.max(0.1, end - start);
  let offset = 0;
  return parts.map((w) => {
    const word = { text: w, start: start + (offset / total) * span };
    offset += w.length + 1;
    return word;
  });
}

/** Parse WebVTT text. Handles YouTube's rolling auto-captions (deduplicated). */
export function parseVtt(vtt) {
  // Cues are keyed off timing lines; a blank line ends a cue once it has text
  // (YouTube sometimes emits an empty first line inside a cue).
  const cues = [];
  let cur = null;
  for (const line of vtt.replace(/\r/g, '').split('\n')) {
    if (line.includes('-->')) {
      const [a, b] = line.split('-->');
      const ma = TS.exec(a);
      const mb = TS.exec(b);
      cur = ma && mb ? { start: toSeconds(ma), end: toSeconds(mb), lines: [] } : null;
      if (cur) cues.push(cur);
    } else if (cur) {
      if (line.trim()) cur.lines.push(line);
      else if (cur.lines.length) cur = null;
    }
  }
  const hasWordTiming = cues.some((c) => c.lines.some((l) => /<\d+:\d{2}[:.]/.test(l)));
  const out = [];
  let lastText = null;
  for (const cue of cues) {
    if (hasWordTiming) {
      // YouTube auto-captions: only lines carrying inline timestamps are new text.
      for (const raw of cue.lines) {
        if (!/<\d+:\d{2}[:.]/.test(raw)) continue;
        // "first<00:00:01.020><c> second</c><00:00:01.380><c> third</c>"
        const parts = raw.split(/<((?:\d+:)?\d{1,2}:\d{2}[.,]\d{1,3})>/);
        const words = [];
        for (let i = 0; i < parts.length; i += 2) {
          const t = i === 0 ? cue.start : toSeconds(TS.exec(parts[i - 1]));
          for (const w of cleanText(parts[i]).split(' ').filter(Boolean)) words.push({ text: w, start: t });
        }
        const text = words.map((w) => w.text).join(' ');
        if (!words.length || isNoise(text) || text === lastText) continue;
        out.push({ start: words[0].start, end: cue.end, text, words });
        lastText = text;
      }
    } else {
      const text = cleanText(cue.lines.join(' '));
      if (isNoise(text) || text === lastText) continue;
      out.push({ start: cue.start, end: cue.end, text, words: spreadWords(text, cue.start, cue.end) });
      lastText = text;
    }
  }
  return finalize(out);
}

/** Parse LRC (synced lyrics). Supports multiple time tags per line and <mm:ss.xx> word tags. */
export function parseLrc(lrc) {
  const entries = [];
  for (const line of lrc.replace(/\r/g, '').split('\n')) {
    const tags = [...line.matchAll(/\[(\d+):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    if (!tags.length) continue;
    const body = line.slice(tags[tags.length - 1].index + tags[tags.length - 1][0].length);
    for (const t of tags) {
      const start = +t[1] * 60 + +t[2] + (t[3] ? +t[3].padEnd(3, '0') / 1000 : 0);
      entries.push({ start, body });
    }
  }
  entries.sort((a, b) => a.start - b.start);
  const out = [];
  entries.forEach((e, i) => {
    const next = entries[i + 1]?.start ?? e.start + 5;
    const end = Math.min(next, e.start + 8);
    const wordTags = [...e.body.matchAll(/<(\d+):(\d{2})[.:](\d{1,3})>([^<]*)/g)];
    let words;
    if (wordTags.length) {
      words = [];
      for (const w of wordTags) {
        const t = +w[1] * 60 + +w[2] + +w[3].padEnd(3, '0') / 1000;
        for (const part of cleanText(w[4]).split(' ').filter(Boolean)) words.push({ text: part, start: t });
      }
    }
    const text = words ? words.map((w) => w.text).join(' ') : cleanText(e.body);
    if (isNoise(text)) return;
    out.push({ start: e.start, end, text, words: words?.length ? words : spreadWords(text, e.start, end) });
  });
  return finalize(out);
}

function finalize(lines) {
  lines.sort((a, b) => a.start - b.start);
  for (let i = 0; i < lines.length; i++) {
    const next = lines[i + 1];
    if (next && lines[i].end > next.start) lines[i].end = next.start;
  }
  return lines;
}

/** Pick a parser from file name or content. */
export function parseLyrics(text, filename = '') {
  if (/\.lrc$/i.test(filename) || (!/WEBVTT/.test(text) && /^\s*\[\d+:\d{2}/m.test(text))) return parseLrc(text);
  return parseVtt(text);
}
