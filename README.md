# WhatsApp & Telegram Japan Bot 🤖🇯🇵

Bot WhatsApp & Telegram yang mengirim pelajaran bahasa Jepang secara otomatis setiap hari menggunakan Bahasa Indonesia sebagai medium.

## Fitur

- 📚 30 hari pelajaran bahasa Jepang (hiragana, katakana, grammar, kosakata)
- 📝 Quiz harian dengan jawaban otomatis
- 📢 Broadcast otomatis ke semua subscriber WhatsApp
- 🤖 Bot Telegram dengan perintah /belajar, /quiz, /jawaban, /progres
- 👥 Auto-add subscriber saat bergabung ke grup WhatsApp
- ⏰ Jadwal kirim fleksibel

## Quick Start

```bash
npm install
node database/init.js
node index.js
```

## Konfigurasi

Salin `.env.example` ke `.env`:

```env
# WhatsApp
LESSON_TIME=20
MODE=manual

# Telegram (opsional)
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
```

### Dapatkan Telegram Bot Token

1. Buka Telegram, cari @BotFather
2. Kirim `/newbot`
3. Ikuti instruksi, salin token
4. Masukkan ke `.env`

## Deploy ke Render

### 1. Push ke GitHub

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/<username>/<repo>.git
git push -u origin main
```

### 2. Setup di Render

1. Buka [render.com](https://render.com), buat akun
2. Klik **New +** → **Background Worker**
3. Hubungkan repo GitHub
4. Configure:
   - **Name:** wa-japan-bot
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `node index.js`
   - **Instance Type:** Free
5. Tambahkan Environment Variables:
   - `TELEGRAM_BOT_TOKEN` - token bot Telegram
   - `LESSON_TIME` - jam kirim pelajaran (default: 20)
6. Klik **Create Background Worker**

### 3. WhatsApp Session

Pertama kali jalankan, scan QR code yang muncul di terminal Render logs. Session tersimpan di folder `session/`.

## Struktur Project

```
wa-japan-bot/
├── index.js                  # Entry point (WA + Telegram)
├── .env                      # Konfigurasi
├── .env.example              # Template env
├── Procfile                  # Render config
├── package.json
├── content/
│   └── lessons.json          # Data pelajaran 30 hari
├── database/
│   ├── db.js                 # Database handler (JSON)
│   ├── init.js               # Inisialisasi database
│   └── bot.json              # Database file (auto-created)
├── services/
│   ├── whatsapp.js           # Koneksi WhatsApp (Baileys)
│   ├── telegram.js           # Bot Telegram (Telegraf)
│   ├── scheduler.js          # Scheduler & broadcast
│   └── userManager.js        # Manajemen subscriber
├── session/                  # Session WhatsApp (auto-created)
├── add-subscriber.js         # Tambah subscriber manual
├── send-now.js               # Kirim pelajaran sekarang
├── status.js                 # Cek status bot
└── README.md
```

## Perintah Telegram

| Perintah | Fungsi |
|----------|--------|
| `/start` | Mulai & info umum |
| `/belajar` | Lihat pelajaran hari ini |
| `/quiz` | Lihat quiz hari ini |
| `/jawaban` | Lihat jawaban quiz |
| `/progres` | Lihat progress belajar |
| `/help` | Bantuan |

## Perintah Manual

```bash
# Inisialisasi database
node database/init.js

# Tambah subscriber manual
node add-subscriber.js <chat_id> [nama]

# Kirim pelajaran sekarang
node send-now.js

# Cek status
node status.js
```

## Kurikulum

| Hari | Topik |
|------|-------|
| 1-8  | Hiragana |
| 9-10 | Katakana |
| 11-12| Tata Bahasa (Kalimat & Masu) |
| 13-14| Kosakata (Angka & Warna) |
| 15   | Review Hiragana & Katakana |
| 16-20| Kosakata (Waktu, Partikel, Makanan, Keluarga) |
| 21-23| Tata Bahasa (Adj, Negasi, Ta-form) |
| 24-28| Kosakata (Budaya, Transportasi, Profesi, dll) |
| 29-30| Tata Bahasa Lanjutan & Final Review |

## Syarat

- Node.js >= 18
- Akun WhatsApp (untuk QR Code login pertama kali)
- Bot Telegram (dari @BotFather)
- Akses internet