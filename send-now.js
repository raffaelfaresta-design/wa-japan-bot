require('dotenv').config();
const db = require('./database/db');

const dayNumber = Math.floor((new Date() - new Date(new Date().getFullYear(), 0, 0)) / (1000 * 60 * 60 * 24)) % 30 + 1;
const lesson = db.getLessonByDay(dayNumber);

if (lesson) {
  const options = JSON.parse(lesson.quiz_options);
  console.log(`📤 Pelajaran Hari ${dayNumber}: ${lesson.title}`);
  console.log(`📖 ${lesson.content.substring(0, 200)}...`);
  console.log(`📝 Quiz: ${lesson.quiz_question}`);
  options.forEach((opt) => console.log(`   ${opt}`));
  console.log(`✅ Jawaban: ${lesson.quiz_answer}`);
  console.log(`💡 ${lesson.explanation}`);
} else {
  console.log('📭 Pelajaran hari ini belum tersedia.');
}