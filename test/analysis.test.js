import { test } from 'node:test';
import assert from 'node:assert/strict';
import { synthesize } from './synth.js';
import { analyzeAudio } from '../src/core.js';

function barAccuracy(analysis, synth, progression, beatsPerBar = 4) {
  let ok = 0;
  progression.forEach((want, i) => {
    const mid = synth.leadIn + (i * beatsPerBar + beatsPerBar / 2) * synth.beat;
    const seg = analysis.segments.find((s) => s.start <= mid && s.end > mid);
    if (seg?.name === want) ok++;
  });
  return ok / progression.length;
}

test('major-key pop progression: chords, key, tempo, tuning', () => {
  const prog = ['G', 'D', 'Em', 'C', 'G', 'D', 'C', 'C', 'Em', 'C', 'G', 'D', 'G', 'D', 'Em', 'C'];
  const s = synthesize({ progression: prog, bpm: 96, detuneCents: 20 });
  const a = analyzeAudio(s.samples, s.sampleRate);
  assert.ok(barAccuracy(a, s, prog) >= 0.9, 'chord accuracy');
  assert.equal(a.key.name, 'G major');
  assert.ok(Math.abs(a.tempo - 96) < 2, `tempo ${a.tempo}`);
  assert.ok(Math.abs(a.tuningCents - 20) < 5, `tuning ${a.tuningCents}`);
});

test('minor key is distinguished from its relative major', () => {
  const prog = ['Am', 'F', 'C', 'G', 'Am', 'F', 'C', 'E', 'Am', 'F', 'C', 'G', 'Dm', 'E', 'Am', 'Am'];
  const s = synthesize({ progression: prog, bpm: 124 });
  const a = analyzeAudio(s.samples, s.sampleRate);
  assert.ok(barAccuracy(a, s, prog) >= 0.9);
  assert.equal(a.key.name, 'A minor');
});

test('sevenths vocabulary recognises maj7 / m7 / dominant 7', () => {
  const prog = ['Cmaj7', 'Am7', 'Dm7', 'G7', 'Cmaj7', 'Am7', 'Dm7', 'G7'];
  const s = synthesize({ progression: prog, bpm: 88 });
  const a = analyzeAudio(s.samples, s.sampleRate, { vocabulary: 'sevenths' });
  assert.ok(barAccuracy(a, s, prog) >= 0.85);
});

test('bars line up with the downbeat', () => {
  const prog = ['E', 'A', 'B', 'A', 'E', 'A', 'B', 'B'];
  const s = synthesize({ progression: prog, bpm: 140 });
  const a = analyzeAudio(s.samples, s.sampleRate);
  const full = a.bars.filter((b) => !b.pickup && b.beats.length === 4);
  const uniform = full.filter((b) => b.beats.every((c) => c.root === b.beats[0].root && c.quality === b.beats[0].quality));
  assert.ok(uniform.length / full.length >= 0.85, 'each bar should hold a single chord');
});

test('silence produces no chords and does not crash', () => {
  const a = analyzeAudio(new Float32Array(11025 * 3), 11025);
  assert.ok(a.segments.every((s) => s.chord.quality === 'N'));
});

test('talking or applause between songs is marked "no chord" and bars restart after it', () => {
  const prog = ['G', 'D', 'Em', 'C', 'G', 'D', 'C', 'C'];
  const a1 = synthesize({ progression: prog, bpm: 96, seed: 1 });
  const a2 = synthesize({ progression: prog, bpm: 96, seed: 2 });
  const sr = a1.sampleRate;
  // 20 s of "applause": noise bursts with an uneven envelope and no pitch.
  const gap = new Float32Array(20 * sr);
  let r = 11;
  const rnd = () => (r = (r * 16807) % 2147483647) / 2147483647;
  let env = 0.2;
  for (let i = 0; i < gap.length; i++) {
    if (i % 2205 === 0) env = 0.05 + 0.35 * rnd();
    gap[i] = (rnd() * 2 - 1) * env;
  }
  const gap0 = a1.samples.length;
  const all = new Float32Array(a1.samples.length + gap.length + a2.samples.length);
  all.set(a1.samples, 0);
  all.set(gap, gap0);
  all.set(a2.samples, gap0 + gap.length);
  const a = analyzeAudio(all, sr);
  const gapStart = gap0 / sr, gapEnd = gapStart + 20;
  // Most of the noise is "no chord"...
  let nc = 0;
  for (const s of a.segments) if (s.chord.quality === 'N') nc += Math.max(0, Math.min(s.end, gapEnd - 2) - Math.max(s.start, gapStart + 2));
  assert.ok(nc / 16 >= 0.85, `noise marked as no chord: ${(nc / 16).toFixed(2)}`);
  // ...both songs keep their chords...
  const off = gapEnd;
  const shifted = { ...a2, leadIn: a2.leadIn + off };
  assert.ok(barAccuracy(a, a1, prog) >= 0.85, 'first song');
  assert.ok(barAccuracy(a, shifted, prog) >= 0.85, 'second song');
  // ...and the second song's bars start on its own downbeat.
  const after = a.bars.filter((b) => b.start >= off && !b.pickup && b.beats.length === 4 && b.beats.every((c) => c.quality !== 'N'));
  const uniform = after.filter((b) => b.beats.every((c) => c.root === b.beats[0].root && c.quality === b.beats[0].quality));
  assert.ok(after.length >= 6 && uniform.length / after.length >= 0.85, `bars after the break: ${uniform.length}/${after.length}`);
  assert.equal(a.key.name, 'G major');
});

test('analyzeAudioBuffer (browser path) mixes a stereo AudioBuffer-like object', async () => {
  const { analyzeAudioBuffer } = await import('../src/core.js');
  const prog = ['D', 'G', 'A', 'D', 'D', 'G', 'A', 'D'];
  const s = synthesize({ progression: prog, bpm: 120, sampleRate: 44100 });
  const fake = { numberOfChannels: 2, length: s.samples.length, sampleRate: 44100, getChannelData: () => s.samples };
  const a = analyzeAudioBuffer(fake);
  assert.equal(a.key.name, 'D major');
  assert.ok(barAccuracy(a, s, prog) >= 0.85);
});

test('live tracker follows chords from streamed chunks', async () => {
  const { createLiveTracker } = await import('../src/core.js');
  const prog = ['G', 'D', 'Em', 'C', 'G', 'D', 'Em', 'C'];
  const s = synthesize({ progression: prog, bpm: 96, sampleRate: 48000 });
  const live = createLiveTracker({ sampleRate: 48000 });
  let ok = 0;
  let tot = 0;
  for (let i = 0, n = 0; i + 4096 <= s.samples.length; i += 4096, n++) {
    live.push(s.samples.subarray(i, i + 4096));
    if (n % 3) continue;
    const r = live.update();
    const t = (i + 4096) / 48000;
    const bar = Math.floor((t - s.leadIn) / (4 * s.beat));
    const intoBar = t - s.leadIn - bar * 4 * s.beat;
    if (!r || bar < 0 || bar >= prog.length || intoBar < 0.8) continue; // allow ~0.8 s to react
    tot++;
    if (r.name === prog[bar]) ok++;
  }
  assert.ok(ok / tot >= 0.9, `live agreement ${ok}/${tot}`);
});
