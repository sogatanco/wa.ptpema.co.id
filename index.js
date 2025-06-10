import express from 'express';
import pkg from 'whatsapp-web.js';
import qrcode from 'qrcode';
import axios from 'axios';
import dotenv from 'dotenv';
import fs from 'fs';
import mysql from 'mysql2/promise';


dotenv.config();

const { Client, LocalAuth } = pkg;
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

// Fungsi untuk memanggil Gemini Flash API (mengikuti contoh curl Google) dengan konteks dari file eksternal
async function askGeminiFlash(question) {
    let context = '';
    try {
        context = fs.readFileSync('./context.txt', 'utf8').trim();
    } catch (e) {
        context = '';
    }

    // Pakai konteks dan batasi jawaban hanya dari data konteks
    const prompt = context
        ? context + "\n\nJawablah pertanyaan berikut hanya berdasarkan data di atas. Jika jawabannya tidak ada dalam data, balas: 'Maaf, data tidak tersedia dalam sistem.'\n\nPertanyaan: " + question
        : question;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;
    try {
        const response = await axios.post(
            url,
            {
                contents: [
                    {
                        parts: [{ text: prompt }]
                    }
                ]
            },
            {
                headers: {
                    'Content-Type': 'application/json'
                }
            }
        );
        if (
            response.data &&
            Array.isArray(response.data.candidates) &&
            response.data.candidates.length > 0 &&
            response.data.candidates[0].content &&
            Array.isArray(response.data.candidates[0].content.parts) &&
            response.data.candidates[0].content.parts.length > 0 &&
            response.data.candidates[0].content.parts[0].text
        ) {
            return response.data.candidates[0].content.parts[0].text;
        }
        return "Maaf, data tidak tersedia dalam sistem.";
    } catch (err) {
        return "Maaf, data tidak tersedia dalam sistem.";
    }
}

// Fungsi fallback: tanya Gemini tanpa context
async function askGeminiFlashWithoutContext(question) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;
    try {
        const response = await axios.post(
            url,
            {
                contents: [
                    {
                        parts: [{ text: question }]
                    }
                ]
            },
            {
                headers: {
                    'Content-Type': 'application/json'
                }
            }
        );
        if (
            response.data &&
            Array.isArray(response.data.candidates) &&
            response.data.candidates.length > 0 &&
            response.data.candidates[0].content &&
            Array.isArray(response.data.candidates[0].content.parts) &&
            response.data.candidates[0].content.parts.length > 0 &&
            response.data.candidates[0].content.parts[0].text
        ) {
            return response.data.candidates[0].content.parts[0].text;
        }
        return "Maaf, saya tidak dapat menjawab pertanyaan Anda.";
    } catch (err) {
        if (err.response && err.response.data && err.response.data.error && err.response.data.error.message) {
            console.error('❌ Gemini Flash API error:', err.response.data.error.message);
        } else {
            console.error('❌ Gemini Flash API error:', err.message);
        }
        return "Maaf, terjadi kesalahan saat menjawab pertanyaan Anda.";
    }
}

// Middleware untuk autentikasi Bearer token
function apiKeyAuth(req, res, next) {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized: Bearer token required' });
    }
    const token = authHeader.split(' ')[1];
    if (token !== API_KEY) {
        return res.status(401).json({ error: 'Unauthorized: Invalid API key' });
    }
    next();
}

// Endpoint cek status
app.get('/status', apiKeyAuth, (req, res) => {
    res.json({ ready: isReady });
});

// Endpoint kirim pesan manual
app.post('/send', apiKeyAuth, async (req, res) => {
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

// Fungsi format tanggal sesuai permintaan
function formatTanggal(dateStr) {
    const hari = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
    const d = new Date(dateStr);
    const namaHari = hari[d.getDay()];
    const tgl = String(d.getDate()).padStart(2, '0');
    const bln = String(d.getMonth() + 1).padStart(2, '0');
    const thn = d.getFullYear();
    const jam = String(d.getHours()).padStart(2, '0');
    const menit = String(d.getMinutes()).padStart(2, '0');
    return `${namaHari}, ${tgl}/${bln}/${thn} ${jam}:${menit}`;
}

// Polling API eksternal setiap 1 menit
async function pollAndSendMessages() {
    if (!isReady) return;
    try {
        // Coba tanpa trailing slash
        let response;
        try {
            response = await axios.get(
                'https://api.ptpema.co.id/dapi/send-message/first',
                { headers: { 'Authorization': `Bearer ${KEY_SYS}` } }
            );
        } catch (err) {
            // Jika 404, coba dengan trailing slash
            if (err.response && err.response.status === 404) {
                try {
                    response = await axios.get(
                        'https://api.ptpema.co.id/dapi/send-message/first/',
                        { headers: { 'Authorization': `Bearer ${KEY_SYS}` } }
                    );
                } catch (err2) {
                    if (err2.response) {
                        console.error('❌ Response 404:', err2.response.status, err2.response.data);
                    } else {
                        console.error('❌ Error:', err2.message);
                    }
                    return;
                }
            } else {
                if (err.response) {
                    console.error('❌ Response error:', err.response.status, err.response.data);
                } else {
                    console.error('❌ Error:', err.message);
                }
                return;
            }
        }
        const result = response.data;
        // Cek jika response berbentuk objek dengan properti data
        if (result && result.success && result.data && result.data.number && result.data.message) {
            const d = result.data;
            // Format tanggal
            const tanggalFormatted = formatTanggal(d.created_at);
            // Format pesan sesuai permintaan
            const formattedMessage =
                `Assalamu'alaikum ${d.panggilan} *${d.reciepint_name}*,\n\n` +
                `Anda baru saja mendapat notifikasi dari sistem *SYS PT PEMA*.\n\n` +
                `📌 *Pengirim:* ${d.actor_name}\n` +
                `📂 *Jenis:* ${d.entity} - ${d.type}\n` +
                `🗒️ *Pesan:* ${d.message}\n` +
                `📅 *Tanggal:* ${tanggalFormatted}\n` +
                `🔗 *Lihat Detail:* ${d.url}\n\n` +
                `Terima kasih.\n\n` +
                `—\n_pesan ini dikirim otomatis oleh sistem SYS PT PEMA_\n\n` +
                `\n_Anda bisa mengajukan Pertanyaan disini, Saya akan membantu anda semampu saya dengan kecerdasan buatan (AI)_`;

            const phoneNumber = d.number.replace(/\D/g, '');
            const chatId = phoneNumber.includes('@c.us') ? phoneNumber : `${phoneNumber}@c.us`;
            try {
                await client.sendMessage(chatId, formattedMessage);
                console.log(`✅ Pesan terkirim ke ${chatId}`);
                // Update status ke API eksternal
                try {
                    await axios.post(
                        `https://api.ptpema.co.id/dapi/notif/${d.id}/set-swa`,
                        {}, // body kosong
                        { headers: { 'Authorization': `Bearer ${KEY_SYS}` } }
                    );
                    console.log(`✅ Status notifikasi ${d.id} diupdate ke API eksternal`);
                } catch (err) {
                    console.error(`❌ Gagal update status notifikasi ${d.id}:`, err.message);
                }
            } catch (err) {
                console.error(`❌ Gagal kirim pesan ke ${chatId}:`, err.message);
            }
        }
        // Jika response berbentuk array (untuk kompatibilitas lama)
        else if (Array.isArray(result)) {
            for (const item of result) {
                if (item.number && item.message) {
                    const phoneNumber = item.number.replace(/\D/g, '');
                    const chatId = phoneNumber.includes('@c.us') ? phoneNumber : `${phoneNumber}@c.us`;
                    try {
                        await client.sendMessage(chatId, item.message);
                        console.log(`✅ Pesan terkirim ke ${chatId}`);
                        // Tidak ada id untuk update status pada array lama
                    } catch (err) {
                        console.error(`❌ Gagal kirim pesan ke ${chatId}:`, err.message);
                    }
                }
            }
        }
    } catch (err) {
        console.error('❌ Gagal mengambil data dari API eksternal:', err.message);
    }
}

async function generateContextFromMysql(dbConfig, query) {
    const pemaIntro = 'PT. Pembangunan Aceh (PEMA) merupakan Badan Usaha Milik Daerah Aceh (BUMD/BUMA) yang sahamnya 100% dimiliki Pemerintah Aceh, yang bertujuan untuk meningkatkan pembangunan, perekonomian serta Pendapatan Asli Aceh. Website ini merupakan sarana media pelayanan data dan informasi untuk menjembatani keinginan PT PEMA agar lebih mengenal dan dikenal oleh masyarakat melalui media elektronik.\n\n';
    let connection;
    try {
        console.log('⏳ Mulai mengambil data dari MySQL untuk context.txt...');
        connection = await mysql.createConnection(dbConfig);
        const [rows] = await connection.execute(query);
        const jsonText = JSON.stringify(rows, null, 2);
        const contextText = pemaIntro + jsonText;
        fs.writeFileSync('./context.txt', contextText, 'utf8');
        console.log('✅ context.txt berhasil digenerate dari MySQL');
    } catch (err) {
        if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
            console.error('❌ Tidak dapat terhubung ke MySQL. Pastikan service MySQL berjalan dan konfigurasi sudah benar.');
        } else {
            console.error('❌ Gagal generate context.txt dari MySQL:', err.message);
        }
    } finally {
        if (connection) await connection.end();
        console.log('ℹ️ Proses generate context.txt dari MySQL selesai.');
    }
}

// Fungsi untuk menangani pesan baru dan membalas langsung
async function handleIncomingMessage(msg) {
    const chat = await msg.getChat();
    if (chat.isGroup) return;
    const from = msg.from;
    const text = msg.body ? msg.body.trim().toLowerCase() : "";

    // Fitur: jika pesan "p", balas dengan pertanyaan konfirmasi
    if (text === 'p') {
        await msg.reply('Apakah Anda ingin melanjutkan? Balas dengan "ya" untuk konfirmasi.');
        // Simpan state jika perlu (misal: pakai Map untuk menyimpan state per user)
        return;
    }

    // Fitur: jika pesan "ya" setelah "p"
    // (Contoh sederhana, tanpa state, hanya jika pesan sebelumnya "p")
    // Untuk produksi, gunakan Map/DB untuk menyimpan state per user
    if (text === 'ya') {
        await msg.reply('Terima kasih atas konfirmasi Anda. Silakan lanjutkan pertanyaan atau permintaan Anda.');
        return;
    }

    // Coba dengan context dulu
    let response = await askGeminiFlash(text);

    // Jika jawaban adalah "Maaf, data tidak tersedia dalam sistem." atau terlalu pendek/generik
    let isUnclear =
        !response ||
        response.trim().length < 10 ||
        /maaf, data tidak tersedia dalam sistem/i.test(response) ||
        /maaf|tidak dapat|tidak tahu|kurang jelas|saya tidak/.test(response.toLowerCase());

    // Jika unclear, coba ulangi ke Gemini tanpa konteks
    if (isUnclear) {
        const fallbackResponse = await askGeminiFlashWithoutContext(text);
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
            "Halo! 👋\nSaya adalah asisten otomatis WhatsApp PT PEMA.\nSilakan pilih salah satu tombol berikut atau ketik pertanyaan Anda langsung:";

        const buttonMessage = {
            text: introMsg,
            buttons: [
                { type: 'reply', reply: { id: 'tentang_pema', title: 'Tentang PT PEMA' } },
                { type: 'reply', reply: { id: 'layanan', title: 'Layanan' } },
                { type: 'reply', reply: { id: 'kontak', title: 'Kontak' } }
            ],
            header: 'Selamat datang di PT PEMA',
            footer: 'Pilih menu di bawah:'
        };

        try {
            await client.sendMessage(from, buttonMessage);
            greetedNumbers.add(from);
        } catch (err) {
            console.error('❌ Gagal kirim greeting dengan tombol:', err.message);
        }
    }
}

// Pasang handler pada event message
client.on('message', handleIncomingMessage);

// Jalankan polling setiap 5 menit
setInterval(pollAndSendMessages, 2 * 60 * 1000);

const MYSQL_CONTEXT_ENABLED = process.env.MYSQL_CONTEXT_ENABLED === 'true';
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


