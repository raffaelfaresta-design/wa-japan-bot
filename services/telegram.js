const { Telegraf } = require('telegraf');
const db = require('../database/db');

let bot = null;

function startTelegram(botToken) {
  if (!botToken) {
    console.log('[TELEGRAM] Tidak ada TELEGRAM_BOT_TOKEN, skip Telegram bot.');
    return null;
  }

  bot = new Telegraf(botToken);

  bot.start((ctx) => {
    ctx.reply(`🎌 Selamat datang di Saluran Belajar Bahasa Jepang!\n\nGunakan perintah berikut:\n/belajar - Lihat pelajaran hari ini\n/quiz - Lihat quiz hari ini\n/jawaban - Lihat jawaban quiz hari ini\n/progres - Lihat progress belajar\n/help - Bantuan`);
  });

  bot.command('belajar', async (ctx) => {
    const dayNumber = getCurrentDayNumberTelegram();
    const lesson = db.getLessonByDay(dayNumber);
    if (lesson) {
      const options = JSON.parse(lesson.quiz_options);
      const text = buildTelegramLesson(lesson, options);
      await ctx.reply(text, { parse_mode: 'Markdown' });
    } else {
      ctx.reply('📭 Pelajaran hari ini belum tersedia.');
    }
  });

  bot.command('quiz', async (ctx) => {
    const dayNumber = getCurrentDayNumberTelegram();
    const lesson = db.getLessonByDay(dayNumber);
    if (lesson) {
      const options = JSON.parse(lesson.quiz_options);
      let text = `*📝 QUIZ HARI ${lesson.day_number}*\n\n${lesson.quiz_question}\n\n`;
      options.forEach((opt, i) => { text += `${opt}\n`; });
      await ctx.reply(text, { parse_mode: 'Markdown' });
    } else {
      ctx.reply('📭 Quiz hari ini belum tersedia.');
    }
  });

  bot.command('jawaban', async (ctx) => {
    const dayNumber = getCurrentDayNumberTelegram();
    const lesson = db.getLessonByDay(dayNumber);
    if (lesson) {
      const options = JSON.parse(lesson.quiz_options);
      const text = buildTelegramAnswer(lesson, options);
      await ctx.reply(text, { parse_mode: 'Markdown' });
    } else {
      ctx.reply('📭 Jawaban belum tersedia.');
    }
  });

  bot.command('progres', async (ctx) => {
    const chatId = ctx.chat.id.toString();
    const dayNumber = getCurrentDayNumberTelegram();
    const progress = db.getUserProgress(chatId, dayNumber);
    const totalLessons = db.getLessons().length;
    ctx.reply(`📊 *Progress Belajar Anda*\n\nHari ini: Hari ke-${dayNumber}\nStatus: ${progress ? progress.status : 'belum mulai'}\nTotal pelajaran: ${totalLessons}\n\nTerus belajar! 🇯🇵`, { parse_mode: 'Markdown' });
  });

  bot.command('help', (ctx) => {
    ctx.reply(`📖 *Bantuan*\n\n/belajar - Lihat pelajaran hari ini\n/quiz - Lihat quiz hari ini\n/jawaban - Lihat jawaban quiz\n/progres - Lihat progress belajar\n/help - Menampilkan bantuan\n\nBot ini mengajarkan bahasa Jepang menggunakan Bahasa Indonesia. Selamat belajar! 🎌`, { parse_mode: 'Markdown' });
  });

  bot.launch();
  console.log('[TELEGRAM] 🤖 Telegram bot aktif!');
  return bot;
}

function getCurrentDayNumberTelegram() {
  const now = new Date();
  const startOfYear = new Date(now.getFullYear(), 0, 0);
  const diff = now - startOfYear;
  const oneDay = 1000 * 60 * 60 * 24;
  const dayInYear = Math.floor(diff / oneDay);
  return (dayInYear % 30) + 1;
}

function buildTelegramLesson(lesson, options) {
  return `*🎌 PELAJARAN HARI ${lesson.day_number}*\n\n📖 *${lesson.title}*\n\n${lesson.content}\n\n📝 *QUIZ:*\n${lesson.quiz_question}\n${options.join('\n')}`;
}

function buildTelegramAnswer(lesson, options) {
  return `*🎌 JAWABAN QUIZ HARI ${lesson.day_number}*\n\n✅ *Jawaban Benar: ${lesson.quiz_answer}*\n\n📖 *Penjelasan:*\n${lesson.explanation}`;
}

module.exports = { startTelegram, bot };