const db = require('./database/db');

const dayNumber = Math.floor((new Date() - new Date(new Date().getFullYear(), 0, 0)) / (1000 * 60 * 60 * 24)) % 30 + 1;

console.log('📊 STATUS BOT TELEGRAM');
console.log('━━━━━━━━━━━━━━━━━━━━');
console.log(`📚 Total pelajaran: ${db.getLessons().length}`);
console.log(`👥 Total subscriber aktif: ${db.getSubscriberCount()}`);
console.log(`⏰ Hari ini: Pelajaran ke-${dayNumber}`);
console.log('━━━━━━━━━━━━━━━━━━━━');

const subs = db.getSubscribers();
if (subs.length > 0) {
  console.log('\n📋 Daftar Subscriber:');
  subs.forEach((s, i) => console.log(`   ${i + 1}. ${s.chat_id} (${s.name || 'tanpa nama'})`));
}