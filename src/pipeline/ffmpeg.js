/**
 * src/pipeline/ffmpeg.js
 * FFmpeg argument construction, audio filtergraph assembly,
 * and command execution for the final compositing render.
 */

import { execSync } from 'child_process';
import {
  AUDIO_LUFS_TARGET,
  AUDIO_LRA,
  buildVoiceProcessingChain
} from './audio.js';

export function buildAudioFilterGraph({ audioPlan = [], loudStats = null, sfxStartInputIdx = 2 }) {
  const loudnormFilter = loudStats
    ? `loudnorm=I=${AUDIO_LUFS_TARGET}:TP=-1.5:LRA=${AUDIO_LRA}:measured_i=${loudStats.input_i}:measured_lra=${loudStats.input_lra}:measured_tp=${loudStats.input_tp}:measured_thresh=${loudStats.input_thresh}:offset=${loudStats.target_offset}:linear=true`
    : `loudnorm=I=${AUDIO_LUFS_TARGET}:TP=-1.5:LRA=${AUDIO_LRA}`;

  const sfxFilters = audioPlan.map((e, idx) => {
    const inputIdx = sfxStartInputIdx + idx;
    return `[${inputIdx}:a]volume=${e.vol}dB,adelay=${e.delayMs}|${e.delayMs}[sfx${idx}]`;
  });

  let audioMixStr;
  if (audioPlan.length > 0) {
    const mixInputs = ['[vproc]', ...audioPlan.map((_, idx) => `[sfx${idx}]`)].join('');
    audioMixStr = `${sfxFilters.join(';')};${mixInputs}amix=inputs=${audioPlan.length + 1}:duration=first:dropout_transition=0:normalize=0[mixed_audio]`;
  } else {
    audioMixStr = `[vproc]anull[mixed_audio]`;
  }

  const voiceChain = buildVoiceProcessingChain();
  const fullAudioFilter = `[0:a]${voiceChain}[vproc];${audioMixStr};[mixed_audio]${loudnormFilter}[outa]`;
  const sfxInputsStr = audioPlan.length ? ' ' + audioPlan.map(e => `-i "${e.filePath}"`).join(' ') : '';

  return {
    voiceChain,
    sfxFilters,
    audioMixStr,
    loudnormFilter,
    fullAudioFilter,
    sfxInputsStr
  };
}

export function buildFinalFfmpegCommand({
  videoPath,
  brollFilterInputs = '',
  fps = 30,
  framePattern,
  sfxInputsStr = '',
  combinedFilterComplex,
  outputPath
}) {
  return `ffmpeg -y -i "${videoPath}"${brollFilterInputs} -framerate ${fps} -i "${framePattern}"${sfxInputsStr} -filter_complex "${combinedFilterComplex}" -map "[outv]" -map "[outa]" -c:v libx264 -pix_fmt yuv420p -c:a aac -b:a 192k -ar 48000 -ac 2 "${outputPath}"`;
}

export function executeFfmpegRender(ffmpegCmd) {
  execSync(ffmpegCmd, { stdio: 'inherit' });
}
