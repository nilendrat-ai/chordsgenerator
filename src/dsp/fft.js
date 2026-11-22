/**
 * Minimal radix-2 real-input FFT returning magnitude spectra.
 * Pure JavaScript, no dependencies — runs in Node and the browser.
 */

export function hann(n) {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  return w;
}

export class FFT {
  /** @param {number} n power-of-two frame size */
  constructor(n) {
    if (!Number.isInteger(n) || n < 2 || (n & (n - 1)) !== 0) {
      throw new Error(`FFT size must be a power of two, got ${n}`);
    }
    this.n = n;
    this.bins = n / 2 + 1;
    this.cos = new Float64Array(n / 2);
    this.sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      this.cos[i] = Math.cos((2 * Math.PI * i) / n);
      this.sin[i] = Math.sin((2 * Math.PI * i) / n);
    }
    const bits = Math.log2(n);
    this.rev = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      this.rev[i] = r;
    }
    this.window = hann(n);
    this.re = new Float64Array(n);
    this.im = new Float64Array(n);
  }

  /**
   * Magnitude spectrum of a Hann-windowed frame of `signal` starting at `offset`.
   * Samples outside the signal are treated as zero, so frames may be centred on t=0.
   * @param {Float32Array|Float64Array} signal
   * @param {number} offset
   * @param {Float64Array} [out]
   */
  magnitudes(signal, offset, out = new Float64Array(this.bins)) {
    const { n, re, im, rev, window, cos, sin } = this;
    const len = signal.length;
    for (let i = 0; i < n; i++) {
      const idx = offset + i;
      const v = idx >= 0 && idx < len ? signal[idx] : 0;
      const r = rev[i];
      re[r] = v * window[i];
      im[r] = 0;
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1;
      const step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let j = 0, k = 0; j < half; j++, k += step) {
          const a = i + j;
          const b = a + half;
          const tre = re[b] * cos[k] + im[b] * sin[k];
          const tim = im[b] * cos[k] - re[b] * sin[k];
          re[b] = re[a] - tre;
          im[b] = im[a] - tim;
          re[a] += tre;
          im[a] += tim;
        }
      }
    }
    for (let k = 0; k < this.bins; k++) out[k] = Math.hypot(re[k], im[k]);
    return out;
  }
}
