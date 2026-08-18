/**
 * src/pipeline/srt.js
 * Pure SRT transcript parsing and time-conversion utilities.
 */

export function timeToSeconds(hrs, mins, secs, ms) {
  return parseInt(hrs, 10) * 3600 + parseInt(mins, 10) * 60 + parseInt(secs, 10) + parseInt(ms, 10) / 1000;
}

export function parseSRT(srtContent) {
  if (!srtContent || typeof srtContent !== 'string') return [];
  const normalized = srtContent.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];

  const blocks = normalized.split(/\n\s*\n/);
  const cues = [];

  for (const block of blocks) {
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length < 3) continue;

    const index = parseInt(lines[0], 10);
    const timeMatch = lines[1].match(/(\d{2}):(\d{2}):(\d{2})[.,](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[.,](\d{3})/);
    if (!timeMatch) continue;

    const startSec = timeToSeconds(timeMatch[1], timeMatch[2], timeMatch[3], timeMatch[4]);
    const endSec = timeToSeconds(timeMatch[5], timeMatch[6], timeMatch[7], timeMatch[8]);
    const text = lines.slice(2).join(' ');

    cues.push({
      index,
      startTime: startSec,
      endTime: endSec,
      text
    });
  }
  return cues;
}
