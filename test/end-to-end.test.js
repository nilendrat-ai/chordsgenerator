import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, chmod } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { synthesize, toWav } from './synth.js';
import { generateChordSheet, isYouTubeUrl, youTubeId } from '../src/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fakeYtDlp = path.join(here, 'fixtures', 'fake-yt-dlp.cjs');
// Files pushed through the GitHub API lose their executable bit; restore it.
await chmod(fakeYtDlp, 0o755).catch(() => {});

async function fixture() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ytchords-test-'));
  const prog = ['C', 'G', 'Am', 'F', 'C', 'G', 'Am', 'F', 'C', 'G', 'F', 'F'];
  const s = synthesize({ progression: prog, bpm: 100, sampleRate: 44100 });
  const audio = path.join(dir, 'song.wav');
  await writeFile(audio, toWav(s.samples, s.sampleRate));
  const bar = 4 * s.beat;
  const ts = (x) => `00:${String(Math.floor(x / 60)).padStart(2, '0')}:${(x % 60).toFixed(3).padStart(6, '0')}`;
  const a = s.leadIn + 4 * bar;
  const vtt = `WEBVTT\n\n${ts(a)} --> ${ts(a + 2 * bar)}\nlet it be the one\n\n${ts(a + 2 * bar)} --> ${ts(a + 4 * bar)}\nsinging in the sun\n`;
  const lyrics = path.join(dir, 'song.en.vtt');
  await writeFile(lyrics, vtt);
  return { dir, audio, lyrics };
}

test('URL helpers', () => {
  assert.ok(isYouTubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ'));
  assert.ok(isYouTubeUrl('youtu.be/dQw4w9WgXcQ'));
  assert.ok(isYouTubeUrl('https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=x'));
  assert.ok(!isYouTubeUrl('/home/me/song.mp3'));
  assert.equal(youTubeId('https://youtu.be/dQw4w9WgXcQ?t=3'), 'dQw4w9WgXcQ');
});

test('YouTube URL -> chord sheet with captions (yt-dlp test double)', async () => {
  const fx = await fixture();
  try {
    process.env.FAKE_AUDIO = fx.audio;
    process.env.FAKE_VTT = fx.lyrics;
    const res = await generateChordSheet('https://youtu.be/abcdefghijk', { ytDlpPath: fakeYtDlp });
    assert.equal(res.meta.title, 'Fake Song');
    assert.equal(res.analysis.key.name, 'C major');
    assert.match(res.sheet, /Fake Song\nFake Artist/);
    assert.match(res.sheet, /\[Intro\]/);
    assert.match(res.sheet, /C\s+G\nlet it be the one/);
    assert.match(res.sheet, /Am\s+F\nsinging in the sun/);
  } finally {
    await rm(fx.dir, { recursive: true, force: true });
  }
});

test('CLI on a local file with an LRC/VTT lyrics file', async () => {
  const fx = await fixture();
  try {
    const cli = path.join(here, '..', 'bin', 'ytchords.js');
    const { stdout } = await promisify(execFile)(process.execPath, [cli, fx.audio, '--lyrics', fx.lyrics, '-f', 'chordpro', '-q', '--title', 'Local']);
    assert.match(stdout, /\{title: Local\}/);
    assert.match(stdout, /\[C\]let it \[G\]be the one/);
  } finally {
    await rm(fx.dir, { recursive: true, force: true });
  }
});

test('clear error for a missing input', async () => {
  await assert.rejects(generateChordSheet('/nope/missing.mp3'), /neither a YouTube URL nor an existing file/);
});

test('clear error when yt-dlp is not installed', async () => {
  await assert.rejects(generateChordSheet('https://youtu.be/abcdefghijk', { ytDlpPath: 'yt-dlp-does-not-exist' }), /not found on PATH.*yt-dlp/s);
});
