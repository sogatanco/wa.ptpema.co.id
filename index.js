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

client.initialize();

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
if (MYSQL_CONTEXT_ENABLED) {
    const dbConfig = {
        host: process.env.MYSQL_HOST,
        user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE,
        port: process.env.MYSQL_PORT ? parseInt(process.env.MYSQL_PORT) : 3306,
    };
    const contextQuery = process.env.MYSQL_CONTEXT_QUERY || 'SELECT * FROM your_table LIMIT 100';
    generateContextFromMysql(dbConfig, contextQuery);
    setInterval(() => generateContextFromMysql(dbConfig, contextQuery), 60 * 60 * 1000);
}

// Fungsi untuk menangani pesan baru dan membalas langsung
async function handleIncomingMessage(msg) {
    const chat = await msg.getChat();
    if (chat.isGroup) return;
    const from = msg.from;
    const text = msg.body ? msg.body.trim().toLowerCase() : "";

    // Fitur: jika pesan "p", balas dengan pertanyaan konfirmasi tombol ya/tidak
    if (text === 'p') {
        const buttons = new Buttons(
            'Apakah Anda ingin melanjutkan?', // body text
            [
                { body: 'Ya' },
                { body: 'Tidak' }
            ], // tombol
            'Konfirmasi', // header
            'Silakan pilih Ya atau Tidak' // footer
        );
        await client.sendMessage(from, buttons);
        return;
    }


    // Coba dengan context dulu
    let response = await askGeminiFlash(text, GEMINI_API_KEY);

    // Jika jawaban adalah "Maaf, data tidak tersedia dalam sistem." atau terlalu pendek/generik
    let isUnclear =
        !response ||
        response.trim().length < 10 ||
        /maaf, data tidak tersedia dalam sistem/i.test(response) ||
        /maaf|tidak dapat|tidak tahu|kurang jelas|saya tidak/.test(response.toLowerCase());

    // Jika unclear, coba ulangi ke Gemini tanpa konteks
    if (isUnclear) {
        const fallbackResponse = await askGeminiFlashWithoutContext(text, GEMINI_API_KEY);
        let isUnclearFallback =
            !fallbackResponse ||
            fallbackResponse.trim().length < 10 ||
            /maaf, data tidak tersedia dalam sistem/i.test(fallbackResponse) ||
            /maaf|tidak dapat|tidak tahu|kurang jelas|saya tidak/.test(fallbackResponse.toLowerCase());

        if (isUnclearFallback) {
            // Tetap tampilkan jawaban dari Gemini (tanpa context), apapun isinya
            await msg.reply(fallbackResponse);
        } else {
            await msg.reply(fallbackResponse);
        }
        return;
    }

    await msg.reply(response);

    // Jika bukan pertanyaan dan ini chat pertama dari nomor tsb, tetap kirim perkenalan (opsional)
    if (!greetedNumbers.has(from)) {
        const introMsg =
            "Halo! 👋\n" +
            "Saya adalah asisten otomatis WhatsApp PT PEMA.\n" +
            "Silakan ajukan pertanyaan apa saja, saya akan mencoba membantu dengan AI.\n\n" +
            "Terima kasih.";
        try {
            await msg.reply(introMsg);
            greetedNumbers.add(from);
        } catch (err) {
            console.error('❌ Gagal kirim pesan perkenalan:', err.message);
        }
    }
}

// Pasang handler pada event message
client.on('message', handleIncomingMessage);

// Jalankan polling setiap 5 menit
setInterval(pollAndSendMessages, 2 * 60 * 1000);

if (MYSQL_CONTEXT_ENABLED) {
    const dbConfig = {
        host: process.env.MYSQL_HOST,
        user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE,
        port: process.env.MYSQL_PORT ? parseInt(process.env.MYSQL_PORT) : 3306,
        // Tambahkan opsi lain jika perlu (misal ssl)
    };
    const contextQuery = process.env.MYSQL_CONTEXT_QUERY || 'SELECT * FROM your_table LIMIT 100';
    // Jalankan sekali saat server start
    generateContextFromMysql(dbConfig, contextQuery);
    // Jalankan ulang setiap 1 jam
    setInterval(() => generateContextFromMysql(dbConfig, contextQuery), 60 * 60 * 1000);
}

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


