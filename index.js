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

// ========================
// CLIENT 1 (Utama)
// ========================
const client = new Client({
    authStrategy: new LocalAuth({
        dataPath: path.join(process.cwd(), 'wadata')
    }),
    puppeteer: {
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        headless: true,
    },
});

let isReady = false;

client.on('qr', (qr) => {
    console.log('🟢 [Client1] Scan QR untuk login WhatsApp:');
    qrcode.toString(qr, { type: 'terminal', small: true }, (err, qrAscii) => {
        if (err) return console.error('Gagal membuat QR:', err);
        console.log(qrAscii);
    });
});

client.on('ready', () => {
    isReady = true;
    console.log('✅ [Client1] WhatsApp client siap digunakan.');
});

client.on('authenticated', () => {
    console.log('🔐 [Client1] Berhasil terautentikasi.');
});

client.on('auth_failure', (msg) => {
    console.error('❌ [Client1] Autentikasi gagal:', msg);
});

client.on('disconnected', () => {
    console.log('⚠️ [Client1] WhatsApp client terputus.');
    isReady = false;
});

client.on('loading_screen', (percent, message) => {
    console.log(`⏳ Loading WhatsApp: ${percent}% - ${message}`);
});

client.on('error', (err) => {
    console.error('❌ WhatsApp client error:', err);
});

client.on('message', (msg) => {
    handleIncomingMessage(msg, {
        client,
        GEMINI_API_KEY,
        greetedNumbers,
    });
});

console.log('⏳ Inisialisasi WhatsApp client...');
client.initialize();
console.log('📡 Menunggu QR code...');

const API_KEY = process.env.API_KEY;
const KEY_SYS = process.env.KEY_SYS;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const greetedNumbers = new Set();

// ========================
// CLIENT 2 (Tambahan - Hanya Menerima Pesan)
// ========================
const client2 = new Client({
    authStrategy: new LocalAuth({
        dataPath: path.join(process.cwd(), 'wadata2')
    }),
    puppeteer: {
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        headless: true,
    },
});

let isReady2 = false;

client2.on('qr', (qr) => {
    console.log('🟣 [Client2] Scan QR untuk akun WA kedua:');
    qrcode.toString(qr, { type: 'terminal', small: true }, (err, qrAscii) => {
        if (err) return console.error('[Client2] Gagal QR:', err);
        console.log(qrAscii);
    });
});

client2.on('ready', () => {
    isReady2 = true;
    console.log('✅ [Client2] Siap menerima pesan.');
});

client2.on('authenticated', () => {
    console.log('🔐 [Client2] Autentikasi berhasil.');
});

client2.on('auth_failure', (msg) => {
    console.error('❌ [Client2] Gagal autentikasi:', msg);
});

client2.on('disconnected', () => {
    isReady2 = false;
    console.log('⚠️ [Client2] Terputus.');
});

client2.on('error', (err) => {
    console.error('❌ [Client2] Error:', err);
});

// Hanya menerima pesan
client2.on('message', (msg) => {
    handleIncomingMessage(msg, {
        client: client2,
        GEMINI_API_KEY,
        greetedNumbers,
    });
});

console.log('⏳ Inisialisasi Client2...');
client2.initialize();

// ========================
// API Endpoints
// ========================

app.get('/status', apiKeyAuth(API_KEY), (req, res) => {
    res.json({
        client1: isReady,
        client2: isReady2
    });
});

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

// ========================
// Polling
// ========================
setInterval(() => pollAndSendMessages(isReady, KEY_SYS, formatTanggal, client), 2 * 60 * 1000);

// ========================
// MySQL Context (Tanpa Perubahan)
// ========================
const MYSQL_CONTEXT_ENABLED = process.env.MYSQL_CONTEXT_ENABLED === 'true';
let dbConfig;

if (MYSQL_CONTEXT_ENABLED) {
    dbConfig = {
        host: process.env.MYSQL_HOST,
        user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE,
        port: process.env.MYSQL_PORT ? parseInt(process.env.MYSQL_PORT) : 3306,
    };

    const contextQueries = Object.entries(process.env)
        .filter(([key]) => /^MYSQL_CONTEXT_QUERY(\d*)$/.test(key))
        .map(([key, value]) => {
            const m = key.match(/^MYSQL_CONTEXT_QUERY(\d*)$/);
            const idx = m && m[1] ? parseInt(m[1]) : 1;
            return { idx, value };
        })
        .sort((a, b) => a.idx - b.idx);

    contextQueries.forEach(({ idx, value }) => {
        const fileName = idx === 1 ? 'context.txt' : `context${idx}.txt`;
        console.log(`🔄 Mulai generate ${fileName} dari MySQL dengan query: ${value}`);
        generateContextFromMysql(dbConfig, value, fileName);
        setInterval(() => generateContextFromMysql(dbConfig, value, fileName), 60 * 60 * 1000);
    });
}

// ========================
// Static Files & Jadwal Rapat
// ========================
app.use(express.static(path.join(process.cwd(), 'public')));

app.get('/jadwal-rapat', (req, res) => {
    res.sendFile(path.join(process.cwd(), 'public', 'jadwal.html'));
});

app.use('/api/jadwal-rapat', (req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    next();
});

app.get('/api/jadwal-rapat', async (req, res) => {
    try {
        const file = path.join(process.cwd(), 'rapat.json');
        if (!fs.existsSync(file)) return res.json([]);
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        const today = new Date().toISOString().slice(0, 10);
        const filtered = (Array.isArray(data) ? data : []).filter(r => r.tanggal === today)
            .sort((a, b) => (a.jam || '').localeCompare(b.jam || ''));
        res.json(filtered);
    } catch (e) {
        res.status(500).json({ error: 'Gagal membaca data rapat.' });
    }
});

// ========================
// Start Server
// ========================
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
    console.log(`🚀 Server jalan di port ${PORT}`);
});

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`❌ Port ${PORT} sudah digunakan.`);
        process.exit(1);
    } else {
        console.error('❌ Server error:', err);
    }
});
