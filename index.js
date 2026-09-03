require('dotenv').config();
const { startTelegram } = require('./services/telegram');

const botToken = process.env.TELEGRAM_BOT_TOKEN;

if (!botToken) {
  console.error('❌ TELEGRAM_BOT_TOKEN belum diisi di .env');
  console.log('Dapatkan token dari @BotFather di Telegram, lalu tambahkan ke .env');
  process.exit(1);
}

startTelegram(botToken);

console.log('🚀 Telegram Japan AI Bot aktif!');
console.log('📖 /belajar, /quiz (balas A-D), /tanya <pertanyaan>, /progres');
console.log(`📚 Broadcast kosakata tiap ${process.env.BROADCAST_INTERVAL_MINUTES || 60} menit.`);
