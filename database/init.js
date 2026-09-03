const fs = require('fs');
const path = require('path');
const db = require('./db');

const lessons = JSON.parse(fs.readFileSync(path.join(__dirname, '../content/lessons.json'), 'utf8'));

db.initLessons(lessons);
console.log(`✅ ${lessons.length} pelajaran berhasil dimasukkan ke database!`);