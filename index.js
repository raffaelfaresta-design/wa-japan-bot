require('dotenv').config();
const { connectWhatsApp } = require('./services/whatsapp');
const { startScheduler, getSubscriberCount } = require('./services/scheduler');
const { startTelegram } = require('./services/telegram');

async function main() {
  console.log('🚀 Memulai WhatsApp Japan Bot...');
  console.log(`⏰ Jadwal pelajaran: Pukul ${process.env.LESSON_TIME || '20'}:00 WIB`);
  console.log(`📊 Mode: ${process.env.MODE || 'manual'}`);

  await connectWhatsApp();
  startTelegram(process.env.TELEGRAM_BOT_TOKEN);

  setTimeout(() => {
    startScheduler();
    console.log(`📊 Total subscriber WA: ${getSubscriberCount()}`);
  }, 5000);
}

main().catch(console.error);