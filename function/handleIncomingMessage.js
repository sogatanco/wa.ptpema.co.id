import { askGeminiFlash } from './askGeminiFlash.js';
import { askGeminiFlashWithoutContext } from './askGeminiFlashWithoutContext.js';
import {
    loadNomorTerdaftar as loadNomorTerdaftarUtil,
    getUserFromContext // tambahkan import ini
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
    const isTerdaftar = nomorVariasi.some(n => nomorTerdaftar.has(n));

    // Menu utama
    if (text === 'menu' & isTerdaftar) {
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
3. Cancel booking rapat
9. Kembali ke menu utama
0. Keluar menu
Ketik angka sesuai pilihan.`;
        await msg.reply(submenuMsg);
        return;
    }

    // Handler submenu Cancel Booking Rapat
    if (userMenuState.get(from) === 'booking' && text === '3') {
        // Ambil rapat yang dibuat oleh user ini
        let rapatList = [];
        try {
            if (fs.existsSync('./rapat.json')) {
                rapatList = JSON.parse(fs.readFileSync('./rapat.json', 'utf8'));
            }
        } catch { }
        // Filter hanya rapat milik user
        const userRapat = rapatList
            .map((r, idx) => ({ ...r, id: idx + 1 }))
            .filter(r => r.user === from);

        if (userRapat.length === 0) {
            await msg.reply('Anda belum pernah membuat booking rapat.');
            return;
        }
        let listMsg = '*ID Booking Rapat Anda:*\n';
        userRapat.forEach(r => {
            listMsg += `ID: ${r.id}\nTanggal: ${r.tanggal}\nJam: ${r.jam}\nAgenda: ${r.agenda}\nRuang: ${r.ruang}\n\n`;
        });
        listMsg += 'Ketik ID rapat yang ingin dibatalkan:';
        userMenuState.set(from, 'cancel-booking-select');
        userBookingData.set(from, { step: 'select-cancel', userRapat });
        await msg.reply(listMsg);
        return;
    }

    // Handler pilih ID booking yang akan dibatalkan
    if (userMenuState.get(from) === 'cancel-booking-select') {
        const booking = userBookingData.get(from);
        if (booking && booking.step === 'select-cancel') {
            const id = parseInt(text);
            if (isNaN(id)) {
                await msg.reply('ID tidak valid. Ketik ID rapat yang ingin dibatalkan:');
                return;
            }
            const rapat = booking.userRapat.find(r => r.id === id);
            if (!rapat) {
                await msg.reply('ID tidak ditemukan. Ketik ID rapat yang ingin dibatalkan:');
                return;
            }
            // Konfirmasi pembatalan
            userBookingData.set(from, { ...booking, step: 'confirm-cancel', cancelId: id });
            await msg.reply(`Apakah Anda yakin ingin membatalkan booking rapat dengan ID ${id}? (Y/N)`);
            return;
        }
    }

    // Handler konfirmasi cancel booking
    if (userMenuState.get(from) === 'cancel-booking-select') {
        const booking = userBookingData.get(from);
        if (booking && booking.step === 'confirm-cancel') {
            if (text.toLowerCase() === 'y' || text.toLowerCase() === 'ya') {
                let rapatList = [];
                try {
                    if (fs.existsSync('./rapat.json')) {
                        rapatList = JSON.parse(fs.readFileSync('./rapat.json', 'utf8'));
                    }
                } catch { }
                const idx = booking.cancelId - 1;
                if (!rapatList[idx] || rapatList[idx].user !== from) {
                    await msg.reply('Booking tidak ditemukan atau bukan milik Anda.');
                    userMenuState.set(from, 'booking');
                    userBookingData.delete(from);
                    return;
                }
                rapatList.splice(idx, 1);
                fs.writeFileSync('./rapat.json', JSON.stringify(rapatList, null, 2));
                await msg.reply('Booking rapat berhasil dibatalkan.');
                userMenuState.set(from, 'booking');
                userBookingData.delete(from);
                return;
            } else if (text.toLowerCase() === 'n' || text.toLowerCase() === 'tidak') {
                await msg.reply('Pembatalan booking dibatalkan.');
                userMenuState.set(from, 'booking');
                userBookingData.delete(from);
                return;
            } else {
                await msg.reply('Jawab dengan Y (ya) atau N (tidak). Apakah Anda yakin ingin membatalkan booking rapat ini? (Y/N)');
                return;
            }
        }
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
        } catch { }
        // Filter hanya rapat dari hari ini ke depan
        const today = dayjs().format('YYYY-MM-DD');
        rapatList = rapatList.filter(r => r.tanggal >= today);

        if (rapatList.length === 0) {
            await msg.reply('Belum ada rapat yang terdaftar.');
        } else {
            let listMsg = '*Daftar Rapat Yang Akan Datang:*\n';
            rapatList.forEach((r, idx) => {
                listMsg += `\n${idx + 1}.\n`;
                listMsg += `Tanggal : ${r.tanggal}\n`;
                listMsg += `Jam     : ${r.jam}\n`;
                listMsg += `Agenda  : ${r.agenda}\n`;
                listMsg += `Ruang   : ${r.ruang}\n`;
                if (r.pic_name) listMsg += `PIC     : ${r.pic_name}\n`;
                if (r.pic_nomor) listMsg += `No HP   : ${r.pic_nomor}\n`;
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
        // Step 1: tanggal
        if (booking && booking.step === 1) {
            if (text === 'kembali') {
                userBookingData.delete(from);
                await msg.reply('Kembali ke menu booking.');
                return;
            }
            if (text === 'cancel') {
                userBookingData.delete(from);
                await msg.reply('Booking dibatalkan.');
                return;
            }
            if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
                await msg.reply('Format tanggal salah. Masukkan tanggal rapat (format: YYYY-MM-DD):\nKetik "kembali" untuk kembali atau "cancel" untuk membatalkan.');
                return;
            }
            booking.tanggal = text;
            booking.step = 2;
            userBookingData.set(from, booking);
            await msg.reply('Masukkan jam rapat (format: HH:mm, contoh: 13:30):\nKetik "kembali" untuk kembali atau "cancel" untuk membatalkan.');
            return;
        }
        // Step 2: jam
        if (booking && booking.step === 2) {
            if (text === 'kembali') {
                booking.step = 1;
                userBookingData.set(from, booking);
                await msg.reply('Masukkan tanggal rapat (format: YYYY-MM-DD):\nKetik "kembali" untuk kembali atau "cancel" untuk membatalkan.');
                return;
            }
            if (text === 'cancel') {
                userBookingData.delete(from);
                await msg.reply('Booking dibatalkan.');
                return;
            }
            if (!/^\d{2}:\d{2}$/.test(text)) {
                await msg.reply('Format jam salah. Masukkan jam rapat (format: HH:mm, contoh: 13:30):\nKetik "kembali" untuk kembali atau "cancel" untuk membatalkan.');
                return;
            }
            booking.jam = text;
            booking.step = 3;
            userBookingData.set(from, booking);
            await msg.reply('Masukkan agenda rapat:\nKetik "kembali" untuk kembali atau "cancel" untuk membatalkan.');
            return;
        }
        // Step 3: agenda
        if (booking && booking.step === 3) {
            if (text === 'kembali') {
                booking.step = 2;
                userBookingData.set(from, booking);
                await msg.reply('Masukkan jam rapat (format: HH:mm, contoh: 13:30):\nKetik "kembali" untuk kembali atau "cancel" untuk membatalkan.');
                return;
            }
            if (text === 'cancel') {
                userBookingData.delete(from);
                await msg.reply('Booking dibatalkan.');
                return;
            }
            if (!text || text.length < 3) {
                await msg.reply('Agenda rapat tidak boleh kosong. Masukkan agenda rapat:\nKetik "kembali" untuk kembali atau "cancel" untuk membatalkan.');
                return;
            }
            booking.agenda = text;
            booking.step = 4;
            userBookingData.set(from, booking);
            await msg.reply('Pilih ruang rapat:\na. Growth\nb. Harmony\nc. Ruang PAC\nKetik huruf sesuai pilihan.\nKetik "kembali" untuk kembali atau "cancel" untuk membatalkan.');
            return;
        }
        // Step 4: ruang
        if (booking && booking.step === 4) {
            if (text === 'kembali') {
                booking.step = 3;
                userBookingData.set(from, booking);
                await msg.reply('Masukkan agenda rapat:\nKetik "kembali" untuk kembali atau "cancel" untuk membatalkan.');
                return;
            }
            if (text === 'cancel') {
                userBookingData.delete(from);
                await msg.reply('Booking dibatalkan.');
                return;
            }
            let ruang = '';
            if (text === 'a') ruang = 'Growth';
            else if (text === 'b') ruang = 'Harmony';
            else if (text === 'c') ruang = 'Ruang PAC';
            else {
                await msg.reply('Pilihan ruang tidak valid. Pilih ruang rapat:\na. Growth\nb. Harmony\nc. Ruang PAC\nKetik huruf sesuai pilihan.\nKetik "kembali" untuk kembali atau "cancel" untuk membatalkan.');
                return;
            }
            booking.ruang = ruang;
            booking.step = 5;
            userBookingData.set(from, booking);
            await msg.reply('Apakah butuh link Zoom Meeting? (Y/N)\nKetik "kembali" untuk kembali atau "cancel" untuk membatalkan.');
            return;
        }
        // Step 5: butuh zoom
        if (booking && booking.step === 5) {
            if (text === 'kembali') {
                booking.step = 4;
                userBookingData.set(from, booking);
                await msg.reply('Pilih ruang rapat:\na. Growth\nb. Harmony\nc. Ruang PAC\nKetik huruf sesuai pilihan.\nKetik "kembali" untuk kembali atau "cancel" untuk membatalkan.');
                return;
            }
            if (text === 'cancel') {
                userBookingData.delete(from);
                await msg.reply('Booking dibatalkan.');
                return;
            }
            if (text === 'y' || text === 'ya') {
                booking.butuh_zoom = true;
            } else if (text === 'n' || text === 'tidak') {
                booking.butuh_zoom = false;
            } else {
                await msg.reply('Jawab dengan Y (ya) atau N (tidak). Apakah butuh link Zoom Meeting? (Y/N)\nKetik "kembali" untuk kembali atau "cancel" untuk membatalkan.');
                return;
            }
            booking.step = 6;
            userBookingData.set(from, booking);
            await msg.reply('Apakah butuh konsumsi? (Y/N)\nKetik "kembali" untuk kembali atau "cancel" untuk membatalkan.');
            return;
        }
        // Step 6: butuh konsumsi
        if (booking && booking.step === 6) {
            if (text === 'kembali') {
                booking.step = 5;
                userBookingData.set(from, booking);
                await msg.reply('Apakah butuh link Zoom Meeting? (Y/N)\nKetik "kembali" untuk kembali atau "cancel" untuk membatalkan.');
                return;
            }
            if (text === 'cancel') {
                userBookingData.delete(from);
                await msg.reply('Booking dibatalkan.');
                return;
            }
            if (text === 'y' || text === 'ya') {
                booking.butuh_konsumsi = true;
                booking.step = 7;
                userBookingData.set(from, booking);
                await msg.reply('Sebutkan detail konsumsi yang diminta (format teks, contoh: "Snack dan kopi untuk 10 orang"):\nKetik "kembali" untuk kembali atau "cancel" untuk membatalkan.');
                return;
            } else if (text === 'n' || text === 'tidak') {
                booking.butuh_konsumsi = false;
                booking.konsumsi_detail = '';
                booking.step = 8;
                userBookingData.set(from, booking);
                // langsung ke proses simpan
            } else {
                await msg.reply('Jawab dengan Y (ya) atau N (tidak). Apakah butuh konsumsi? (Y/N)\nKetik "kembali" untuk kembali atau "cancel" untuk membatalkan.');
                return;
            }
        }
        // Step 7: detail konsumsi
        if (booking && booking.step === 7) {
            if (text === 'kembali') {
                booking.step = 6;
                userBookingData.set(from, booking);
                await msg.reply('Apakah butuh konsumsi? (Y/N)\nKetik "kembali" untuk kembali atau "cancel" untuk membatalkan.');
                return;
            }
            if (text === 'cancel') {
                userBookingData.delete(from);
                await msg.reply('Booking dibatalkan.');
                return;
            }
            if (!text || text.length < 3) {
                await msg.reply('Detail konsumsi tidak boleh kosong. Sebutkan detail konsumsi yang diminta:\nKetik "kembali" untuk kembali atau "cancel" untuk membatalkan.');
                return;
            }
            booking.konsumsi_detail = text;
            booking.step = 8;
            userBookingData.set(from, booking);
            // lanjut ke proses simpan
        }
        // Step 8: simpan booking
        if (booking && booking.step === 8) {
            // Ambil nama PIC dan nomor HP dari context
            const userData = getUserFromContext(nomor);
            let pic_name = userData.nama;
            let pic_nomor = nomor;

            // Simpan ke file rapat.json
            let rapatList = [];
            try {
                if (fs.existsSync('./rapat.json')) {
                    rapatList = JSON.parse(fs.readFileSync('./rapat.json', 'utf8'));
                }
            } catch { }
            rapatList.push({
                tanggal: booking.tanggal,
                jam: booking.jam,
                agenda: booking.agenda,
                ruang: booking.ruang,
                user: from,
                pic_name,
                pic_nomor,
                butuh_zoom: booking.butuh_zoom || false,
                butuh_konsumsi: booking.butuh_konsumsi,
                konsumsi_detail: booking.konsumsi_detail || ''
            });
            fs.writeFileSync('./rapat.json', JSON.stringify(rapatList, null, 2));
            userBookingData.delete(from);

            let konsumsiMsg = '';
            if (booking.butuh_konsumsi) {
                konsumsiMsg = `Konsumsi: ${booking.konsumsi_detail}`;
            } else {
                konsumsiMsg = 'Konsumsi: Tidak';
            }
            let zoomMsg = '';
            if (booking.butuh_zoom) {
                zoomMsg = 'Butuh link Zoom Meeting: Ya';
            } else {
                zoomMsg = 'Butuh link Zoom Meeting: Tidak';
            }

            await msg.reply(
                `Booking ruang rapat berhasil!\nTanggal: ${booking.tanggal}\nJam: ${booking.jam}\nAgenda: ${booking.agenda}\nRuang: ${booking.ruang}\n${zoomMsg}\n${konsumsiMsg}`
            );
            // Tampilkan menu booking lagi
            const submenuMsg =
                `*BOOKING RUANG RAPAT*
1. List rapat yang akan datang
2. Booking ruang rapat
3. Cancel booking rapat
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
