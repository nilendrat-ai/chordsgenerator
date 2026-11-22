/**
 * Turn an analysis (+ optional timed lyrics) into a chord sheet.
 * Formats: 'text' (chords over lyrics), 'html' (the text sheet with every chord
 * and lyric line wrapped in a <span data-s data-e> carrying its start/end time,
 * for play-along highlighting), 'chordpro', 'markdown', 'json'.
 */
import {
  chordName, chordId, isNoChord, keyName, keyPrefersFlats, transposeChord, transposeKey, simplifyChord, noteName,
} from '../music/theory.js';
import { suggestCapo } from '../analysis/capo.js';
import { median } from '../dsp/stats.js';

export const FORMATS = ['text', 'html', 'chordpro', 'markdown', 'json'];

export function formatTime(sec) {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/* ---------------------------------------------------------------- model --- */

function chordEvents(segments, line, lineEnd) {
  const words = line.words;
  const events = [];
  const at = line.start + 0.05;
  const active = segments.find((s) => s.start <= at && s.end > at);
  if (active) events.push({ time: line.start, end: active.end, chord: active.chord, wordIndex: 0 });
  const lastWordStart = words.length ? words[words.length - 1].start : line.start;
  for (const s of segments) {
    if (s.start <= at || s.start >= lineEnd - 0.05) continue;
    let wi;
    if (s.start > lastWordStart + 1.5) wi = words.length; // after the sung text
    else {
      wi = 0;
      for (let i = 0; i < words.length; i++) if (words[i].start <= s.start + 0.15) wi = i;
    }
    events.push({ time: s.start, end: s.end, chord: s.chord, wordIndex: wi });
  }
  return events;
}

/**
 * Build a format-neutral list of blocks:
 *  { type: 'grid', label, bars } | { type: 'lyric', start, words, text, events, stanzaBreak }
 */
export function buildBlocks(analysis, lyrics, { gapThreshold } = {}) {
  const { bars, segments } = analysis;
  if (!bars.length) return [];
  if (!lyrics || !lyrics.length) return [{ type: 'grid', label: null, bars }];

  const barDur = median(bars.filter((b) => !b.pickup).map((b) => b.end - b.start)) || 2;
  const gap = gapThreshold ?? Math.max(4, 1.5 * barDur);
  const songEnd = bars[bars.length - 1].end;
  const lines = lyrics.filter((l) => l.start < songEnd && l.words.length);
  const blocks = [];
  let cursor = bars[0].start;
  const barsBetween = (a, b) => bars.filter((bar) => {
    const mid = (bar.start + bar.end) / 2;
    return mid >= a && mid < b;
  });

  lines.forEach((line, i) => {
    const next = lines[i + 1];
    let lineEnd = Math.min(next ? next.start : Infinity, line.end ?? Infinity);
    if (!Number.isFinite(lineEnd) || lineEnd <= line.start) lineEnd = line.start + 4;
    if (line.start - cursor >= gap) {
      const gb = barsBetween(cursor, line.start);
      if (gb.length) blocks.push({ type: 'grid', label: blocks.length ? 'Instrumental' : 'Intro', bars: gb });
    }
    const prev = blocks[blocks.length - 1];
    const stanzaBreak = !!prev && prev.type === 'lyric' && line.start - prev.end > 2.5;
    blocks.push({ type: 'lyric', start: line.start, end: lineEnd, words: line.words, text: line.text, events: chordEvents(segments, line, lineEnd), stanzaBreak });
    cursor = Math.max(cursor, lineEnd);
  });
  if (songEnd - cursor >= gap) {
    const gb = barsBetween(cursor, songEnd + 1);
    if (gb.length) blocks.push({ type: 'grid', label: 'Outro', bars: gb });
  }
  return blocks;
}

/* ------------------------------------------------------------- layout ---- */

function layoutLyric(block, name) {
  const offsets = [];
  let text = '';
  for (const w of block.words) {
    if (text) text += ' ';
    offsets.push(text.length);
    text += w.text;
  }
  const placed = []; // word-anchored positions (ChordPro)
  const chordPieces = []; // laid-out chord line, collisions pushed right
  let col = 0;
  let prevLabel = null;
  for (const ev of block.events) {
    const label = name(ev.chord);
    if (label === prevLabel) continue;
    prevLabel = label;
    let pos = ev.wordIndex >= offsets.length ? text.length + 1 : offsets[ev.wordIndex];
    placed.push({ pos, label });
    if (col) pos = Math.max(pos, col + 1);
    if (pos > col) chordPieces.push({ t: ' '.repeat(pos - col) });
    chordPieces.push({ t: label, s: ev.time, e: ev.end ?? ev.time, k: 'ch' });
    col = pos + label.length;
  }
  return { chordPieces, text, placed };
}

// A sheet line is a list of pieces { t: text, k?: 'ch'|'ly', s?: start, e?: end }.
const plain = (pieces) => pieces.map((p) => p.t).join('');
const escHtml = (str) => str.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const toHtml = (pieces) => pieces
  .map((p) => (p.k ? `<span class="${p.k}" data-s="${p.s.toFixed(2)}" data-e="${p.e.toFixed(2)}">${escHtml(p.t)}</span>` : escHtml(p.t)))
  .join('');

function barCell(bar, name) {
  const labels = bar.beats.map(name);
  if (labels.every((l) => l === labels[0])) return [{ t: labels[0], s: bar.start, e: bar.end, k: 'ch' }];
  const beat = (bar.end - bar.start) / labels.length;
  const pieces = [];
  labels.forEach((l, i) => {
    if (i) pieces.push({ t: ' ' });
    if (i > 0 && l === labels[i - 1]) return pieces.push({ t: '.' });
    let j = i + 1;
    while (j < labels.length && labels[j] === l) j++;
    pieces.push({ t: l, s: bar.start + i * beat, e: bar.start + j * beat, k: 'ch' });
  });
  return pieces;
}

function gridLines(bars, name, { barsPerLine = 4, timestamps = true } = {}) {
  const cells = bars.map((b) => barCell(b, name));
  const width = Math.max(4, ...cells.map((c) => plain(c).length));
  const out = [];
  for (let i = 0; i < bars.length; i += barsPerLine) {
    const line = [{ t: `${timestamps ? `[${formatTime(bars[i].start).padStart(5)}]  ` : ''}| ` }];
    cells.slice(i, i + barsPerLine).forEach((c, k) => {
      if (k) line.push({ t: ' | ' });
      line.push(...c);
      const pad = width - plain(c).length;
      if (pad > 0) line.push({ t: ' '.repeat(pad) });
    });
    line.push({ t: ' |' });
    out.push(line);
  }
  return out;
}

/* --------------------------------------------------------------- main ---- */

/**
 * @param {object} analysis result of analyzeAudio()
 * @param {object} [opts]
 * @param {'text'|'html'|'chordpro'|'markdown'|'json'} [opts.format]
 * @param {Array} [opts.lyrics] timed lyric lines (parseVtt/parseLrc)
 * @param {string} [opts.title]
 * @param {string} [opts.artist]
 * @param {number} [opts.transpose] semitones
 * @param {'none'|'auto'|number} [opts.capo] show chord shapes relative to a capo
 * @param {boolean} [opts.simplify] reduce to plain major/minor triads
 * @param {number} [opts.barsPerLine]
 * @param {boolean} [opts.timestamps]
 * @param {string} [opts.source] source URL/path, shown in the header
 */
export function renderSheet(analysis, opts = {}) {
  const {
    format = 'text', lyrics = null, title = 'Untitled', artist = null, transpose = 0, capo = 'none',
    simplify = false, barsPerLine = 4, timestamps = true, gapThreshold, source = null,
  } = opts;
  if (!FORMATS.includes(format)) throw new Error(`Unknown format "${format}". Use one of: ${FORMATS.join(', ')}`);

  const prep = (ch) => (simplify ? simplifyChord(ch) : ch);
  const soundingKey = transposeKey(analysis.key, transpose);
  const soundingSegs = analysis.segments.map((s) => ({ ...s, chord: transposeChord(prep(s.chord), transpose) }));
  const suggestion = suggestCapo(soundingSegs);
  const capoFret = capo === 'auto' ? suggestion.capo : Number.isInteger(+capo) && capo !== 'none' ? +capo : 0;
  const shift = transpose - capoFret;
  const shapeKey = transposeKey(analysis.key, shift);
  const flats = keyPrefersFlats(shapeKey);
  const name = (ch) => chordName(transposeChord(prep(ch), shift), flats);

  const blocks = buildBlocks(analysis, lyrics, { gapThreshold });
  const used = [];
  const seen = new Set();
  for (const s of analysis.segments) {
    if (isNoChord(s.chord)) continue;
    const id = chordId(transposeChord(prep(s.chord), shift));
    if (!seen.has(id)) {
      seen.add(id);
      used.push(name(s.chord));
    }
  }

  const meta = {
    title, artist, source,
    key: keyName(soundingKey),
    tempo: analysis.tempo,
    timeSignature: `${analysis.beatsPerBar}/4`,
    tuningHz: +(440 * Math.pow(2, analysis.tuningCents / 1200)).toFixed(1),
    capo: capoFret,
    suggestedCapo: suggestion.capo,
    transpose,
    chords: used,
  };

  if (format === 'json') return renderJson(analysis, blocks, meta, name, shift);
  if (format === 'chordpro') return renderChordPro(blocks, meta, name, { barsPerLine, shapeKey, flats });
  const lines = renderTextBody(blocks, name, { barsPerLine, timestamps });
  const body = lines.map(plain).join('\n');
  if (format === 'markdown') return renderMarkdown(meta, body, shapeKey, flats);
  const header = [...textHeader(meta, shapeKey, flats), ''];
  if (format === 'html') {
    return `<pre class="chord-sheet">${[...header.map(escHtml), ...lines.map(toHtml)].join('\n')}\n</pre>\n`;
  }
  return [...header, body].join('\n') + '\n';
}

function headerFacts(meta, shapeKey, flats) {
  const facts = [`Key: ${meta.key}`];
  if (meta.tempo) facts.push(`Tempo: ~${Math.round(meta.tempo)} BPM`);
  facts.push(`Time: ${meta.timeSignature}`);
  if (Math.abs(meta.tuningHz - 440) >= 1.5) facts.push(`Tuning: A4 = ${meta.tuningHz} Hz`);
  const notes = [];
  if (meta.capo > 0) notes.push(`Capo ${meta.capo} — chords shown as shapes (play as ${keyName(shapeKey, flats)})`);
  else if (meta.suggestedCapo > 0) notes.push(`Tip: capo ${meta.suggestedCapo} makes this easier on guitar (use --capo auto)`);
  if (meta.transpose) notes.push(`Transposed ${meta.transpose > 0 ? '+' : ''}${meta.transpose} semitones`);
  return { facts, notes };
}

function textHeader(meta, shapeKey, flats) {
  const { facts, notes } = headerFacts(meta, shapeKey, flats);
  const lines = [meta.title];
  if (meta.artist) lines.push(meta.artist);
  lines.push('='.repeat(Math.max(meta.title.length, 20)));
  lines.push(facts.join('  |  '));
  lines.push(...notes);
  if (meta.chords.length) lines.push(`Chords: ${meta.chords.join('  ')}`);
  return lines;
}

/** @returns {Array<Array<{t, k?, s?, e?}>>} one array of pieces per line */
function renderTextBody(blocks, name, { barsPerLine, timestamps }) {
  const out = [];
  for (const b of blocks) {
    if (b.type === 'grid') {
      if (out.length) out.push([]);
      if (b.label) out.push([{ t: `[${b.label}]` }]);
      out.push(...gridLines(b.bars, name, { barsPerLine, timestamps }));
      out.push([]);
    } else {
      if (b.stanzaBreak) out.push([]);
      const { chordPieces, text } = layoutLyric(b, name);
      if (chordPieces.length) out.push(chordPieces);
      out.push([{ t: text, s: b.start, e: b.end, k: 'ly' }]);
    }
  }
  while (out.length && !out[out.length - 1].length) out.pop();
  return out;
}

function renderMarkdown(meta, body, shapeKey, flats) {
  const { facts, notes } = headerFacts(meta, shapeKey, flats);
  const lines = [`# ${meta.title}`];
  if (meta.artist) lines.push(`*${meta.artist}*`);
  lines.push('', facts.map((f) => `**${f.replace(': ', ':** ')}`).join(' · '));
  for (const n of notes) lines.push('', `> ${n}`);
  if (meta.chords.length) lines.push('', `**Chords:** ${meta.chords.map((c) => `\`${c}\``).join(' ')}`);
  if (meta.source) lines.push('', `Source: ${meta.source}`);
  lines.push('', '```text', body, '```', '');
  return lines.join('\n');
}

function renderChordPro(blocks, meta, name, { barsPerLine, shapeKey, flats }) {
  const out = [`{title: ${meta.title}}`];
  if (meta.artist) out.push(`{artist: ${meta.artist}}`);
  out.push(`{key: ${noteName(shapeKey.tonic, flats)}${shapeKey.mode === 'minor' ? 'm' : ''}}`);
  if (meta.tempo) out.push(`{tempo: ${Math.round(meta.tempo)}}`);
  out.push(`{time: ${meta.timeSignature}}`);
  if (meta.capo > 0) out.push(`{capo: ${meta.capo}}`);
  if (meta.source) out.push(`{comment: Source ${meta.source}}`);
  out.push('');
  for (const b of blocks) {
    if (b.type === 'grid') {
      if (out[out.length - 1] !== '') out.push('');
      if (b.label) out.push(`{comment: ${b.label}}`);
      out.push('{start_of_grid}');
      for (let i = 0; i < b.bars.length; i += barsPerLine) {
        const row = b.bars.slice(i, i + barsPerLine).map((bar) => bar.beats.map((c, k) => (k > 0 && chordId(c) === chordId(bar.beats[k - 1]) ? '.' : name(c))).join(' '));
        out.push(`| ${row.join(' | ')} |`);
      }
      out.push('{end_of_grid}', '');
    } else {
      if (b.stanzaBreak) out.push('');
      const { text, placed } = layoutLyric(b, name);
      const at = new Map();
      for (const p of placed) at.set(p.pos, (at.get(p.pos) || '') + `[${p.label}]`);
      let line = '';
      for (let i = 0; i < text.length; i++) line += (at.get(i) || '') + text[i];
      const tail = [...at.entries()].filter(([pos]) => pos >= text.length).map(([, l]) => l).join('');
      out.push(tail ? `${line} ${tail}` : line);
    }
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

function renderJson(analysis, blocks, meta, name, shift) {
  const named = (ch) => ({ ...transposeChord(ch, shift), name: name(ch) });
  return JSON.stringify({
    ...meta,
    durationSec: +analysis.duration.toFixed(2),
    keyConfidence: analysis.key.confidence,
    segments: analysis.segments.map((s) => ({ start: +s.start.toFixed(3), end: +s.end.toFixed(3), chord: name(s.chord), beats: s.beats, confidence: s.confidence })),
    bars: analysis.bars.map((b) => ({ start: +b.start.toFixed(3), end: +b.end.toFixed(3), pickup: b.pickup || undefined, beats: b.beats.map(name) })),
    beats: analysis.beats.map((t) => +t.toFixed(3)),
    lyrics: blocks.filter((b) => b.type === 'lyric').map((b) => ({
      start: +b.start.toFixed(3), text: b.text,
      chords: b.events.map((e) => ({ time: +e.time.toFixed(3), wordIndex: e.wordIndex, ...named(e.chord) })),
    })),
  }, null, 2) + '\n';
}
