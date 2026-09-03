const db = require('./database/db');

console.log('📊 STATUS BOT');
console.log('━━━━━━━━━━━━━━━━━━━━');
console.log(`📚 Total pelajaran: ${db.getLessons().length}`);
console.log(`👥 Total subscriber aktif: ${db.getSubscriberCount()}`);
console.log(`📅 Jadwal: Pukul ${process.env.LESSON_TIME || '20'}:00 WIB`);
console.log(`🤖 Mode: ${process.env.MODE || 'manual'}`);
console.log(`⏰ Hari ini: Pelajaran ke-${db.getLessons().length > 0 ? new Date().getDate() % 30 + 1 : '?'}`);
console.log('━━━━━━━━━━━━━━━━━━━━');

const subs = db.getSubscribers();
if (subs.length > 0) {
  console.log('\n📋 Daftar Subscriber:');
  subs.forEach((s, i) => console.log(`   ${i + 1}. ${s.chat_id} (${s.name || 'tanpa nama'})`));
}