/**
 * src/pipeline/cache.js
 * Per-video isolated cache manager with strict fail-closed ownership validation.
 */

import fs from 'fs';
import path from 'path';

export function getCacheCandidatePaths(videoPath, srtPath) {
  if (!videoPath) return [];
  const videoDir = path.dirname(path.resolve(videoPath));
  const videoBaseName = path.basename(videoPath, path.extname(videoPath));

  const candidatePaths = [
    path.join(videoDir, `${videoBaseName}_gemini_cache.json`),
    path.join(videoDir, '_gemini_cache.json')
  ];

  if (srtPath && fs.existsSync(srtPath)) {
    const srtDir = path.dirname(path.resolve(srtPath));
    candidatePaths.push(path.join(srtDir, `${videoBaseName}_gemini_cache.json`));
    candidatePaths.push(path.join(srtDir, '_gemini_cache.json'));
  }

  return [...new Set(candidatePaths)].filter(p => fs.existsSync(p));
}

export function loadOwnedCache(videoPath, srtPath) {
  const existingCandidates = getCacheCandidatePaths(videoPath, srtPath);
  let cacheFilePath = null;
  let cachedData = null;

  for (const cand of existingCandidates) {
    try {
      const content = JSON.parse(fs.readFileSync(cand, 'utf-8'));
      if (!content || !content.videoFile || typeof content.videoFile !== 'string' || content.videoFile.trim() === '') {
        throw new Error(`CRITICAL FAIL-CLOSED: Cache file "${cand}" has no videoFile ownership metadata. Refusing unowned/legacy generic cache under --skip-gemini.`);
      }
      if (content.videoFile !== path.basename(videoPath)) {
        throw new Error(`CRITICAL FAIL-CLOSED: Cache file "${cand}" belongs to "${content.videoFile}", not "${path.basename(videoPath)}". Refusing cross-video contamination.`);
      }
      cacheFilePath = cand;
      cachedData = content;
      break;
    } catch (e) {
      if (e.message.includes('CRITICAL FAIL-CLOSED')) throw e;
    }
  }

  if (!cacheFilePath || !cachedData) {
    throw new Error(`CRITICAL FAIL-CLOSED: --skip-gemini was specified, but no local cache exists for "${videoPath}". Refusing to load unrelated global assets. Run without --skip-gemini first to generate cache.`);
  }

  return {
    cacheFilePath,
    data: cachedData
  };
}

export function saveOwnedCache({ videoPath, srtPath, sentences, overlays, totalDuration, hook, broll_schedule }) {
  const srtDir = srtPath ? path.dirname(srtPath) : (videoPath ? path.dirname(videoPath) : '.');
  const videoBaseName = path.basename(videoPath, path.extname(videoPath));

  const cachePayload = {
    videoFile: path.basename(videoPath),
    sentences,
    overlays,
    totalDuration,
    hook,
    broll_schedule
  };

  const serialized = JSON.stringify(cachePayload, null, 2);

  if (srtDir !== '.') {
    fs.writeFileSync(path.join(srtDir, '_gemini_cache.json'), serialized, 'utf-8');
    fs.writeFileSync(path.join(srtDir, `${videoBaseName}_gemini_cache.json`), serialized, 'utf-8');
  }
  fs.writeFileSync(path.resolve('_gemini_cache.json'), serialized, 'utf-8');

  return cachePayload;
}
