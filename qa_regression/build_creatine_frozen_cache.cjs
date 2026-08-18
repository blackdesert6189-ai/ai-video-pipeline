const fs = require('fs');
const path = require('path');

function parseSRT(srtContent) {
  const blocks = srtContent.trim().split(/\n\s*\n/);
  const cues = [];
  for (const block of blocks) {
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length < 3) continue;
    const timeMatch = lines[1].match(/(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/);
    if (!timeMatch) continue;
    const startTime = parseInt(timeMatch[1]) * 3600 + parseInt(timeMatch[2]) * 60 + parseInt(timeMatch[3]) + parseInt(timeMatch[4]) / 1000;
    const endTime = parseInt(timeMatch[5]) * 3600 + parseInt(timeMatch[6]) * 60 + parseInt(timeMatch[7]) + parseInt(timeMatch[8]) / 1000;
    const text = lines.slice(2).join(' ');
    cues.push({ startTime, endTime, text });
  }
  return cues;
}

const srtPath = path.resolve('raw_materials', 'creatine', 'transcrips.srt');
const srtContent = fs.readFileSync(srtPath, 'utf8');
const cues = parseSRT(srtContent);

const sentences = cues.map((c, i) => {
  const words = c.text.split(/\s+/).filter(Boolean);
  return {
    index: i + 1,
    text: c.text,
    startTime: c.startTime,
    endTime: c.endTime,
    words,
    style: (i === 0 || i === 5 || i === 12 || i === 25) ? "peak" : "normal",
    peak_lines: (i === 0 || i === 5 || i === 12 || i === 25) ? [{ text: c.text.slice(0, 30), type: "bold" }] : []
  };
});

const overlays = [
  {
    sentence_index: 1,
    startTime: 2.0,
    endTime: 6.5,
    type: "card",
    title: "CREATINE CHO MỌI NGƯỜI",
    detail: "Đàn ông, phụ nữ và người già đều nên dùng",
    icon_keyword: "creatine supplement"
  },
  {
    sentence_index: 4,
    startTime: 14.5,
    endTime: 19.0,
    type: "card",
    title: "AN TOÀN TUYỆT ĐỐI",
    detail: "Thực phẩm bổ sung được nghiên cứu nhiều nhất",
    icon_keyword: "shield"
  },
  {
    sentence_index: 10,
    startTime: 38.0,
    endTime: 44.5,
    type: "card",
    title: "TĂNG NĂNG LƯỢNG NÃO BỘ",
    detail: "Hỗ trợ trí nhớ, tập trung và giảm mệt mỏi",
    icon_keyword: "brain"
  },
  {
    sentence_index: 18,
    startTime: 62.0,
    endTime: 68.5,
    type: "card",
    title: "PHỤC HỒI CƠ BẮP",
    detail: "Gia tăng ATP và sức mạnh cơ bắp",
    icon_keyword: "muscle"
  },
  {
    sentence_index: 24,
    startTime: 88.0,
    endTime: 94.5,
    type: "card",
    title: "CHỐNG LÃO HÓA TẾ BÀO",
    detail: "Bảo vệ chức năng thần kinh và tim mạch",
    icon_keyword: "heart"
  },
  {
    sentence_index: 30,
    startTime: 110.0,
    endTime: 117.0,
    type: "card",
    title: "LIỀU DÙNG KHUYẾN NGHỊ",
    detail: "3-5g mỗi ngày duy trì đều đặn",
    icon_keyword: "check"
  }
];

const totalDuration = 121.91;

const cachePayload = {
  videoFile: "input.mp4",
  sentences,
  overlays,
  totalDuration,
  hook: "AI CŨNG CẦN DÙNG CREATINE",
  hook_type: "brand",
  broll_schedule: []
};

const targetCache1 = path.resolve('raw_materials', 'creatine', '_gemini_cache.json');
const targetCache2 = path.resolve('raw_materials', 'creatine', 'input_gemini_cache.json');

fs.writeFileSync(targetCache1, JSON.stringify(cachePayload, null, 2), 'utf8');
fs.writeFileSync(targetCache2, JSON.stringify(cachePayload, null, 2), 'utf8');

console.log('✓ Successfully created frozen Creatine cache at:');
console.log(' ', targetCache1);
console.log(' ', targetCache2);
console.log(`  Total Sentences: ${sentences.length}, Overlays: ${overlays.length}, Duration: ${totalDuration}s`);
