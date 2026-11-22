/**
 * Onset detection, tempo estimation and dynamic-programming beat tracking
 * (after D. Ellis, "Beat Tracking by Dynamic Programming", 2007).
 */
import { FFT } from './fft.js';

/** Log-spectral-flux onset strength envelope, frames centred at t*hop. */
export function onsetEnvelope(samples, sr, { frameSize = 1024, hopSize = 256, fmax = 5000 } = {}) {
  const fft = new FFT(frameSize);
  const nFrames = Math.max(1, Math.ceil(samples.length / hopSize));
  const kMax = Math.min(fft.bins - 1, Math.ceil((fmax * frameSize) / sr));
  let prev = new Float64Array(kMax + 1);
  let cur = new Float64Array(kMax + 1);
  const mag = new Float64Array(fft.bins);
  const raw = new Float64Array(nFrames);
  for (let t = 0; t < nFrames; t++) {
    fft.magnitudes(samples, t * hopSize - frameSize / 2, mag);
    let flux = 0;
    for (let k = 1; k <= kMax; k++) {
      cur[k] = Math.log1p(mag[k] * 10);
      const d = cur[k] - prev[k];
      if (d > 0) flux += d;
    }
    raw[t] = t === 0 ? 0 : flux;
    const tmp = prev;
    prev = cur;
    cur = tmp;
  }
  // Remove slow trends (moving average over ~0.5 s), rectify, normalise.
  const frameRate = sr / hopSize;
  const w = Math.max(1, Math.round(frameRate * 0.25));
  const env = new Float64Array(nFrames);
  let acc = 0;
  const prefix = new Float64Array(nFrames + 1);
  for (let i = 0; i < nFrames; i++) prefix[i + 1] = prefix[i] + raw[i];
  for (let i = 0; i < nFrames; i++) {
    const a = Math.max(0, i - w);
    const b = Math.min(nFrames, i + w + 1);
    const m = (prefix[b] - prefix[a]) / (b - a);
    env[i] = Math.max(0, raw[i] - m);
    acc += env[i] * env[i];
  }
  const std = Math.sqrt(acc / nFrames) || 1;
  for (let i = 0; i < nFrames; i++) env[i] /= std;
  return { env, frameRate, hopSize };
}

/**
 * Tempo (BPM) from the onset envelope's autocorrelation with a log-normal prior
 * (centre 125 BPM, 1-octave spread — resolves most half/double-time ambiguity
 * towards the tempo people usually count; force `tempo` when it guesses wrong).
 */
export function estimateTempo(env, frameRate, { minBpm = 50, maxBpm = 210, prior = 125, priorWidth = 1.0 } = {}) {
  const N = env.length;
  const minLag = Math.max(1, Math.floor((60 * frameRate) / maxBpm));
  const maxLag = Math.min(N - 2, Math.ceil((60 * frameRate) / minBpm));
  if (maxLag <= minLag) return prior;
  const ac = new Float64Array(maxLag + 2);
  for (let lag = Math.max(1, minLag - 1); lag <= Math.min(maxLag + 1, N - 1); lag++) {
    let s = 0;
    for (let i = 0; i + lag < N; i++) s += env[i] * env[i + lag];
    ac[lag] = s / (N - lag);
  }
  let best = -Infinity;
  let bestLag = minLag;
  for (let lag = minLag; lag <= maxLag; lag++) {
    const bpm = (60 * frameRate) / lag;
    const z = Math.log2(bpm / prior) / priorWidth;
    const weight = Math.exp(-0.5 * z * z);
    const score = weight * ac[lag];
    if (score > best) {
      best = score;
      bestLag = lag;
    }
  }
  // Parabolic refinement of the lag
  const y0 = ac[bestLag - 1] ?? ac[bestLag];
  const y1 = ac[bestLag];
  const y2 = ac[bestLag + 1] ?? ac[bestLag];
  const d = y0 - 2 * y1 + y2;
  const off = d !== 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (y0 - y2)) / d)) : 0;
  return (60 * frameRate) / (bestLag + off);
}

/** Returns beat positions as (fractional) envelope frame indices. */
export function trackBeats(env, frameRate, bpm, { tightness = 100 } = {}) {
  const N = env.length;
  const period = (60 * frameRate) / bpm;
  const score = new Float64Array(N);
  const back = new Int32Array(N).fill(-1);
  for (let t = 0; t < N; t++) {
    const lo = Math.max(0, Math.round(t - 2 * period));
    const hi = Math.round(t - period / 2);
    let best = -Infinity;
    let arg = -1;
    for (let tau = lo; tau <= hi; tau++) {
      const r = Math.log((t - tau) / period);
      const v = score[tau] - tightness * r * r;
      if (v > best) {
        best = v;
        arg = tau;
      }
    }
    score[t] = env[t] + (arg >= 0 ? best : 0);
    back[t] = arg;
  }
  // Last beat: best-scoring frame within the final period.
  let end = N - 1;
  let bestEnd = -Infinity;
  for (let t = Math.max(0, N - Math.round(period)); t < N; t++) {
    if (score[t] > bestEnd) {
      bestEnd = score[t];
      end = t;
    }
  }
  const beats = [];
  for (let t = end; t >= 0; t = back[t]) {
    beats.push(t);
    if (back[t] < 0) break;
  }
  return beats.reverse();
}
