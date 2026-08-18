/**
 * src/pipeline/finalQa.js
 * Strict Fail-Closed Post-Render Audio QA Validation.
 * Validates output existence, audio stream presence, AAC codec,
 * 48000 Hz, stereo channels, Integrated Loudness in [-15, -13] LUFS,
 * and True Peak <= -1.0 dBTP.
 */

import fs from 'fs';
import { logStep, logSuccess } from './logger.js';
import { hasAudioStream, probeAudioStream, measureLoudnormStats } from './mediaProbe.js';

export function validatePostRenderAudioQA(outputPath) {
  logStep("Running Post-Render Audio QA Validation on final output...");

  if (!fs.existsSync(outputPath)) {
    throw new Error(`CRITICAL AUDIO QA FAILED: Output file not found at "${outputPath}"!`);
  }

  if (!hasAudioStream(outputPath)) {
    throw new Error(`CRITICAL AUDIO QA FAILED: Output video "${outputPath}" has no audio stream!`);
  }

  const aStream = probeAudioStream(outputPath);
  if (!aStream) {
    throw new Error(`CRITICAL AUDIO QA FAILED: No audio stream found by ffprobe in "${outputPath}"!`);
  }
  if (aStream.codec_name !== 'aac') {
    throw new Error(`CRITICAL AUDIO QA FAILED: Expected audio codec 'aac', got '${aStream.codec_name}'!`);
  }
  if (Number(aStream.channels) !== 2) {
    throw new Error(`CRITICAL AUDIO QA FAILED: Expected 2 channels (stereo), got ${aStream.channels}!`);
  }
  if (Number(aStream.sample_rate) !== 48000) {
    throw new Error(`CRITICAL AUDIO QA FAILED: Expected 48000 Hz sample rate, got ${aStream.sample_rate}!`);
  }

  const qaLoudStats = measureLoudnormStats(outputPath);
  if (!qaLoudStats) {
    throw new Error(`CRITICAL AUDIO QA FAILED: Unable to measure loudness on final output "${outputPath}"!`);
  }

  const finalLUFS = parseFloat(qaLoudStats.input_i);
  const finalTP = parseFloat(qaLoudStats.input_tp);
  logSuccess(`Final Audio QA Stats: Integrated Loudness = ${finalLUFS} LUFS, True Peak = ${finalTP} dBTP`);

  if (finalLUFS < -15.0 || finalLUFS > -13.0) {
    throw new Error(`CRITICAL AUDIO QA FAILED: Final Integrated Loudness (${finalLUFS} LUFS) is outside acceptable tolerance [-15.0, -13.0] LUFS!`);
  }
  if (finalTP > -1.0) {
    throw new Error(`CRITICAL AUDIO QA FAILED: Final True Peak (${finalTP} dBTP) exceeds limit (-1.0 dBTP)!`);
  }

  logSuccess(`Audio QA PASSED: Output video meets all broadcast and social loudness standards.`);

  return {
    passed: true,
    lufs: finalLUFS,
    truePeak: finalTP,
    codec: aStream.codec_name,
    channels: Number(aStream.channels),
    sampleRate: Number(aStream.sample_rate)
  };
}
