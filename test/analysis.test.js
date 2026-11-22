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
