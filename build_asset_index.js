/**
 * build_asset_index.js — chạy một lần: node build_asset_index.js
 * Scan Health visuals/ + icons/ → Gemini Vision tag → asset_index.json
 */

import { readdir, readFile, writeFile } from 'fs/promises';
import { createInflate } from 'zlib';
import path from 'path';

const ASSET_DIRS = ['assets/Health visuals', 'assets/icons'];
const OUT      = 'asset_index.json';
const API_KEY  = process.env.GEMINI_API_KEY || '';
const BATCH    = 3;   // nhỏ hơn để tránh rate limit với Vision
const DELAY_MS = 20000; // 20s giữa mỗi batch
const URL      = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${API_KEY}`;

const SKIP_FILES = new Set([
  'hormones.png',
  'Brain With Pituitary Gland.png',
  'alif_production-black-7235742_1920.png',
  'peggy_marco-santa-hat-4702982_1920.png',
]);

const NOISE = new Set([
  'free','vector','images','generated','medium','clker','openclipart','vectors',
  'wikimediaimages','creativecanvasshop','bestbiologygirl','alisakonell','imagemo',
  'bodimadesign','geralt','simisi','simisi1','nadjadonauer','lucianavieira','fidsor',
  'zachvanstone','zachvanstone8','gdj','drabbitod','drsjs','hyperslower','ideativas',
  'tlm','jeftymatricio','jeftymatricio1','jingturner','jingturner8','johnbloor',
  'julieta','masc','leo','romero','lobkoolya','lobkoolya777','maklay','maklay62',
  'marcuesbo','mcmurryjulie','merre','merre57','mickeylit','mono','tone','nashart',
  'nandey','nandey4j','nopixelzone','nube','art07','olenchic','osama','charawy',
  'pixaline','raniramli','rayce','schwarzenarzisse','stux','sunriseforever','peggy',
  'marco','jozefm','jozefm84','katzen','tupas','klauiii','alif','production',
  'mohamed','hassan','sus','sus4n','realistix','pngtree','icons8','canvas','shop',
  'ai','el','man','woman','couple','abstract','isolated',
]);

const VALID_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif']);

function extractKey(filename) {
  const base = path.basename(filename, path.extname(filename));
  const tokens = base
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => {
      if (!t || t.length < 2) return false;
      if (/^\d+$/.test(t)) return false;
      if (t.length >= 4 && /\d/.test(t)) return false;
      if (NOISE.has(t)) return false;
      return true;
    });
  const subject = tokens.slice(-2);
  return subject.join('-') || tokens[0] || base.slice(0, 20).replace(/\s+/g, '-');
}

// ── PNG pixel sampler ─────────────────────────────────────────────
async function samplePNG(filepath) {
  const buf = await readFile(filepath);
  if (buf.length < 33 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  const width     = buf.readUInt32BE(16);
  const height    = buf.readUInt32BE(20);
  const colorType = buf[25];
  const bpp       = colorType === 6 ? 4 : colorType === 2 ? 3 : null;
  if (!bpp || width < 4 || height < 4) return null;
  const idats = [];
  let off = 8;
  while (off + 12 <= buf.length) {
    const len  = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    if (type === 'IDAT') idats.push(buf.subarray(off + 8, off + 8 + len));
    if (type === 'IEND') break;
    off += 12 + len;
  }
  if (!idats.length) return null;
  let raw;
  try {
    raw = await new Promise((res, rej) => {
      const chunks = [];
      const inflate = createInflate();
      inflate.on('data', c => chunks.push(c));
      inflate.on('end', () => res(Buffer.concat(chunks)));
      inflate.on('error', rej);
      inflate.end(Buffer.concat(idats));
    });
  } catch { return null; }
  const stride = 1 + width * bpp;
  const rows = [];
  for (let y = 0; y < height; y++) {
    const sl   = raw.subarray(y * stride, y * stride + stride);
    const filt = sl[0];
    const data = sl.subarray(1);
    const out  = new Uint8Array(data.length);
    const prev = y > 0 ? rows[y - 1] : new Uint8Array(data.length);
    for (let i = 0; i < data.length; i++) {
      const x = data[i];
      const a = i >= bpp ? out[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      switch (filt) {
        case 0: out[i] = x; break;
        case 1: out[i] = (x + a) & 0xff; break;
        case 2: out[i] = (x + b) & 0xff; break;
        case 3: out[i] = (x + Math.floor((a + b) / 2)) & 0xff; break;
        case 4: { const p = a+b-c; const pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c); out[i]=(x+(pa<=pb&&pa<=pc?a:pb<=pc?b:c))&0xff; break; }
        default: out[i] = x;
      }
    }
    rows.push(out);
  }
  const px = (x, y) => { const row=rows[Math.min(y,height-1)]; const i=Math.min(x,width-1)*bpp; return {r:row[i],g:row[i+1],b:row[i+2],a:bpp===4?row[i+3]:255}; };
  const corners = [px(0,0),px(1,0),px(2,0),px(0,1),px(1,1),px(width-1,0),px(width-2,0),px(width-1,1),px(0,height-1),px(0,height-2),px(1,height-1),px(width-1,height-1),px(width-2,height-1),px(width-1,height-2)];
  const cx=Math.floor(width/2),cy=Math.floor(height/2);
  const center = [px(cx,cy),px(cx-1,cy),px(cx+1,cy),px(cx,cy-1),px(cx,cy+1)];
  return { corners, center };
}

function detectBlendMode(sample) {
  if (!sample) return 'screen';
  const { corners, center } = sample;
  const avgAlpha  = corners.reduce((s,p) => s+p.a, 0) / corners.length;
  const avgBright = corners.reduce((s,p) => s+(p.r+p.g+p.b)/3, 0) / corners.length;
  const ctrBright = center.reduce((s,p)  => s+(p.r+p.g+p.b)/3, 0) / center.length;
  if (avgAlpha < 20) return ctrBright < 80 ? 'invert' : 'normal';
  if (avgBright > 210) return 'screen';
  if (avgBright < 30)  return 'normal';
  return 'screen';
}

// ── Gemini Vision batch tagger ────────────────────────────────────
async function tagBatch(batch) {
  const parts = [];
  for (let i = 0; i < batch.length; i++) {
    const { key, filepath } = batch[i];
    const ext  = path.extname(filepath).toLowerCase();
    if (ext === '.gif') continue; // skip GIF — Vision không đọc được tốt
    const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png';
    const b64  = (await readFile(filepath)).toString('base64');
    parts.push({ text: `[${i + 1}] key="${key}"` });
    parts.push({ inlineData: { mimeType: mime, data: b64 } });
  }

  parts.push({ text: `
Bạn đang xem các ảnh illustration/icon cho kênh sức khỏe/fitness tiếng Việt.
Với mỗi ảnh được đánh số [1], [2]..., mô tả nội dung và gán nhãn.
Trả về JSON array theo đúng thứ tự ảnh:` });

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
            key:         { type: 'STRING' },
            description: { type: 'STRING' },
            keywords_en: { type: 'ARRAY', items: { type: 'STRING' } },
            keywords_vi: { type: 'ARRAY', items: { type: 'STRING' } },
            category:    { type: 'STRING', enum: ['food','fitness','medical','body','lifestyle','nutrition','mental','abstract'] }
          },
          required: ['key','description','keywords_en','keywords_vi','category']
        }
      }
    }
  };

  let lastErr;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const resp = await fetch(URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (resp.status === 429) {
        const wait = 60000 * attempt;
        console.log(`\n    ⏳ Rate limit. Chờ ${wait/1000}s...`);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
      if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${(await resp.text()).slice(0,200)}`);
      const data = await resp.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
      return JSON.parse(text);
    } catch (e) {
      lastErr = e;
      if (attempt < 5) await new Promise(r => setTimeout(r, 8000 * attempt));
    }
  }
  throw lastErr || new Error('All attempts failed (rate limit or unknown error)');
}

// ── Main ──────────────────────────────────────────────────────────
async function main() {
  // Load existing index để resume (skip đã tagged)
  let existing = {};
  try {
    const prev = JSON.parse(await readFile(OUT, 'utf8'));
    for (const e of prev) {
      if (e.description) existing[e.key] = e;
    }
    console.log(`Resume: ${Object.keys(existing).length} assets already tagged.`);
  } catch { /* first run */ }

  const entries  = [];
  const seenKeys = new Map();

  for (const dir of ASSET_DIRS) {
    let files;
    try { files = await readdir(dir); }
    catch { console.warn(`  ⚠ cannot read ${dir}`); continue; }

    for (const file of files) {
      if (SKIP_FILES.has(file)) continue;
      const ext = path.extname(file).toLowerCase();
      if (!VALID_EXT.has(ext)) continue;

      const filepath = `${dir}/${file}`;
      let blend_mode = 'screen';
      if (ext === '.png') {
        try { blend_mode = detectBlendMode(await samplePNG(filepath)); } catch { /* ignore */ }
      } else if (ext === '.gif') {
        blend_mode = 'normal';
      }

      let key = extractKey(file);
      if (seenKeys.has(key)) {
        const n = seenKeys.get(key) + 1;
        seenKeys.set(key, n);
        key = `${key}-${n}`;
      } else {
        seenKeys.set(key, 1);
      }

      entries.push({ key, path: filepath, blend_mode });
    }
  }

  // Merge existing tags into entries
  const tagMap = new Map(Object.entries(existing).map(([k, v]) => [k, v]));

  const toTag = entries.filter(e => !existing[e.key]);
  console.log(`Found ${entries.length} total. Need to tag: ${toTag.length}. Batches: ${Math.ceil(toTag.length / BATCH)}\n`);

  const save = async () => {
    const out = entries.map(e => {
      const tag = tagMap.get(e.key) || {};
      return {
        key:         e.key,
        path:        e.path,
        blend_mode:  e.blend_mode,
        description: tag.description || '',
        keywords_en: tag.keywords_en || [],
        keywords_vi: tag.keywords_vi || [],
        category:    tag.category    || 'abstract',
        keywords:    [e.key, ...(tag.keywords_en || [])].filter(Boolean)
      };
    });
    await writeFile(OUT, JSON.stringify(out, null, 2), 'utf8');
  };

  for (let i = 0; i < toTag.length; i += BATCH) {
    const batch    = toTag.slice(i, i + BATCH);
    const batchNum = Math.floor(i / BATCH) + 1;
    const total    = Math.ceil(toTag.length / BATCH);
    process.stdout.write(`  Batch ${batchNum}/${total}... `);

    try {
      const results = await tagBatch(batch.map(e => ({ key: e.key, filepath: e.path })));
      for (let j = 0; j < batch.length; j++) {
        const tag = results.find(r => r.key === batch[j].key) || results[j] || {};
        tagMap.set(batch[j].key, {
          keywords_en: tag.keywords_en || [],
          keywords_vi: tag.keywords_vi || [],
          description: tag.description || '',
          category:    tag.category    || 'abstract'
        });
        const kw = (tag.keywords_en || []).slice(0, 3).join(', ');
        process.stdout.write(`\n    ✓ ${batch[j].key.slice(0,30).padEnd(30)} [${tag.category||'?'}] ${kw}`);
      }
      console.log();
      await save(); // save after every successful batch
    } catch (e) {
      console.error(`\n    ✗ Batch failed: ${e.message}`);
    }

    if (i + BATCH < toTag.length) {
      process.stdout.write(`  ⏳ ${DELAY_MS/1000}s...\n`);
      await new Promise(r => setTimeout(r, DELAY_MS));
    }
  }

  await save();
  const tagged = entries.filter(e => tagMap.get(e.key)?.description).length;
  console.log(`\n✓ ${entries.length} assets (${tagged} tagged) → ${OUT}`);
}

main().catch(err => { console.error(err); process.exit(1); });
