const { makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers } = require('@whiskeysockets/baileys');
const pino = require('pino');
const path = require('path');
const { addSubscriber } = require('./userManager');

const logger = pino({ level: 'silent' });

let sock = null;
let sessionDir = path.join(__dirname, '../session');

async function connectWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

  sock = makeWASocket({
    auth: state,
    logger: logger,
    browser: Browsers.macOS('Desktop'),
    markOnlineOnConnect: true,
  });

  sock.ev.on('creds-update', async () => {
    await saveCreds();
  });

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('[QR CODE] Scan QR berikut di WhatsApp:');
      console.log(qr);
    }

    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log(`[KONEKSI TUTUP] ${shouldReconnect ? 'Akan reconnect...' : 'Harap scan QR lagi.'}`);
      if (shouldReconnect) {
        setTimeout(() => connectWhatsApp(), 3000);
      }
    }

    if (connection === 'open') {
      console.log('[✅] WhatsApp terhubung!');
    }
  });

  sock.ev.on('group-participants.update', async (update) => {
    const { action, participants } = update;
    if (action === 'add') {
      for (const participant of participants) {
        const chatId = participant.replace('@s.whatsapp.net', '');
        addSubscriber(participant, 'Baru Bergabung');
        try {
          await sock.sendMessage(participant, {
            text: `🎌 Selamat datang di Saluran Belajar Bahasa Jepang!\n\nAnda kini terdaftar sebagai subscriber. Setiap hari Anda akan menerima pelajaran & quiz baru.\n\nSelamat belajar! 🇯🇵`
          });
        } catch (e) {
          console.error(`[AUTO-SUB] Gagal sambut ${participant}:`, e.message);
        }
      }
    }
  });

  return sock;
}

async function sendMessage(chatId, content) {
  if (!sock) {
    console.error('[ERROR] WhatsApp belum terhubung!');
    return null;
  }

  try {
    const msg = await sock.sendMessage(chatId, {
      text: content,
    });
    return msg;
  } catch (error) {
    console.error(`[ERROR] Gagal kirim pesan ke ${chatId}:`, error.message);
    return null;
  }
}

async function sendBulkMessage(chatIds, content) {
  const results = [];
  for (const chatId of chatIds) {
    const result = await sendMessage(chatId, content);
    results.push({ chatId, success: !!result });
  }
  return results;
}

function getSock() {
  return sock;
}

module.exports = { connectWhatsApp, sendMessage, sendBulkMessage, getSock };