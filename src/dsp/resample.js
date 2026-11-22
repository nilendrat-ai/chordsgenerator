/**
 * Channel mixing and band-limited resampling (windowed sinc).
 */

/** Mix an array of channels (Float32Array[]) down to mono. */
export function toMono(channels) {
  if (!channels.length) return new Float32Array(0);
  if (channels.length === 1) return Float32Array.from(channels[0]);
  const len = channels[0].length;
  const out = new Float32Array(len);
  for (const ch of channels) for (let i = 0; i < len; i++) out[i] += ch[i];
  const g = 1 / channels.length;
  for (let i = 0; i < len; i++) out[i] *= g;
  return out;
}

/**
 * Resample `input` from `fromRate` to `toRate` with a Hann-windowed sinc low-pass.
 * Good enough for analysis (not mastering).
 */
export function resample(input, fromRate, toRate) {
  if (fromRate === toRate) return Float32Array.from(input);
  const ratio = toRate / fromRate;
  const outLen = Math.max(0, Math.floor(input.length * ratio));
  const out = new Float32Array(outLen);
  const cutoff = Math.min(1, ratio) * 0.95; // fraction of the input Nyquist
  const half = Math.ceil(8 / cutoff);
  const len = input.length;
  for (let i = 0; i < outLen; i++) {
    const center = i / ratio;
    const lo = Math.max(0, Math.ceil(center - half));
    const hi = Math.min(len - 1, Math.floor(center + half));
    let sum = 0;
    let wsum = 0;
    for (let j = lo; j <= hi; j++) {
      const x = j - center;
      const px = Math.PI * cutoff * x;
      const sinc = x === 0 ? 1 : Math.sin(px) / px;
      const win = 0.5 + 0.5 * Math.cos((Math.PI * x) / half);
      const w = sinc * win;
      sum += input[j] * w;
      wsum += w;
    }
    out[i] = wsum !== 0 ? sum / wsum : 0;
  }
  return out;
}
