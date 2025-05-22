import express from 'express';
// import { Client, LocalAuth } from 'whatsapp-web.js';
import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import qrcode from 'qrcode';

const app = express();
app.use(express.json());

const client = new Client({
    authStrategy: new LocalAuth()
});

let isReady = false;

// Tampilkan QR code kecil di terminal saat login pertama
client.on('qr', (qr) => {
    console.log('Scan QR code to login');
    qrcode.toString(qr, { type: 'terminal', small: true }, (err, url) => {
        console.log(url);
    });
});

client.on('ready', () => {
    isReady = true;
    console.log('WhatsApp client is ready!');
});

client.on('authenticated', () => {
    console.log('Authenticated');
});

client.on('auth_failure', msg => {
    console.error('Auth failure', msg);
});

client.initialize();

// Endpoint untuk cek status koneksi
app.get('/status', (req, res) => {
    res.json({ ready: isReady });
});

// Endpoint untuk kirim pesan
app.post('/send', async (req, res) => {
    if (!isReady) return res.status(400).json({ error: 'WhatsApp belum siap' });
    const { number, message } = req.body;
    if (!number || !message) return res.status(400).json({ error: 'number & message wajib diisi' });

    // Format nomor: 628xxxxxxx (tanpa +)
    const chatId = number.includes('@c.us') ? number : `${number}@c.us`;
    try {
        await client.sendMessage(chatId, message);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log('Server running on port', PORT);
});
