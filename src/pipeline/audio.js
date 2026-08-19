/**
 * src/pipeline/audio.js
 * Audio planning, SFX discovery/pool selection, voice processing chain,
 * and mixed audio loudnorm measurement.
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { logStep, logSuccess, logWarning } from './logger.js';

// Audio mastering constants
export const AUDIO_COMP_THRESHOLD   = -18;   // dB — voice compressor threshold
export const AUDIO_COMP_RATIO       = 3;     // 3:1 ratio
export const AUDIO_COMP_ATTACK_MS   = 5;     // ms
export const AUDIO_COMP_RELEASE_MS  = 80;    // ms
export const AUDIO_LUFS_TARGET      = -14;   // integrated loudness (LUFS)
export const AUDIO_TRUE_PEAK_DB     = -1;    // dBTP ceiling
export const AUDIO_LRA              = 7;     // loudness range

export const AUDIO_HIGHPASS_HZ      = 80;    // cắt rumble phòng thu
export const AUDIO_DENOISE_FLOOR    = -25;   // dB — ngưỡng noise floor (afftdn)
export const AUDIO_GATE_THRESHOLD   = 0.001; // noise gate open threshold (~-30dBFS)
export const AUDIO_GATE_ATTACK_MS   = 20;    // ms — gate open speed
export const AUDIO_GATE_RELEASE_MS  = 250;   // ms — gate close speed
export const AUDIO_EQ_MUD_HZ        = 250;   // EQ band: giảm muddy
export const AUDIO_EQ_MUD_GAIN      = -2;    // dB
export const AUDIO_EQ_DESS_HZ       = 7500;  // de-esser center (âm s/ch chói)
export const AUDIO_EQ_DESS_GAIN     = -3;    // dB
export const AUDIO_EQ_PRESENCE_HZ   = 3000;  // EQ band: boost clarity/presence
export const AUDIO_EQ_PRESENCE_GAIN = 3;     // dB
export const AUDIO_EQ_AIR_HZ        = 8000;  // EQ band: subtle air/brightness
export const AUDIO_EQ_AIR_GAIN      = 1;     // dB

export const SFX_VOLUME_DB          = -10;   // card SFX under voice (−8 to −12 dB)
export const HOOK_SFX_VOLUME_DB     = -8;    // hook whoosh — slightly louder for impact
export const BROLL_SFX_VOLUME_DB    = -13;   // b-roll cut-in whoosh
export const SFX_POOL_SIZE          = 4;     // lấy tối đa 4 file khác nhau cho mỗi loại

export const CARD_SFX_CATEGORY_PREFERENCES = {
  STAT:    ["impact", "pop", "cinematic", "rise", "whoosh"],
  ACTION:  ["whoosh", "transition", "rise", "cinematic", "zoom"],
  WARNING: ["notification", "alert", "ui", "impact", "cinematic"],
};

export const SFX_CATEGORY_KEYWORDS = [
  { category: "notification", keywords: ["notification", "notify", "alert", "alarm", "warning", "beep"] },
  { category: "whoosh", keywords: ["whoosh", "swoosh", "swish"] },
  { category: "transition", keywords: ["transition"] },
  { category: "rise", keywords: ["riser", "rise", "build", "swell"] },
  { category: "cinematic", keywords: ["cinematic", "dramatic", "trailer", "scary"] },
  { category: "impact", keywords: ["impact", "hit", "boom", "punch", "slam", "scary", "stop"] },
  { category: "pop", keywords: ["pop"] },
  { category: "ui", keywords: ["ui", "click"] },
  { category: "zoom", keywords: ["zoom"] },
  { category: "music", keywords: ["music", "instrumental", "intro", "motivational", "upbeat", "podcast"] }
];

export function toSeconds(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export function sfxTempOutputPath(finalOutputPath) {
  const ext = path.extname(finalOutputPath) || ".mp4";
  const base = path.basename(finalOutputPath, ext);
  return path.join(path.dirname(finalOutputPath), `${base}_sfx_tmp${ext}`);
}

export function normalizeSfxFileName(fileName) {
  return String(fileName ?? "").toLowerCase().replace(/[_\s]+/g, "-");
}

export function classifySfxFile(fileName) {
  const normalizedName = normalizeSfxFileName(fileName);
  const categories = new Set();

  for (const rule of SFX_CATEGORY_KEYWORDS) {
    if (rule.keywords.some(keyword => normalizedName.includes(keyword))) {
      categories.add(rule.category);
    }
  }

  return [...categories];
}

export function discoverSfxFiles(sfxDir = path.resolve("assets", "sfx")) {
  if (!fs.existsSync(sfxDir)) return [];

  return fs.readdirSync(sfxDir)
    .filter(fileName => /\.mp3$/i.test(fileName))
    .map(fileName => {
      const filePath = path.join(sfxDir, fileName);
      return {
        fileName,
        filePath,
        categories: classifySfxFile(fileName)
      };
    })
    .filter(item => item.categories.length > 0 && fs.existsSync(item.filePath));
}

export function scoreSfxForCardType(item, cardType) {
  const normalizedType = String(cardType ?? "").trim().toUpperCase();
  const preferences = CARD_SFX_CATEGORY_PREFERENCES[normalizedType] || [];
  if (!preferences.length) return 0;

  const normalizedName = normalizeSfxFileName(item.fileName);
  let score = 0;

  for (const category of item.categories) {
    const preferenceIndex = preferences.indexOf(category);
    if (preferenceIndex !== -1) {
      score = Math.max(score, (preferences.length - preferenceIndex) * 100);
    }
  }

  if (item.categories.includes("music")) score -= 500;

  if (normalizedType === "STAT") {
    if (item.categories.includes("impact")) score += 45;
    if (normalizedName.includes("scary")) score += 25;
    if (item.categories.includes("pop")) score += 20;
  } else if (normalizedType === "ACTION") {
    if (item.categories.includes("whoosh")) score += 45;
    if (item.categories.includes("transition")) score += 20;
    if (item.categories.includes("rise")) score += 10;
  } else if (normalizedType === "WARNING") {
    if (item.categories.includes("notification")) score += 70;
    if (item.categories.includes("alert")) score += 35;
    if (item.categories.includes("ui")) score += 15;
  }

  return score;
}

export function buildSfxPoolByCardType(sfxFiles = discoverSfxFiles()) {
  const sfxPool = {};

  for (const cardType of Object.keys(CARD_SFX_CATEGORY_PREFERENCES)) {
    const ranked = sfxFiles
      .map(item => ({ item, score: scoreSfxForCardType(item, cardType) }))
      .filter(m => m.score > 0)
      .sort((a, b) => b.score - a.score || a.item.fileName.localeCompare(b.item.fileName))
      .slice(0, SFX_POOL_SIZE)
      .map(m => m.item.filePath);

    if (ranked.length) sfxPool[cardType] = ranked;
  }

  return sfxPool;
}

export function buildSfxMapByCardType() {
  const pool = buildSfxPoolByCardType();
  return Object.fromEntries(Object.entries(pool).map(([k, v]) => [k, v[0]]));
}

export function buildVoiceProcessingChain() {
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

export function buildAudioPlan(sfxOverlayEvents, brollSegments, sfxFiles = discoverSfxFiles()) {
  const plan = [];

  // 1. Hook SFX at t=0 (reuses existing scoring/selection)
  const preferred = ['whoosh', 'cinematic', 'impact'];
  const hookFile = sfxFiles
    .map(f => {
      const score = preferred.findIndex(cat => f.categories.includes(cat));
      return { f, score: score === -1 ? 999 : score };
    })
    .sort((a, b) => a.score - b.score)[0]?.f;

  if (hookFile && fs.existsSync(hookFile.filePath)) {
    plan.push({
      type: 'HOOK',
      fileName: hookFile.fileName,
      filePath: hookFile.filePath,
      delayMs: 0,
      vol: HOOK_SFX_VOLUME_DB
    });
  }

  // 2. Card SFX (reuses existing pool rotation/selection)
  const seen = new Set();
  const sfxPool = buildSfxPoolByCardType(sfxFiles);
  const typeCounter = {};

  for (const event of sfxOverlayEvents || []) {
    const type = String(event.type ?? "").trim().toUpperCase();
    const pool = sfxPool[type];
    if (!pool?.length) continue;

    const idx = typeCounter[type] ?? 0;
    const filePath = pool[idx % pool.length];
    typeCounter[type] = idx + 1;

    if (!fs.existsSync(filePath)) continue;

    const startTime = toSeconds(event.startTime ?? event.start_ms, 0);
    const key = `${type}|${Math.round(startTime * 100)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    plan.push({
      type: `CARD_${type}`,
      fileName: path.basename(filePath),
      filePath,
      delayMs: Math.max(0, Math.round(startTime * 1000)),
      vol: SFX_VOLUME_DB
    });
  }

  // 3. B-roll SFX (reuses existing pool selection)
  if (brollSegments?.length && sfxFiles.length) {
    const brollPool = sfxFiles
      .map(f => ({ f, score: ['whoosh', 'transition'].findIndex(c => f.categories.includes(c)) }))
      .filter(x => x.score >= 0)
      .sort((a, b) => a.score - b.score)
      .slice(0, 3)
      .map(x => x.f);

    if (brollPool.length) {
      let bi = 0;
      for (const seg of brollSegments) {
        const t = toSeconds(seg.startTime, 0);
        const f = brollPool[bi % brollPool.length]; bi++;
        plan.push({
          type: 'BROLL',
          fileName: f.fileName,
          filePath: f.filePath,
          delayMs: Math.round(t * 1000),
          vol: BROLL_SFX_VOLUME_DB
        });
      }
    }
  }

  return plan;
}

export function measureMixedAudioLoudnorm(videoPath, audioPlan) {
  const voiceChain = buildVoiceProcessingChain();
  const sfxInputs = audioPlan.map(e => `-i "${e.filePath}"`).join(' ');
  const sfxFilters = audioPlan.map((e, idx) => {
    const inputIdx = idx + 1;
    return `[${inputIdx}:a]volume=${e.vol}dB,adelay=${e.delayMs}|${e.delayMs}[sfx${idx}]`;
  });

  let mixFilter;
  if (audioPlan.length > 0) {
    const mixInputs = ['[vproc]', ...audioPlan.map((_, idx) => `[sfx${idx}]`)].join('');
    mixFilter = `${sfxFilters.join(';')};${mixInputs}amix=inputs=${audioPlan.length + 1}:duration=first:dropout_transition=0:normalize=0[mixed_audio]`;
  } else {
    mixFilter = `[vproc]anull[mixed_audio]`;
  }

  const filterComplex = `[0:a]${voiceChain}[vproc];${mixFilter};[mixed_audio]loudnorm=I=${AUDIO_LUFS_TARGET}:TP=-1.5:LRA=${AUDIO_LRA}:print_format=json`;
  const cmd = `ffmpeg -i "${videoPath}" ${sfxInputs} -vn -filter_complex "${filterComplex}" -f null - 2>&1`;

  try {
    const raw = execSync(cmd, { encoding: 'utf8' });
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

export function mixOverlaySfxIntoOutput(finalOutputPath, overlayEvents) {
  const validEvents = [];
  const seen = new Set();
  const sfxPool = buildSfxPoolByCardType();
  const typeCounter = {};

  for (const event of overlayEvents || []) {
    const type = String(event.type ?? "").trim().toUpperCase();
    const pool = sfxPool[type];
    if (!pool?.length) continue;

    const idx = typeCounter[type] ?? 0;
    const filePath = pool[idx % pool.length];
    typeCounter[type] = idx + 1;

    if (!fs.existsSync(filePath)) continue;

    const startTime = toSeconds(event.startTime ?? event.start_ms, 0);
    const key = `${type}|${Math.round(startTime * 100)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    validEvents.push({ type, filePath, delayMs: Math.max(0, Math.round(startTime * 1000)) });
  }

  if (!validEvents.length) return false;

  const tempOutputPath = sfxTempOutputPath(finalOutputPath);
  const sfxInputs = validEvents.map(event => `-i "${event.filePath}"`).join(" ");
  const delayedLabels = validEvents.map((event, index) => {
    const inputIndex = index + 1;
    return `[${inputIndex}:a]volume=${SFX_VOLUME_DB}dB,adelay=${event.delayMs}|${event.delayMs}[sfx${index}]`;
  });
  const mixInputs = ["[0:a]", ...validEvents.map((_, index) => `[sfx${index}]`)].join("");
  const filterComplex = `${delayedLabels.join(";")};${mixInputs}amix=inputs=${validEvents.length + 1}:duration=first:dropout_transition=0:normalize=0[aout]`;
  const mixCmd = `ffmpeg -y -i "${finalOutputPath}" ${sfxInputs} -filter_complex "${filterComplex}" -map 0:v -map "[aout]" -c:v copy -c:a aac -shortest "${tempOutputPath}"`;

  logStep(`Mixing ${validEvents.length} overlay SFX event(s) into final output...`);
  console.log(`Running: ${mixCmd}\n`);
  try {
    execSync(mixCmd, { stdio: 'inherit' });
    fs.copyFileSync(tempOutputPath, finalOutputPath);
    fs.rmSync(tempOutputPath, { force: true });
    logSuccess("Overlay SFX mix complete.");
    return true;
  } catch (e) {
    logWarning(`Overlay SFX mix failed: ${e.message}`);
    if (fs.existsSync(tempOutputPath)) fs.rmSync(tempOutputPath, { force: true });
    return false;
  }
}

// Hook SFX — whoosh/impact tại t=0 khi opening hook xuất hiện (Section 6A)
export function addHookSfx(outputPath) {
  const sfxFiles = discoverSfxFiles();
  const preferred = ['whoosh', 'cinematic', 'impact'];

  const hookFile = sfxFiles
    .map(f => {
      const score = preferred.findIndex(cat => f.categories.includes(cat));
      return { f, score: score === -1 ? 999 : score };
    })
    .sort((a, b) => a.score - b.score)[0]?.f;

  if (!hookFile || !fs.existsSync(hookFile.filePath)) {
    logWarning('Hook SFX: no suitable file found in assets/sfx/');
    return;
  }

  const tempPath = sfxTempOutputPath(outputPath);
  const cmd = [
    `ffmpeg -y`,
    `-i "${outputPath}"`,
    `-i "${hookFile.filePath}"`,
    `-filter_complex "[1:a]volume=${HOOK_SFX_VOLUME_DB}dB,adelay=0|0[sfx];[0:a][sfx]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[aout]"`,
    `-map 0:v -map "[aout]" -c:v copy -c:a aac -shortest "${tempPath}"`
  ].join(' ');

  try {
    execSync(cmd, { stdio: 'inherit' });
    fs.copyFileSync(tempPath, outputPath);
    fs.rmSync(tempPath, { force: true });
    logSuccess(`Hook SFX: "${hookFile.fileName}" at t=0`);
  } catch (e) {
    logWarning(`Hook SFX failed: ${e.message}`);
  }
}

// B-roll cut-in SFX — whoosh nhẹ khi B-roll xuất hiện (content-driven, không random)
export function addBrollSfx(outputPath, brollSegs) {
  if (!brollSegs?.length) return;

  const sfxFiles = discoverSfxFiles();
  if (!sfxFiles.length) return;

  // Pool top-3 whoosh/transition cho B-roll
  const brollPool = sfxFiles
    .map(f => ({ f, score: ['whoosh', 'transition'].findIndex(c => f.categories.includes(c)) }))
    .filter(x => x.score >= 0)
    .sort((a, b) => a.score - b.score)
    .slice(0, 3)
    .map(x => x.f);

  if (!brollPool.length) return;

  const events = [];
  let bi = 0;
  for (const seg of brollSegs) {
    const t = toSeconds(seg.startTime, 0);
    const f = brollPool[bi % brollPool.length]; bi++;
    events.push({ filePath: f.filePath, delayMs: Math.round(t * 1000), vol: BROLL_SFX_VOLUME_DB });
    logSuccess(`B-roll SFX: ${f.fileName} at t=${t.toFixed(1)}s`);
  }

  if (!events.length) return;

  const tempPath = sfxTempOutputPath(outputPath);
  const inputs   = events.map(e => `-i "${e.filePath}"`).join(' ');
  const delays   = events.map((e, i) =>
    `[${i+1}:a]volume=${e.vol}dB,adelay=${e.delayMs}|${e.delayMs}[s${i}]`
  );
  const mixIn    = ['[0:a]', ...events.map((_, i) => `[s${i}]`)].join('');
  const filter   = `${delays.join(';')};${mixIn}amix=inputs=${events.length+1}:duration=first:dropout_transition=0:normalize=0[aout]`;
  const cmd      = `ffmpeg -y -i "${outputPath}" ${inputs} -filter_complex "${filter}" -map 0:v -map "[aout]" -c:v copy -c:a aac -shortest "${tempPath}"`;

  try {
    execSync(cmd, { stdio: 'inherit' });
    fs.copyFileSync(tempPath, outputPath);
    fs.rmSync(tempPath, { force: true });
    logSuccess(`B-roll SFX: ${events.length} event(s) mixed`);
  } catch (e) {
    logWarning(`B-roll SFX failed: ${e.message}`);
  }
}
