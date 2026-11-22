/**
 * Live (streaming) chord estimate for audio arriving in chunks — e.g. from a
 * microphone or captured tab audio. Browser-safe.
 *
 *   const live = createLiveTracker({ sampleRate: ctx.sampleRate });
 *   node.port.onmessage = (e) => live.push(e.data);
 *   setInterval(() => show(live.update()), 250);
 *
 * It looks at the most recent ~1 s, scores chord templates, and only switches
 * chord when the new one wins twice in a row (or clearly), so the display is steady.
 * For the final sheet, run analyzeAudio() over the whole recording.
 */
import { resample } from '../dsp/resample.js';
import { computeChroma } from '../dsp/chroma.js';
import { buildStates, scoreSteps } from './chords.js';
import { keyCorrelations, ALL_KEYS } from './key.js';
import { chordName, keyName, keyPrefersFlats, NO_CHORD } from '../music/theory.js';

export function createLiveTracker({ sampleRate, vocabulary = 'majmin', window = 0.6, analysisRate = 11025 } = {}) {
  if (!sampleRate) throw new Error('createLiveTracker needs the input sampleRate');
  const keep = Math.ceil(sampleRate * (window + 0.6));
  const buf = new Float32Array(keep);
  const states = buildStates(vocabulary);
  const keyChroma = new Float64Array(12);
  let filled = 0;
  let loudest = 1e-4;
  let current = 0;
  let candidate = -1;
  let wins = 0;
  let key = null;
  let tuningCents = null;
  let tuningVotes = 0;

  function push(chunk) {
    const n = chunk.length;
    if (n >= keep) buf.set(chunk.subarray(n - keep));
    else {
      buf.copyWithin(0, n);
      buf.set(chunk, keep - n);
    }
    filled += n;
  }

  function update() {
    if (filled < sampleRate * 0.5) return null;
    const x = resample(buf, sampleRate, analysisRate);
    const ch = computeChroma(x, analysisRate, { hopSize: 512, tuning: tuningCents ?? 'auto' });
    // Settle tuning over the first few seconds, then keep it fixed.
    if (tuningVotes < 12) {
      tuningVotes++;
      tuningCents = tuningCents == null ? ch.tuningCents : tuningCents + (ch.tuningCents - tuningCents) / tuningVotes;
    }
    const from = Math.max(0, ch.treble.length - Math.round((window * analysisRate) / 512) - 2);
    const to = ch.treble.length - 2; // skip the zero-padded tail frame
    const t = new Float64Array(12);
    const b = new Float64Array(12);
    let e = 0;
    let cnt = 0;
    for (let i = from; i <= to; i++) {
      for (let k = 0; k < 12; k++) {
        t[k] += ch.treble[i][k];
        b[k] += ch.bass[i][k];
      }
      e += ch.energy[i];
      cnt++;
    }
    e /= cnt || 1;
    loudest = Math.max(loudest * 0.9995, e);
    const silent = e < loudest * 0.05;

    if (!silent) {
      const s = t.reduce((a, v) => a + v, 0) || 1;
      for (let k = 0; k < 12; k++) keyChroma[k] += t[k] / s;
      const scores = keyCorrelations([keyChroma], [false]);
      let best = 0;
      for (let k = 1; k < 24; k++) if (scores[k] > scores[best]) best = k;
      key = ALL_KEYS[best];
    }

    const row = scoreSteps([t], [b], [silent], states, { key, keyBonus: 0.02 })[0];
    let best = 0;
    for (let s = 1; s < row.length; s++) if (row[s] > row[best]) best = s;
    const margin = row[best] - row[current];
    if (best === current) {
      candidate = -1;
      wins = 0;
    } else {
      if (best === candidate) wins++;
      else {
        candidate = best;
        wins = 1;
      }
      if (wins >= 2 || margin > 0.08) {
        current = best;
        candidate = -1;
        wins = 0;
      }
    }
    const chord = states[current].chord || NO_CHORD;
    return {
      chord,
      name: chordName(chord, keyPrefersFlats(key)),
      confidence: Math.max(0, Math.min(1, row[current])),
      key: key ? { ...key, name: keyName(key) } : null,
      silent,
      seconds: filled / sampleRate,
    };
  }

  function reset() {
    buf.fill(0);
    keyChroma.fill(0);
    filled = 0;
    current = 0;
    candidate = -1;
    wins = 0;
    key = null;
  }

  return { push, update, reset };
}
