const cron = require('node-cron');
const db = require('../database/db');
const { sendBulkMessage } = require('./whatsapp');

function getAllSubscribers() {
  return db.getActiveSubscribers().map(s => s.chat_id);
}

function getLessonByDay(dayNumber) {
  return db.getLessonByDay(dayNumber);
}

function getUserProgress(chatId, dayNumber) {
  return db.getUserProgress(chatId, dayNumber);
}

function upsertUserProgress(chatId, dayNumber, status, score) {
  db.upsertUserProgress(chatId, dayNumber, status, score);
}

function getCurrentDayNumber() {
  const now = new Date();
  const startOfYear = new Date(now.getFullYear(), 0, 0);
  const diff = now - startOfYear;
  const oneDay = 1000 * 60 * 60 * 24;
  const dayInYear = Math.floor(diff / oneDay);
  return (dayInYear % 30) + 1;
}

function getYesterdayDayNumber() {
  return getCurrentDayNumber() === 1 ? 30 : getCurrentDayNumber() - 1;
}

function buildLessonMessage(lesson) {
  const options = JSON.parse(lesson.quiz_options);
  return `🎌 *PELAJARAN BAHASA JEPANG - HARI ${lesson.day_number}*

━━━━━━━━━━━━━━━━━━━━
📖 *${lesson.title}*
━━━━━━━━━━━━━━━━━━━━

${lesson.content}

━━━━━━━━━━━━━━━━━━━━
📝 *QUIZ HARI INI*
━━━━━━━━━━━━━━━━━━━━

${lesson.quiz_question}

${options.join('\n')}

⏰ Jawaban quiz akan dikirim esok hari.

*Terus belajar! 🇯🇵*`;
}

function buildAnswerMessage(lesson) {
  const options = JSON.parse(lesson.quiz_options);
  return `🎌 *JAWABAN QUIZ - HARI ${lesson.day_number}*

━━━━━━━━━━━━━━━━━━━━
✅ *${lesson.title}*
━━━━━━━━━━━━━━━━━━━━

${lesson.quiz_question}

${options.join('\n')}

🏆 *Jawaban Benar: ${lesson.quiz_answer}*

📖 *Penjelasan:*
${lesson.explanation}

━━━━━━━━━━━━━━━━━━━━
💪 Selamat belajar! 🇯🇵`;
}

async function sendDailyLesson() {
  try {
    const dayNumber = getCurrentDayNumber();
    const lesson = getLessonByDay(dayNumber);

    if (!lesson) {
      console.log(`[SCHEDULER] Pelajaran hari ${dayNumber} tidak ditemukan.`);
      return;
    }

    const subscribers = getAllSubscribers();
    if (subscribers.length === 0) {
      console.log('[SCHEDULER] Tidak ada subscriber.');
      return;
    }

    const message = buildLessonMessage(lesson);
    await sendBulkMessage(subscribers, message);

    for (const sub of subscribers) {
      upsertUserProgress(sub, dayNumber, 'lesson_sent', 0);
    }

    console.log(`[SCHEDULER] ✅ Pelajaran HARI ${dayNumber} terkirim ke ${subscribers.length} subscriber`);
  } catch (error) {
    console.error('[SCHEDULER] Error kirim pelajaran:', error.message);
  }
}

async function sendDailyAnswer() {
  try {
    const yesterdayDay = getYesterdayDayNumber();
    const lesson = getLessonByDay(yesterdayDay);

    if (!lesson) return;

    const subscribers = getAllSubscribers();
    if (subscribers.length === 0) return;

    const message = buildAnswerMessage(lesson);
    await sendBulkMessage(subscribers, message);

    console.log(`[SCHEDULER] ✅ Jawaban QUIZ HARI ${yesterdayDay} terkirim ke ${subscribers.length} subscriber`);
  } catch (error) {
    console.error('[SCHEDULER] Error kirim jawaban:', error.message);
  }
}

function startScheduler() {
  const lessonHour = parseInt(process.env.LESSON_TIME || '20');

  cron.schedule(`0 ${lessonHour} * * *`, () => {
    console.log('[⏰] Cron: Kirim pelajaran harian...');
    sendDailyLesson();
  });

  cron.schedule(`0 ${lessonHour + 2} * * *`, () => {
    console.log('[⏰] Cron: Kirim jawaban quiz...');
    sendDailyAnswer();
  });

  console.log(`[SCHEDULER] ✅ Scheduler dimulai.`);
  console.log(`   • Pelajaran: setiap hari pukul ${lessonHour}:00 WIB`);
  console.log(`   • Jawaban quiz: pukul ${lessonHour + 2}:00 WIB`);
}

module.exports = {
  startScheduler,
  sendDailyLesson,
  sendDailyAnswer,
  getAllSubscribers,
  getLessonByDay,
  getUserProgress,
  upsertUserProgress,
  getCurrentDayNumber,
  getYesterdayDayNumber
};