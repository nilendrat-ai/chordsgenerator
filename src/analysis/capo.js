/**
 * Guitar capo suggestion: find the capo fret that turns the song's chords
 * into the most open-position-friendly shapes.
 */
import { transposeChord, chordName, isNoChord, simplifyChord } from '../music/theory.js';

const EASY = new Set([
  'C', 'D', 'E', 'G', 'A', 'Am', 'Em', 'Dm',
  'C7', 'D7', 'E7', 'G7', 'A7', 'B7', 'Am7', 'Em7', 'Dm7',
  'Cmaj7', 'Fmaj7', 'Gmaj7', 'Amaj7', 'Dmaj7',
  'Dsus2', 'Dsus4', 'Asus2', 'Asus4', 'Esus4', 'Csus2',
]);
const MEDIUM = new Map([['F', 0.5], ['Bm', 0.5], ['B7', 1], ['Bm7', 0.6], ['Fm', 0.3], ['Gm', 0.3], ['Cm', 0.3], ['Edim', 0.4], ['Bdim', 0.4]]);

function easiness(ch) {
  if (isNoChord(ch)) return 1;
  const base = { root: ch.root, quality: ch.quality };
  const name = chordName(base, false);
  if (EASY.has(name)) return 1;
  if (MEDIUM.has(name)) return MEDIUM.get(name);
  const simple = chordName(simplifyChord(base), false);
  if (EASY.has(simple)) return 0.7;
  return MEDIUM.get(simple) ?? 0;
}

/**
 * @param {Array<{chord, start, end}>} segments
 * @returns {{capo: number, playability: number, ranking: Array<{capo, playability}>}}
 */
export function suggestCapo(segments, { maxCapo = 7 } = {}) {
  const total = segments.reduce((s, x) => s + (isNoChord(x.chord) ? 0 : x.end - x.start), 0) || 1;
  const ranking = [];
  for (let capo = 0; capo <= maxCapo; capo++) {
    let score = 0;
    for (const seg of segments) {
      if (isNoChord(seg.chord)) continue;
      score += (seg.end - seg.start) * easiness(transposeChord(seg.chord, -capo));
    }
    ranking.push({ capo, playability: score / total });
  }
  // Prefer lower frets unless a higher one is clearly easier.
  const best = ranking.reduce((a, b) => (b.playability - 0.05 * b.capo > a.playability - 0.05 * a.capo ? b : a));
  return { capo: best.capo, playability: best.playability, ranking };
}
