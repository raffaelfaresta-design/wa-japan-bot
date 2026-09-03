const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'bot.json');

function loadDB() {
  if (!fs.existsSync(DB_PATH)) {
    const initialData = {
      subscribers: [],
      lessons: [],
      userProgress: []
    };
    saveDB(initialData);
    return initialData;
  }
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
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
  const existing = findSubscriber(chatId);
  if (existing) {
    existing.is_active = 1;
    existing.name = name;
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
  const sub = findSubscriber(chatId);
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
  getAllUserProgress
};