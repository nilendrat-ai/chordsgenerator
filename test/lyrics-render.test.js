import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseVtt, parseLrc, renderSheet } from '../src/core.js';

const YT_AUTO = `WEBVTT
Kind: captions
Language: en

00:00:01.000 --> 00:00:03.990 align:start position:0%

hello<00:00:01.500><c> darkness</c><00:00:02.200><c> my</c><00:00:02.600><c> old</c><00:00:03.000><c> friend</c>

00:00:03.990 --> 00:00:04.000 align:start position:0%
hello darkness my old friend


00:00:04.000 --> 00:00:06.000 align:start position:0%
hello darkness my old friend
[Music]<00:00:04.500><c> again</c>
`;

test('parses YouTube auto-captions with word timing and dedupes rolling lines', () => {
  const lines = parseVtt(YT_AUTO);
  assert.equal(lines.length, 2);
  assert.equal(lines[0].text, 'hello darkness my old friend');
  assert.deepEqual(lines[0].words.map((w) => w.start), [1, 1.5, 2.2, 2.6, 3]);
  assert.equal(lines[1].text, '[Music] again');
});

test('parses manual VTT captions and spreads word times across the cue', () => {
  const lines = parseVtt('WEBVTT\n\n1\n00:00:10.000 --> 00:00:14.000\n♪ Here comes the sun ♪\n\n2\n00:00:14.000 --> 00:00:16.000\n[Music]\n');
  assert.equal(lines.length, 1);
  assert.equal(lines[0].text, 'Here comes the sun');
  assert.equal(lines[0].words[0].start, 10);
  assert.ok(lines[0].words[3].start > 12);
});

test('parses LRC lyrics', () => {
  const lines = parseLrc('[ti:Song]\n[00:12.50]First line here\n[00:17.00][01:20.00]Chorus line\n');
  assert.deepEqual(lines.map((l) => [l.start, l.text]), [[12.5, 'First line here'], [17, 'Chorus line'], [80, 'Chorus line']]);
});

// A hand-built analysis: 8 bars of G D Em C at 120 BPM (2 s per bar).
function fakeAnalysis() {
  const names = [[7, 'maj'], [2, 'maj'], [4, 'min'], [0, 'maj']];
  const segments = [];
  const bars = [];
  for (let i = 0; i < 8; i++) {
    const [root, quality] = names[i % 4];
    const chord = { root, quality };
    segments.push({ start: i * 2, end: i * 2 + 2, chord, beats: 4, confidence: 0.9 });
    bars.push({ start: i * 2, end: i * 2 + 2, beats: [chord, chord, chord, chord] });
  }
  return { duration: 16, tempo: 120, beatsPerBar: 4, beats: [], tuningCents: 0, key: { tonic: 7, mode: 'major', name: 'G major', confidence: 0.5 }, segments, bars, capo: { capo: 0 } };
}

test('renders a bar grid when there are no lyrics', () => {
  const out = renderSheet(fakeAnalysis(), { title: 'Grid' });
  assert.match(out, /Key: G major/);
  assert.match(out, /\| G\s+\| D\s+\| Em\s+\| C\s+\|/);
});

test('places chords above the word being sung', () => {
  const lyrics = [{ start: 8, end: 12, text: 'one two three four', words: [{ text: 'one', start: 8 }, { text: 'two', start: 9 }, { text: 'three', start: 10 }, { text: 'four', start: 11 }] }];
  const out = renderSheet(fakeAnalysis(), { lyrics, timestamps: false });
  const lines = out.split('\n');
  const i = lines.indexOf('one two three four');
  assert.equal(lines[i - 1], 'G       D'); // D lands on "three" (t=10s)
  assert.match(out, /\[Intro\]/);
});

test('transpose and capo respell chords sensibly', () => {
  const up3 = renderSheet(fakeAnalysis(), { transpose: 3 });
  assert.match(up3, /Key: Bb major/);
  assert.match(up3, /Chords: Bb {2}F {2}Gm {2}Eb/);
  const capo = renderSheet(fakeAnalysis(), { transpose: 3, capo: 'auto' });
  assert.match(capo, /Capo 3/);
  assert.match(capo, /Chords: G {2}D {2}Em {2}C/);
});

test('ChordPro and JSON output', () => {
  const lyrics = [{ start: 8, end: 12, text: 'one two', words: [{ text: 'one', start: 8 }, { text: 'two', start: 10 }] }];
  const cp = renderSheet(fakeAnalysis(), { format: 'chordpro', lyrics, title: 'T' });
  assert.match(cp, /\{title: T\}/);
  assert.match(cp, /\[G\]one \[D\]two/);
  const json = JSON.parse(renderSheet(fakeAnalysis(), { format: 'json', lyrics }));
  assert.equal(json.segments[0].chord, 'G');
  assert.equal(json.lyrics[0].chords[1].name, 'D');
});
