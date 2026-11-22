/**
 * Key estimation: Krumhansl–Kessler profile correlation over the song's chroma,
 * optionally refined with the decoded chords (diatonic coverage + tonic weight)
 * to separate relative major/minor keys.
 */
import { isDiatonic, isTonicChord, isNoChord } from '../music/theory.js';

const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function pearson(a, b) {
  const n = a.length;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i];
    mb += b[i];
  }
  ma /= n;
  mb /= n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma;
    const y = b[i] - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

/** All 24 keys, index = mode*12 + tonic (mode 0 = major, 1 = minor). */
export const ALL_KEYS = [...Array(24)].map((_, i) => ({ tonic: i % 12, mode: i < 12 ? 'major' : 'minor' }));

export function keyCorrelations(chromaSteps, silent, weights) {
  const total = new Float64Array(12);
  for (let t = 0; t < chromaSteps.length; t++) {
    if (silent[t]) continue;
    const c = chromaSteps[t];
    let s = 0;
    for (let i = 0; i < 12; i++) s += c[i];
    if (s <= 0) continue;
    const w = weights ? weights[t] : 1;
    for (let i = 0; i < 12; i++) total[i] += (w * c[i]) / s;
  }
  const scores = new Float64Array(24);
  for (let k = 0; k < 24; k++) {
    const { tonic, mode } = ALL_KEYS[k];
    const prof = mode === 'major' ? MAJOR : MINOR;
    const rotated = new Float64Array(12);
    for (let i = 0; i < 12; i++) rotated[(i + tonic) % 12] = prof[i];
    scores[k] = pearson(total, rotated);
  }
  return scores;
}

function pick(scores) {
  let best = 0;
  for (let k = 1; k < scores.length; k++) if (scores[k] > scores[best]) best = k;
  let second = -Infinity;
  for (let k = 0; k < scores.length; k++) if (k !== best && scores[k] > second) second = scores[k];
  return { ...ALL_KEYS[best], confidence: Math.max(0, Math.min(1, (scores[best] - second) * 5)), score: scores[best] };
}

export function estimateKey(chromaSteps, silent, weights) {
  return pick(keyCorrelations(chromaSteps, silent, weights));
}

/**
 * @param {Float64Array} chromaScores from keyCorrelations
 * @param {Array<{chord, duration}>} chordSpans
 */
export function refineKey(chromaScores, chordSpans) {
  let total = 0;
  for (const s of chordSpans) if (!isNoChord(s.chord)) total += s.duration;
  if (!total) return pick(chromaScores);
  const combined = new Float64Array(24);
  for (let k = 0; k < 24; k++) {
    const key = ALL_KEYS[k];
    let dia = 0;
    let tonic = 0;
    for (const s of chordSpans) {
      if (isNoChord(s.chord)) continue;
      if (isDiatonic(s.chord, key)) dia += s.duration;
      if (isTonicChord(s.chord, key)) tonic += s.duration;
    }
    combined[k] = chromaScores[k] + 0.35 * (dia / total) + 0.35 * (tonic / total);
  }
  return pick(combined);
}
