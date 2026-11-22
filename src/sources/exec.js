import { spawn } from 'node:child_process';

const INSTALL_HINTS = {
  'yt-dlp': 'Install yt-dlp (https://github.com/yt-dlp/yt-dlp#installation), e.g. `pip install -U yt-dlp` or `brew install yt-dlp`, or pass { ytDlpPath }.',
  ffmpeg: 'Install ffmpeg (https://ffmpeg.org/download.html), e.g. `brew install ffmpeg` / `apt install ffmpeg` / `winget install ffmpeg`, or pass { ffmpegPath }.',
};

/**
 * Run a command, collecting stdout as a Buffer.
 * @returns {Promise<{stdout: Buffer, stderr: string}>}
 */
export function run(cmd, args, { tool = cmd, onStderr } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    } catch (err) {
      reject(err);
      return;
    }
    const out = [];
    let err = '';
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => {
      const s = d.toString();
      err += s;
      if (err.length > 20000) err = err.slice(-10000);
      onStderr?.(s);
    });
    child.on('error', (e) => {
      if (e.code === 'ENOENT') {
        const hint = INSTALL_HINTS[tool] || '';
        reject(Object.assign(new Error(`"${cmd}" was not found on PATH. ${hint}`), { code: 'ENOENT' }));
      } else reject(e);
    });
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout: Buffer.concat(out), stderr: err });
      else reject(Object.assign(new Error(`${tool} exited with code ${code}: ${err.trim().split('\n').slice(-6).join('\n')}`), { code, stderr: err }));
    });
  });
}
