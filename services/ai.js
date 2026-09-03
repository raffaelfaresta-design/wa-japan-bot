// Groq AI client (OpenAI-compatible) + fallback lokal.
// Tidak butuh dependency tambahan: memakai global fetch (Node >= 18).

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const DEFAULT_MODEL = 'llama-3.3-70b-versatile';

function isAIEnabled() {
  return Boolean(process.env.GROQ_API_KEY && process.env.GROQ_API_KEY.trim());
}

function getModel() {
  return (process.env.GROQ_MODEL || DEFAULT_MODEL).trim();
}

const SYSTEM_PROMPT = `Kamu adalah Sensei AI, pengajar bahasa Jepang yang ramah untuk orang Indonesia.
Aturan:
- Jawab SELALU dalam Bahasa Indonesia (kecuali contoh bahasa Jepang + romaji + arti).
- singing: setiap kosakata/frasa Jepang wajib disertai cara baca romaji dan arti Indonesia.
- Jawaban ringkas tapi lengkap, cocok dibaca di chat Telegram (maksimal ~700 kata).
- Jika pertanyaan di luar bahasa Jepang, tetap jawab dengan baik lalu kaitkan kembali ke belajar bahasa Jepang bila relevan.
- Jika diberi KONTEKS MATERI, prioritaskan isinya agar konsisten dengan kurikulum, tapi boleh menambah penjelasan sendiri.`;

async function askGroq(question, lessonContext = '') {
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
        temperature: 0.7,
        max_tokens: 900
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

module.exports = { isAIEnabled, getModel, askGroq };
