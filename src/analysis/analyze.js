/**
 * Full analysis pipeline: PCM samples -> tempo, beats, key, chords, bars.
 * Browser-safe (no Node APIs).
 */
import { resample } from '../dsp/resample.js';
import { computeChroma } from '../dsp/chroma.js';
import { onsetEnvelope, estimateTempo, trackBeats } from '../dsp/beats.js';
import { percentile, median } from '../dsp/stats.js';
import { buildStates, scoreSteps, viterbi } from './chords.js';
import { keyCorrelations, refineKey, estimateKey } from './key.js';
import { suggestCapo } from './capo.js';
import { chordId, chordName, chordPcs, isNoChord, keyName, keyPrefersFlats, NO_CHORD } from '../music/theory.js';

export const DEFAULT_ANALYSIS_OPTIONS = {
  sampleRate: 11025, // internal analysis rate
  vocabulary: 'majmin', // 'majmin' | 'sevenths' | 'full' | array of qualities
  beatsPerBar: 4,
  tempo: null, // force a BPM instead of estimating it
  minBpm: 50,
  maxBpm: 210,
  silenceThreshold: 0.03, // relative to the 95th-percentile frame RMS (-30 dB)
  selfTransition: 0.75, // HMM probability of keeping the same chord on the next beat
  beta: 14, // emission sharpness
  bassWeight: 0.1,
  keyBonus: 0.03,
  slashChords: false,
  tuning: 'auto', // 'auto' or cents offset from A440
  onProgress: null,
};

function weightedAverage(frames, idxFrom, idxTo, center, halfSpan) {
  const out = new Float64Array(12);
  let wsum = 0;
  for (let i = idxFrom; i <= idxTo; i++) {
    const w = halfSpan > 0 ? Math.max(0.05, 1 - Math.abs(i - center) / (halfSpan + 1)) : 1;
    const f = frames[i];
    for (let k = 0; k < 12; k++) out[k] += w * f[k];
    wsum += w;
  }
  if (wsum) for (let k = 0; k < 12; k++) out[k] /= wsum;
  return out;
}

/**
 * Analyse mono PCM audio.
 * @param {Float32Array} samples mono samples in [-1, 1]
 * @param {number} sampleRate
 * @param {object} [options] see DEFAULT_ANALYSIS_OPTIONS
 */
export function analyzeAudio(samples, sampleRate, options = {}) {
  const o = { ...DEFAULT_ANALYSIS_OPTIONS, ...options };
  const progress = (stage, pct) => o.onProgress && o.onProgress({ stage, progress: pct });

  const sr = o.sampleRate;
  if (sampleRate !== sr) progress('resample', 0);
  const x = sampleRate === sr ? samples : resample(samples, sampleRate, sr);
  const duration = x.length / sr;

  progress('chroma', 0.1);
  const ch = computeChroma(x, sr, { tuning: o.tuning });
  const frameDt = ch.hopSize / sr;
  const loud = percentile(ch.energy, 0.95);
  const silenceLevel = loud * o.silenceThreshold;
  const activeFrames = [];
  for (let i = 0; i < ch.energy.length; i++) if (ch.energy[i] > silenceLevel) activeFrames.push(i);
  const firstActive = activeFrames.length ? ch.times[activeFrames[0]] : 0;
  const lastActive = activeFrames.length ? ch.times[activeFrames[activeFrames.length - 1]] : duration;

  progress('beats', 0.5);
  const on = onsetEnvelope(x, sr);
  let bpm = o.tempo || estimateTempo(on.env, on.frameRate, { minBpm: o.minBpm, maxBpm: o.maxBpm });
  let period = 60 / bpm;
  let beats = trackBeats(on.env, on.frameRate, bpm).map((f) => f / on.frameRate);
  beats = beats.filter((t) => t >= firstActive - 0.5 * period && t <= lastActive);
  let tempoDetected = true;
  if (beats.length < 4) {
    // Fall back to a fixed grid if the beat tracker found nothing usable.
    tempoDetected = false;
    period = 0.5;
    beats = [];
    for (let t = firstActive; t < lastActive; t += period) beats.push(t);
    if (!beats.length) beats.push(0);
  } else {
    // Beats are quantised to onset frames, so average the steady intervals
    // (within 20% of the median) for a sub-frame tempo estimate.
    const ibis = beats.slice(1).map((b, i) => b - beats[i]);
    const med = median(ibis);
    const steady = ibis.filter((d) => Math.abs(d - med) < 0.2 * med);
    period = steady.length ? steady.reduce((s, d) => s + d, 0) / steady.length : med;
    bpm = 60 / period;
  }
  const bounds = [...beats, Math.min(duration, beats[beats.length - 1] + period)];
  const M = beats.length;

  // Beat-synchronous chroma (frames in the inner part of each beat, centre-weighted).
  progress('chords', 0.65);
  const bt = new Array(M);
  const bb = new Array(M);
  const silent = new Array(M);
  const nF = ch.treble.length;
  for (let j = 0; j < M; j++) {
    const a = bounds[j];
    const b = Math.max(bounds[j + 1], a + frameDt);
    const margin = 0.15 * (b - a);
    let i0 = Math.ceil((a + margin) / frameDt);
    let i1 = Math.floor((b - margin) / frameDt);
    i0 = Math.min(Math.max(0, i0), nF - 1);
    i1 = Math.min(Math.max(i0, i1), nF - 1);
    const center = (i0 + i1) / 2;
    bt[j] = weightedAverage(ch.treble, i0, i1, center, (i1 - i0) / 2);
    bb[j] = weightedAverage(ch.bass, i0, i1, center, (i1 - i0) / 2);
    let e = 0;
    for (let i = i0; i <= i1; i++) e += ch.energy[i];
    silent[j] = e / (i1 - i0 + 1) <= silenceLevel;
  }
  const durations = beats.map((_, j) => bounds[j + 1] - bounds[j]);

  // Pass 1: chords without key knowledge -> key -> pass 2 with a diatonic prior.
  const states = buildStates(o.vocabulary);
  const hmm = { beta: o.beta, selfTransition: o.selfTransition };
  const keyScores = keyCorrelations(bt, silent, durations);
  const path1 = viterbi(scoreSteps(bt, bb, silent, states, { bassWeight: o.bassWeight }), hmm);
  const key = refineKey(keyScores, path1.map((s, j) => ({ chord: states[s].chord, duration: durations[j] })));
  const scores2 = scoreSteps(bt, bb, silent, states, { bassWeight: o.bassWeight, key, keyBonus: o.keyBonus });
  const path = viterbi(scores2, hmm);

  let beatChords = path.map((s) => states[s].chord);
  const beatConf = path.map((s, j) => Math.max(0, Math.min(1, scores2[j][s])));

  // Merge beats into segments.
  const buildSegments = () => {
    const segs = [];
    for (let j = 0; j < M; j++) {
      const id = chordId(beatChords[j]);
      const last = segs[segs.length - 1];
      if (last && last.id === id) {
        last.endBeat = j + 1;
        last.confSum += beatConf[j];
      } else segs.push({ id, chord: beatChords[j], startBeat: j, endBeat: j + 1, confSum: beatConf[j] });
    }
    return segs;
  };
  let segs = buildSegments();

  if (o.slashChords) {
    for (const s of segs) {
      if (isNoChord(s.chord)) continue;
      const avg = new Float64Array(12);
      for (let j = s.startBeat; j < s.endBeat; j++) {
        const b = bb[j];
        const mx = Math.max(...b) || 1;
        for (let k = 0; k < 12; k++) avg[k] += b[k] / mx;
      }
      const n = s.endBeat - s.startBeat;
      for (let k = 0; k < 12; k++) avg[k] /= n;
      let arg = 0;
      for (let k = 1; k < 12; k++) if (avg[k] > avg[arg]) arg = k;
      if (arg !== s.chord.root && chordPcs(s.chord).includes(arg) && avg[arg] > 0.8 && avg[s.chord.root] < 0.5) {
        const slash = { ...s.chord, bass: arg };
        for (let j = s.startBeat; j < s.endBeat; j++) beatChords[j] = slash;
      }
    }
    segs = buildSegments();
  }

  const flats = keyPrefersFlats(key);
  const segments = segs.map((s) => ({
    start: bounds[s.startBeat],
    end: bounds[s.endBeat],
    chord: s.chord,
    name: chordName(s.chord, flats),
    beats: s.endBeat - s.startBeat,
    confidence: +(s.confSum / (s.endBeat - s.startBeat)).toFixed(3),
  }));

  // Downbeat phase: the bar line position where chord changes line up best.
  const bpb = Math.max(1, o.beatsPerBar | 0);
  const onsetAt = (t) => on.env[Math.min(on.env.length - 1, Math.max(0, Math.round(t * on.frameRate)))] || 0;
  let phase = 0;
  let bestPhase = -Infinity;
  for (let p = 0; p < bpb; p++) {
    let sc = 0;
    for (let j = 0; j < M; j++) {
      const pos = (((j - p) % bpb) + bpb) % bpb;
      const change = j > 0 && chordId(beatChords[j]) !== chordId(beatChords[j - 1]);
      if (pos === 0) sc += (change ? 1 : 0) + 0.05 * onsetAt(beats[j]);
      else if (bpb % 2 === 0 && pos === bpb / 2 && change) sc += 0.3;
    }
    if (sc > bestPhase) {
      bestPhase = sc;
      phase = p;
    }
  }
  const bars = [];
  const pushBar = (j0, j1, pickup = false) => {
    bars.push({ start: bounds[j0], end: bounds[j1], pickup, beats: beatChords.slice(j0, j1) });
  };
  if (phase > 0) pushBar(0, Math.min(phase, M), true);
  for (let j = phase; j < M; j += bpb) pushBar(j, Math.min(j + bpb, M));
  // Drop silent bars at either end (lead-in noise, reverb tails).
  const allSilent = (bar) => bar.beats.every(isNoChord);
  while (bars.length > 1 && allSilent(bars[bars.length - 1])) bars.pop();
  while (bars.length > 1 && allSilent(bars[0])) bars.shift();

  progress('done', 1);
  return {
    duration,
    tempo: tempoDetected ? +bpm.toFixed(1) : null,
    beatsPerBar: bpb,
    beats,
    tuningCents: +ch.tuningCents.toFixed(1),
    key: { tonic: key.tonic, mode: key.mode, name: keyName(key), confidence: +key.confidence.toFixed(3) },
    segments,
    bars,
    capo: suggestCapo(segments),
    vocabulary: o.vocabulary,
  };
}

/** Convenience for the browser: analyse a Web Audio AudioBuffer. */
export function analyzeAudioBuffer(audioBuffer, options = {}) {
  const n = audioBuffer.numberOfChannels;
  const len = audioBuffer.length;
  const mono = new Float32Array(len);
  for (let c = 0; c < n; c++) {
    const d = audioBuffer.getChannelData(c);
    for (let i = 0; i < len; i++) mono[i] += d[i] / n;
  }
  return analyzeAudio(mono, audioBuffer.sampleRate, options);
}

export { NO_CHORD, estimateKey };
