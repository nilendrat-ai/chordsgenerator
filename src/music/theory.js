/**
 * Small music-theory helpers: note spelling, chord qualities, keys, transposition.
 * A chord is represented as { root: 0-11, quality: 'maj'|'min'|..., bass?: 0-11 }
 * and "no chord" as { quality: 'N' }.
 */

const SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

export const mod12 = (n) => ((n % 12) + 12) % 12;

export const QUALITIES = {
  maj: { intervals: [0, 4, 7], suffix: '', penalty: 0 },
  min: { intervals: [0, 3, 7], suffix: 'm', penalty: 0 },
  '7': { intervals: [0, 4, 7, 10], suffix: '7', penalty: 0.03 },
  maj7: { intervals: [0, 4, 7, 11], suffix: 'maj7', penalty: 0.03 },
  min7: { intervals: [0, 3, 7, 10], suffix: 'm7', penalty: 0.03 },
  sus2: { intervals: [0, 2, 7], suffix: 'sus2', penalty: 0.05 },
  sus4: { intervals: [0, 5, 7], suffix: 'sus4', penalty: 0.05 },
  dim: { intervals: [0, 3, 6], suffix: 'dim', penalty: 0.05 },
  aug: { intervals: [0, 4, 8], suffix: 'aug', penalty: 0.06 },
};

export const VOCABULARIES = {
  majmin: ['maj', 'min'],
  sevenths: ['maj', 'min', '7', 'maj7', 'min7'],
  full: Object.keys(QUALITIES),
};

/** Map any quality onto plain major/minor (used by `simplify`). */
export const SIMPLE_QUALITY = { maj: 'maj', min: 'min', '7': 'maj', maj7: 'maj', min7: 'min', sus2: 'maj', sus4: 'maj', dim: 'min', aug: 'maj' };

export const NO_CHORD = Object.freeze({ quality: 'N' });

export const isNoChord = (ch) => !ch || ch.quality === 'N';

export function noteName(pc, flats = false) {
  return (flats ? FLAT : SHARP)[mod12(pc)];
}

export function parseNote(name) {
  const m = /^([A-Ga-g])([#b]?)$/.exec(name.trim());
  if (!m) throw new Error(`Bad note name: ${name}`);
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1].toUpperCase()];
  return mod12(base + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0));
}

export function chordName(ch, flats = false) {
  if (isNoChord(ch)) return 'N.C.';
  let s = noteName(ch.root, flats) + QUALITIES[ch.quality].suffix;
  if (ch.bass != null && ch.bass !== ch.root) s += '/' + noteName(ch.bass, flats);
  return s;
}

/** Identity key for comparing chords (spelling-independent). */
export function chordId(ch) {
  if (isNoChord(ch)) return 'N';
  return `${ch.root}:${ch.quality}${ch.bass != null && ch.bass !== ch.root ? '/' + ch.bass : ''}`;
}

export function chordPcs(ch) {
  if (isNoChord(ch)) return [];
  return QUALITIES[ch.quality].intervals.map((i) => mod12(ch.root + i));
}

export function transposeChord(ch, semis) {
  if (isNoChord(ch) || !semis) return ch;
  const out = { ...ch, root: mod12(ch.root + semis) };
  if (ch.bass != null) out.bass = mod12(ch.bass + semis);
  return out;
}

export function simplifyChord(ch) {
  if (isNoChord(ch)) return ch;
  return { root: ch.root, quality: SIMPLE_QUALITY[ch.quality] };
}

// Major keys conventionally written with flats: F Bb Eb Ab Db Gb
const FLAT_MAJOR_TONICS = new Set([5, 10, 3, 8, 1, 6]);

export function keyPrefersFlats(key) {
  if (!key) return false;
  const relMajor = key.mode === 'major' ? key.tonic : mod12(key.tonic + 3);
  return FLAT_MAJOR_TONICS.has(relMajor);
}

export function keyName(key, flats = keyPrefersFlats(key)) {
  if (!key) return 'unknown';
  return `${noteName(key.tonic, flats)} ${key.mode}`;
}

export function transposeKey(key, semis) {
  if (!key || !semis) return key;
  return { ...key, tonic: mod12(key.tonic + semis) };
}

/** Scale pitch classes; minor includes the raised 7th (harmonic minor) for V/V7. */
export function scalePcs(key) {
  const steps = key.mode === 'major' ? [0, 2, 4, 5, 7, 9, 11] : [0, 2, 3, 5, 7, 8, 10, 11];
  return new Set(steps.map((s) => mod12(key.tonic + s)));
}

export function isDiatonic(ch, key) {
  if (isNoChord(ch) || !key) return false;
  const scale = scalePcs(key);
  return chordPcs(ch).every((pc) => scale.has(pc));
}

export function isTonicChord(ch, key) {
  if (isNoChord(ch) || ch.root !== key.tonic) return false;
  return key.mode === 'major' ? ['maj', '7', 'maj7', 'sus2', 'sus4'].includes(ch.quality) : ['min', 'min7'].includes(ch.quality);
}
