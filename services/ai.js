// Groq AI client (OpenAI-compatible).
// Tidak butuh dependency tambahan: memakai global fetch (Node >= 18).
//
// Prinsip: GAGAL ITU BERISIK. Fungsi di sini MELEMPAR AIError saat gagal
// (bukan diam-diam null) agar bot bisa memberi tahu user sebabnya,
// bukan malah menjawab pakai template basi.

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
// Teks: gpt-oss-20b (cepat, jawaban langsung tanpa bocoran thinking).
// Vision: qwen3.6-27b (multimodal). Keduanya terverifikasi aktif Sep 2026.
const DEFAULT_MODEL = 'openai/gpt-oss-20b';
const DEFAULT_VISION_MODEL = 'qwen/qwen3.6-27b';

class AIError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AIError';
    this.aiCode = code;
  }
}

let lastAIError = null; // { code, detail, at } — ditampilkan di /ai agar "gajelas" hilang

function noteAIError(code, detail) {
  lastAIError = { code, detail: String(detail || '').slice(0, 200), at: new Date().toISOString() };
  console.error(`[AI] gagal (${code}): ${lastAIError.detail}`);
}

function getLastAIError() {
  return lastAIError;
}

function isAIEnabled() {
  return Boolean(process.env.GROQ_API_KEY && process.env.GROQ_API_KEY.trim());
}

function getModel() {
  return (process.env.GROQ_MODEL || DEFAULT_MODEL).trim();
}

function getVisionModel() {
  return (process.env.GROQ_VISION_MODEL || DEFAULT_VISION_MODEL).trim();
}

function humanizeAIError(err) {
  const code = err && (err.aiCode || err.code);
  if (code === 401 || code === 'invalid_api_key') return 'API key salah / kedaluwarsa / dicabut';
  if (code === 404 || code === 'model_not_found') return 'model AI sudah pensiun / tidak tersedia (ganti GROQ_MODEL)';
  if (code === 429 || code === 'rate_limit_exceeded') return 'limit gratis Groq habis, coba lagi nanti';
  if (code === 'timeout') return 'AI timeout (jaringan lambat)';
  if (code === 'network') return 'tidak bisa mencapai server Groq (jaringan)';
  if (code === 'empty_response') return 'AI merespons kosong';
  return (err && err.message) || 'kesalahan tidak dikenal';
}

const SYSTEM_PROMPT = `Kamu adalah Sensei AI, pengajar bahasa Jepang yang ramah untuk orang Indonesia.
Aturan:
- Jawab SELALU dalam Bahasa Indonesia (kecuali contoh bahasa Jepang + romaji + arti).
- Setiap kosakata/frasa Jepang wajib disertai cara baca romaji dan arti Indonesia.
- Jawaban ringkas tapi lengkap, cocok dibaca di chat Telegram (maksimal ~700 kata).
- PENTING: jawab LANGSUNG tanpa menunjukkan proses berpikir. Jangan pernah menulis tag <think> atau menjelaskan langkah berpikirmu.
- Ingat konteks percakapan sebelumnya (riwayat chat diberikan) untuk menjawab pertanyaan lanjutan seperti "kalau ...?", "terus?".
- Jika pertanyaan di luar bahasa Jepang, tetap jawab dengan baik lalu kaitkan kembali ke belajar bahasa Jepang bila relevan.
- Jika diberi KONTEKS MATERI, prioritaskan isinya agar konsisten dengan kurikulum, tapi boleh menambah penjelasan sendiri.`;

async function groqChat({ model, messages, temperature, maxTokens, timeoutMs }) {
  const apiKey = (process.env.GROQ_API_KEY || '').trim();
  if (!apiKey) throw new AIError('no_api_key', 'GROQ_API_KEY belum diisi');

  // Coba hingga 2x: model thinking kadang hanya mengembalikan <think> tanpa jawaban.
  // Ujian kedua ditegaskan agar langsung menjawab.
  // Floor 800 token output: thinking memakan bujet, bujet kecil membuat jawaban terpotong.
  const safeMaxTokens = Math.max(maxTokens, 800);
  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const msgs = attempt === 1 ? messages : [
      ...messages.slice(0, -1),
      {
        role: 'user',
        content: messages[messages.length - 1].content +
          '\n\n[PENTING: jawab LANGSUNG sekarang, tanpa tag <think>, tanpa proses berpikir.]'
      }
    ];
    try {
      return await groqChatOnce({ model, messages: msgs, temperature, maxTokens: safeMaxTokens, timeoutMs, apiKey });
    } catch (e) {
      lastError = e;
      if (!(e instanceof AIError) || e.aiCode !== 'empty_response') throw e;
      console.error(`[AI] respons kosong (percobaan ${attempt}), mengulang...`);
    }
  }
  noteAIError(lastError.aiCode, lastError.message);
  throw lastError;
}

// Qwen3 hybrid: akhiran /no_think mematikan mode berpikir (hemat token + tanpa bocoran <think>).
// Bila model tidak mendukung, akhiran ini hanya teks biasa yang diabaikan.
function noThink(messages) {
  return messages.map((msg, idx) => {
    if (idx !== messages.length - 1) return msg;
    if (typeof msg.content === 'string') return { ...msg, content: msg.content + '\n/no_think' };
    if (Array.isArray(msg.content)) {
      return {
        ...msg,
        content: msg.content.map(p => p.type === 'text' ? { ...p, text: p.text + '\n/no_think' } : p)
      };
    }
    return msg;
  });
}

async function groqChatOnce({ model, messages, temperature, maxTokens, timeoutMs, apiKey }) {

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(GROQ_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ model, messages: noThink(messages), temperature, max_tokens: maxTokens })
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      let code = res.status;
      try {
        const j = JSON.parse(body);
        if (j && j.error && j.error.code) code = j.error.code;
      } catch (e) { /* abaikan */ }
      throw new AIError(code, body.slice(0, 300));
    }
    const data = await res.json();
    let text = data && data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content
      : null;
    text = (text || '').trim();
    // buang jejak thinking model reasoning (qwen <think>...</think>) agar jawaban bersih
    text = text.replace(/<(think|thinking)>[\s\S]*?(<\/\1>|$)/gi, '').trim();
    if (!text) throw new AIError('empty_response', 'respons kosong dari model');
    return text;
  } catch (e) {
    if (e instanceof AIError) {
      // empty_response dicatat pemanggil (bisa retry dulu); lainnya catat langsung
      if (e.aiCode !== 'empty_response') noteAIError(e.aiCode, e.message);
      throw e;
    }
    const code = e && e.name === 'AbortError' ? 'timeout' : 'network';
    noteAIError(code, (e && e.message) || code);
    throw new AIError(code, (e && e.message) || code);
  } finally {
    clearTimeout(timer);
  }
}

// Tanya jawab teks. history: [{role:'user'|'assistant', content}] — memory percakapan.
// MELEMPAR AIError bila gagal.
async function askGroq(question, lessonContext = '', opts = {}) {
  const userContent = lessonContext
    ? `KONTEKS MATERI (jadikan acuan utama bila relevan):\n${lessonContext}\n\nPERTANYAAN MURID:\n${question}`
    : question;

  const messages = [{ role: 'system', content: opts.system || SYSTEM_PROMPT }];
  for (const h of (opts.history || [])) {
    if (h && (h.role === 'user' || h.role === 'assistant') && h.content) {
      messages.push({ role: h.role, content: String(h.content).slice(0, 800) });
    }
  }
  messages.push({ role: 'user', content: userContent });

  return groqChat({
    model: opts.model || getModel(),
    messages,
    temperature: opts.temperature !== undefined ? opts.temperature : 0.7,
    maxTokens: opts.maxTokens || 1000,
    timeoutMs: parseInt(process.env.GROQ_TIMEOUT_MS || '25000', 10)
  });
}

// Vision: baca foto (base64) dan ekstrak kosakata dasar bahasa Jepang.
// MELEMPAR AIError bila gagal.
async function describeImage({ base64, mimeType = 'image/jpeg', question = '' }) {
  const apiKey = (process.env.GROQ_API_KEY || '').trim();
  if (!apiKey) throw new AIError('no_api_key', 'GROQ_API_KEY belum diisi');
  if (!base64) throw new AIError('no_image', 'gambar kosong');

  const instruction = question && question.trim()
    ? `Permintaan murid: "${question.trim()}"\n\n`
    : '';

  const prompt = `${instruction}Lihat foto ini. Tugasmu sebagai Sensei AI bahasa Jepang:\n` +
    `1. Baca SEMUA tulisan Jepang yang terlihat di foto (hiragana, katakana, kanji).\n` +
    `2. Tulis DAFTAR KOSAKATA DASAR (maksimal 6, yang paling penting): format "Jepang (romaji) = arti Indonesia" per baris.\n` +
    `3. Beri PENJELASAN singkat (2-4 kalimat) tentang isi foto dalam Bahasa Indonesia.\n` +
    `4. Jika tidak ada tulisan Jepang sama sekali, deskripsikan isi foto lalu beri 3 kosakata Jepang yang berkaitan dengan isi foto.\n` +
    `Seluruh jawaban dalam Bahasa Indonesia.`;

  return groqChat({
    model: getVisionModel(),
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } }
        ]
      }
    ],
    temperature: 0.5,
    maxTokens: 900,
    timeoutMs: parseInt(process.env.GROQ_TIMEOUT_MS || '40000', 10)
  });
}

module.exports = { AIError, isAIEnabled, getModel, getVisionModel, humanizeAIError, getLastAIError, askGroq, describeImage };
