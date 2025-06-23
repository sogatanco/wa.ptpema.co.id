import express from 'express';
import pkg from 'whatsapp-web.js';
import qrcode from 'qrcode';
import dotenv from 'dotenv';
import fs from 'fs';
import mysql from 'mysql2/promise';
import { askGeminiFlash } from './function/askGeminiFlash.js';
import { askGeminiFlashWithoutContext } from './function/askGeminiFlashWithoutContext.js';
import { formatTanggal } from './function/formatTanggal.js';
import { apiKeyAuth } from './function/apiKeyAuth.js';
import { generateContextFromMysql } from './function/generateContextFromMysql.js';
import { pollAndSendMessages } from './function/pollAndSendMessages.js';
import { handleIncomingMessage } from './function/handleIncomingMessage.js';
import path from 'path';

dotenv.config();

const { Client, LocalAuth, Buttons } = pkg;
const app = express();

app.use(express.json());

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        headless: true,
    },
});

let isReady = false;

// Tampilkan QR code di terminal
client.on('qr', (qr) => {
    console.log('Silakan scan QR berikut untuk login WhatsApp:');
    qrcode.toString(qr, { type: 'terminal', small: true }, (err, qrAscii) => {
        if (err) return console.error('Gagal membuat QR:', err);
        console.log(qrAscii);
    });
});

client.on('ready', () => {
    isReady = true;
    console.log('✅ WhatsApp client siap digunakan.');
});

client.on('authenticated', () => {
    console.log('🔐 Berhasil terautentikasi.');
});

client.on('auth_failure', (msg) => {
    console.error('❌ Autentikasi gagal:', msg);
});

client.on('disconnected', () => {
    console.log('⚠️ WhatsApp client terputus.');
    isReady = false;
});

client.on('loading_screen', (percent, message) => {
    console.log(`⏳ Loading WhatsApp: ${percent}% - ${message}`);
});

client.on('error', (err) => {
    console.error('❌ WhatsApp client error:', err);
});

// Tambahkan log sebelum dan sesudah inisialisasi
console.log('⏳ Inisialisasi WhatsApp client...');
client.initialize();
console.log('📡 Menunggu QR code...');

const API_KEY = process.env.API_KEY; // Dari .env
const KEY_SYS = process.env.KEY_SYS; // Dari .env
const GEMINI_API_KEY = process.env.GEMINI_API_KEY; // Tambahkan ke .env

// State untuk melacak nomor yang sudah pernah dibalas otomatis
const greetedNumbers = new Set();

// Endpoint cek status
app.get('/status', apiKeyAuth(API_KEY), (req, res) => {
    res.json({ ready: isReady });
});

// Endpoint kirim pesan manual
app.post('/send', apiKeyAuth(API_KEY), async (req, res) => {
    if (!isReady) return res.status(503).json({ error: 'WhatsApp belum siap.' });

    const { number, message } = req.body;
    if (!number || !message) {
        return res.status(400).json({ error: 'number dan message harus diisi.' });
    }

    const phoneNumber = number.replace(/\D/g, '');
    const chatId = phoneNumber.includes('@c.us') ? phoneNumber : `${phoneNumber}@c.us`;

    try {
        await client.sendMessage(chatId, message);
        res.json({ success: true, to: chatId });
    } catch (err) {
        console.error('❌ Gagal kirim pesan:', err);
        res.status(500).json({ error: 'Gagal mengirim pesan', detail: err.message });
    }
});

// Polling API eksternal setiap 1 menit
setInterval(() => pollAndSendMessages(isReady, KEY_SYS, formatTanggal, client), 2 * 60 * 1000);

const MYSQL_CONTEXT_ENABLED = process.env.MYSQL_CONTEXT_ENABLED === 'true';
let dbConfig;
if (MYSQL_CONTEXT_ENABLED) {
    dbConfig = {
        host: process.env.MYSQL_HOST,
        user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE,
        port: process.env.MYSQL_PORT ? parseInt(process.env.MYSQL_PORT) : 3306,
        // Tambahkan opsi lain jika perlu (misal ssl)
    };

    // Ambil semua variabel env yang diawali MYSQL_CONTEXT_QUERY dan urutkan berdasar angka di akhir (atau kosong untuk utama)
    const contextQueries = Object.entries(process.env)
        .filter(([key]) => /^MYSQL_CONTEXT_QUERY(\d*)$/.test(key))
        .map(([key, value]) => {
            // Ekstrak angka di akhir, kosong = 1 (utama), 2, 3, dst
            const m = key.match(/^MYSQL_CONTEXT_QUERY(\d*)$/);
            const idx = m && m[1] ? parseInt(m[1]) : 1;
            return { idx, value };
        })
        .sort((a, b) => a.idx - b.idx);

    contextQueries.forEach(({ idx, value }) => {
        // context.txt untuk utama (idx==1), context2.txt dst untuk berikutnya
        const fileName = idx === 1 ? 'context.txt' : `context${idx}.txt`;
        console.log(`🔄 Mulai generate ${fileName} dari MySQL dengan query: ${value}`);
        generateContextFromMysql(dbConfig, value, fileName);
        setInterval(() => generateContextFromMysql(dbConfig, value, fileName), 60 * 60 * 1000);
    });
}

// Pasang handler pada event message
client.on('message', (msg) => handleIncomingMessage(msg, {
    client,
    GEMINI_API_KEY,
    greetedNumbers
}));

// Serve static files (jadwal-rapat.html)
app.use(express.static(path.join(process.cwd(), 'public')));

// Endpoint publik jadwal rapat (JSON)
app.get('/api/jadwal-rapat', async (req, res) => {
    try {
        const file = path.join(process.cwd(), 'rapat.json');
        if (!fs.existsSync(file)) return res.json([]);
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        // Hanya tampilkan rapat hari ini ke depan, urutkan
        const today = new Date().toISOString().slice(0, 10);
        const filtered = (Array.isArray(data) ? data : []).filter(r => r.tanggal >= today)
            .sort((a, b) => a.tanggal === b.tanggal ? (a.jam || '').localeCompare(b.jam || '') : a.tanggal.localeCompare(b.tanggal));
        res.json(filtered);
    } catch (e) {
        res.status(500).json({ error: 'Gagal membaca data rapat.' });
    }
});

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
    console.log(`🚀 Server jalan di port ${PORT}`);
});

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`❌ Port ${PORT} sudah digunakan. Silakan gunakan port lain atau matikan proses lain yang memakai port ini.`);
        process.exit(1);
    } else {
        console.error('❌ Server error:', err);
    }
});


