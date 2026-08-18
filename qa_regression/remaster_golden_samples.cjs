const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const AUDIO_LUFS_TARGET     = -14;
const AUDIO_LRA             = 7;
const AUDIO_HIGHPASS_HZ     = 80;
const AUDIO_DENOISE_FLOOR   = -25;
const AUDIO_GATE_THRESHOLD  = 0.001;
const AUDIO_GATE_ATTACK_MS  = 20;
const AUDIO_GATE_RELEASE_MS = 250;
const AUDIO_EQ_MUD_HZ       = 250;
const AUDIO_EQ_MUD_GAIN     = -2;
const AUDIO_EQ_DESS_HZ      = 7500;
const AUDIO_EQ_DESS_GAIN    = -3;
const AUDIO_EQ_PRESENCE_HZ  = 3000;
const AUDIO_EQ_PRESENCE_GAIN= 3;
const AUDIO_EQ_AIR_HZ       = 8000;
const AUDIO_EQ_AIR_GAIN     = 1;
const AUDIO_COMP_THRESHOLD  = -18;
const AUDIO_COMP_RATIO      = 3;
const AUDIO_COMP_ATTACK_MS  = 5;
const AUDIO_COMP_RELEASE_MS = 80;
const HOOK_SFX_VOLUME_DB    = -8;

function buildVoiceProcessingChain() {
  return [
    `highpass=f=${AUDIO_HIGHPASS_HZ}`,
    `agate=threshold=${AUDIO_GATE_THRESHOLD}:attack=${AUDIO_GATE_ATTACK_MS}:release=${AUDIO_GATE_RELEASE_MS}:knee=2.828`,
    `afftdn=nf=${AUDIO_DENOISE_FLOOR}`,
    `equalizer=f=${AUDIO_EQ_MUD_HZ}:width_type=o:width=2:g=${AUDIO_EQ_MUD_GAIN}`,
    `equalizer=f=${AUDIO_EQ_DESS_HZ}:width_type=o:width=1.5:g=${AUDIO_EQ_DESS_GAIN}`,
    `equalizer=f=${AUDIO_EQ_PRESENCE_HZ}:width_type=o:width=2:g=${AUDIO_EQ_PRESENCE_GAIN}`,
    `equalizer=f=${AUDIO_EQ_AIR_HZ}:width_type=o:width=2:g=${AUDIO_EQ_AIR_GAIN}`,
    `acompressor=threshold=${AUDIO_COMP_THRESHOLD}dB:ratio=${AUDIO_COMP_RATIO}:attack=${AUDIO_COMP_ATTACK_MS}:release=${AUDIO_COMP_RELEASE_MS}:makeup=4`
  ].join(',');
}

function getHookSfx() {
  const p = path.resolve("assets", "sfx", "whoosh.mp3");
  if (fs.existsSync(p)) return { fileName: "whoosh.mp3", filePath: p, delayMs: 0, vol: HOOK_SFX_VOLUME_DB };
  return null;
}

function remasterVideoAudio(goldenVideoPath, rawInputPath, outputPath, sfxEvents = []) {
  console.log(`\n==================================================================`);
  console.log(`Mastering audio for: ${path.basename(goldenVideoPath)}`);
  console.log(`Video Stream:       ${goldenVideoPath} (100% exact stream copy)`);
  console.log(`Audio Source:       ${rawInputPath}`);
  console.log(`Output:             ${outputPath}`);
  console.log(`==================================================================`);

  if (!fs.existsSync(goldenVideoPath)) throw new Error(`Golden video not found: ${goldenVideoPath}`);
  if (!fs.existsSync(rawInputPath)) throw new Error(`Raw audio source not found: ${rawInputPath}`);

  const audioPlan = [];
  const hook = getHookSfx();
  if (hook) audioPlan.push(hook);
  if (sfxEvents.length) audioPlan.push(...sfxEvents);

  const voiceChain = buildVoiceProcessingChain();
  const sfxInputs = audioPlan.map(e => `-i "${e.filePath}"`).join(' ');
  const sfxFilters = audioPlan.map((e, idx) => {
    const inputIdx = idx + 2;
    return `[${inputIdx}:a]volume=${e.vol}dB,adelay=${e.delayMs}|${e.delayMs}[sfx${idx}]`;
  });

  let mixFilter;
  if (audioPlan.length > 0) {
    const mixInputs = ['[vproc]', ...audioPlan.map((_, idx) => `[sfx${idx}]`)].join('');
    mixFilter = `${sfxFilters.join(';')};${mixInputs}amix=inputs=${audioPlan.length + 1}:duration=first:dropout_transition=0:normalize=0[mixed_audio]`;
  } else {
    mixFilter = `[vproc]anull[mixed_audio]`;
  }

  // Pass 1
  console.log(`[Pass 1] Measuring loudness on [mixed_audio] with ${audioPlan.length} SFX...`);
  const pass1FilterComplex = `[1:a]${voiceChain}[vproc];${mixFilter};[mixed_audio]loudnorm=I=${AUDIO_LUFS_TARGET}:TP=-1.5:LRA=${AUDIO_LRA}:print_format=json`;
  const pass1Cmd = `ffmpeg -i "${goldenVideoPath}" -i "${rawInputPath}" ${sfxInputs} -vn -filter_complex "${pass1FilterComplex}" -f null - 2>&1`;

  const pass1Raw = execSync(pass1Cmd, { encoding: 'utf8' });
  const match = pass1Raw.match(/\{[\s\S]*?"input_i"[\s\S]*?\}/);
  if (!match) throw new Error("Pass 1 measurement failed!");
  const stats = JSON.parse(match[0]);
  console.log(`[Pass 1 Result] I=${stats.input_i} LUFS, TP=${stats.input_tp} dBTP, LRA=${stats.input_lra}`);

  // Pass 2
  const loudnormPass2 = `loudnorm=I=${AUDIO_LUFS_TARGET}:TP=-1.5:LRA=${AUDIO_LRA}:measured_i=${stats.input_i}:measured_lra=${stats.input_lra}:measured_tp=${stats.input_tp}:measured_thresh=${stats.input_thresh}:offset=${stats.target_offset}:linear=true`;
  const fullAudioFilter = `[1:a]${voiceChain}[vproc];${mixFilter};[mixed_audio]${loudnormPass2}[outa]`;

  const pass2Cmd = `ffmpeg -y -i "${goldenVideoPath}" -i "${rawInputPath}" ${sfxInputs} -filter_complex "${fullAudioFilter}" -map 0:v:0 -map "[outa]" -c:v copy -c:a aac -b:a 192k -ar 48000 -ac 2 "${outputPath}"`;
  console.log(`[Pass 2] Executing single-pass mastering and muxing...`);
  execSync(pass2Cmd, { stdio: 'inherit' });

  // Post-Render QA
  console.log(`[QA] Running Post-Render Audio QA validation on "${outputPath}"...`);
  const qaRaw = execSync(`ffmpeg -i "${outputPath}" -vn -af loudnorm=I=-14:TP=-1.5:LRA=7:print_format=json -f null - 2>&1`, { encoding: 'utf8' });
  const qaMatch = qaRaw.match(/\{[\s\S]*?"input_i"[\s\S]*?\}/);
  if (!qaMatch) throw new Error("Audio QA measurement failed!");
  const qaStats = JSON.parse(qaMatch[0]);
  const finalLUFS = parseFloat(qaStats.input_i);
  const finalTP = parseFloat(qaStats.input_tp);

  console.log(`[QA Stats] Final Integrated Loudness = ${finalLUFS} LUFS, True Peak = ${finalTP} dBTP`);
  if (finalLUFS < -15.0 || finalLUFS > -13.0) {
    throw new Error(`CRITICAL QA FAILED: Loudness out of range (${finalLUFS} LUFS)!`);
  }
  if (finalTP > -1.0) {
    throw new Error(`CRITICAL QA FAILED: True Peak exceeds limit (${finalTP} dBTP > -1.0 dBTP)!`);
  }
  console.log(`✓ Audio QA PASSED! Output is broadcast/social compliant.`);
  return { finalLUFS, finalTP, stats: qaStats };
}

// 1. creatine
const creatineRes = remasterVideoAudio(
  'output/creatine.mp4',
  'raw_materials/creatine/input.mp4',
  'output/creatine_mastered.mp4'
);

// 2. di-bo-chuyen-sau
const diboRes = remasterVideoAudio(
  'output/di-bo-chuyen-sau.mp4',
  'raw_materials/di-bo-chuyen-sau/input.mp4',
  'output/di-bo-chuyen-sau_mastered.mp4'
);

console.log('\n==================================================================');
console.log('       MASTERING AND REGRESSION RESULTS FOR GOLDEN SAMPLES');
console.log('==================================================================');
console.log(`creatine:        ${creatineRes.finalLUFS} LUFS | True Peak: ${creatineRes.finalTP} dBTP`);
console.log(`di-bo-chuyen-sau:${diboRes.finalLUFS} LUFS | True Peak: ${diboRes.finalTP} dBTP`);
