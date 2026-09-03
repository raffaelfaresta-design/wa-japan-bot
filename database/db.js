const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'bot.json');

function loadDB() {
  if (!fs.existsSync(DB_PATH)) {
    const initialData = {
      subscribers: [],
      lessons: [],
      userProgress: [],
      userStates: []
    };
    saveDB(initialData);
    return initialData;
  }
  const data = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  // migrasi field lama agar tidak crash
  if (!Array.isArray(data.subscribers)) data.subscribers = [];
  if (!Array.isArray(data.lessons)) data.lessons = [];
  if (!Array.isArray(data.userProgress)) data.userProgress = [];
  if (!Array.isArray(data.userStates)) data.userStates = [];
  // auto-init: isi pelajaran otomatis dari content/lessons.json
  // agar /belajar langsung jalan tanpa `node database/init.js`
  if (data.lessons.length === 0) {
    try {
      const lessonsRaw = JSON.parse(
        fs.readFileSync(path.join(__dirname, '../content/lessons.json'), 'utf8')
      );
      data.lessons = lessonsRaw.map(l => ({
        day_number: l.day,
        title: l.title,
        category: l.category,
        content: l.content,
        quiz_question: l.quiz_question,
        quiz_options: JSON.stringify(l.quiz_options),
        quiz_answer: l.quiz_answer,
        explanation: l.explanation
      }));
      saveDB(data);
      console.log(`[DB] Auto-init: ${data.lessons.length} pelajaran dimuat dari content/lessons.json`);
    } catch (e) {
      console.error('[DB] Auto-init gagal:', e.message);
    }
  }
  return data;
}

function saveDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

function initLessons(lessonsData) {
  const db = loadDB();
  db.lessons = lessonsData.map(l => ({
    day_number: l.day,
    title: l.title,
    category: l.category,
    content: l.content,
    quiz_question: l.quiz_question,
    quiz_options: JSON.stringify(l.quiz_options),
    quiz_answer: l.quiz_answer,
    explanation: l.explanation
  }));
  saveDB(db);
}

function getLessons() {
  return loadDB().lessons;
}

function getLessonByDay(dayNumber) {
  return loadDB().lessons.find(l => l.day_number === dayNumber) || null;
}

function getSubscribers() {
  return loadDB().subscribers;
}

function getActiveSubscribers() {
  return loadDB().subscribers.filter(s => s.is_active);
}

function findSubscriber(chatId) {
  return loadDB().subscribers.find(s => s.chat_id === chatId) || null;
}

function addSubscriber(chatId, name = '') {
  const db = loadDB();
  const existing = db.subscribers.find(s => s.chat_id === chatId);
  if (existing) {
    existing.is_active = 1;
    if (name) existing.name = name;
  } else {
    db.subscribers.push({
      chat_id: chatId,
      name: name,
      level: 'beginner',
      is_active: 1
    });
  }
  saveDB(db);
}

function removeSubscriber(chatId) {
  const db = loadDB();
  const sub = db.subscribers.find(s => s.chat_id === chatId);
  if (sub) sub.is_active = 0;
  saveDB(db);
}

function getSubscriberCount() {
  return loadDB().subscribers.filter(s => s.is_active).length;
}

function getUserProgress(chatId, dayNumber) {
  const db = loadDB();
  return db.userProgress.find(p => p.chat_id === chatId && p.day_number === dayNumber) || null;
}

function upsertUserProgress(chatId, dayNumber, status, score) {
  const db = loadDB();
  const idx = db.userProgress.findIndex(p => p.chat_id === chatId && p.day_number === dayNumber);
  if (idx >= 0) {
    db.userProgress[idx] = { chat_id: chatId, day_number: dayNumber, status, quiz_score: score };
  } else {
    db.userProgress.push({ chat_id, day_number: dayNumber, status, quiz_score: score });
  }
  saveDB(db);
}

function getAllUserProgress() {
  return loadDB().userProgress;
}

function getUserQuizStats(chatId) {
  const db = loadDB();
  const rows = db.userProgress.filter(p => p.chat_id === chatId);
  const answered = rows.length;
  const correct = rows.filter(p => p.quiz_score === 1).length;
  return { answered, correct };
}

// ---- user state (mode tanya / quiz) ----
function getUserState(chatId) {
  const db = loadDB();
  return db.userStates.find(s => s.chat_id === chatId) || { chat_id: chatId, mode: 'normal' };
}

function setUserState(chatId, patch) {
  const db = loadDB();
  const idx = db.userStates.findIndex(s => s.chat_id === chatId);
  if (idx >= 0) {
    db.userStates[idx] = { ...db.userStates[idx], ...patch, chat_id: chatId };
  } else {
    db.userStates.push({ chat_id: chatId, mode: 'normal', ...patch });
  }
  saveDB(db);
  return db.userStates.find(s => s.chat_id === chatId);
}

module.exports = {
  initLessons,
  getLessons,
  getLessonByDay,
  getSubscribers,
  getActiveSubscribers,
  findSubscriber,
  addSubscriber,
  removeSubscriber,
  getSubscriberCount,
  getUserProgress,
  upsertUserProgress,
  getAllUserProgress,
  getUserQuizStats,
  getUserState,
  setUserState
};
