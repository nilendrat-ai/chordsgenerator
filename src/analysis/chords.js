/**
 * Chord recognition: harmonic chord templates scored against chroma,
 * decoded with an HMM (Viterbi) so chords don't flicker beat to beat.
 */
import { QUALITIES, VOCABULARIES, mod12, isDiatonic, NO_CHORD } from '../music/theory.js';

const HARMONIC_OFFSETS = [0, 12, 19, 24, 28, 31]; // partials 1..6 in semitones
const HARMONIC_DECAY = 0.6;

function harmonicVector(pc) {
  const v = new Float64Array(12);
  let a = 1;
  for (const o of HARMONIC_OFFSETS) {
    v[mod12(pc + o)] += a;
    a *= HARMONIC_DECAY;
  }
  return v;
}

/** State 0 is "no chord"; the rest are root x quality. */
export function buildStates(vocabulary = 'majmin') {
  const quals = Array.isArray(vocabulary) ? vocabulary : VOCABULARIES[vocabulary];
  if (!quals) throw new Error(`Unknown chord vocabulary "${vocabulary}". Use ${Object.keys(VOCABULARIES).join(', ')} or an array of qualities.`);
  for (const q of quals) if (!QUALITIES[q]) throw new Error(`Unknown chord quality "${q}"`);
  const states = [{ chord: NO_CHORD, template: null, penalty: 0 }];
  for (const q of quals) {
    for (let r = 0; r < 12; r++) {
      const t = new Float64Array(12);
      for (const iv of QUALITIES[q].intervals) {
        const h = harmonicVector(r + iv);
        for (let i = 0; i < 12; i++) t[i] += h[i];
      }
      let n = 0;
      for (let i = 0; i < 12; i++) n += t[i] * t[i];
      n = Math.sqrt(n);
      for (let i = 0; i < 12; i++) t[i] /= n;
      states.push({ chord: { root: r, quality: q }, template: t, penalty: QUALITIES[q].penalty });
    }
  }
  return states;
}

/**
 * Score every (step, state) pair. Scores are roughly cosine similarities (0..1).
 * @returns {Float64Array[]}
 */
export function scoreSteps(treble, bass, silent, states, opts = {}) {
  const { bassWeight = 0.1, key = null, keyBonus = 0.03, noChordScore = 0.3 } = opts;
  const S = states.length;
  const diatonic = states.map((s) => (key ? isDiatonic(s.chord, key) : false));
  const rows = new Array(treble.length);
  for (let t = 0; t < treble.length; t++) {
    const c = treble[t];
    const row = new Float64Array(S);
    let norm = 0;
    for (let i = 0; i < 12; i++) norm += c[i] * c[i];
    norm = Math.sqrt(norm);
    if (silent[t] || norm < 1e-9) {
      row[0] = 1;
      rows[t] = row;
      continue;
    }
    const b = bass[t];
    let bmax = 0;
    for (let i = 0; i < 12; i++) if (b[i] > bmax) bmax = b[i];
    row[0] = noChordScore;
    for (let s = 1; s < S; s++) {
      const { template, penalty, chord } = states[s];
      let dot = 0;
      for (let i = 0; i < 12; i++) dot += c[i] * template[i];
      let sc = dot / norm - penalty;
      if (bmax > 0) sc += bassWeight * (b[chord.root] / bmax);
      if (diatonic[s]) sc += keyBonus;
      row[s] = sc;
    }
    rows[t] = row;
  }
  return rows;
}

/** Viterbi decoding with a "stay or jump anywhere" transition model. O(T*S). */
export function viterbi(scores, { beta = 14, selfTransition = 0.75 } = {}) {
  const T = scores.length;
  if (!T) return [];
  const S = scores[0].length;
  const lStay = Math.log(selfTransition);
  const lSwitch = Math.log((1 - selfTransition) / (S - 1));
  let delta = Float64Array.from(scores[0], (x) => beta * x);
  const back = new Array(T);
  for (let t = 1; t < T; t++) {
    let b1 = 0;
    let b2 = 1;
    if (delta[b2] > delta[b1]) [b1, b2] = [b2, b1];
    for (let s = 2; s < S; s++) {
      if (delta[s] > delta[b1]) {
        b2 = b1;
        b1 = s;
      } else if (delta[s] > delta[b2]) b2 = s;
    }
    const nd = new Float64Array(S);
    const bk = new Int32Array(S);
    const row = scores[t];
    for (let s = 0; s < S; s++) {
      const stay = delta[s] + lStay;
      const from = s === b1 ? b2 : b1;
      const sw = delta[from] + lSwitch;
      if (stay >= sw) {
        nd[s] = stay;
        bk[s] = s;
      } else {
        nd[s] = sw;
        bk[s] = from;
      }
      nd[s] += beta * row[s];
    }
    back[t] = bk;
    delta = nd;
  }
  let last = 0;
  for (let s = 1; s < S; s++) if (delta[s] > delta[last]) last = s;
  const path = new Array(T);
  path[T - 1] = last;
  for (let t = T - 1; t > 0; t--) path[t - 1] = back[t][path[t]];
  return path;
}
