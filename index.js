// Contoh API Key dan cara penggunaan:
// API_KEY: 1234567890abcdef
// 
// Contoh request menggunakan curl (Bearer):
// curl -X POST http://localhost:3000/send \
//   -H "Content-Type: application/json" \
//   -H "Authorization: Bearer 1234567890abcdef" \
//   -d '{"number":"6281234567890","message":"Halo"}'
//
// curl -X GET http://localhost:3000/status -H "Authorization: Bearer 1234567890abcdef"

import express from 'express';
import pkg from 'whatsapp-web.js';
import qrcode from 'qrcode';
import axios from 'axios';

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

const API_KEY = '1234567890abcdef'; // Ganti dengan key statis yang diinginkan

const KEY_SYS = 'y6e766aa21ef5173e73d602767850bbe1f2c51af2'; // Ganti dengan API key sistem Anda

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
    const hari = ['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];
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
        const response = await axios.get('https://api.ptpema.co.id/dapi/send-message/first', {
            headers: { 'Authorization': `Bearer ${KEY_SYS}` }
        });
        const result = response.data;
        // Cek jika response berbentuk objek dengan properti data
        if (result && result.success && result.data && result.data.number && result.data.message) {
            const d = result.data;
            // Format tanggal
            const tanggalFormatted = formatTanggal(d.created_at);
            // Format pesan sesuai permintaan
            const formattedMessage =
                `Assalamu'alaikum Bapak/Ibu *${d.reciepint_name}*,\n\n` +
                `Anda baru saja mendapat notifikasi dari sistem *SYS PT PEMA*.\n\n` +
                `📌 *Pengirim:* ${d.actor_name}\n` +
                `📂 *Jenis:* ${d.entity} - ${d.type}\n` +
                `🗒️ *Pesan:* ${d.message}\n` +
                `📅 *Tanggal:* ${tanggalFormatted}\n` +
                `🔗 *Lihat Detail:*${d.url}\n\n` +
                `Terima kasih.\nWassalamu'alaikum warahmatullahi wabarakatuh.\n\n` +
                `—\n_pesan ini dikirim otomatis oleh sistem SYS PT PEMA_\n` +
                `_jangan balas pesan ini, silakan bisukan jika dirasa mengganggu_`;

            const phoneNumber = d.number.replace(/\D/g, '');
            const chatId = phoneNumber.includes('@c.us') ? phoneNumber : `${phoneNumber}@c.us`;
            try {
                await client.sendMessage(chatId, formattedMessage);
                console.log(`✅ Pesan terkirim ke ${chatId}`);
                // Update status ke API eksternal
                try {
                    await axios.post(`https://api.ptpema.co.id/dapi/notif/${d.id}/set-swa`,{
                        headers: { 'Authorization': `Bearer ${KEY_SYS}` }});
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

// Jalankan polling setiap 5 menit
setInterval(pollAndSendMessages, 1 * 60 * 1000);

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
