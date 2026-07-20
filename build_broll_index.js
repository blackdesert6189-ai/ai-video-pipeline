/**
 * build_broll_index.js — chạy một lần: node build_broll_index.js
 * FFmpeg extract thumbnail → Gemini Vision batch tag → broll_index.json
 */

import { readdir, writeFile, mkdir, rm } from 'fs/promises';
import { existsSync, readFileSync } from 'fs';
import { execSync }                   from 'child_process';

const BROLL_DIR = 'assets/Broll';
const THUMB_DIR = '.broll_thumbs';
const OUT       = 'broll_index.json';
const API_KEY   = process.env.GEMINI_API_KEY || '';
const BATCH     = 8;
const URL       = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${API_KEY}`;

// ── FFmpeg thumbnail ──────────────────────────────────────────────
async function extractThumb(videoPath, outPath) {
  const cmds = [
    `ffmpeg -y -ss 1 -i "${videoPath}" -vframes 1 -vf "scale=320:-1" "${outPath}"`,
    `ffmpeg -y -i "${videoPath}" -vframes 1 -vf "scale=320:-1" "${outPath}"`,
  ];
  for (const cmd of cmds) {
    try {
      execSync(cmd, { stdio: ['pipe','pipe','pipe'] });
      if (existsSync(outPath)) return true;
    } catch { /* try next */ }
  }
  return false;
}

// ── Gemini Vision batch ───────────────────────────────────────────
async function tagBatch(batch) {
  const parts = [];

  for (let i = 0; i < batch.length; i++) {
    const { filename, thumbPath } = batch[i];
    if (!existsSync(thumbPath)) continue;
    const b64 = readFileSync(thumbPath).toString('base64');
    parts.push({ text: `[${i + 1}] ${filename}` });
    parts.push({ inlineData: { mimeType: 'image/jpeg', data: b64 } });
  }

  parts.push({ text: `
Bạn đang xem các frame thumbnail từ B-roll video clips cho kênh sức khỏe/fitness tiếng Việt.
Với mỗi clip được đánh số [1], [2]... hãy mô tả nội dung và gán nhãn.

Trả về JSON array theo schema sau (đúng thứ tự clip):` });

  const payload = {
    contents: [{ parts }],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.1,
      responseSchema: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            filename:    { type: 'STRING' },
            keywords_en: { type: 'ARRAY', items: { type: 'STRING' } },
            keywords_vi: { type: 'ARRAY', items: { type: 'STRING' } },
            description: { type: 'STRING' },
            category:    { type: 'STRING', enum: ['food','fitness','medical','body','lifestyle','nature','abstract'] }
          },
          required: ['filename','keywords_en','keywords_vi','description','category']
        }
      }
    }
  };

  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const resp = await fetch(URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${(await resp.text()).slice(0,200)}`);
      const data = await resp.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
      return JSON.parse(text);
    } catch (e) {
      lastErr = e;
      if (attempt < 3) await new Promise(r => setTimeout(r, 4000 * attempt));
    }
  }
  throw lastErr;
}

// ── Main ──────────────────────────────────────────────────────────
async function main() {
  let files;
  try {
    files = (await readdir(BROLL_DIR)).filter(f => f.toLowerCase().endsWith('.mp4'));
  } catch {
    console.error(`Cannot read ${BROLL_DIR}`); process.exit(1);
  }
  console.log(`Found ${files.length} B-roll clips\n`);

  await mkdir(THUMB_DIR, { recursive: true });

  // Extract thumbnails
  console.log('Extracting thumbnails...');
  const clips = [];
  for (const file of files) {
    const videoPath = `${BROLL_DIR}/${file}`;
    const thumbPath = `${THUMB_DIR}/${file.replace(/\.mp4$/i, '.jpg')}`;
    const ok = await extractThumb(videoPath, thumbPath);
    process.stdout.write(`  ${ok ? '✓' : '✗'} ${file}\n`);
    clips.push({ filename: file, path: videoPath, thumbPath, ok });
  }

  const valid = clips.filter(c => c.ok);
  console.log(`\n${valid.length}/${clips.length} thumbnails extracted`);
  console.log(`\nTagging with Gemini Vision (${Math.ceil(valid.length / BATCH)} batches)...\n`);

  const tagged = new Map();

  for (let i = 0; i < valid.length; i += BATCH) {
    const batch = valid.slice(i, i + BATCH);
    const batchNum = Math.floor(i / BATCH) + 1;
    const total    = Math.ceil(valid.length / BATCH);
    console.log(`  Batch ${batchNum}/${total}...`);

    try {
      const results = await tagBatch(batch);
      // Map results back by position (fallback) or by filename
      for (let j = 0; j < batch.length; j++) {
        const clip = batch[j];
        const tag  = results.find(r => r.filename === clip.filename) || results[j] || {};
        tagged.set(clip.filename, {
          keywords_en: tag.keywords_en || [],
          keywords_vi: tag.keywords_vi || [],
          description: tag.description || '',
          category:    tag.category    || 'unknown'
        });
        const kw = (tag.keywords_en || []).slice(0, 3).join(', ');
        console.log(`    ✓ ${clip.filename.slice(0,35).padEnd(35)} ${kw}`);
      }
    } catch (e) {
      console.error(`    ✗ Batch failed: ${e.message}`);
      for (const clip of batch) {
        tagged.set(clip.filename, { keywords_en: [], keywords_vi: [], description: '', category: 'unknown' });
      }
    }

    if (i + BATCH < valid.length) await new Promise(r => setTimeout(r, 2500));
  }

  // Build final index
  const index = clips.map(clip => ({
    filename:    clip.filename,
    path:        clip.path,
    ...(tagged.get(clip.filename) || { keywords_en: [], keywords_vi: [], description: '', category: 'unknown' })
  }));

  await writeFile(OUT, JSON.stringify(index, null, 2), 'utf8');
  console.log(`\n✓ ${index.length} clips → ${OUT}`);

  await rm(THUMB_DIR, { recursive: true, force: true });
  console.log('✓ Temp thumbnails cleaned up');
}

main().catch(err => { console.error(err); process.exit(1); });
