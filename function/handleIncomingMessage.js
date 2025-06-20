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
3. Edit booking rapat
9. Kembali ke menu utama
0. Keluar menu
Ketik angka sesuai pilihan.`;
        await msg.reply(submenuMsg);
        return;
    }

    // Handler menu Edit Booking Rapat
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
        listMsg += 'Ketik ID rapat yang ingin diedit:';
        userMenuState.set(from, 'edit-booking-select');
        userBookingData.set(from, { step: 'select-edit', userRapat });
        await msg.reply(listMsg);
        return;
    }

    // Handler pilih ID booking yang akan diedit
    if (userMenuState.get(from) === 'edit-booking-select') {
        const booking = userBookingData.get(from);
        if (booking && booking.step === 'select-edit') {
            const id = parseInt(text);
            if (isNaN(id)) {
                await msg.reply('ID tidak valid. Ketik ID rapat yang ingin diedit:');
                return;
            }
            const rapat = booking.userRapat.find(r => r.id === id);
            if (!rapat) {
                await msg.reply('ID tidak ditemukan. Ketik ID rapat yang ingin diedit:');
                return;
            }
            // Simpan data rapat yang akan diedit
            userBookingData.set(from, { step: 'edit-field', editId: id, rapat });
            userMenuState.set(from, 'edit-booking-field');
            // Tampilkan field yang bisa diedit
            await msg.reply(
                `Edit booking rapat (ID: ${id}):\n` +
                `1. Tanggal (${rapat.tanggal})\n` +
                `2. Jam (${rapat.jam})\n` +
                `3. Agenda (${rapat.agenda})\n` +
                `4. Ruang (${rapat.ruang})\n` +
                `5. Konsumsi (${rapat.butuh_konsumsi ? rapat.konsumsi_detail : 'Tidak'})\n` +
                `9. Batal edit\n` +
                `Ketik angka sesuai field yang ingin diedit.`
            );
            return;
        }
    }

    // Handler edit field booking
    if (userMenuState.get(from) === 'edit-booking-field') {
        const booking = userBookingData.get(from);
        if (booking && booking.step === 'edit-field') {
            const field = text.trim();
            if (field === '9') {
                userMenuState.set(from, 'booking');
                userBookingData.delete(from);
                await msg.reply('Edit booking dibatalkan.');
                return;
            }
            // Simpan field yang akan diedit
            let promptMsg = '';
            if (field === '1') promptMsg = 'Masukkan tanggal baru (format: YYYY-MM-DD):';
            else if (field === '2') promptMsg = 'Masukkan jam baru (format: HH:mm):';
            else if (field === '3') promptMsg = 'Masukkan agenda baru:';
            else if (field === '4') promptMsg = 'Pilih ruang rapat baru:\na. Growth\nb. Harmony\nc. Ruang PAC\nKetik huruf sesuai pilihan.';
            else if (field === '5') promptMsg = 'Masukkan detail konsumsi baru (atau ketik "tidak" jika tidak butuh konsumsi):';
            else {
                await msg.reply('Pilihan tidak valid. Ketik angka sesuai field yang ingin diedit.');
                return;
            }
            userBookingData.set(from, { ...booking, step: 'edit-value', field });
            await msg.reply(promptMsg);
            return;
        }
    }

    // Handler input value baru untuk field yang diedit
    if (userMenuState.get(from) === 'edit-booking-field') {
        const booking = userBookingData.get(from);
        if (booking && booking.step === 'edit-value') {
            let rapatList = [];
            try {
                if (fs.existsSync('./rapat.json')) {
                    rapatList = JSON.parse(fs.readFileSync('./rapat.json', 'utf8'));
                }
            } catch { }
            const idx = booking.editId - 1;
            if (!rapatList[idx] || rapatList[idx].user !== from) {
                await msg.reply('Booking tidak ditemukan atau bukan milik Anda.');
                userMenuState.set(from, 'booking');
                userBookingData.delete(from);
                return;
            }
            let value = text.trim();
            if (booking.field === '1') {
                if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
                    await msg.reply('Format tanggal salah. Masukkan tanggal baru (format: YYYY-MM-DD):');
                    return;
                }
                rapatList[idx].tanggal = value;
            } else if (booking.field === '2') {
                if (!/^\d{2}:\d{2}$/.test(value)) {
                    await msg.reply('Format jam salah. Masukkan jam baru (format: HH:mm):');
                    return;
                }
                rapatList[idx].jam = value;
            } else if (booking.field === '3') {
                if (!value || value.length < 3) {
                    await msg.reply('Agenda tidak boleh kosong. Masukkan agenda baru:');
                    return;
                }
                rapatList[idx].agenda = value;
            } else if (booking.field === '4') {
                if (value === 'a') rapatList[idx].ruang = 'Growth';
                else if (value === 'b') rapatList[idx].ruang = 'Harmony';
                else if (value === 'c') rapatList[idx].ruang = 'Ruang PAC';
                else {
                    await msg.reply('Pilihan ruang tidak valid. Pilih ruang rapat baru:\na. Growth\nb. Harmony\nc. Ruang PAC\nKetik huruf sesuai pilihan.');
                    return;
                }
            } else if (booking.field === '5') {
                if (value.toLowerCase() === 'tidak') {
                    rapatList[idx].butuh_konsumsi = false;
                    rapatList[idx].konsumsi_detail = '';
                } else {
                    rapatList[idx].butuh_konsumsi = true;
                    rapatList[idx].konsumsi_detail = value;
                }
            }
            fs.writeFileSync('./rapat.json', JSON.stringify(rapatList, null, 2));
            userMenuState.set(from, 'booking');
            userBookingData.delete(from);
            await msg.reply('Booking rapat berhasil diupdate.');
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
