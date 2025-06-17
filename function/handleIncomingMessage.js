import { askGeminiFlash } from './askGeminiFlash.js';
import { askGeminiFlashWithoutContext } from './askGeminiFlashWithoutContext.js';
import fs from 'fs';

import { createZoomMeeting } from './zoom.js';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';

dayjs.extend(utc);
dayjs.extend(timezone);

// Menyimpan riwayat chat per user (hanya pertanyaan & jawaban terakhir)
const chatHistory = new Map();

// Ambil daftar nomor dari context.txt (sekali saat start, bisa di-refresh jika perlu)
let nomorTerdaftar = new Set();
function loadNomorTerdaftar() {
    try {
        const context = fs.readFileSync('./context.txt', 'utf8');
        const matches = context.match(/\b\d{10,16}\b/g);
        if (matches) {
            // Simpan nomor dalam bentuk asli, tanpa kode negara, dan dengan kode negara
            nomorTerdaftar = new Set();
            matches.forEach(no => {
                nomorTerdaftar.add(no); // as is
                // tanpa 62 di depan
                nomorTerdaftar.add(no.replace(/^62/, ''));
                // tanpa 0 di depan
                nomorTerdaftar.add(no.replace(/^0/, ''));
                // tanpa 62 dan tanpa 0
                nomorTerdaftar.add(no.replace(/^62/, '').replace(/^0/, ''));
            });
        }
    } catch (e) {
        nomorTerdaftar = new Set();
    }
}
loadNomorTerdaftar();
setInterval(loadNomorTerdaftar, 5 * 60 * 1000);

export async function handleIncomingMessage(msg, { client, GEMINI_API_KEY, greetedNumbers }) {
    console.log(nomorTerdaftar); // Debug: tampilkan nomor terdaftar
    const chat = await msg.getChat();
    if (chat.isGroup) return;
    const from = msg.from;
    let nomor = from.replace(/@.*$/, '');
    const nomorVariasi = [
        nomor,
        nomor.replace(/^62/, ''),
        nomor.replace(/^0/, ''),
        nomor.replace(/^62/, '').replace(/^0/, '')
    ];

    console.log(`📥 Pesan masuk dari ${nomor}: ${msg.body}`);
    const text = msg.body ? msg.body.trim().toLowerCase() : "";

    // Ambil history terakhir user (pertanyaan & jawaban sebelumnya)
    let lastHistory = chatHistory.get(from) || null;

    // Deteksi apakah pesan ini berkaitan dengan pertanyaan sebelumnya
    // Berkaitan jika: ada history sebelumnya dan pertanyaan sekarang adalah kata tanya (siapa/apa/dimana/dll)
    const kataTanya = /^(siapa|apa|dimana|kapan|mengapa|bagaimana|kenapa|siapa yang)/i;
    const isRelated = lastHistory && kataTanya.test(text);

    // Fitur: jika pesan "p", balas dengan teks saja tanpa tombol
    if (text === 'p') {
        await client.sendMessage(from, 'Apakah Anda ingin melanjutkan? Balas dengan "ya" atau "tidak".');
        return;
    }

    // Gabungkan riwayat chat sebagai konteks tambahan hanya jika berkaitan
    let fullPrompt = text;
    if (isRelated) {
        // Gunakan format: "User: {pertanyaan sebelumnya}\nAI: {jawaban sebelumnya}\nUser: {pertanyaan sekarang}"
        fullPrompt = `User: ${lastHistory.question}\nAI: ${lastHistory.answer}\nUser: ${text}`;
    }

    // Gunakan pengecekan variasi nomor
    const isTerdaftar = nomorVariasi.some(n => nomorTerdaftar.has(n));
    console.log(`📋 Nomor ${nomorVariasi} terdaftar: ${isTerdaftar}`);

    // Fitur buat zoom meeting hanya jika nomor terdaftar
    if (isTerdaftar && /^buat (zoom )?meeting\b/.test(text)) {
        try {
            // Ambil topik (setelah "topik:" atau "topic:") dan jam (setelah "jam:" atau "pukul:") dan tanggal (setelah "tanggal:" atau "tgl:")
            const topicMatch = text.match(/(?:topik|topic):\s*([^\n]+?)(?=\s+(?:jam|pukul|tanggal|tgl):|$)/i);
            const timeMatch = text.match(/(?:jam|pukul):\s*([0-9]{1,2}[:.][0-9]{2})/i);
            const dateMatch = text.match(/(?:tanggal|tgl):\s*([0-9]{4}-[0-9]{2}-[0-9]{2}|[0-9]{2}[-/][0-9]{2}[-/][0-9]{4})/i);

            // Validasi: semua harus ada
            if (!topicMatch || !timeMatch || !dateMatch) {
                await msg.reply(
                    '❗ Mohon sertakan topik, tanggal, dan jam meeting.\n' +
                    'Contoh:\n' +
                    '`buat zoom meeting topik: Rapat Divisi tanggal: 2024-07-01 jam: 14:00`'
                );
                return;
            }

            const topic = topicMatch[1].trim();
            const timeString = timeMatch[1].replace('.', ':');

            // Tanggal
            let dateStr = dateMatch[1].replace(/\//g, '-');
            if (/^\d{2}-\d{2}-\d{4}$/.test(dateStr)) {
                // dd-mm-yyyy to yyyy-mm-dd
                const [d, m, y] = dateStr.split('-');
                dateStr = `${y}-${m}-${d}`;
            }
            let meetingDate = dayjs.tz(dateStr, 'Asia/Jakarta');

            const [hour, minute] = timeString.split(':').map(Number);

            // Set jam dan menit pada tanggal yang sudah didapat
            let meetingTime = meetingDate.hour(hour).minute(minute).second(0);

            const isoTime = meetingTime.toISOString();

            // Buat meeting Zoom
            const zoomResult = await createZoomMeeting(topic, isoTime);

            let replyMsg = `✅ Meeting Zoom berhasil dibuat!\n`;
            replyMsg += `📝 Topik: ${topic}\n`;
            replyMsg += `📅 Tanggal: ${meetingTime.format('YYYY-MM-DD')}\n`;
            replyMsg += `🕒 Jam: ${meetingTime.format('HH:mm')}\n`;
            replyMsg += zoomResult.join_url ? `🔗 Link: ${zoomResult.join_url}\n` : '';
            replyMsg += zoomResult.id ? `🆔 ID Meeting: ${zoomResult.id}\n` : '';
            replyMsg += zoomResult.password ? `🔑 Password: ${zoomResult.password}\n` : '';

            await msg.reply(replyMsg.trim());
        } catch (err) {
            console.error(err);
            await msg.reply('❌ Gagal membuat meeting. Pastikan formatnya benar.\nContoh:\n`buat zoom meeting topik: Rapat A tanggal: 2024-07-01 jam: 14:00`');
        }
        return;
    }

    // Pilih context file sesuai status nomor pengirim
    let contextFile = isTerdaftar ? 'context.txt' : 'context2.txt';

    // Jika pertanyaan tentang "siapa saya", "siapa aku", "who am i", atau "kamu kenal sama aku", tambahkan instruksi dan nomor pengirim ke prompt
    if (
        /^(siapa|profil) (saya|aku)\b|who am i\b/i.test(text) ||
        /(kenal|mengenal).*(saya|aku|saya?|aku?)/i.test(text) ||
        /(kamu.*kenal.*aku|kamu.*kenal.*saya)/i.test(text)
    ) {
        fullPrompt =
            `Cari data user yang memiliki nomor handphone "${nomor}" pada data di atas, lalu jawab siapa user tersebut berdasarkan data yang ditemukan. Jika tidak ditemukan, jawab "Maaf, data Anda tidak ditemukan di sistem."`;
    }

    // Modifikasi askGeminiFlash agar menerima parameter contextFile
    let response = await askGeminiFlash(fullPrompt, GEMINI_API_KEY, contextFile);

    // Jika jawaban adalah "Maaf, data tidak tersedia dalam sistem." atau terlalu pendek/generik
    let isUnclear =
        !response ||
        response.trim().length < 10 ||
        /maaf, data tidak tersedia dalam sistem/i.test(response) ||
        /maaf|tidak dapat|tidak tahu|kurang jelas|saya tidak/.test(response.toLowerCase());

    // Jika unclear, coba ulangi ke Gemini tanpa konteks
    if (isUnclear) {
        const fallbackResponse = await askGeminiFlashWithoutContext(fullPrompt, GEMINI_API_KEY);
        let isUnclearFallback =
            !fallbackResponse ||
            fallbackResponse.trim().length < 10 ||
            /maaf, data tidak tersedia dalam sistem/i.test(fallbackResponse) ||
            /maaf|tidak dapat|tidak tahu|kurang jelas|saya tidak/.test(fallbackResponse.toLowerCase());

        await msg.reply(fallbackResponse);

        // Kirim pesan perkenalan jika belum pernah, saat isUnclearFallback
        if (isUnclearFallback && !greetedNumbers.has(from)) {
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
        return;
    }

    await msg.reply(response);

    // Simpan pertanyaan & jawaban terakhir user
    chatHistory.set(from, { question: text, answer: response });

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
