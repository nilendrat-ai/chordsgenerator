/**
 * Decode any audio/video file to mono Float32 PCM.
 * Uses ffmpeg; falls back to a built-in reader for plain .wav files.
 */
import { readFile } from 'node:fs/promises';
import { run } from './exec.js';

/** Minimal PCM/float WAV reader (8/16/24/32-bit int, 32/64-bit float). */
export function decodeWav(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Not a WAV file');
  let off = 12;
  let fmt = null;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    const body = off + 8;
    if (id === 'fmt ') {
      fmt = {
        format: buf.readUInt16LE(body),
        channels: buf.readUInt16LE(body + 2),
        sampleRate: buf.readUInt32LE(body + 4),
        bits: buf.readUInt16LE(body + 14),
      };
      if (fmt.format === 0xfffe && size >= 26) fmt.format = buf.readUInt16LE(body + 24); // WAVE_FORMAT_EXTENSIBLE
    } else if (id === 'data') {
      if (!fmt) throw new Error('WAV data before fmt chunk');
      const { channels, bits, format } = fmt;
      const bps = bits / 8;
      const end = Math.min(buf.length, body + size);
      const frames = Math.floor((end - body) / (bps * channels));
      const out = new Float32Array(frames);
      const read = (p) => {
        if (format === 3) return bits === 64 ? buf.readDoubleLE(p) : buf.readFloatLE(p);
        if (bits === 8) return (buf.readUInt8(p) - 128) / 128;
        if (bits === 16) return buf.readInt16LE(p) / 32768;
        if (bits === 24) return buf.readIntLE(p, 3) / 8388608;
        if (bits === 32) return buf.readInt32LE(p) / 2147483648;
        throw new Error(`Unsupported WAV bit depth ${bits}`);
      };
      for (let i = 0; i < frames; i++) {
        let s = 0;
        for (let c = 0; c < channels; c++) s += read(body + (i * channels + c) * bps);
        out[i] = s / channels;
      }
      return { samples: out, sampleRate: fmt.sampleRate };
    }
    off = body + size + (size & 1);
  }
  throw new Error('WAV file has no data chunk');
}

/**
 * @param {string} file path to any media file ffmpeg understands
 * @param {{ffmpegPath?: string, sampleRate?: number}} [opts]
 * @returns {Promise<{samples: Float32Array, sampleRate: number}>}
 */
export async function decodeAudioFile(file, { ffmpegPath = 'ffmpeg', sampleRate = 11025 } = {}) {
  try {
    const { stdout } = await run(ffmpegPath, ['-v', 'error', '-nostdin', '-i', file, '-vn', '-ac', '1', '-ar', String(sampleRate), '-f', 'f32le', 'pipe:1'], { tool: 'ffmpeg' });
    const n = stdout.length >> 2;
    const samples = new Float32Array(n);
    new Uint8Array(samples.buffer).set(stdout.subarray(0, n * 4));
    return { samples, sampleRate };
  } catch (err) {
    if (err.code === 'ENOENT' && /\.wav$/i.test(file)) return decodeWav(await readFile(file));
    throw err;
  }
}
