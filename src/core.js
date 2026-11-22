/**
 * Browser-safe entry point (no Node APIs).
 *
 *   import { analyzeAudioBuffer, renderSheet, parseVtt } from 'yt-chord-sheet/core';
 */
export { analyzeAudio, analyzeAudioBuffer, DEFAULT_ANALYSIS_OPTIONS } from './analysis/analyze.js';
export { renderSheet, buildBlocks, formatTime, FORMATS } from './format/render.js';
export { parseVtt, parseLrc, parseLyrics } from './lyrics/parse.js';
export { suggestCapo } from './analysis/capo.js';
export { createLiveTracker } from './analysis/live.js';
export { resample, toMono } from './dsp/resample.js';
export * as theory from './music/theory.js';
