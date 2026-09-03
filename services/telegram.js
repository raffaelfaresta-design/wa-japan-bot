const { Telegraf } = require('telegraf');
const fs = require('fs');
const path = require('path');
const db = require('../database/db');
const { isAIEnabled, getModel, getVisionModel, askGroq, describeImage } = require('./ai');
const BOT_VERSION = require('../package.json').version;

let bot = null;
let broadcastTimer = null;

const MAX_TG_LEN = 4000;
const MAX_TG_CAPTION = 950; // batas caption foto Telegram 1024, sisakan margin
const MAX_PHOTO_BYTES = 15 * 1024 * 1024; // limit Groq 20MB, jaga-jaga
let broadcastPhotoTurn = false;
const STOPWORDS = new Set(['apa', 'yang', 'itu', 'ini', 'dan', 'atau', 'bagaimana', 'gimana', 'cara', 'tolong', 'jelaskan', 'jelasin', 'artinya', 'arti', 'adalah', 'dalam', 'bahasa', 'jepang', 'nya', 'saya', 'kamu', 'apa?', 'ya', 'kah', 'dong', 'sih', 'deh', 'the', 'a', 'an', 'of', 'to', 'in']);

function truncate(text, max = MAX_TG_LEN) {
  if (!text) return text;
  if (text.length <= max) return text;
  return text.slice(0, max - 3) + '...';
}

function getCurrentDayNumber() {
  const now = new Date();
  const startOfYear = new Date(now.getFullYear(), 0, 0);
  const diff = now - startOfYear;
  const oneDay = 1000 * 60 * 60 * 24;
  const dayInYear = Math.floor(diff / oneDay);
  return (dayInYear % 30) + 1;
}

function safeOptions(lesson) {
  try {
    return JSON.parse(lesson.quiz_options);
  } catch (e) {
    return [];
  }
}

function buildLessonMessage(lesson, options) {
  let text = `🎌 PELAJARAN HARI ${lesson.day_number}\n\n📖 ${lesson.title}\n\n${lesson.content}\n\n📝 QUIZ:\n${lesson.quiz_question}\n`;
  (options || []).forEach((opt) => { text += `${opt}\n`; });
  text += `\n💡 Balas dengan A / B / C / D untuk menjawab quiz, saya akan koreksi otomatis!`;
  return truncate(text);
}

function buildQuizMessage(lesson, options) {
  let text = `📝 QUIZ HARI ${lesson.day_number}\n\n${lesson.quiz_question}\n\n`;
  (options || []).forEach((opt) => { text += `${opt}\n`; });
  text += `\nBalas dengan A / B / C / D ya, nanti saya koreksi.`;
  return truncate(text);
}

function buildAnswerMessage(lesson) {
  return truncate(`🎌 JAWABAN QUIZ HARI ${lesson.day_number}\n\n✅ Jawaban Benar: ${lesson.quiz_answer}\n\n📖 Penjelasan:\n${lesson.explanation}`);
}

function tokenize(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[?!.。,、！？「」"'\-—:;()]/g, ' ')
    .split(/\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 1 && !STOPWORDS.has(s));
}

// ---- kamus lokal (fallback saat AI mati) ----
let KAMUS = null;
function loadKamus() {
  if (KAMUS) return KAMUS;
  try {
    KAMUS = JSON.parse(fs.readFileSync(path.join(__dirname, '../content/kamus.json'), 'utf8'));
  } catch (e) {
    KAMUS = [];
  }
  return KAMUS;
}

// "apa arti anakku?" / "bahasa jepangnya terima kasih" / "kucing artinya apa" -> entri kamus
function lookupKamus(query) {
  let key = (query || '').toLowerCase().replace(/[?!.。、！？「」"'—:;()]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!key) return null;
  key = key
    .replace(/^(tolong\s+)?(jelaskan|jelasin|artikan|terjemahkan)\s+/, '')
    .replace(/^(apa|apakah)\s+(arti|artinya|itu|ini|maksud|yang dimaksud)\s+(dari\s+)?/, '')
    .replace(/^(arti|artinya|itu|ini)\s+(dari\s+)?/, '')
    .replace(/^apa\s+/, '')
    .replace(/^(cara\s+baca|bacaan|tulisan)\s+/, '')
    .replace(/^(bahasa\s+jepangnya|jepangnya)\s+/, '')
    .replace(/\s+(artinya|arti)\s+(apa|dong|ya)?$/, '')
    .replace(/\s+(dalam\s+)?bahasa\s+jepang$/, '')
    .replace(/\s+(apa|dong|ya|sih)$/, '')
    .trim();
  if (!key) return null;
  const kamus = loadKamus();
  // 1. cocok persis alias
  for (const e of kamus) {
    if ((e.id || []).some(a => a.toLowerCase() === key)) return e;
  }
  // 2. kunci terkandung utuh sebagai kata
  for (const e of kamus) {
    for (const a of (e.id || [])) {
      const alias = a.toLowerCase();
      if (key === alias || key.startsWith(alias + ' ') || key.endsWith(' ' + alias) || key.includes(' ' + alias + ' ')) return e;
    }
  }
  return null;
}

function formatKamusAnswer(entry, original) {
  let text = `💡 KAMUS\n\n"${original}" dalam bahasa Jepang:\n\n${entry.jp}`;
  if (entry.romaji) text += ` (${entry.romaji})`;
  text += `\n= ${entry.arti}`;
  if (entry.note) text += `\n\n📌 ${entry.note}`;
  text += `\n\nMau latihan? Kirim /quiz lalu balas A/B/C/D. Tanya lain? /tanya saja.`;
  return truncate(text);
}

// ---- deteksi jawaban quiz yang toleran ----
// Terima: "B", "b.", "B)", "jawaban C", "jawabannya a", "aku pilih D", bahkan teks opsinya.
function extractQuizLetter(text, lesson) {
  const t = (text || '').trim();
  if (!t || t.length > 80) return null;

  const cleaned = t.toUpperCase().replace(/[\s.!?)"'\]}>]+$/g, '').replace(/^[\s([{<"']+/g, '');
  if (/^[A-D]$/.test(cleaned)) return cleaned;

  const m = t.match(/jawab\w*\s*(nya|an)?\s*[:\-]?\s*([A-D])/i)
    || t.match(/pilih(an)?\s*[:\-]?\s*([A-D])/i)
    || t.match(/\bno\.?\s*([A-D])\b/i);
  if (m) {
    const letter = ((m[2] || m[1]) || '').toUpperCase();
    if (/^[A-D]$/.test(letter)) return letter;
  }

  // cocok dengan teks opsi, mis. user balas "おはようございます" -> huruf opsinya
  if (lesson) {
    const norm = t.toLowerCase();
    for (const opt of safeOptions(lesson)) {
      const om = String(opt).match(/^\s*([A-D])\s*[).\-:]\s*(.+)$/i);
      if (om && om[2].trim().toLowerCase() === norm) return om[1].toUpperCase();
    }
  }
  return null;
}

// ---- AI pengajar sederhana berbasis lessons.json ----
function searchLessons(query, limit = 3) {
  const lessons = db.getLessons();
  if (!lessons || lessons.length === 0) return [];
  const terms = tokenize(query);
  const raw = (query || '').toLowerCase();

  // 1. cocok langsung karakter jepang / romaji di konten
  const scored = lessons.map((lesson) => {
    const hay = `${lesson.title}\n${lesson.content}\n${lesson.quiz_question}\n${lesson.explanation}`.toLowerCase();
    let score = 0;
    for (const t of terms) {
      if (hay.includes(t)) score += t.length > 4 ? 3 : 2;
    }
    // bonus kalau query mengandung kata kunci kategori
    if (raw.includes('hiragana') && (lesson.category || '').includes('hiragana')) score += 3;
    if (raw.includes('katakana') && (lesson.category || '').includes('katakana')) score += 3;
    if (raw.includes('angka') && hay.includes('angka')) score += 2;
    if (raw.includes('sapaan') && hay.includes('konnichiwa')) score += 2;
    return { lesson, score };
  }).filter(r => r.score > 0);

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(r => r.lesson);
}

function buildLessonContext(hits) {
  if (!hits || hits.length === 0) return '';
  return hits.slice(0, 2).map(h => {
    const snippet = h.content.length > 1200 ? h.content.slice(0, 1200) + '...' : h.content;
    return `[Hari ${h.day_number} - ${h.title}]\n${snippet}\nPenjelasan: ${h.explanation}`;
  }).join('\n\n');
}

function answerQuestionLocal(query) {
  const q = (query || '').trim();
  const ql = q.toLowerCase();

  if (!q) {
    return '❓ Tulis pertanyaanmu setelah /tanya ya.\nContoh: /tanya apa arti konnichiwa?';
  }

  // sapaan ringan
  if (/^(halo|hai|hello|hei|pagi|siang|sore|malam|konnichiwa|ohayou|konbanwa)/.test(ql)) {
    return '👋 Halo! Saya asisten bahasa Jepang kamu. Tanya apa saja, misalnya:\n• /tanya apa arti arigatou?\n• /tanya cara baca し\n• /tanya bedanya hiragana dan katakana\n\nAtau kirim /belajar untuk pelajaran hari ini.';
  }
  if (ql.includes('terima kasih') || ql.includes('makasih') || ql.includes('arigatou')) {
    return '😊 Sama-sama! Dalam bahasa Jepang: どういたしまして (Douitashimashite) = sama-sama.\n\nMau lanjut? Coba /tanya apa arti sumimasen?';
  }
  if (ql.includes('siapa kamu') || ql.includes('kamu siapa')) {
    return '🤖 Saya bot AI pengajar bahasa Jepang (berbasis 30 hari materi). Saya bisa:\n1. Menjawab pertanyaan kosakata & grammar\n2. Mengoreksi jawaban quiz kamu\n3. Mengirim kosakata baru setiap 1 jam\n\nCoba: /belajar atau /tanya apa itu partikel wa?';
  }

  // 1. kamus kata sehari-hari (anakku, terima kasih, kucing, ...)
  const kamusHit = lookupKamus(q);
  if (kamusHit) return formatKamusAnswer(kamusHit, q);

  const hits = searchLessons(q, 3);
  if (hits.length === 0) {
    return `🤔 Hmm, saya belum menemukan jawaban pasti untuk: "${q}"\n\n` +
      `Kemungkinan saya jalan dalam MODE LOKAL (tanpa AI). Cek dengan /ai — kalau AI mati, minta admin mengisi GROQ_API_KEY.\n\n` +
      `Sementara itu coba kata lain, misalnya:\n• /tanya apa arti anakku?\n• /tanya sapaan pagi\n• /tanya hiragana shi\n\nAtau buka /belajar untuk materi hari ini.`;
  }

  const top = hits[0];
  let text = `💡 JAWABAN\n\nBerdasarkan Hari ${top.day_number} - ${top.title}:\n\n`;
  // potong konten agar tidak terlalu panjang, ambil 900 karakter pertama yg relevan
  const snippet = top.content.length > 900 ? top.content.slice(0, 900) + '...' : top.content;
  text += `${snippet}\n\n📖 Penjelasan quiz terkait:\n${top.explanation}`;
  if (hits.length > 1) {
    text += `\n\n🔗 Terkait juga: ${hits.slice(1).map(h => `Hari ${h.day_number} (${h.title})`).join(', ')}. Buka dengan /belajar.`;
  }
  text += `\n\nMau latihan? Kirim /quiz lalu balas A/B/C/D.`;
  return truncate(text);
}

// Jawab pertanyaan apa pun: pakai Groq AI bila API key tersedia,
// fallback ke jawaban lokal berbasis materi bila AI mati/gagal.
async function answerQuestion(query) {
  const q = (query || '').trim();
  if (!q) {
    return '❓ Tulis pertanyaanmu setelah /tanya ya.\nContoh: /tanya apa arti konnichiwa?';
  }
  if (isAIEnabled()) {
    const hits = searchLessons(q, 2);
    const aiAnswer = await askGroq(q, buildLessonContext(hits));
    if (aiAnswer) return truncate('🤖 ' + aiAnswer);
    // AI gagal -> lanjut ke fallback lokal di bawah
  }
  return answerQuestionLocal(q);
}

// ---- cek jawaban quiz: benar/salah deterministik, penjelasan berjiwa AI ----
function buildQuizFeedbackLocal({ lesson, userLetter, isCorrect, correct, stats }) {
  if (isCorrect) {
    return `✅ BENAR! Hebat! 🎉\n\nJawaban kamu ${userLetter} tepat.\n\n📖 ${lesson.explanation}\n\n📊 Skor kamu: ${stats.correct} benar dari ${stats.answered} quiz.\nLanjut /belajar untuk materi berikutnya!`;
  }
  return `❌ Kurang tepat. Kamu jawab ${userLetter}, jawaban benar: ${correct}.\n\n📖 ${lesson.explanation}\n\n📊 Skor kamu: ${stats.correct} benar dari ${stats.answered} quiz.\nSemangat, coba /quiz lagi besok ya! 💪`;
}

async function handleQuizAnswer(ctx, rawLetter) {
  const chatId = ctx.chat.id.toString();
  const dayNumber = getCurrentDayNumber();
  const lesson = db.getLessonByDay(dayNumber);

  if (!lesson) {
    await ctx.reply('📭 Quiz hari ini belum tersedia.');
    return;
  }

  // normalisasi di sini juga agar tahan terhadap input mentah apa pun
  const letter = extractQuizLetter(rawLetter, lesson) || (rawLetter || '').trim().toUpperCase();
  if (!/^[A-D]$/.test(letter)) {
    await ctx.reply('❓ Saya tidak menangkap jawabanmu. Balas dengan A, B, C, atau D ya.');
    return;
  }

  const options = safeOptions(lesson);
  const correct = (lesson.quiz_answer || '').toUpperCase();
  const isCorrect = letter === correct;
  db.upsertUserProgress(chatId, dayNumber, isCorrect ? 'correct' : 'wrong', isCorrect ? 1 : 0);
  db.setUserState(chatId, { mode: 'normal', lastQuizDay: dayNumber });

  const stats = db.getUserQuizStats(chatId);
  const local = buildQuizFeedbackLocal({ lesson, userLetter: letter, isCorrect, correct, stats });

  // AI meresuki quiz: bila aktif, biarkan AI menyusun pesan koreksinya
  if (isAIEnabled()) {
    const quizCtx = `Quiz Hari ${lesson.day_number}: ${lesson.quiz_question}\nPilihan:\n${options.join('\n')}\nJawaban benar: ${correct}\nJawaban murid: ${letter} (${isCorrect ? 'BENAR' : 'SALAH'})\nPenjelasan kunci: ${lesson.explanation}\nSkor murid sejauh ini: ${stats.correct} benar dari ${stats.answered} quiz.`;
    const aiMsg = await askGroq(
      'Koreksi jawaban quiz murid di atas. Sebutkan benar/salah dengan jelas, jelaskan singkat kenapa, beri semangat 1 kalimat, dan tutup dengan skornya. Maksimal 5 kalimat, Bahasa Indonesia.',
      quizCtx,
      { maxTokens: 300, temperature: 0.8 }
    );
    if (aiMsg) {
      await ctx.reply(truncate((isCorrect ? '✅ ' : '❌ ') + aiMsg));
      return;
    }
  }
  await ctx.reply(truncate(local));
}

// ---- ekstrak kosakata untuk broadcast per jam ----
function extractVocabularies() {
  const lessons = db.getLessons();
  const out = [];
  const seen = new Set();
  for (const lesson of lessons) {
    const content = lesson.content || '';
    // pola: • jepang (romaji) = arti
    const re1 = /•\s*([^()\n=•]+?)\s*\(([^)\n]+)\)\s*=\s*([^\n]+)/g;
    let m;
    while ((m = re1.exec(content)) !== null) {
      const jepang = m[1].trim();
      const romaji = m[2].trim();
      const arti = m[3].trim();
      const key = jepang + '|' + arti;
      if (!seen.has(key) && jepang && arti) {
        seen.add(key);
        out.push({ jepang, romaji, arti, day: lesson.day_number, title: lesson.title });
      }
    }
    // pola: kana = arti (tanpa bullet), contoh: あ = a
    const re2 = /^([ぁ-んァ-ヶ一-龯ー]+)\s*=\s*([^\n=]+)$/gm;
    while ((m = re2.exec(content)) !== null) {
      const jepang = m[1].trim();
      const arti = m[2].trim();
      const key = jepang + '|' + arti;
      if (!seen.has(key) && jepang.length <= 8 && arti.length <= 60) {
        seen.add(key);
        out.push({ jepang, romaji: '', arti, day: lesson.day_number, title: lesson.title });
      }
    }
  }
  return out;
}

function buildVocabMessage(v) {
  const romajiPart = v.romaji ? ` (${v.romaji})` : '';
  return truncate(
    `📚 KOSAKATA PER JAM 🇯🇵\n\n${v.jepang}${romajiPart}\nArtinya: ${v.arti}\n\n📖 Dari Hari ${v.day} - ${v.title}\n\n💬 Tanya saya: /tanya apa arti ${v.jepang}?\n📝 Latihan: /quiz`
  );
}

async function broadcastVocab(botInstance) {
  try {
    const subs = db.getActiveSubscribers();
    if (subs.length === 0) return;

    // selang-seling: giliran foto (dari pool foto user) vs teks (dari materi)
    const photos = db.getPhotoVocab();
    broadcastPhotoTurn = !broadcastPhotoTurn;
    if (broadcastPhotoTurn && photos.length > 0) {
      const pick = photos[Math.floor(Math.random() * photos.length)];
      const caption = truncate(`📚 KOSAKATA DARI FOTO 🇯🇵\n\n${pick.caption}\n\n💬 Kirim foto tulisan Jepang apa pun, saya bacakan! /foto`, MAX_TG_CAPTION);
      let sent = 0;
      for (const s of subs) {
        try {
          await botInstance.telegram.sendPhoto(s.chat_id, pick.file_id, { caption });
          sent++;
          await new Promise(r => setTimeout(r, 300));
        } catch (e) { /* abaikan user yg block / file kedaluwarsa */ }
      }
      console.log(`[BROADCAST] Foto kosakata terkirim ke ${sent} subscriber.`);
      return;
    }

    const vocabs = extractVocabularies();
    if (vocabs.length === 0) return;
    const pick = vocabs[Math.floor(Math.random() * vocabs.length)];
    const msg = buildVocabMessage(pick);
    for (const s of subs) {
      try {
        await botInstance.telegram.sendMessage(s.chat_id, msg);
        // jeda kecil agar tidak kena rate limit
        await new Promise(r => setTimeout(r, 300));
      } catch (e) {
        // abaikan user yg block bot
      }
    }
    console.log(`[BROADCAST] Kosakata terkirim ke ${subs.length} subscriber: ${pick.jepang}`);
  } catch (e) {
    console.error('[BROADCAST] gagal:', e.message);
  }
}

function startHourlyBroadcast(botInstance) {
  if (broadcastTimer) clearInterval(broadcastTimer);
  const minutes = parseInt(process.env.BROADCAST_INTERVAL_MINUTES || '60', 10);
  const ms = Math.max(1, minutes) * 60 * 1000;
  // kirim langsung 10 detik setelah start agar user langsung dapat contoh (opsional via env)
  if (process.env.BROADCAST_ON_START === '1') {
    setTimeout(() => broadcastVocab(botInstance), 10000);
  }
  broadcastTimer = setInterval(() => broadcastVocab(botInstance), ms);
  console.log(`[BROADCAST] Aktif tiap ${minutes} menit.`);
}

function ensureSubscriber(ctx) {
  try {
    const chatId = ctx.chat.id.toString();
    const name = [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' ') || ctx.from.username || '';
    db.addSubscriber(chatId, name);
  } catch (e) { /* abaikan */ }
}

function startTelegram(botToken) {
  if (!botToken) {
    console.log('[TELEGRAM] TELEGRAM_BOT_TOKEN belum diisi. Skip Telegram bot.');
    return null;
  }

  bot = new Telegraf(botToken);

  bot.start((ctx) => {
    ensureSubscriber(ctx);
    db.setUserState(ctx.chat.id.toString(), { mode: 'normal' });
    const aiLine = isAIEnabled()
      ? `🤖 Mode AI AKTIF (${getModel()}) — tanya apa pun, saya jawab!`
      : '🤖 Mode lokal — tambah GROQ_API_KEY agar saya bisa jawab pertanyaan apa pun.';
    ctx.reply(
      '🎌 Selamat datang di AI Pengajar Bahasa Jepang!\n\n' +
      aiLine + '\n\n' +
      'Saya bisa:\n' +
      '1. 📖 /belajar - pelajaran hari ini\n' +
      '2. 📝 /quiz - quiz hari ini (balas A/B/C/D, saya koreksi otomatis)\n' +
      '3. ❓ /tanya <pertanyaan> - tanya kosakata / grammar / apa saja\n' +
      '4. 📸 Kirim FOTO tulisan Jepang - saya bacakan + ekstrak kosakatanya\n' +
      '5. 📚 Broadcast kosakata otomatis tiap 1 jam (teks + foto)\n\n' +
      'Contoh:\n/tanya apa arti konnichiwa?\n/quiz'
    );
  });

  bot.command('belajar', async (ctx) => {
    ensureSubscriber(ctx);
    const dayNumber = getCurrentDayNumber();
    const lesson = db.getLessonByDay(dayNumber);
    if (lesson) {
      // pesan belajar memuat quiz -> masuk mode quiz agar jawaban longgar ikut terkoreksi
      db.setUserState(ctx.chat.id.toString(), { mode: 'quiz', lastQuizDay: dayNumber });
      await ctx.reply(buildLessonMessage(lesson, safeOptions(lesson)));
    } else {
      await ctx.reply('📭 Pelajaran hari ini belum tersedia. Coba lagi sebentar ya.');
    }
  });

  bot.command('quiz', async (ctx) => {
    ensureSubscriber(ctx);
    const dayNumber = getCurrentDayNumber();
    const lesson = db.getLessonByDay(dayNumber);
    if (lesson) {
      db.setUserState(ctx.chat.id.toString(), { mode: 'quiz', lastQuizDay: dayNumber });
      await ctx.reply(buildQuizMessage(lesson, safeOptions(lesson)));
    } else {
      await ctx.reply('📭 Quiz hari ini belum tersedia.');
    }
  });

  bot.command('jawaban', async (ctx) => {
    ensureSubscriber(ctx);
    const dayNumber = getCurrentDayNumber();
    const lesson = db.getLessonByDay(dayNumber);
    if (lesson) {
      await ctx.reply(buildAnswerMessage(lesson));
    } else {
      await ctx.reply('📭 Jawaban belum tersedia.');
    }
  });

  bot.command('progres', async (ctx) => {
    ensureSubscriber(ctx);
    const chatId = ctx.chat.id.toString();
    const dayNumber = getCurrentDayNumber();
    const progress = db.getUserProgress(chatId, dayNumber);
    const stats = db.getUserQuizStats(chatId);
    const totalLessons = db.getLessons().length;
    await ctx.reply(
      `📊 Progress Belajar Anda\n\nHari ini: Hari ke-${dayNumber}\n` +
      `Status hari ini: ${progress ? progress.status : 'belum mulai'}\n` +
      `Quiz: ${stats.correct} benar / ${stats.answered} dijawab\n` +
      `Total pelajaran: ${totalLessons}\n\nTerus belajar! 🇯🇵`
    );
  });

  // mode tanya: /tanya <pertanyaan> langsung jawab, /tanya saja = masuk mode tanya
  bot.command('tanya', async (ctx) => {
    ensureSubscriber(ctx);
    const chatId = ctx.chat.id.toString();
    const full = ctx.message.text || '';
    const question = full.replace(/^\/tanya(@\w+)?\s*/, '').trim();
    if (question) {
      await ctx.reply(await answerQuestion(question));
    } else {
      db.setUserState(chatId, { mode: 'qa' });
      await ctx.reply(
        '❓ Mode TANYA aktif. Silakan ketik pertanyaan bahasa Jepang kamu.\n' +
        'Contoh: apa arti arigatou? / cara baca し?\n\nKetik /selesai untuk keluar dari mode tanya.'
      );
    }
  });

  bot.command('selesai', async (ctx) => {
    db.setUserState(ctx.chat.id.toString(), { mode: 'normal' });
    await ctx.reply('✅ Keluar dari mode tanya. Kirim /belajar untuk lanjut belajar!');
  });
  bot.command('batal', async (ctx) => {
    db.setUserState(ctx.chat.id.toString(), { mode: 'normal' });
    await ctx.reply('✅ Mode direset. Kirim /help untuk daftar perintah.');
  });

  // diagnostik: pastikan AI aktif & bot versi terbaru
  bot.command('ai', async (ctx) => {
    const lessons = db.getLessons().length;
    const photos = db.getPhotoVocab().length;
    await ctx.reply(
      `🤖 STATUS AI\n\n` +
      `Mode: ${isAIEnabled() ? 'AKTIF ✅ (Groq)' : 'LOKAL ⚠️ (GROQ_API_KEY belum diisi)'}\n` +
      `Model teks: ${getModel()}\n` +
      `Model vision: ${getVisionModel()}\n` +
      `Materi: ${lessons} pelajaran\n` +
      `Pool foto: ${photos} foto\n` +
      `Versi bot: v${BOT_VERSION}\n\n` +
      (isAIEnabled()
        ? 'AI meresuki semuanya: /tanya, chat bebas, koreksi quiz, dan baca foto. Silakan uji saya! 💪'
        : 'Agar saya bisa jawab apa pun + koreksi berjiwa AI + baca foto, minta admin mengisi GROQ_API_KEY lalu restart bot.')
    );
  });

  bot.command(['help', 'bantuan'], (ctx) => {
    ctx.reply(
      '📖 Bantuan\n\n' +
      '/belajar - pelajaran hari ini\n' +
      '/quiz - quiz hari ini (balas A/B/C/D)\n' +
      '/jawaban - kunci jawaban hari ini\n' +
      '/tanya <pertanyaan> - tanya AI pengajar\n' +
      '/ai - cek status AI & versi bot\n' +
      '/foto - cara kirim foto tulisan Jepang untuk dibacakan\n' +
      '/progres - progress & skor quiz\n' +
      '/selesai - keluar mode tanya\n' +
      '/help - bantuan ini\n\n' +
      'Tips: setelah /quiz, cukup balas "B" saja, saya koreksi otomatis. Kirim foto + caption pertanyaan juga bisa! Bot kirim kosakata baru tiap 1 jam. 🎌'
    );
  });

  // handler teks: 1) jawaban quiz, 2) mode tanya, 3) pertanyaan/AI, 4) hint
  bot.on('text', async (ctx) => {
    ensureSubscriber(ctx);
    const text = (ctx.message.text || '').trim();
    if (!text) return;
    if (text.startsWith('/')) return; // command sudah ditangani di atas

    const chatId = ctx.chat.id.toString();
    const state = db.getUserState(chatId);
    const lesson = db.getLessonByDay(getCurrentDayNumber());

    // 1. jawaban quiz (toleran: "B", "b.", "jawaban C", "aku pilih A", bahkan teks opsinya)
    let letter = extractQuizLetter(text, lesson);
    if (!letter && state && state.mode === 'quiz') {
      const loose = text.match(/\b([A-D])\b/);
      if (loose) letter = loose[1].toUpperCase();
    }
    if (letter) {
      await handleQuizAnswer(ctx, letter);
      return;
    }

    // 2. mode tanya aktif -> anggap pertanyaan
    if (state && state.mode === 'qa') {
      await ctx.reply(await answerQuestion(text));
      return;
    }

    // 3. terlihat seperti pertanyaan -> jawab langsung
    const looksQuestion = (text.length > 3 && /[?]/.test(text)) ||
      /^(apa|bagaimana|gimana|kenapa|kapan|dimana|arti|artinya|cara|jelaskan|tolong|bedanya)\b/i.test(text);
    if (looksQuestion) {
      await ctx.reply(await answerQuestion(text) + '\n\n(Ketik /tanya untuk mode tanya terus-menerus, /selesai untuk keluar.)');
      return;
    }

    // 4. AI aktif -> AI menjawab teks apa pun; mode lokal -> hint singkat
    if (isAIEnabled() && text.length > 1) {
      await ctx.reply(await answerQuestion(text));
      return;
    }
    await ctx.reply('👋 Kirim /belajar untuk materi, /quiz untuk latihan, atau /tanya <pertanyaan> untuk bertanya. /help untuk daftar lengkap.');
  });

  bot.command('foto', (ctx) => {
    ctx.reply(
      '📸 KIRIM FOTO TULISAN JEPANG\n\n' +
      'Caranya: kirim foto apa pun (menu, rambu, buku, tulisan tangan kana/kanji) langsung ke chat ini.\n' +
      `Saya bacakan pakai AI vision (${isAIEnabled() ? getVisionModel() : 'butuh GROQ_API_KEY'}) + ekstrak kosakata dasarnya (Jepang, romaji, arti).\n\n` +
      'Foto yang kamu kirim otomatis masuk pool dan ikut di-broadcast tiap 1 jam ke semua subscriber. 📚\n\n' +
      'Tips: tambah caption pertanyaan, mis. kirim foto + caption "apa artinya ini?"'
    );
  });

  // handler FOTO: baca tulisan Jepang via Groq vision -> jelaskan + simpan untuk broadcast
  bot.on('photo', async (ctx) => {
    ensureSubscriber(ctx);
    if (!isAIEnabled()) {
      await ctx.reply('📸 Saya terima fotonya, tapi fitur baca foto butuh GROQ_API_KEY. Minta admin mengisi API key dulu ya.');
      return;
    }
    const photos = ctx.message.photo || [];
    if (photos.length === 0) return;
    const best = photos[photos.length - 1]; // resolusi terbesar
    const question = (ctx.message.caption || '').trim();

    await ctx.reply('📸 Foto diterima, saya baca dulu ya... ⏳');
    try {
      const link = await ctx.telegram.getFileLink(best.file_id);
      const resp = await fetch(link.href || link.toString());
      if (!resp.ok) throw new Error(`unduh foto gagal (${resp.status})`);
      const buf = Buffer.from(await resp.arrayBuffer());
      if (buf.length > MAX_PHOTO_BYTES) {
        await ctx.reply('⚠️ Fotonya terlalu besar untuk diproses (>15MB). Coba kirim foto yang lebih kecil.');
        return;
      }
      const mime = 'image/jpeg';
      const result = await describeImage({ base64: buf.toString('base64'), mimeType: mime, question });
      if (!result) {
        await ctx.reply('😔 Maaf, saya gagal membaca foto ini. Coba lagi dengan foto yang lebih jelas.');
        return;
      }
      const total = db.addPhotoVocab({
        file_id: best.file_id,
        caption: result.length > MAX_TG_CAPTION ? result.slice(0, MAX_TG_CAPTION - 3) + '...' : result,
        from: ctx.chat.id.toString()
      });
      await ctx.reply(truncate(`📸 HASIL BACA FOTO\n\n${result}\n\n✅ Tersimpan! Foto ini ikut antri broadcast kosakata per jam (total ${total} foto di pool).`));
    } catch (e) {
      console.error('[FOTO] gagal:', e.message);
      await ctx.reply('😔 Maaf, terjadi kesalahan saat membaca foto. Coba lagi ya.');
    }
  });

  bot.launch();
  console.log('[TELEGRAM] 🤖 Telegram bot aktif!');

  startHourlyBroadcast(bot);

  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));

  return bot;
}

function getBot() {
  return bot;
}

module.exports = { startTelegram, getBot, answerQuestion, answerQuestionLocal, lookupKamus, extractQuizLetter, handleQuizAnswer, searchLessons, extractVocabularies, getCurrentDayNumber };
