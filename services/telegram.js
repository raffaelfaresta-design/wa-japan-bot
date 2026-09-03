const { Telegraf } = require('telegraf');
const db = require('../database/db');

let bot = null;

function startTelegram(botToken) {
  if (!botToken) {
    console.log('[TELEGRAM] TELEGRAM_BOT_TOKEN belum diisi. Skip Telegram bot.');
    return null;
  }

  bot = new Telegraf(botToken);

  bot.start((ctx) => {
    ctx.reply('🎌 Selamat datang di Saluran Belajar Bahasa Jepang!\n\nGunakan perintah berikut:\n/belajar - Lihat pelajaran hari ini\n/quiz - Lihat quiz hari ini\n/jawaban - Lihat jawaban quiz hari ini\n/progres - Lihat progress belajar\n/help - Bantuan');
  });

  bot.command('belajar', async (ctx) => {
    const dayNumber = getCurrentDayNumber();
    const lesson = db.getLessonByDay(dayNumber);
    if (lesson) {
      const options = JSON.parse(lesson.quiz_options);
      const text = buildLessonMessage(lesson, options);
      await ctx.reply(text);
    } else {
      ctx.reply('📭 Pelajaran hari ini belum tersedia.');
    }
  });

  bot.command('quiz', async (ctx) => {
    const dayNumber = getCurrentDayNumber();
    const lesson = db.getLessonByDay(dayNumber);
    if (lesson) {
      const options = JSON.parse(lesson.quiz_options);
      let text = `📝 QUIZ HARI ${lesson.day_number}\n\n${lesson.quiz_question}\n\n`;
      options.forEach((opt) => { text += `${opt}\n`; });
      await ctx.reply(text);
    } else {
      ctx.reply('📭 Quiz hari ini belum tersedia.');
    }
  });

  bot.command('jawaban', async (ctx) => {
    const dayNumber = getCurrentDayNumber();
    const lesson = db.getLessonByDay(dayNumber);
    if (lesson) {
      const options = JSON.parse(lesson.quiz_options);
      const text = buildAnswerMessage(lesson, options);
      await ctx.reply(text);
    } else {
      ctx.reply('📭 Jawaban belum tersedia.');
    }
  });

  bot.command('progres', async (ctx) => {
    const chatId = ctx.chat.id.toString();
    const dayNumber = getCurrentDayNumber();
    const progress = db.getUserProgress(chatId, dayNumber);
    const totalLessons = db.getLessons().length;
    ctx.reply(`📊 Progress Belajar Anda\n\nHari ini: Hari ke-${dayNumber}\nStatus: ${progress ? progress.status : 'belum mulai'}\nTotal pelajaran: ${totalLessons}\n\nTerus belajar! 🇯🇵`);
  });

  bot.command('help', (ctx) => {
    ctx.reply('📖 Bantuan\n\n/belajar - Lihat pelajaran hari ini\n/quiz - Lihat quiz hari ini\n/jawaban - Lihat jawaban quiz\n/progres - Lihat progress belajar\n/help - Menampilkan bantuan\n\nBot ini mengajarkan bahasa Jepang menggunakan Bahasa Indonesia. Selamat belajar! 🎌');
  });

  bot.launch();
  console.log('[TELEGRAM] 🤖 Telegram bot aktif!');
  return bot;
}

function getCurrentDayNumber() {
  const now = new Date();
  const startOfYear = new Date(now.getFullYear(), 0, 0);
  const diff = now - startOfYear;
  const oneDay = 1000 * 60 * 60 * 24;
  const dayInYear = Math.floor(diff / oneDay);
  return (dayInYear % 30) + 1;
}

function buildLessonMessage(lesson, options) {
  let text = `🎌 PELAJARAN HARI ${lesson.day_number}\n\n📖 ${lesson.title}\n\n${lesson.content}\n\n📝 QUIZ:\n${lesson.quiz_question}\n`;
  options.forEach((opt) => { text += `${opt}\n`; });
  return text;
}

function buildAnswerMessage(lesson, options) {
  return `🎌 JAWABAN QUIZ HARI ${lesson.day_number}\n\n✅ Jawaban Benar: ${lesson.quiz_answer}\n\n📖 Penjelasan:\n${lesson.explanation}`;
}

function getBot() {
  return bot;
}

module.exports = { startTelegram, getBot };