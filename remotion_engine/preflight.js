/**
 * preflight.js — Remotion Pre-render Audio & Voiceover Validation
 *
 * Enforces repository Reel rules:
 * - Premium Remotion compositions REQUIRE voiceover.
 * - Missing or empty voiceover -> preflight FAIL -> render blocked.
 * - Voiceover file must exist in public/ before render.
 * - Explicit 'voiceoverExempt: true' allows rendering without voiceover.
 */

const fs = require('fs');
const path = require('path');

function validateRemotionProps(propsPath) {
  const resolvedPropsPath = path.resolve(__dirname, propsPath);
  if (!fs.existsSync(resolvedPropsPath)) {
    throw new Error(`REMOTION PREFLIGHT FAILED: Props file not found at "${resolvedPropsPath}"`);
  }

  const propsContent = fs.readFileSync(resolvedPropsPath, 'utf8');
  let props;
  try {
    props = JSON.parse(propsContent);
  } catch (err) {
    throw new Error(`REMOTION PREFLIGHT FAILED: Invalid JSON in props file: ${err.message}`);
  }

  if (props.voiceoverExempt === true) {
    console.log(`[preflight] Composition explicitly marked voiceoverExempt: true. Proceeding.`);
    return true;
  }

  const voProp = props.voiceoverAudio || props.voiceoverFile || props.voiceover;
  if (!voProp || typeof voProp !== 'string' || voProp.trim() === '') {
    throw new Error(
      `REMOTION PREFLIGHT FAILED: Voiceover is REQUIRED for Premium Remotion compositions according to Reel rules, but voiceover prop is missing or empty.`
    );
  }

  // If voiceover is text script rather than audio file name
  const isAudioFile = /\.(mp3|wav|m4a|aac)$/i.test(voProp);
  if (isAudioFile) {
    const publicDir = path.resolve(__dirname, 'public');
    const audioFilePath = path.resolve(publicDir, voProp);
    if (!fs.existsSync(audioFilePath)) {
      throw new Error(
        `REMOTION PREFLIGHT FAILED: Declared voiceover audio file "${voProp}" does not exist in remotion_engine/public/`
      );
    }
  } else {
    // If props.voiceover is transcript text, check if voiceoverAudio/voiceoverFile was provided
    if (!props.voiceoverAudio && !props.voiceoverFile) {
      throw new Error(
        `REMOTION PREFLIGHT FAILED: Voiceover transcript text provided, but no audio file specified (voiceoverAudio / voiceoverFile required).`
      );
    }
  }

  console.log(`[preflight] ✓ Voiceover preflight validation PASSED: "${voProp}"`);
  return true;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const propsArg = args[0] || 'props_c.json';
  try {
    validateRemotionProps(propsArg);
    process.exit(0);
  } catch (err) {
    console.error(`\n[PREFLIGHT ERROR] ${err.message}\n`);
    process.exit(1);
  }
}

module.exports = { validateRemotionProps };
