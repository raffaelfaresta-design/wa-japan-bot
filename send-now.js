require('dotenv').config();
const { connectWhatsApp } = require('./services/whatsapp');
const { sendDailyLesson, getCurrentDayNumber } = require('./services/scheduler');

async function main() {
  console.log('📤 Mengirim pelajaran hari ini...');
  const dayNumber = getCurrentDayNumber();
  console.log(`📅 Hari ke-${dayNumber}`);

  await connectWhatsApp();

  setTimeout(async () => {
    await sendDailyLesson();
    console.log('✅ Selesai!');
    process.exit(0);
  }, 5000);
}

main().catch(console.error);