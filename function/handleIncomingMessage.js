import { askGeminiFlash } from './askGeminiFlash.js';
import { askGeminiFlashWithoutContext } from './askGeminiFlashWithoutContext.js';
import {
    loadNomorTerdaftar as loadNomorTerdaftarUtil
} from './utils.js';
import { handleZoomMeeting } from './zoomMeetingHandler.js';
import fs from 'fs';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone.js';
import utc from 'dayjs/plugin/utc.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const chatHistory = new Map();
let nomorTerdaftar = new Set();
function loadNomorTerdaftar() {
    nomorTerdaftar = loadNomorTerdaftarUtil();
}
loadNomorTerdaftar();
setInterval(loadNomorTerdaftar, 5 * 60 * 1000);

const userMenuState = new Map();
const userBookingData = new Map();

async function handleFallbackResponse({ msg, fullPrompt, GEMINI_API_KEY, greetedNumbers, from, text }) {
    const fallbackResponse = await askGeminiFlashWithoutContext(fullPrompt, GEMINI_API_KEY);
    let isUnclearFallback =
        !fallbackResponse ||
        fallbackResponse.trim().length < 10 ||
        /maaf, data tidak tersedia dalam sistem/i.test(fallbackResponse) ||
        /maaf|tidak dapat|tidak tahu|kurang jelas|saya tidak/.test(fallbackResponse.toLowerCase());

    await msg.reply(fallbackResponse);

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
}

export async function handleIncomingMessage(msg, { client, GEMINI_API_KEY, greetedNumbers }) {
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

    const text = msg.body ? msg.body.trim().toLowerCase() : "";
    let lastHistory = chatHistory.get(from) || null;
    const kataTanya = /^(siapa|apa|dimana|kapan|mengapa|bagaimana|kenapa|siapa yang)/i;
    const isRelated = lastHistory && kataTanya.test(text);

    // Menu utama
    if (text === 'menu') {
        userMenuState.set(from, 'main');
        const menuMsg =
`*MENU UTAMA*
1. Booking Ruang Rapat
2. Zoom Meeting
3. Keluar`;
        await msg.reply(menuMsg);
        return;
    }

    // Handler submenu Booking Ruang Rapat
    if (userMenuState.get(from) === 'main' && text === '1') {
        userMenuState.set(from, 'booking');
        userBookingData.delete(from); // reset data booking jika ada
        const submenuMsg =
`*BOOKING RUANG RAPAT*
1. List rapat yang akan datang
2. Booking ruang rapat
9. Kembali ke menu utama
0. Keluar menu
Ketik angka sesuai pilihan.`;
        await msg.reply(submenuMsg);
        return;
    }

    // Handler kembali ke menu utama dari submenu
    if (userMenuState.get(from) === 'booking' && text === '9') {
        userMenuState.set(from, 'main');
        userBookingData.delete(from);
        const menuMsg =
`*MENU UTAMA*
1. Booking Ruang Rapat
2. Zoom Meeting
3. Keluar`;
        await msg.reply('Anda kembali ke menu utama.\n\n' + menuMsg);
        return;
    }

    // Handler keluar dari menu (hapus state)
    if (userMenuState.get(from) === 'booking' && text === '0') {
        userMenuState.delete(from);
        userBookingData.delete(from);
        await msg.reply('Anda telah keluar dari menu.');
        return;
    }

    // Handler List rapat yang akan datang
    if (userMenuState.get(from) === 'booking' && text === '1') {
        // Baca file rapat
        let rapatList = [];
        try {
            if (fs.existsSync('./rapat.json')) {
                rapatList = JSON.parse(fs.readFileSync('./rapat.json', 'utf8'));
            }
        } catch {}
        if (rapatList.length === 0) {
            await msg.reply('Belum ada rapat yang terdaftar.');
        } else {
            let listMsg = '*Daftar Rapat Yang Akan Datang:*\n';
            rapatList.forEach((r, idx) => {
                listMsg += `${idx + 1}. ${r.tanggal} ${r.jam} | ${r.agenda} | Ruang: ${r.ruang}\n`;
            });
            await msg.reply(listMsg);
        }
        return;
    }

    // Handler Booking ruang rapat (mulai step by step)
    if (userMenuState.get(from) === 'booking' && text === '2') {
        userBookingData.set(from, { step: 1 });
        await msg.reply('Masukkan tanggal rapat (format: YYYY-MM-DD):');
        return;
    }

    // Step booking ruang rapat: tanggal
    if (userMenuState.get(from) === 'booking') {
        const booking = userBookingData.get(from);
        if (booking && booking.step === 1) {
            // Validasi tanggal
            if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
                await msg.reply('Format tanggal salah. Masukkan tanggal rapat (format: YYYY-MM-DD):');
                return;
            }
            booking.tanggal = text;
            booking.step = 2;
            userBookingData.set(from, booking);
            await msg.reply('Masukkan jam rapat (format: HH:mm, contoh: 13:30):');
            return;
        }
        // Step jam
        if (booking && booking.step === 2) {
            if (!/^\d{2}:\d{2}$/.test(text)) {
                await msg.reply('Format jam salah. Masukkan jam rapat (format: HH:mm, contoh: 13:30):');
                return;
            }
            booking.jam = text;
            booking.step = 3;
            userBookingData.set(from, booking);
            await msg.reply('Masukkan agenda rapat:');
            return;
        }
        // Step agenda
        if (booking && booking.step === 3) {
            if (!text || text.length < 3) {
                await msg.reply('Agenda rapat tidak boleh kosong. Masukkan agenda rapat:');
                return;
            }
            booking.agenda = text;
            booking.step = 4;
            userBookingData.set(from, booking);
            await msg.reply('Pilih ruang rapat:\n1. Growth\n2. Harmony\n3. Ruang PAC\nKetik angka sesuai pilihan.');
            return;
        }
        // Step ruang
        if (booking && booking.step === 4) {
            let ruang = '';
            if (text === '1') ruang = 'Growth';
            else if (text === '2') ruang = 'Harmony';
            else if (text === '3') ruang = 'Ruang PAC';
            else {
                await msg.reply('Pilihan ruang tidak valid. Pilih ruang rapat:\n1. Growth\n2. Harmony\n3. Ruang PAC\nKetik angka sesuai pilihan.');
                return;
            }
            booking.ruang = ruang;
            // Simpan ke file rapat.json
            let rapatList = [];
            try {
                if (fs.existsSync('./rapat.json')) {
                    rapatList = JSON.parse(fs.readFileSync('./rapat.json', 'utf8'));
                }
            } catch {}
            rapatList.push({
                tanggal: booking.tanggal,
                jam: booking.jam,
                agenda: booking.agenda,
                ruang: booking.ruang,
                user: from
            });
            fs.writeFileSync('./rapat.json', JSON.stringify(rapatList, null, 2));
            userBookingData.delete(from);
            await msg.reply(`Booking ruang rapat berhasil!\nTanggal: ${booking.tanggal}\nJam: ${booking.jam}\nAgenda: ${booking.agenda}\nRuang: ${booking.ruang}`);
            // Tampilkan menu booking lagi
            const submenuMsg =
`*BOOKING RUANG RAPAT*
1. List rapat yang akan datang
2. Booking ruang rapat
9. Kembali ke menu utama
0. Keluar menu
Ketik angka sesuai pilihan.`;
            await msg.reply(submenuMsg);
            return;
        }
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

    // Deteksi perintah zoom meeting lebih luas (bisa bahasa Inggris/campuran)
    const isZoomPrompt =
        /^buat (zoom )?meeting\b/.test(text) ||
        (text.includes('zoom') && text.includes('meeting')) ||
        /create.*zoom.*meeting/i.test(text) ||
        /schedule.*zoom/i.test(text);

    if (isTerdaftar && isZoomPrompt) {
        await handleZoomMeeting({ msg, nomor, GEMINI_API_KEY });
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

    let response = await askGeminiFlash(fullPrompt, GEMINI_API_KEY, contextFile);

    let isUnclear =
        !response ||
        response.trim().length < 10 ||
        /maaf, data tidak tersedia dalam sistem/i.test(response) ||
        /maaf|tidak dapat|tidak tahu|kurang jelas|saya tidak/.test(response.toLowerCase());

    if (isUnclear) {
        await handleFallbackResponse({ msg, fullPrompt, GEMINI_API_KEY, greetedNumbers, from, text });
        return;
    }

    await msg.reply(response);
    greetedNumbers.add(from);
    chatHistory.set(from, { question: text, answer: response });
}
