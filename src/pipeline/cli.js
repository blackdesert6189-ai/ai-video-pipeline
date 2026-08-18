/**
 * src/pipeline/cli.js
 * CLI argument parser for CNFI Video Pipeline.
 * Pure function returning options object; no process.exit inside parser.
 */

import path from 'path';

export function parseArgs(rawArgs = process.argv.slice(2)) {
  let srtPath    = "";
  let videoPath  = "";
  let outputPath = "";
  let skipGemini = false;
  let reportOnly = false;
  let batchDir   = "";
  let outputDir  = "";

  const knownValuedFlags = new Set([
    '--srt',
    '--video',
    '--output',
    '--batch',
    '--batch-dir',
    '--output-dir',
    '--out-dir'
  ]);

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    if (arg === "--srt" && rawArgs[i + 1]) {
      srtPath = rawArgs[i + 1]; i++;
    } else if (arg === "--video" && rawArgs[i + 1]) {
      videoPath = rawArgs[i + 1]; i++;
    } else if (arg === "--output" && rawArgs[i + 1]) {
      outputPath = rawArgs[i + 1]; i++;
    } else if ((arg === "--batch" || arg === "--batch-dir") && rawArgs[i + 1]) {
      batchDir = path.resolve(rawArgs[i + 1]); i++;
    } else if ((arg === "--output-dir" || arg === "--out-dir") && rawArgs[i + 1]) {
      outputDir = path.resolve(rawArgs[i + 1]); i++;
    } else if (arg === "--skip-gemini") {
      skipGemini = true;
    } else if (arg === "--report") {
      reportOnly = true;
    }
  }

  // Fallback to positional arguments (single-video mode only)
  if (!batchDir) {
    if (!srtPath    && rawArgs[0]) srtPath    = rawArgs[0];
    if (!videoPath  && rawArgs[1]) videoPath  = rawArgs[1];
    if (!outputPath && rawArgs[2]) outputPath = rawArgs[2];
  }

  return {
    srtPath,
    videoPath,
    outputPath,
    skipGemini,
    reportOnly,
    batchDir,
    outputDir
  };
}
