const { Telegraf } = require('telegraf');
const db = require('../database/db');
const { isAIEnabled, getModel, askGroq } = require('./ai');

let bot = null;
let broadcastTimer = null;

const MAX_TG_LEN = 4000;
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

  const hits = searchLessons(q, 3);
  if (hits.length === 0) {
    return `🤔 Hmm, saya belum menemukan jawaban pasti untuk: "${q}"\n\nCoba tanya dengan kata kunci lain, misalnya:\n• /tanya sapaan pagi\n• /tanya hiragana shi\n• /tanya angka dalam bahasa jepang\n\nAtau buka /belajar untuk materi hari ini.`;
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

// ---- cek jawaban quiz otomatis ----
async function handleQuizAnswer(ctx, rawLetter) {
  const letter = (rawLetter || '').toUpperCase();
  const chatId = ctx.chat.id.toString();
  const dayNumber = getCurrentDayNumber();
  const lesson = db.getLessonByDay(dayNumber);

  if (!lesson) {
    await ctx.reply('📭 Quiz hari ini belum tersedia.');
    return;
  }

  const correct = (lesson.quiz_answer || '').toUpperCase();
  const isCorrect = letter === correct;
  db.upsertUserProgress(chatId, dayNumber, isCorrect ? 'correct' : 'wrong', isCorrect ? 1 : 0);
  db.setUserState(chatId, { mode: 'normal', lastQuizDay: dayNumber });

  const stats = db.getUserQuizStats(chatId);
  if (isCorrect) {
    await ctx.reply(truncate(
      `✅ BENAR! Hebat! 🎉\n\nJawaban kamu ${letter} tepat.\n\n📖 ${lesson.explanation}\n\n📊 Skor kamu: ${stats.correct} benar dari ${stats.answered} quiz.\nLanjut /belajar untuk materi berikutnya!`
    ));
  } else {
    await ctx.reply(truncate(
      `❌ Kurang tepat. Kamu jawab ${letter}, jawaban benar: ${correct}.\n\n📖 ${lesson.explanation}\n\n📊 Skor kamu: ${stats.correct} benar dari ${stats.answered} quiz.\nSemangat, coba /quiz lagi besok ya! 💪`
    ));
  }
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
    const vocabs = extractVocabularies();
    if (vocabs.length === 0) return;
    const subs = db.getActiveSubscribers();
    if (subs.length === 0) return;
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
      '4. 📚 Broadcast kosakata otomatis tiap 1 jam\n\n' +
      'Contoh:\n/tanya apa arti konnichiwa?\n/quiz'
    );
  });

  bot.command('belajar', async (ctx) => {
    ensureSubscriber(ctx);
    const dayNumber = getCurrentDayNumber();
    const lesson = db.getLessonByDay(dayNumber);
    if (lesson) {
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

  bot.command(['help', 'bantuan'], (ctx) => {
    ctx.reply(
      '📖 Bantuan\n\n' +
      '/belajar - pelajaran hari ini\n' +
      '/quiz - quiz hari ini (balas A/B/C/D)\n' +
      '/jawaban - kunci jawaban hari ini\n' +
      '/tanya <pertanyaan> - tanya AI pengajar\n' +
      '/progres - progress & skor quiz\n' +
      '/selesai - keluar mode tanya\n' +
      '/help - bantuan ini\n\n' +
      'Tips: setelah /quiz, cukup balas "B" saja, saya koreksi otomatis. Bot juga kirim kosakata baru tiap 1 jam. 🎌'
    );
  });

  // handler teks: 1) jawaban quiz A-D, 2) mode tanya, 3) abaikan
  bot.on('text', async (ctx) => {
    ensureSubscriber(ctx);
    const text = (ctx.message.text || '').trim();
    if (!text) return;
    if (text.startsWith('/')) return; // command sudah ditangani di atas

    // 1. jawaban quiz satu huruf
    if (/^[a-dA-D]$/.test(text)) {
      await handleQuizAnswer(ctx, text);
      return;
    }

    // 2. mode tanya aktif -> anggap pertanyaan
    const chatId = ctx.chat.id.toString();
    const state = db.getUserState(chatId);
    if (state && state.mode === 'qa') {
      await ctx.reply(await answerQuestion(text));
      return;
    }

    // 3. di luar mode: kalau terlihat seperti pertanyaan, jawab sekalian
    if (text.length > 3 && /[?]/.test(text) || /^(apa|bagaimana|gimana|kenapa|kapan|dimana|arti|artinya|cara|jelaskan|tolong|bedanya)\b/i.test(text)) {
      await ctx.reply(await answerQuestion(text) + '\n\n(Ketik /tanya untuk mode tanya terus-menerus, /selesai untuk keluar.)');
      return;
    }
    // selain itu diamkan agar tidak spam; beri hint singkat
    await ctx.reply('👋 Kirim /belajar untuk materi, /quiz untuk latihan, atau /tanya <pertanyaan> untuk bertanya. /help untuk daftar lengkap.');
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

module.exports = { startTelegram, getBot, answerQuestion, searchLessons, extractVocabularies, getCurrentDayNumber };
