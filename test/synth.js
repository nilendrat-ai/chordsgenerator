/**
 * Synthesises a simple band arrangement (strummed chords + bass + kick + hats)
 * from a chord progression, for testing the analyser against known answers.
 */
const NOTE = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
const QUAL = { '': [0, 4, 7], m: [0, 3, 7], '7': [0, 4, 7, 10], maj7: [0, 4, 7, 11], m7: [0, 3, 7, 10] };

export function parseChord(name) {
  const m = /^([A-G][#b]?)(maj7|m7|m|7)?$/.exec(name);
  if (!m) throw new Error(name);
  return { root: NOTE[m[1]], intervals: QUAL[m[2] || ''] };
}

function lcg(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
}

/**
 * @param {object} o
 * @param {string[]} o.progression chord per bar, e.g. ['G','D','Em','C']
 */
export function synthesize({ progression, bpm = 96, beatsPerBar = 4, sampleRate = 22050, detuneCents = 0, leadIn = 1, tail = 1, seed = 1, noise = 0.01 }) {
  const beat = 60 / bpm;
  const total = leadIn + progression.length * beatsPerBar * beat + tail;
  const n = Math.ceil(total * sampleRate);
  const out = new Float32Array(n);
  const rnd = lcg(seed);
  const freq = (midi) => 440 * Math.pow(2, (midi - 69 + detuneCents / 100) / 12);

  const addTone = (f, t0, dur, amp, decay) => {
    const i0 = Math.floor(t0 * sampleRate);
    const i1 = Math.min(n, Math.floor((t0 + dur) * sampleRate));
    for (let h = 1; h <= 6; h++) {
      const fh = f * h;
      if (fh > sampleRate / 2) break;
      const ah = amp / h;
      const w = (2 * Math.PI * fh) / sampleRate;
      for (let i = i0; i < i1; i++) {
        const tt = (i - i0) / sampleRate;
        const env = Math.exp(-tt / decay) * Math.min(1, tt * 200);
        out[i] += ah * env * Math.sin(w * (i - i0));
      }
    }
  };

  progression.forEach((name, bar) => {
    const { root, intervals } = parseChord(name);
    for (let b = 0; b < beatsPerBar; b++) {
      const t = leadIn + (bar * beatsPerBar + b) * beat;
      // chord voicing around C4..C5
      for (const iv of intervals) {
        let midi = 55 + ((root + iv - 55 % 12 + 24) % 12); // between G3 and F#4
        addTone(freq(midi), t, beat, 0.08, 0.5);
        addTone(freq(midi + 12), t, beat, 0.03, 0.4);
      }
      // bass root on beats 1 and 3
      if (b % 2 === 0) addTone(freq(36 + root), t, beat * 2, 0.25, 0.8);
      // kick on 1 and 3, snare-ish noise on 2 and 4, hats on eighths
      const i0 = Math.floor(t * sampleRate);
      if (b % 2 === 0) {
        for (let i = 0; i < 0.12 * sampleRate && i0 + i < n; i++) {
          const tt = i / sampleRate;
          out[i0 + i] += 0.5 * Math.exp(-tt / 0.04) * Math.sin(2 * Math.PI * (50 + 60 * Math.exp(-tt / 0.02)) * tt);
        }
      } else {
        for (let i = 0; i < 0.08 * sampleRate && i0 + i < n; i++) out[i0 + i] += 0.12 * Math.exp(-i / sampleRate / 0.03) * rnd();
      }
      for (const off of [0, beat / 2]) {
        const j0 = Math.floor((t + off) * sampleRate);
        for (let i = 0; i < 0.02 * sampleRate && j0 + i < n; i++) out[j0 + i] += 0.04 * Math.exp(-i / sampleRate / 0.006) * rnd();
      }
    }
  });
  for (let i = 0; i < n; i++) out[i] += noise * rnd();
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
  for (let i = 0; i < n; i++) out[i] *= 0.9 / peak;
  return { samples: out, sampleRate, beat, leadIn, total };
}

/** Encode mono float samples as a 16-bit PCM WAV buffer. */
export function toWav(samples, sampleRate) {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + samples.length * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + i * 2);
  return buf;
}
