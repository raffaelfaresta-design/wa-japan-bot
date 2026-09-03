require('dotenv').config();
const { startTelegram } = require('./services/telegram');
const { isAIEnabled, getModel, getVisionModel } = require('./services/ai');

const botToken = process.env.TELEGRAM_BOT_TOKEN;

if (!botToken) {
  console.error('❌ TELEGRAM_BOT_TOKEN belum diisi di .env');
  console.log('Dapatkan token dari @BotFather di Telegram, lalu tambahkan ke .env');
  process.exit(1);
}

startTelegram(botToken);

console.log('🚀 Telegram Japan AI Bot aktif!');
console.log('📖 /belajar, /quiz (balas A-D), /tanya <pertanyaan>, /progres');
if (isAIEnabled()) {
  console.log(`🤖 Groq AI AKTIF (teks: ${getModel()} | vision: ${getVisionModel()})`);
} else {
  console.log('🤖 Groq AI MATI (mode lokal). Isi GROQ_API_KEY di .env untuk jawaban fleksibel.');
}
console.log(`📚 Broadcast kosakata tiap ${process.env.BROADCAST_INTERVAL_MINUTES || 60} menit.`);
