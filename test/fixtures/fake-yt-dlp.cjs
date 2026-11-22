#!/usr/bin/env node
// Test double for yt-dlp: honours -o, copies FAKE_AUDIO (+ FAKE_VTT when captions
// are requested) into the output folder and prints yt-dlp-style JSON metadata.
const fs = require('fs');
const path = require('path');
const args = process.argv.slice(2);
const dir = path.dirname(args[args.indexOf('-o') + 1]);
fs.copyFileSync(process.env.FAKE_AUDIO, path.join(dir, 'audio' + path.extname(process.env.FAKE_AUDIO)));
if (args.includes('--write-auto-subs') && process.env.FAKE_VTT) fs.copyFileSync(process.env.FAKE_VTT, path.join(dir, 'audio.en.vtt'));
console.log(JSON.stringify({ id: 'abcdefghijk', title: 'Fake Song', uploader: 'Fake Artist', webpage_url: args[args.length - 1] }));
