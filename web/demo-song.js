/**
 * A small synthesised song (band + word-timed captions) so the demo page
 * works before you've pasted a URL or installed yt-dlp. Browser-safe.
 */
const NOTE = { C: 0, 'C#': 1, D: 2, Eb: 3, E: 4, F: 5, 'F#': 6, G: 7, Ab: 8, A: 9, Bb: 10, B: 11 };
const QUAL = { '': [0, 4, 7], m: [0, 3, 7], '7': [0, 4, 7, 10] };

const PROGRESSION = ['G', 'D', 'Em', 'C', 'G', 'D', 'Em', 'C', 'G', 'D', 'Em', 'C', 'C', 'D', 'G', 'G', 'Em', 'C', 'G', 'D', 'G', 'G'];
const LINES = [
  [4, 'walking down the river road tonight'],
  [6, 'the city lights are fading out of sight'],
  [8, 'i kept your letter folded in my coat'],
  [10, 'and every word still catches in my throat'],
  [12, 'so carry me home'],
  [14, 'carry me home'],
  [16, 'when the morning comes around'],
  [18, 'i will be homeward bound'],
];

export function makeDemoSong({ bpm = 96, sampleRate = 22050, leadIn = 1.2 } = {}) {
  const beat = 60 / bpm;
  const bar = 4 * beat;
  const total = leadIn + PROGRESSION.length * bar + 1.5;
  const n = Math.ceil(total * sampleRate);
  const out = new Float32Array(n);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const hz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

  const tone = (f, t0, dur, amp, decay) => {
    const i0 = Math.floor(t0 * sampleRate);
    const i1 = Math.min(n, Math.floor((t0 + dur) * sampleRate));
    for (let h = 1; h <= 5; h++) {
      const w = (2 * Math.PI * f * h) / sampleRate;
      if (f * h > sampleRate / 2) break;
      for (let i = i0; i < i1; i++) {
        const tt = (i - i0) / sampleRate;
        out[i] += (amp / h) * Math.exp(-tt / decay) * Math.min(1, tt * 200) * Math.sin(w * (i - i0));
      }
    }
  };

  PROGRESSION.forEach((name, b) => {
    const m = /^([A-G][#b]?)(m|7)?$/.exec(name);
    const root = NOTE[m[1]];
    const ivs = QUAL[m[2] || ''];
    for (let k = 0; k < 4; k++) {
      const t = leadIn + (b * 4 + k) * beat;
      for (const iv of ivs) tone(hz(55 + ((root + iv - 7 + 24) % 12)), t, beat, 0.08, 0.5);
      if (k % 2 === 0) tone(hz(36 + root), t, 2 * beat, 0.25, 0.8);
      const i0 = Math.floor(t * sampleRate);
      const len = Math.floor((k % 2 === 0 ? 0.12 : 0.08) * sampleRate);
      for (let i = 0; i < len && i0 + i < n; i++) {
        const tt = i / sampleRate;
        out[i0 + i] += k % 2 === 0
          ? 0.5 * Math.exp(-tt / 0.04) * Math.sin(2 * Math.PI * (50 + 60 * Math.exp(-tt / 0.02)) * tt)
          : 0.12 * Math.exp(-tt / 0.03) * rnd();
      }
    }
  });
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
  for (let i = 0; i < n; i++) out[i] *= 0.85 / peak;

  // YouTube-style auto captions with per-word timestamps.
  const ts = (x) => `00:${String(Math.floor(x / 60)).padStart(2, '0')}:${(x % 60).toFixed(3).padStart(6, '0')}`;
  let vtt = 'WEBVTT\n\n';
  for (const [b, text] of LINES) {
    const start = leadIn + b * bar;
    const words = text.split(' ');
    const per = (1.6 * bar) / words.length;
    const tagged = words.map((w, i) => (i ? `<${ts(start + i * per)}><c> ${w}</c>` : w)).join('');
    vtt += `${ts(start)} --> ${ts(start + 2 * bar)}\n${tagged}\n\n`;
  }
  return { samples: out, sampleRate, vtt, title: 'River Road (demo song)', artist: 'Synthesised in your browser' };
}

/** 16-bit PCM WAV Blob for the <audio> player. */
export function wavBlob(samples, sampleRate) {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 32767, true);
  return new Blob([buf], { type: 'audio/wav' });
}
