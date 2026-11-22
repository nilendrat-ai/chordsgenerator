/**
 * Tuning-aware chroma extraction.
 *
 * For every hop we take two FFT frames centred on the same instant:
 *  - a shorter frame for the "treble" chroma (good time resolution)
 *  - a longer frame for the "bass" chroma (needed to separate low semitones)
 * Spectral peaks are refined with parabolic interpolation and folded onto
 * the 12 pitch classes with a Gaussian weight around each equal-tempered pitch.
 */
import { FFT } from './fft.js';

const LN2 = Math.LN2;
const EPS = 1e-12;

function* spectralPeaks(mag, sr, n, kMin, kMax, threshold) {
  const lo = Math.max(1, kMin);
  const hi = Math.min(mag.length - 2, kMax);
  for (let k = lo; k <= hi; k++) {
    const m = mag[k];
    if (m <= threshold || m <= mag[k - 1] || m < mag[k + 1]) continue;
    const a = Math.log(mag[k - 1] + EPS);
    const b = Math.log(m + EPS);
    const c = Math.log(mag[k + 1] + EPS);
    const denom = a - 2 * b + c;
    const p = denom !== 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / denom)) : 0;
    const freq = ((k + p) * sr) / n;
    const amp = Math.exp(b - 0.25 * (a - c) * p);
    yield { freq, amp };
  }
}

const midiOf = (freq) => 69 + (12 * Math.log(freq / 440)) / LN2;

/**
 * Estimate global tuning deviation (in semitones, -0.5..0.5) from A440.
 */
export function estimateTuning(samples, sr, { frameSize = 4096, hopSize = 1024, stride = 4, fmin = 100, fmax = 2000 } = {}) {
  const fft = new FFT(frameSize);
  const mag = new Float64Array(fft.bins);
  const kMin = Math.floor((fmin * frameSize) / sr);
  const kMax = Math.ceil((fmax * frameSize) / sr);
  let C = 0;
  let S = 0;
  const nFrames = Math.ceil(samples.length / hopSize);
  for (let t = 0; t < nFrames; t += stride) {
    fft.magnitudes(samples, t * hopSize - frameSize / 2, mag);
    let max = 0;
    for (let k = kMin; k <= kMax && k < mag.length; k++) if (mag[k] > max) max = mag[k];
    if (max <= EPS) continue;
    for (const { freq, amp } of spectralPeaks(mag, sr, frameSize, kMin, kMax, max * 0.05)) {
      const midi = midiOf(freq);
      const dev = midi - Math.round(midi);
      C += amp * Math.cos(2 * Math.PI * dev);
      S += amp * Math.sin(2 * Math.PI * dev);
    }
  }
  if (C === 0 && S === 0) return 0;
  return Math.atan2(S, C) / (2 * Math.PI);
}

/**
 * @returns {{treble: Float64Array[], bass: Float64Array[], energy: Float64Array,
 *            times: Float64Array, hopSize: number, sampleRate: number, tuningCents: number}}
 */
export function computeChroma(samples, sr, opts = {}) {
  const {
    hopSize = 1024,
    trebleFrameSize = 4096,
    bassFrameSize = 8192,
    trebleRange = [65, 2100],
    bassRange = [32, 200],
    tuning = 'auto',
    peakThresholdDb = -60,
    pitchTolerance = 0.2, // std-dev of the Gaussian, in semitones
    compression = 0.5,
  } = opts;

  const tuningSemis = tuning === 'auto' ? estimateTuning(samples, sr, { frameSize: trebleFrameSize, hopSize }) : (tuning || 0) / 100;

  const fftT = new FFT(trebleFrameSize);
  const fftB = new FFT(bassFrameSize);
  const magT = new Float64Array(fftT.bins);
  const magB = new Float64Array(fftB.bins);
  const tk = [Math.floor((trebleRange[0] * trebleFrameSize) / sr), Math.ceil((trebleRange[1] * trebleFrameSize) / sr)];
  const bk = [Math.floor((bassRange[0] * bassFrameSize) / sr), Math.ceil((bassRange[1] * bassFrameSize) / sr)];
  const relThr = Math.pow(10, peakThresholdDb / 20);
  const twoVar = 2 * pitchTolerance * pitchTolerance;

  const nFrames = Math.max(1, Math.ceil(samples.length / hopSize));
  const treble = new Array(nFrames);
  const bass = new Array(nFrames);
  const energy = new Float64Array(nFrames);
  const times = new Float64Array(nFrames);

  const fold = (mag, n, kRange, fLo, fHi, out) => {
    let max = 0;
    for (let k = kRange[0]; k <= kRange[1] && k < mag.length; k++) if (mag[k] > max) max = mag[k];
    if (max <= EPS) return;
    for (const { freq, amp } of spectralPeaks(mag, sr, n, kRange[0], kRange[1], max * relThr)) {
      if (freq < fLo || freq > fHi) continue;
      const midi = midiOf(freq) - tuningSemis;
      const nearest = Math.round(midi);
      const dev = midi - nearest;
      const w = Math.exp(-(dev * dev) / twoVar);
      out[((nearest % 12) + 12) % 12] += w * Math.pow(amp, compression);
    }
  };

  const half = hopSize / 2;
  for (let t = 0; t < nFrames; t++) {
    const center = t * hopSize;
    times[t] = center / sr;
    const tr = new Float64Array(12);
    const bs = new Float64Array(12);
    fftT.magnitudes(samples, center - trebleFrameSize / 2, magT);
    fold(magT, trebleFrameSize, tk, trebleRange[0], trebleRange[1], tr);
    fftB.magnitudes(samples, center - bassFrameSize / 2, magB);
    fold(magB, bassFrameSize, bk, bassRange[0], bassRange[1], bs);
    treble[t] = tr;
    bass[t] = bs;
    // RMS over one hop centred on the frame
    let e = 0;
    let cnt = 0;
    const s0 = Math.max(0, Math.floor(center - half));
    const s1 = Math.min(samples.length, Math.floor(center + half));
    for (let i = s0; i < s1; i++) {
      e += samples[i] * samples[i];
      cnt++;
    }
    energy[t] = cnt ? Math.sqrt(e / cnt) : 0;
  }

  return { treble, bass, energy, times, hopSize, sampleRate: sr, tuningCents: tuningSemis * 100 };
}
