/**
 * src/pipeline/assetAcquisition.js
 * External asset acquisition service for Pexels B-roll videos and IconScout / Lottie animations.
 */

import fs from 'fs';
import path from 'path';
import https from 'https';

// -------------------------------------------------------------
// Pexels — auto-fetch B-roll (video) + card images (photo)
// -------------------------------------------------------------
const PEXELS_VI_TO_EN = [
  ['đi bộ',        'person walking park outdoor'],
  ['chạy bộ',      'person running jogging street'],
  ['tập thể dục',  'woman man exercising gym workout'],
  ['gym',          'gym dumbbell lifting weights'],
  ['cơ bắp',       'muscular fit body workout'],
  ['mỡ bụng',      'woman measuring waist belly slim'],
  ['giảm cân',     'woman scale weight loss healthy'],
  ['ăn uống',      'person eating healthy meal bowl'],
  ['thực phẩm',    'fresh healthy food preparation kitchen'],
  ['rau củ',       'fresh vegetables colorful market'],
  ['hoa quả',      'fresh fruits bowl colorful'],
  ['protein',      'grilled chicken eggs meat protein'],
  ['insulin',      'doctor syringe injection medical'],
  ['tim mạch',     'heartbeat pulse medical cardiology'],
  ['nhịp tim',     'person checking pulse fitness tracker'],
  ['ngủ',          'person sleeping bed peaceful night'],
  ['uống nước',    'person drinking water glass hydration'],
  ['sức khỏe',     'healthy active lifestyle woman man'],
  ['tiêu hóa',     'stomach healthy digestion gut food'],
  ['hạt chia',     'chia seeds bowl spoon superfood'],
  ['chất xơ',      'whole grain fiber bread oats cereal'],
  ['năng lượng',   'energetic active running person sunrise'],
  ['béo phì',      'overweight person walking lifestyle change'],
  ['calo',         'person counting calories food journal'],
  ['bước chân',    'close up feet walking steps pavement'],
  ['cơ thể',       'healthy fit body person athletic'],
  ['đốt mỡ',       'person sweating cardio exercise intense'],
  ['dinh dưỡng',   'nutritious meal prep healthy ingredients'],
  ['trao đổi chất','person active metabolism workout sweat'],
  ['zone 2',       'person slow jogging steady pace cardio'],
  ['cortisol',     'stressed person tired work office'],
  ['hormone',      'woman man healthy lifestyle balance'],
  ['viêm',         'inflammation medical health treatment'],
  ['đường huyết',  'blood glucose test finger prick'],
  ['bữa sáng',     'healthy breakfast morning meal table'],
  ['bữa tối',      'dinner healthy meal evening'],
  ['nhịn ăn',      'person fasting water glass clock'],
  ['căng thẳng',   'stressed person relaxation meditation'],
  ['thiền',        'person meditating yoga peaceful'],
  ['vitamin',      'vitamin supplements pills capsules'],
  ['omega',        'fish salmon healthy fat food'],
];

const ICONSCOUT_API = 'https://api.iconscout.com/v3';

export function createAssetAcquisition({
  pexelsBroll = {},
  pexelsApiKey = '',
  iconscoutApiKey = '',
  iconscoutClientId = '',
  lottieDir = path.resolve('assets/lottie'),
  fetchImpl = globalThis.fetch,
  httpsGet = https.get,
  logSuccess = (msg) => console.log(`✓  ${msg}`)
} = {}) {

  function pexelsExtractQueries(srtText, max = pexelsBroll.maxDictQueries) {
    const lower = srtText.toLowerCase();
    // Đếm tần suất xuất hiện — keyword nào nhiều hơn ưu tiên hơn
    const scored = [];
    for (const [vi, en] of PEXELS_VI_TO_EN) {
      let count = 0;
      let pos = 0;
      while ((pos = lower.indexOf(vi, pos)) !== -1) { count++; pos += vi.length; }
      if (count > 0) scored.push({ en, count });
    }
    scored.sort((a, b) => b.count - a.count);
    const hits = scored.map(s => s.en);
    if (hits.length < 2) {
      hits.push('person healthy active lifestyle');
      hits.push('healthy food nutrition meal');
    }
    return hits.slice(0, max);
  }

  function pexelsDetectCategory(tagStr) {
    if (/food|eat|vegetable|fruit|cook|nutrition|meal|ingredient/.test(tagStr)) return 'food';
    if (/gym|workout|fitness|exercise|muscle|training|sport/.test(tagStr)) return 'fitness';
    if (/doctor|medical|hospital|anatomy|scan|clinic/.test(tagStr)) return 'medical';
    if (/body|skin|fat|weight|belly|slim|physique/.test(tagStr)) return 'body';
    return 'lifestyle';
  }

  function pexelsDownload(url, dest) {
    return new Promise((resolve, reject) => {
      function get(u, redirects = 0) {
        if (redirects > 5) { reject(new Error('Too many redirects')); return; }
        httpsGet(u, res => {
          if (res.statusCode === 301 || res.statusCode === 302) {
            res.resume();
            get(res.headers.location, redirects + 1);
            return;
          }
          if (res.statusCode !== 200) {
            res.resume();
            reject(new Error(`HTTP ${res.statusCode}`));
            return;
          }
          const file = fs.createWriteStream(dest);
          res.pipe(file);
          file.on('finish', () => file.close(resolve));
          file.on('error', err => { fs.unlink(dest, () => {}); reject(err); });
        }).on('error', reject);
      }
      get(url);
    });
  }

  async function fetchPexelsBroll(srtText, maxNewClips = pexelsBroll.maxDictPass, geminiQueriesEn = []) {
    const brollDir = path.resolve('assets/Broll');
    const indexFile = path.resolve('broll_index.json');
    if (!fs.existsSync(brollDir)) fs.mkdirSync(brollDir, { recursive: true });

    let existingIndex = [];
    try { existingIndex = JSON.parse(fs.readFileSync(indexFile, 'utf8')); } catch {}
    const existingFiles = new Set(existingIndex.map(c => c.filename.toLowerCase()));

    // Ưu tiên dùng query từ Gemini, fallback về từ điển nếu không có
    const queries = geminiQueriesEn.length >= pexelsBroll.minGeminiCount
      ? geminiQueriesEn.slice(0, pexelsBroll.maxGeminiQueries)
      : pexelsExtractQueries(srtText, pexelsBroll.maxDictQueries);
    console.log(`\n[pexels] B-roll queries (${geminiQueriesEn.length ? 'Gemini' : 'dictionary'}): ${queries.join(' | ')}`);

    const newEntries = [];
    for (const query of queries) {
      if (newEntries.length >= maxNewClips) break;
      try {
        const url = `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=${pexelsBroll.perPage}&orientation=portrait&size=medium`;
        const res = await fetchImpl(url, { headers: { Authorization: pexelsApiKey } });
        if (!res.ok) throw new Error(`Pexels Videos ${res.status}`);
        const videos = (await res.json()).videos || [];

        for (const video of videos) {
          if (newEntries.length >= maxNewClips) break;
          const filename = `pexels_${video.id}.mp4`;
          if (existingFiles.has(filename.toLowerCase())) continue;

          const files = (video.video_files || []).filter(f => f.file_type === 'video/mp4');
          const fileInfo = files.sort((a, b) => {
            const score = f => (f.quality === 'hd' ? 20 : f.quality === 'sd' ? 10 : 0) + (f.height > f.width ? 5 : 0);
            return score(b) - score(a);
          })[0];
          if (!fileInfo) continue;

          const destPath = path.join(brollDir, filename);
          if (!fs.existsSync(destPath)) {
            process.stdout.write(`[pexels] ${filename} (${query}) ... `);
            try { await pexelsDownload(fileInfo.link, destPath); console.log('✓'); }
            catch (e) { console.log(`✗ ${e.message}`); continue; }
          }

          const tags = (video.tags || []).map(t => (typeof t === 'string' ? t : t.title) || '').filter(Boolean);
          const tagStr = [...tags, ...query.split(' ')].join(' ').toLowerCase();
          newEntries.push({ filename, path: `assets/Broll/${filename}`, keywords_en: tags.length ? tags.slice(0, 8) : query.split(' '), keywords_vi: [], description: `Pexels #${video.id} — ${query}`, category: pexelsDetectCategory(tagStr) });
          existingFiles.add(filename.toLowerCase());
        }
      } catch (err) { console.warn(`[pexels] "${query}" failed: ${err.message}`); }
    }

    if (newEntries.length) {
      fs.writeFileSync(indexFile, JSON.stringify([...existingIndex, ...newEntries], null, 2));
      console.log(`[pexels] +${newEntries.length} clips added to broll_index.json\n`);
    } else {
      console.log(`[pexels] No new clips (all already cached)\n`);
    }
    return newEntries;
  }

  async function searchLottieJson(query) {
    // Search IconScout for FREE Lottie animations matching the query
    const searchHeaders = {
      'Authorization': `Bearer ${iconscoutApiKey}`,
      'Client-ID': iconscoutClientId,
      'Accept': 'application/json'
    };
    const url = `${ICONSCOUT_API}/search?query=${encodeURIComponent(query)}&asset=lottie&per_page=5&price=free`;
    const res = await fetchImpl(url, { headers: searchHeaders });
    if (!res.ok) throw new Error(`IconScout search ${res.status}`);
    const data = await res.json();
    const items = data?.response?.items?.data;
    if (!items?.length) return null;

    const uuid = items[0]?.uuid;
    if (!uuid) return null;

    // Download API requires Client-Secret header
    const dlHeaders = {
      'Client-ID': iconscoutClientId,
      'Client-Secret': iconscoutApiKey,
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    };
    const dlRes = await fetchImpl(`${ICONSCOUT_API}/items/${uuid}/api-download`, {
      method: 'POST',
      headers: dlHeaders,
      body: JSON.stringify({ format: 'json' })
    });
    if (!dlRes.ok) throw new Error(`IconScout download ${dlRes.status}`);
    const dlData = await dlRes.json();
    const fileUrl = dlData?.response?.download?.url;
    if (!fileUrl) return null;

    // Fetch the actual Lottie JSON file
    const jsonRes = await fetchImpl(fileUrl);
    if (!jsonRes.ok) throw new Error(`Lottie JSON fetch ${jsonRes.status}`);
    return await jsonRes.json();
  }

  // Fuzzy-match a query against cached Lottie filenames by word overlap score
  function findBestCachedLottie(query, usedPaths = new Set()) {
    if (!fs.existsSync(lottieDir)) return null;
    const raw = fs.readdirSync(lottieDir).filter(f => f.endsWith('.json'));
    // Shuffle trước để tránh bias theo alphabet — khi score bằng nhau sẽ ra file khác nhau
    const files = [...raw].sort(() => Math.random() - 0.5);
    if (!files.length) return null;

    const queryWords = new Set(
      query.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 2)
    );
    if (!queryWords.size) return null;

    let best = null, bestScore = 0;
    for (const file of files) {
      const fullPath = path.join(lottieDir, file);
      if (usedPaths.has(fullPath)) continue; // bỏ qua file đã dùng

      const stem = file.replace(/\.json$/, '').replace(/_/g, ' ');
      const fileWords = stem.split(/\s+/).filter(w => w.length > 2);
      let score = 0;
      for (const w of fileWords) {
        if (queryWords.has(w)) score += 2;
        else {
          for (const qw of queryWords) {
            if (w.startsWith(qw) || qw.startsWith(w)) score += 1;
          }
        }
      }
      if (score > bestScore) { bestScore = score; best = file; }
    }
    // Threshold >= 4: cần ít nhất 2 word match chính xác (mỗi word = 2pt)
    // Ngăn fuzzy pick lung tung khi không có file phù hợp → card render full-width
    return bestScore >= 4 ? path.join(lottieDir, best) : null;
  }

  async function fetchLottieForOverlays(overlays) {
    fs.mkdirSync(lottieDir, { recursive: true });
    let fetched = 0, cached = 0, fuzzy = 0;
    const usedPaths = new Set(); // runtime dedup — mỗi animation chỉ dùng 1 lần

    for (const overlay of overlays) {
      if ((overlay.type || '').toUpperCase() === 'STAT') continue; // STAT dùng MetricRenderer, không cần lottie
      const q = (overlay.lottie_query_en || '').trim();
      if (!q) continue;
      const safeKey = q.replace(/[^a-z0-9]+/gi, '_').toLowerCase().slice(0, 50);
      const cacheFile = path.join(lottieDir, `${safeKey}.json`);

      // 1. Exact cache hit — chỉ dùng nếu chưa bị dùng bởi card khác
      if (fs.existsSync(cacheFile) && !usedPaths.has(cacheFile)) {
        overlay.lottie_path = cacheFile;
        usedPaths.add(cacheFile);
        cached++;
        continue;
      }

      // 2. Try IconScout API
      let downloaded = false;
      if (!fs.existsSync(cacheFile)) {
        try {
          process.stdout.write(`[lottie] "${q.slice(0,40)}" ... `);
          const json = await searchLottieJson(q);
          if (json) {
            fs.writeFileSync(cacheFile, JSON.stringify(json));
            if (!usedPaths.has(cacheFile)) {
              overlay.lottie_path = cacheFile;
              usedPaths.add(cacheFile);
              fetched++;
              downloaded = true;
            }
            console.log('✓ (api)');
          } else {
            console.log('(no result)');
          }
        } catch (e) {
          console.log(`✗ ${e.message}`);
        }
      }

      // 3. Fuzzy fallback — tìm file chưa dùng gần nhất
      if (!downloaded && !overlay.lottie_path) {
        const fuzzyFile = findBestCachedLottie(q, usedPaths);
        if (fuzzyFile) {
          overlay.lottie_path = fuzzyFile;
          usedPaths.add(fuzzyFile);
          fuzzy++;
          console.log(`[lottie] "${q.slice(0,40)}" → fuzzy: ${path.basename(fuzzyFile)}`);
        }
      }
    }
    logSuccess(`Lottie: +${fetched} api, ${cached} exact cache, ${fuzzy} fuzzy match`);
  }

  return {
    fetchPexelsBroll,
    fetchLottieForOverlays
  };
}
