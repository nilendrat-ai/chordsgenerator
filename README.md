# yt-chord-sheet

Generate a chord sheet from a YouTube video (or any audio/video file) in JavaScript.

```
River Road
Synthetic Test Band
====================
Key: G major  |  Tempo: ~96 BPM  |  Time: 4/4  |  Tuning: A4 = 443 Hz
Chords: G  D  Em  C

[Intro]
[ 0:01]  | G    | D    | Em   | C    |

G                D
walking down the river road tonight
Em                         C
the city lights are fading out of sight
```

**What it does**

- Downloads the audio (and captions, if there are any) with **yt-dlp**, then decodes it with **ffmpeg**.
- Detects **tempo and beats**, the **downbeat/bars**, the **key**, the **tuning offset** and the **chords** (major/minor, or sevenths, sus, dim and aug).
- Uses YouTube's **word-timed captions** to place each chord above the word where it changes. Without captions, it prints a bar grid.
- Outputs **plain text**, **ChordPro**, **Markdown** or **JSON**.
- **Transposes**, simplifies chords, and suggests a **capo** position that gives easier guitar shapes.
- The analysis engine is **pure JavaScript with zero dependencies**. It also runs **entirely in the browser**: `dist/chord-sheet.html` listens to a YouTube video as it plays and builds the sheet, with no server.

## Requirements (Node CLI / API)

- Node.js 18+
- [`yt-dlp`](https://github.com/yt-dlp/yt-dlp#installation) for YouTube URLs (`pip install -U yt-dlp` / `brew install yt-dlp` / `winget install yt-dlp`)
- [`ffmpeg`](https://ffmpeg.org/download.html) to decode audio (plain `.wav` files work without it)

## CLI

```bash
git clone https://github.com/nilendrat-ai/chordsgenerator && cd chordsgenerator
npm install -g .        # or: npm link

ytchords "https://www.youtube.com/watch?v=VIDEO_ID"
ytchords "https://youtu.be/VIDEO_ID" -f chordpro -o song.cho
ytchords "https://youtu.be/VIDEO_ID" --vocab sevenths --capo auto
ytchords ./my-song.mp3 --lyrics ./my-song.lrc --transpose -2
```

| Option | Description |
|---|---|
| `-f, --format` | `text` (default), `chordpro`, `markdown`, `json` |
| `-o, --output` | write to a file |
| `-v, --vocab` | `majmin` (default), `sevenths` (adds 7, maj7, m7), `full` (adds sus2, sus4, dim, aug) |
| `-t, --transpose <n>` | transpose by n semitones |
| `-c, --capo <n\|auto>` | show chord shapes for a capo position; `auto` picks the easiest |
| `--simplify` | reduce everything to major/minor triads |
| `--slash` | detect slash chords such as C/E and D/F# from the bass line |
| `--tempo <bpm>` | force a tempo (fixes the occasional half/double-time guess) |
| `--beats-per-bar <n>` | default 4 |
| `--no-lyrics` | skip captions and print a bar grid only |
| `--lyrics <file>` | use your own `.vtt` or `.lrc` timed lyrics |
| `--lang <code>` | caption language (default `en`) |
| `--cookies-from-browser <name>` | passed to yt-dlp (for videos that need sign-in or age checks) |
| `--title`, `--artist` | override the metadata |

## Node API

```js
import { generateChordSheet } from 'yt-chord-sheet';

const { sheet, analysis, lyrics, meta } = await generateChordSheet('https://youtu.be/VIDEO_ID', {
  format: 'text',          // 'text' | 'chordpro' | 'markdown' | 'json'
  vocabulary: 'majmin',    // 'majmin' | 'sevenths' | 'full' | ['maj','min','7']
  capo: 'auto',            // 'none' | 'auto' | number
  transpose: 0,
  lyrics: true,            // align to YouTube captions when available
  onProgress: ({ stage }) => console.log(stage),
});
console.log(sheet);
```

Analysis runs once; you can re-render the result in any format or key without re-analysing:

```js
import { renderSheet } from 'yt-chord-sheet';
const chordpro = renderSheet(analysis, { format: 'chordpro', lyrics, title: meta.title, transpose: 2 });
```

`analysis` contains:

```js
{
  duration, tempo, beatsPerBar, tuningCents,
  key: { tonic, mode, name: 'G major', confidence },
  beats: [0.98, 1.60, ...],                                        // seconds
  segments: [{ start, end, chord: { root, quality, bass? }, name: 'G', beats, confidence }],
  bars: [{ start, end, pickup, beats: [chord, chord, chord, chord] }],
  capo: { capo, playability, ranking },
}
```

Lower-level building blocks are exported too: `downloadYouTube`, `decodeAudioFile`, `analyzeAudio(samples, sampleRate, opts)`, `parseVtt`, `parseLrc`, `suggestCapo` and `theory` (note spelling, transposition, keys).

## In the browser (no server)

The analyser is pure JavaScript with no dependencies. It runs in any modern browser, inside a Web Worker so the page stays smooth.

### The ready-made page: `dist/chord-sheet.html`

This is a single 70 KB file with the library built in. Nothing runs on a server, and no audio leaves the browser.

- **Live:** every push to `main` runs the tests, builds the page and publishes it to GitHub Pages at `https://nilendrat-ai.github.io/chordsgenerator/` (see `.github/workflows/pages.yml`). This needs **Settings → Pages → Source: GitHub Actions** turned on once.
- **Download:** each workflow run also attaches the built `dist/` folder as an artifact.
- **Build it yourself:** run `npm install && npm run build`, then open `dist/chord-sheet.html` or host it anywhere (Netlify, any static folder).

1. Paste a YouTube link and press **Load video**.
2. Press **Listen & get chords**. In the share dialog, choose **This tab** and keep **Also share tab audio** switched on.
3. Play the video. The current chord appears live, about half a second behind the music. When the video ends, or you press **Stop**, the whole recording is analysed and the full sheet appears, synced to the video for playing along.

Also on the page:

- **Listen to another tab instead:** captures any tab (YouTube, Spotify web, SoundCloud…), with no embedding needed.
- **Open an audio file**, or play the **demo song**.
- **Synced lyrics:** looked up automatically on [lrclib.net](https://lrclib.net) from the video title, or you can paste or open an `.lrc` or `.vtt` file. A timing nudge corrects offsets between the music video and the lyrics.
- **Sheet controls:** transpose, capo (or "Easiest"), simplify, and Text, ChordPro, Markdown or JSON, with Copy and Download.

Why does it listen instead of downloading? Browsers aren't allowed to fetch YouTube's audio directly (cross-origin rules), and there's no public CORS-friendly API for it. Tab-audio capture is the only way to get the sound with no server, and it's the same permission video-call apps use.

Requirements and limits:

- **Browsers:** tab-audio sharing works in **desktop Chrome and Edge**. Firefox and Safari can't share tab audio, but they can still analyse audio files.
- **Real-time playback:** the analysis needs the song to play through in real time. A 4-minute song takes 4 minutes to capture, and you can pause.
- **Embedding:** some videos block it (error 101/150). Use **Listen to another tab instead**. YouTube can also refuse embeds on pages opened straight from disk (`file://`, error 153). Hosting the file anywhere fixes this, and "another tab" always works.

Rebuild after changing the source:

```bash
npm install && npm run build   # writes dist/chord-sheet.html, dist/yt-chord-sheet.esm.js, dist/yt-chord-sheet.min.js
```

### Use the library in your own web app

```js
import { analyzeAudioBuffer, renderSheet, createLiveTracker } from 'yt-chord-sheet/browser'; // or dist/yt-chord-sheet.esm.js

// A whole file:
const buffer = await new AudioContext().decodeAudioData(await file.arrayBuffer());
const analysis = analyzeAudioBuffer(buffer, { vocabulary: 'sevenths' });
pre.textContent = renderSheet(analysis, { title: file.name, capo: 'auto' });

// Live, from any MediaStream (tab capture, microphone, <audio>.captureStream()):
const live = createLiveTracker({ sampleRate: ctx.sampleRate });
// feed it Float32Array chunks: live.push(chunk); every ~250 ms: live.update() -> { name: 'Em', confidence, key }
```

`dist/yt-chord-sheet.min.js` is a classic script that exposes a global `YTChords`. It works in a `<script>` tag or in a Web Worker via `importScripts`. Full-song analysis takes a few seconds for a typical song, so run it in a Worker, as the page does.

## How it works

1. **Decoding.** ffmpeg converts the audio to mono 11,025 Hz float PCM.
2. **Tuning.** Spectral peaks are folded onto the semitone grid. Their circular mean gives the cents offset from A440, so detuned recordings still map onto the right notes.
3. **Chroma.** Each hop gets two FFT frames on the same centre: 4096 samples for the treble chroma and 8192 for a separate bass chroma. Peaks are refined by parabolic interpolation and added to the 12 pitch classes with a Gaussian weight.
4. **Beats.** The tempo comes from the autocorrelation of a log spectral-flux onset envelope, with a log-normal prior around 125 BPM. Ellis-style dynamic programming then tracks the beats, and chroma is averaged within each beat.
5. **Chords.** Every candidate chord has a template that includes the harmonic series (partials 1–6). Each beat is scored by cosine similarity plus a bass-root bonus. An HMM with Viterbi decoding then smooths the sequence.
6. **Key.** Krumhansl–Kessler profile correlation, refined by how much of the song is diatonic and on the tonic chord (this separates G major from E minor). A second chord pass adds a small preference for chords in the key.
7. **Bars.** Each possible downbeat phase is scored by how many chord changes land on it. Bars follow from the winner.
8. **Lyrics.** YouTube auto-captions carry per-word timestamps. The rolling duplicate lines are removed, and each chord change goes over the word being sung at that moment.

## Accuracy and limits

The tests synthesise songs with known chords (strummed chords, bass, drums, a wandering melody, noise, detuning up to ±30 cents). The results are 92–100% beat-level chord accuracy, the correct key and tempo within 0.5%. Real recordings are harder: dense mixes, distorted guitars, heavy vocals and jazz harmony all lower accuracy, as with every automatic chord recogniser. Treat the output as a strong first draft.

- Half or double tempo can still happen; use `--tempo`.
- Only one key is reported, so modulations are not tracked.
- Captions on music videos are often missing or "[Music]". Use `--lyrics` with an `.lrc` file for proper lyric alignment.
- Only download content you have the right to use, and follow YouTube's Terms of Service.

## Tests

```bash
npm test
```

There are 19 tests covering chord, key, tempo and tuning accuracy on synthetic audio; the live tracker; caption, LRC and VTT parsing; every output format; transpose and capo; the browser `AudioBuffer` path; and the full YouTube flow through the CLI, using a yt-dlp test double.
