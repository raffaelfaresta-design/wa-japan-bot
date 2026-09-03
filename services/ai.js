// Groq AI client (OpenAI-compatible) + fallback lokal.
// Tidak butuh dependency tambahan: memakai global fetch (Node >= 18).

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const DEFAULT_MODEL = 'llama-3.3-70b-versatile';
const DEFAULT_VISION_MODEL = 'qwen/qwen3.6-27b';

function isAIEnabled() {
  return Boolean(process.env.GROQ_API_KEY && process.env.GROQ_API_KEY.trim());
}

function getModel() {
  return (process.env.GROQ_MODEL || DEFAULT_MODEL).trim();
}

function getVisionModel() {
  return (process.env.GROQ_VISION_MODEL || DEFAULT_VISION_MODEL).trim();
}

const SYSTEM_PROMPT = `Kamu adalah Sensei AI, pengajar bahasa Jepang yang ramah untuk orang Indonesia.
Aturan:
- Jawab SELALU dalam Bahasa Indonesia (kecuali contoh bahasa Jepang + romaji + arti).
- singing: setiap kosakata/frasa Jepang wajib disertai cara baca romaji dan arti Indonesia.
- Jawaban ringkas tapi lengkap, cocok dibaca di chat Telegram (maksimal ~700 kata).
- Jika pertanyaan di luar bahasa Jepang, tetap jawab dengan baik lalu kaitkan kembali ke belajar bahasa Jepang bila relevan.
- Jika diberi KONTEKS MATERI, prioritaskan isinya agar konsisten dengan kurikulum, tapi boleh menambah penjelasan sendiri.`;

async function askGroq(question, lessonContext = '', opts = {}) {
  const apiKey = (process.env.GROQ_API_KEY || '').trim();
  if (!apiKey) return null;

  const userContent = lessonContext
    ? `KONTEKS MATERI (jadikan acuan utama bila relevan):\n${lessonContext}\n\nPERTANYAAN MURID:\n${question}`
    : question;

  const controller = new AbortController();
  const timeoutMs = parseInt(process.env.GROQ_TIMEOUT_MS || '25000', 10);
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(GROQ_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: getModel(),
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userContent }
        ],
        temperature: opts.temperature !== undefined ? opts.temperature : 0.7,
        max_tokens: opts.maxTokens || 900
      })
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error(`[AI] Groq error ${res.status}: ${body.slice(0, 200)}`);
      return null;
    }
    const data = await res.json();
    const text = data && data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content
      : null;
    return (text || '').trim() || null;
  } catch (e) {
    console.error('[AI] Groq request gagal:', e.name === 'AbortError' ? 'timeout' : e.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { isAIEnabled, getModel, getVisionModel, askGroq, describeImage };

// Vision: baca foto (base64) dan ekstrak kosakata dasar bahasa Jepang.
// base64: string base64 murni (tanpa prefix data:), mimeType: 'image/jpeg' | 'image/png' ...
// question: instruksi tambahan dari user (mis. caption foto).
// Return: string jawaban atau null bila gagal.
async function describeImage({ base64, mimeType = 'image/jpeg', question = '' }) {
  const apiKey = (process.env.GROQ_API_KEY || '').trim();
  if (!apiKey || !base64) return null;

  const instruction = question && question.trim()
    ? `Permintaan murid: "${question.trim()}"\n\n`
    : '';

  const prompt = `${instruction}Lihat foto ini. Tugasmu sebagai Sensei AI bahasa Jepang:\n` +
    `1. Baca SEMUA tulisan Jepang yang terlihat di foto (hiragana, katakana, kanji).\n` +
    `2. Tulis DAFTAR KOSAKATA DASAR (maksimal 6, yang paling penting): format "Jepang (romaji) = arti Indonesia" per baris.\n` +
    `3. Beri PENJELASAN singkat (2-4 kalimat) tentang isi foto dalam Bahasa Indonesia.\n` +
    `4. Jika tidak ada tulisan Jepang sama sekali, deskripsikan isi foto lalu beri 3 kosakata Jepang yang berkaitan dengan isi foto.\n` +
    `Seluruh jawaban dalam Bahasa Indonesia.`;

  const controller = new AbortController();
  const timeoutMs = parseInt(process.env.GROQ_TIMEOUT_MS || '40000', 10);
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(GROQ_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
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
        max_tokens: 900
      })
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error(`[AI-VISION] Groq error ${res.status}: ${body.slice(0, 200)}`);
      return null;
    }
    const data = await res.json();
    const text = data && data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content
      : null;
    return (text || '').trim() || null;
  } catch (e) {
    console.error('[AI-VISION] Groq request gagal:', e.name === 'AbortError' ? 'timeout' : e.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
