const db = require('./database/db');

const chatId = process.argv[2];
const name = process.argv[3] || '';

if (!chatId) {
  console.log('Penggunaan: node add-subscriber.js <chat_id> [nama]');
  console.log('Contoh: node add-subscriber.js 6281234567890 Budi');
  process.exit(1);
}

db.addSubscriber(chatId, name);
console.log(`✅ Subscriber ditambahkan: ${chatId} (${name || 'tanpa nama'})`);
console.log(`📊 Total subscriber aktif: ${db.getSubscriberCount()}`);