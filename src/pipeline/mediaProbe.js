/**
 * src/pipeline/mediaProbe.js
 * Media stream detection, ffprobe helpers, and loudnorm stats probing.
 * Pure probing helpers without business/render decisions.
 */

import { execSync } from 'child_process';

export function hasAudioStream(filePath) {
  try {
    const out = execSync(`ffmpeg -i "${filePath}"`, { stdio: 'pipe' }).toString();
    return out.includes('Audio:');
  } catch (e) {
    const out = String(e.stdout || '') + String(e.stderr || '');
    return out.includes('Audio:');
  }
}

export function probeAudioStream(filePath) {
  try {
    const probeJson = execSync(
      `ffprobe -v error -select_streams a:0 -show_entries stream=codec_name,channels,sample_rate -of json "${filePath}"`,
      { encoding: 'utf8' }
    );
    const probeData = JSON.parse(probeJson);
    return (probeData.streams && probeData.streams[0]) || null;
  } catch (e) {
    return null;
  }
}

export function measureLoudnormStats(videoPath, { lufsTarget = -14, truePeakDb = -1, lra = 7 } = {}) {
  try {
    const raw = execSync(
      `ffmpeg -i "${videoPath}" -vn -af "loudnorm=I=${lufsTarget}:TP=${truePeakDb}:LRA=${lra}:print_format=json" -f null - 2>&1`,
      { encoding: 'utf8' }
    );
    const match = raw.match(/\{[\s\S]*?"input_i"[\s\S]*?\}/);
    if (!match) return null;
    return JSON.parse(match[0]);
  } catch (e) {
    const out = String(e.stdout || '') + String(e.stderr || '');
    const match = out.match(/\{[\s\S]*?"input_i"[\s\S]*?\}/);
    if (!match) return null;
    try { return JSON.parse(match[0]); } catch { return null; }
  }
}
