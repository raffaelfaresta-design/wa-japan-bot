# Telegram Japan Bot 🤖🇯🇵

Bot Telegram yang mengirim pelajaran bahasa Jepang secara otomatis setiap hari menggunakan Bahasa Indonesia sebagai medium.

## Fitur

- 📚 30 hari pelajaran bahasa Jepang (hiragana, katakana, grammar, kosakata) — otomatis dimuat saat bot start, tanpa setup manual
- 🤖 AI pengajar via Groq (jawab pertanyaan apa pun dalam Bahasa Indonesia)
- 📝 Quiz harian dengan koreksi jawaban otomatis (balas A/B/C/D)
- ❓ Mode tanya-jawab (`/tanya`)
- 📚 Broadcast kosakata dasar otomatis tiap 1 jam
- 🤖 Bot Telegram dengan perintah /belajar, /quiz, /jawaban, /tanya, /progres
- ⏰ Jadwal kirim fleksibel

## Quick Start

```bash
npm install
node index.js
```

Materi 30 hari otomatis dimuat dari `content/lessons.json` saat pertama jalan — tidak perlu `node database/init.js` lagi.

## Konfigurasi

Salin `.env.example` ke `.env`:

```env
TELEGRAM_BOT_TOKEN=your_telegram_bot_token

# Opsional tapi disarankan: agar bot bisa jawab pertanyaan APAPUN
GROQ_API_KEY=your_groq_api_key
GROQ_MODEL=llama-3.3-70b-versatile

BROADCAST_INTERVAL_MINUTES=60
```

### Dapatkan Groq API Key (gratis)

1. Buka [console.groq.com](https://console.groq.com), daftar / login
2. Buka **API Keys** → **Create API Key**, salin key-nya
3. Masukkan ke `.env` sebagai `GROQ_API_KEY`
4. Tanpa key, bot tetap jalan dalam mode lokal (jawab hanya dari materi 30 hari)

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
2. Klik **New +** → **Web Service**
3. Hubungkan repo GitHub
4. Configure:
   - **Name:** wa-japan-bot
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `node index.js`
   - **Instance Type:** Free
5. Tambahkan Environment Variables:
   - `TELEGRAM_BOT_TOKEN` - token bot Telegram
   - `GROQ_API_KEY` - API key Groq (agar bisa jawab apa pun)
   - `GROQ_MODEL` - opsional, default `llama-3.3-70b-versatile`
   - `BROADCAST_INTERVAL_MINUTES` - opsional, default `60`
6. Klik **Create Web Service**

## Struktur Project

```
wa-japan-bot/
├── index.js                  # Entry point
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
│   └── telegram.js           # Bot Telegram (Telegraf)
├── status.js                 # Cek status bot
└── README.md
```

## Perintah Telegram

| Perintah | Fungsi |
|----------|--------|
| `/start` | Mulai & info umum |
| `/belajar` | Lihat pelajaran hari ini |
| `/quiz` | Lihat quiz hari ini (balas A/B/C/D untuk dikoreksi) |
| `/jawaban` | Lihat jawaban quiz |
| `/tanya <pertanyaan>` | Tanya AI pengajar apa saja |
| `/selesai` | Keluar dari mode tanya |
| `/progres` | Lihat progress belajar |
| `/help` | Bantuan |

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
- Bot Telegram (dari @BotFather)
- Akses internet
