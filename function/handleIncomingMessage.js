import { askGeminiFlash } from './askGeminiFlash.js';
import { askGeminiFlashWithoutContext } from './askGeminiFlashWithoutContext.js';
import {
    loadNomorTerdaftar as loadNomorTerdaftarUtil,
    getUserFromContext,
    isMeetingConflict,
    checkMeetingConflict // tambahkan import ini
} from './utils.js';
import { handleZoomMeeting } from './zoomMeetingHandler.js';
// Tambahkan import:
import { createZoomMeetingWithConflict, deleteZoomMeeting } from './zoom.js';
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
        await new Promise(res => setTimeout(res, 2000));
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
        await new Promise(res => setTimeout(res, 2000));
        await msg.reply(submenuMsg);
        return;
    }

    // Handler submenu Zoom Meeting
    if (userMenuState.get(from) === 'main' && text === '2' && isTerdaftar) {
        userMenuState.set(from, 'zoom');
        const submenuMsg =
            `*ZOOM MEETING*\n` +
            `1. Zoom meeting yang akan datang\n` +
            `2. Buat link Zoom\n` +
            `3. Cancel Zoom meeting\n` +
            `9. Kembali ke menu utama\n` +
            `0. Keluar menu\n` +
            `Ketik angka sesuai pilihan.`;
        await new Promise(res => setTimeout(res, 2000));
        await msg.reply(submenuMsg);
        return;
    }

    // Handler submenu Zoom Meeting - kembali ke menu utama
    if (userMenuState.get(from) === 'zoom' && text === '9') {
        userMenuState.set(from, 'main');
        const menuMsg =
            `*MENU UTAMA*\n1. Booking Ruang Rapat\n2. Zoom Meeting\n3. Keluar`;
        await new Promise(res => setTimeout(res, 2000));
        await msg.reply('Anda kembali ke menu utama.\n\n' + menuMsg);
        return;
    }

    // Handler submenu Zoom Meeting - keluar menu
    if (userMenuState.get(from) === 'zoom' && text === '0') {
        userMenuState.delete(from);
        await new Promise(res => setTimeout(res, 2000));
        await msg.reply('Anda telah keluar dari menu Zoom Meeting.');
        return;
    }

    // Handler submenu Zoom Meeting - list meeting yang akan datang
    if (userMenuState.get(from) === 'zoom' && text === '1') {
        let logFile = './meeting_log.json';
        let logs = [];
        if (fs.existsSync(logFile)) {
            try {
                const raw = fs.readFileSync(logFile, 'utf8');
                logs = JSON.parse(raw);
                if (!Array.isArray(logs)) logs = [];
            } catch { logs = []; }
        }
        // Filter hanya meeting yang akan datang
        const today = dayjs().tz('Asia/Jakarta').format('YYYY-MM-DD');
        const futureMeetings = logs.filter(m => m.tgl >= today)
            .sort((a, b) => a.tgl === b.tgl ? a.jam.localeCompare(b.jam) : a.tgl.localeCompare(b.tgl));
        let submenuMsg =
            `*ZOOM MEETING*\n` +
            `1. Zoom meeting yang akan datang\n` +
            `2. Buat link Zoom\n` +
            `3. Cancel Zoom meeting\n` +
            `9. Kembali ke menu utama\n` +
            `0. Keluar menu\n` +
            `Ketik angka sesuai pilihan.`;
        if (futureMeetings.length === 0) {
            await new Promise(res => setTimeout(res, 2000));
            await msg.reply('Belum ada Zoom meeting yang akan datang.');
            await new Promise(res => setTimeout(res, 2000));
            await msg.reply(submenuMsg);
        } else {
            let listMsg = '*Daftar Zoom Meeting Yang Akan Datang:*\n';
            futureMeetings.forEach((m, idx) => {
                listMsg += `${idx + 1}. *${m.topic}*\n   waktu: ${m.tgl} / ${m.jam}\n   ID: ${m.id || '-'}\n   PIC: ${m.nama || '-'}\n   Link: ${m.url || '-'}\n`;
            });
            await new Promise(res => setTimeout(res, 2000));
            await msg.reply(listMsg);
            await new Promise(res => setTimeout(res, 2000));
            await msg.reply(submenuMsg);
        }
        return;
    }

    // Handler submenu Zoom Meeting - buat link zoom
    if (userMenuState.get(from) === 'zoom' && text === '2') {
        userMenuState.set(from, 'zoom-create-form');
        userBookingData.set(from, { step: 1 });
        await new Promise(res => setTimeout(res, 2000));
        await msg.reply('Masukkan topik meeting Zoom:');
        return;
    }

    // Handler form step-by-step Zoom Meeting
    if (userMenuState.get(from) === 'zoom-create-form') {
        let booking = userBookingData.get(from) || { step: 1 };
        // Step 1: Topik
        if (booking.step === 1) {
            if (!text || text.length < 3) {
                await new Promise(res => setTimeout(res, 2000));
                await msg.reply('Topik tidak boleh kosong. Masukkan topik meeting Zoom:');
                return;
            }
            booking.topic = msg.body.trim();
            booking.step = 2;
            userBookingData.set(from, booking);
            await new Promise(res => setTimeout(res, 2000));
            await msg.reply('Masukkan tanggal meeting Zoom (format: YYYY-MM-DD):');
            return;
        }
        // Step 2: Tanggal
        if (booking.step === 2) {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
                await new Promise(res => setTimeout(res, 2000));
                await msg.reply('Format tanggal salah. Masukkan tanggal meeting Zoom (format: YYYY-MM-DD):');
                return;
            }
            const today = dayjs().format('YYYY-MM-DD');
            if (text < today) {
                await new Promise(res => setTimeout(res, 2000));
                await msg.reply('Tanggal meeting tidak boleh sebelum hari ini. Masukkan tanggal meeting Zoom (format: YYYY-MM-DD):');
                return;
            }
            booking.tanggal = text;
            booking.step = 3;
            userBookingData.set(from, booking);
            await new Promise(res => setTimeout(res, 2000));
            await msg.reply('Masukkan jam mulai meeting Zoom (format: HH:mm, contoh: 13:30):');
            return;
        }
        // Step 3: Jam mulai
        if (booking.step === 3) {
            if (!/^\d{2}:\d{2}$/.test(text)) {
                await new Promise(res => setTimeout(res, 2000));
                await msg.reply('Format jam salah. Masukkan jam mulai meeting Zoom (format: HH:mm, contoh: 13:30):');
                return;
            }
            // Validasi jam mulai tidak boleh sebelum waktu sekarang jika tanggal hari ini
            const now = dayjs();
            if (booking.tanggal === now.format('YYYY-MM-DD')) {
                const jamNow = now.format('HH:mm');
                if (text < jamNow) {
                    await new Promise(res => setTimeout(res, 2000));
                    await msg.reply('Jam mulai tidak boleh sebelum waktu sekarang. Masukkan jam mulai meeting Zoom (format: HH:mm, contoh: 13:30):');
                    return;
                }
            }
            booking.jam_mulai = text;
            booking.step = 4;
            userBookingData.set(from, booking);
            await new Promise(res => setTimeout(res, 2000));
            await msg.reply('Masukkan jam selesai meeting Zoom (format: HH:mm, contoh: 15:00):');
            return;
        }
        // Step 4: Jam selesai
        if (booking.step === 4) {
            if (!/^\d{2}:\d{2}$/.test(text)) {
                await new Promise(res => setTimeout(res, 2000));
                await msg.reply('Format jam salah. Masukkan jam selesai meeting Zoom (format: HH:mm, contoh: 15:00):');
                return;
            }
            // Validasi jam selesai harus lebih besar dari jam mulai
            const toMinutes = jam => {
                const [h, m] = jam.split(':').map(Number);
                return h * 60 + m;
            };
            if (toMinutes(text) <= toMinutes(booking.jam_mulai)) {
                await new Promise(res => setTimeout(res, 2000));
                await msg.reply('Jam selesai harus lebih besar dari jam mulai. Masukkan jam selesai meeting Zoom (format: HH:mm, contoh: 15:00):');
                return;
            }
            booking.jam_selesai = text;
            booking.step = 5;
            userBookingData.set(from, booking);
            // Proses pembuatan Zoom
            // Siapkan data
            const dateStr = booking.tanggal;
            const jamMulai = booking.jam_mulai;
            const jamSelesai = booking.jam_selesai;
            const dateTimeStr = `${dateStr} ${jamMulai}`;
            const meetingTime = dayjs.tz(dateTimeStr, 'YYYY-MM-DD HH:mm', 'Asia/Jakarta');
            const isoStart = meetingTime.utc().format();
            let isoEnd = null;
            if (jamSelesai) {
                const endDateTimeStr = `${dateStr} ${jamSelesai}`;
                const endTime = dayjs.tz(endDateTimeStr, 'YYYY-MM-DD HH:mm', 'Asia/Jakarta');
                isoEnd = endTime.utc().format();
            }
            // Ambil log Zoom
            let logFile = './meeting_log.json';
            let logs = [];
            if (fs.existsSync(logFile)) {
                try {
                    const raw = fs.readFileSync(logFile, 'utf8');
                    logs = JSON.parse(raw);
                    if (!Array.isArray(logs)) logs = [];
                } catch { logs = []; }
            }
            // Cek & buat Zoom
            const userData = getUserFromContext(nomor);
            const { meeting: zoomResult, accountIdx, schedule_for } = await createZoomMeetingWithConflict(
                booking.topic,
                isoStart,
                isoEnd,
                checkMeetingConflict,
                logs
            );
            if (!zoomResult) {
                userBookingData.delete(from);
                await new Promise(res => setTimeout(res, 2000));
                await msg.reply('❌ Jadwal Zoom bentrok/konflik dengan meeting lain di kedua akun Zoom. Silakan pilih waktu lain.');
                userMenuState.set(from, 'zoom');
                return;
            }
            // Simpan log Zoom
            logs.push({
                nomor_user: from,
                employe_id: userData.employeeId,
                nama: userData.nama,
                topic: booking.topic,
                jam: meetingTime.format('HH:mm'),
                tgl: booking.tanggal,
                url: zoomResult.join_url || '',
                id: zoomResult.id || '',
                account: accountIdx,
                schedule_for: schedule_for
            });
            fs.writeFileSync(logFile, JSON.stringify(logs, null, 2));
            userBookingData.delete(from);
            await msg.reply(
                `Zoom meeting berhasil dibuat!\n` +
                `Topik: ${booking.topic}\n` +
                `Tanggal: ${booking.tanggal}\n` +
                `Jam: ${booking.jam_mulai} - ${booking.jam_selesai}\n` +
                `🔗 Link: ${zoomResult.join_url}\n` +
                `🆔 ID Meeting: ${zoomResult.personal_meeting_id || zoomResult.id || '-'}\n` +
                `🔑 Password: ${zoomResult.password || '-'}`
            );
            userMenuState.set(from, 'zoom');
            // Tampilkan menu Zoom lagi
            const submenuMsg =
                `*ZOOM MEETING*\n` +
                `1. Zoom meeting yang akan datang\n` +
                `2. Buat link Zoom\n` +
                `3. Cancel Zoom meeting\n` +
                `9. Kembali ke menu utama\n` +
                `0. Keluar menu\n` +
                `Ketik angka sesuai pilihan.`;
            await new Promise(res => setTimeout(res, 2000));
            await msg.reply(submenuMsg);
            return;
        }
    }

    // Handler submenu Zoom Meeting - cancel zoom meeting
    if (userMenuState.get(from) === 'zoom' && text === '3') {
        let logFile = './meeting_log.json';
        let logs = [];
        if (fs.existsSync(logFile)) {
            try {
                const raw = fs.readFileSync(logFile, 'utf8');
                logs = JSON.parse(raw);
                if (!Array.isArray(logs)) logs = [];
            } catch { logs = []; }
        }
        // Filter meeting milik user dan dari jam sekarang ke depan
        const now = dayjs().tz('Asia/Jakarta');
        const userMeetings = logs
            .map((m, idx) => ({ ...m, idx: idx + 1 }))
            .filter(m => m.nomor_user === from && (
                m.tgl > now.format('YYYY-MM-DD') ||
                (m.tgl === now.format('YYYY-MM-DD') && (!m.jam || m.jam >= now.format('HH:mm')))
            ));
        let submenuMsg =
            `*ZOOM MEETING*\n` +
            `1. Zoom meeting yang akan datang\n` +
            `2. Buat link Zoom\n` +
            `3. Cancel Zoom meeting\n` +
            `9. Kembali ke menu utama\n` +
            `0. Keluar menu\n` +
            `Ketik angka sesuai pilihan.`;
        if (userMeetings.length === 0) {
            await new Promise(res => setTimeout(res, 2000));
            await msg.reply('Anda belum pernah membuat Zoom meeting yang akan datang.');
            await new Promise(res => setTimeout(res, 2000));
            await msg.reply(submenuMsg);
            return;
        }
        let listMsg = '*ID Zoom Meeting Anda (yang akan datang):*\n';
        userMeetings.forEach(m => {
            listMsg += `ID: ${m.idx}\nTanggal: ${m.tgl}\nJam: ${m.jam}\nTopik: ${m.topic}\nID Meeting: ${m.id || '-'}\n\n`;
        });
        listMsg += 'Ketik ID Zoom meeting yang ingin dibatalkan:';
        userMenuState.set(from, 'zoom-cancel-select');
        userBookingData.set(from, { step: 'select-cancel-zoom', userMeetings });
        await new Promise(res => setTimeout(res, 2000));
        await msg.reply(listMsg);
        await new Promise(res => setTimeout(res, 2000));
        await msg.reply(submenuMsg);
        return;
    }

    // Handler pilih ID zoom meeting yang akan dibatalkan
    if (userMenuState.get(from) === 'zoom-cancel-select') {
        const booking = userBookingData.get(from);
        if (booking && booking.step === 'select-cancel-zoom') {
            const id = parseInt(text);
            if (isNaN(id)) {
                await new Promise(res => setTimeout(res, 2000));
                await msg.reply('ID tidak valid. Ketik ID Zoom meeting yang ingin dibatalkan:');
                return;
            }
            const meeting = booking.userMeetings.find(m => m.idx === id);
            if (!meeting) {
                await new Promise(res => setTimeout(res, 2000));
                await msg.reply('ID tidak ditemukan. Ketik ID Zoom meeting yang ingin dibatalkan:');
                return;
            }
            // Hapus dari Zoom API jika ada ID meeting
            if (meeting.id) {
                try {
                    let accountIdx = meeting.account || 1;
                    await deleteZoomMeeting(meeting.id, accountIdx);
                } catch (err) {
                    // Jika error 404 (meeting sudah tidak ada di Zoom), abaikan
                    if (err.response && err.response.status === 404) {
                        console.warn('⚠️ Meeting Zoom sudah tidak ada di Zoom API, lanjut hapus log lokal.');
                    } else {
                        console.error('❌ Gagal hapus meeting di Zoom API:', err.message);
                        // Tetap lanjut hapus dari log lokal
                    }
                }
            }
            // Hapus dari log berdasarkan ID Zoom (bukan index)
            let logFile = './meeting_log.json';
            let logs = [];
            if (fs.existsSync(logFile)) {
                try {
                    const raw = fs.readFileSync(logFile, 'utf8');
                    logs = JSON.parse(raw);
                    if (!Array.isArray(logs)) logs = [];
                } catch { logs = []; }
            }
            logs = logs.filter(m => !(m.id == meeting.id && m.nomor_user === from));
            fs.writeFileSync(logFile, JSON.stringify(logs, null, 2));
            await new Promise(res => setTimeout(res, 2000));
            await msg.reply('Zoom meeting berhasil dibatalkan.');
            // Tampilkan submenu setelah hapus
            let submenuMsg =
                `*ZOOM MEETING*\n` +
                `1. Zoom meeting yang akan datang\n` +
                `2. Buat link Zoom\n` +
                `3. Cancel Zoom meeting\n` +
                `9. Kembali ke menu utama\n` +
                `0. Keluar menu\n` +
                `Ketik angka sesuai pilihan.`;
            await new Promise(res => setTimeout(res, 2000));
            await msg.reply(submenuMsg);
            userMenuState.set(from, 'zoom');
            userBookingData.delete(from);
            return;
        }
    }

    // Handler submenu Zoom Meeting - buat link zoom (input detail meeting)
    if (userMenuState.get(from) === 'zoom-create') {
        // Panggil handler Zoom Meeting seperti handleZoomMeeting
        await handleZoomMeeting({ msg, nomor, GEMINI_API_KEY });
        userMenuState.set(from, 'zoom');
        // Tampilkan submenu setelah buat link zoom
        let submenuMsg =
            `*ZOOM MEETING*\n` +
            `1. Zoom meeting yang akan datang\n` +
            `2. Buat link Zoom\n` +
            `3. Cancel Zoom meeting\n` +
            `9. Kembali ke menu utama\n` +
            `0. Keluar menu\n` +
            `Ketik angka sesuai pilihan.`;
        await new Promise(res => setTimeout(res, 2000));
        await msg.reply(submenuMsg);
        return;
    }

    // Handler submenu Cancel Booking Rapat
    if (userMenuState.get(from) === 'booking' && text === '3') {
        // Ambil rapat yang dibuat oleh user ini dan dari jam sekarang ke depan
        let rapatList = [];
        try {
            if (fs.existsSync('./rapat.json')) {
                rapatList = JSON.parse(fs.readFileSync('./rapat.json', 'utf8'));
            }
        } catch { }
        const now = dayjs().tz('Asia/Jakarta');
        // Filter hanya rapat milik user dan dari jam sekarang ke depan
        const userRapat = rapatList
            .map((r, idx) => ({ ...r, id: idx + 1 }))
            .filter(r =>
                r.user === from &&
                (
                    r.tanggal > now.format('YYYY-MM-DD') ||
                    (r.tanggal === now.format('YYYY-MM-DD') && (!r.jam || r.jam >= now.format('HH:mm')))
                )
            );

        let submenuMsg =
            `*BOOKING RUANG RAPAT*\n` +
            `1. List rapat yang akan datang\n` +
            `2. Booking ruang rapat\n` +
            `3. Cancel booking rapat\n` +
            `9. Kembali ke menu utama\n` +
            `0. Keluar menu\n` +
            `Ketik angka sesuai pilihan.`;

        if (userRapat.length === 0) {
            await new Promise(res => setTimeout(res, 2000));
            await msg.reply('Anda belum pernah membuat booking rapat yang akan datang.');
            await new Promise(res => setTimeout(res, 2000));
            await msg.reply(submenuMsg);
            return;
        }
        let listMsg = '*ID Booking Rapat Anda (yang akan datang):*\n';
        userRapat.forEach(r => {
            listMsg += `ID: ${r.id}\nTanggal: ${r.tanggal}\nJam: ${r.jam}\nAgenda: ${r.agenda}\nRuang: ${r.ruang}\n\n`;
        });
        listMsg += 'Ketik ID rapat yang ingin dibatalkan:';
        userMenuState.set(from, 'cancel-booking-select');
        userBookingData.set(from, { step: 'select-cancel', userRapat });
        await new Promise(res => setTimeout(res, 2000));
        await msg.reply(listMsg);
        await new Promise(res => setTimeout(res, 2000));
        await msg.reply(submenuMsg);
        return;
    }

    // Handler pilih ID booking yang akan dibatalkan
    if (userMenuState.get(from) === 'cancel-booking-select') {
        const booking = userBookingData.get(from);
        if (booking && booking.step === 'select-cancel') {
            const id = parseInt(text);
            if (isNaN(id)) {
                await new Promise(res => setTimeout(res, 2000));
                await msg.reply('ID tidak valid. Ketik ID rapat yang ingin dibatalkan:');
                return;
            }
            const rapat = booking.userRapat.find(r => r.id === id);
            if (!rapat) {
                await new Promise(res => setTimeout(res, 2000));
                await msg.reply('ID tidak ditemukan. Ketik ID rapat yang ingin dibatalkan:');
                return;
            }
            // Konfirmasi pembatalan
            userBookingData.set(from, { ...booking, step: 'confirm-cancel', cancelId: id });
            await new Promise(res => setTimeout(res, 2000));
            await msg.reply(`Apakah Anda yakin ingin membatalkan booking rapat dengan ID ${id}? (Y/N)`);
            let submenuMsg =
                `*BOOKING RUANG RAPAT*\n` +
                `1. List rapat yang akan datang\n` +
                `2. Booking ruang rapat\n` +
                `3. Cancel booking rapat\n` +
                `9. Kembali ke menu utama\n` +
                `0. Keluar menu\n` +
                `Ketik angka sesuai pilihan.`;
            await new Promise(res => setTimeout(res, 2000));
            await msg.reply(submenuMsg);
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
                    await new Promise(res => setTimeout(res, 2000));
                    await msg.reply('Booking tidak ditemukan atau bukan milik Anda.');
                    userMenuState.set(from, 'booking');
                    userBookingData.delete(from);
                    return;
                }

                // Jika booking punya Zoom, hapus juga di Zoom API
                const rapat = rapatList[idx];
                if (rapat.butuh_zoom && rapat.zoom_id) {
                    try {
                        // Cari log Zoom untuk dapatkan accountIdx
                        let logFile = './meeting_log.json';
                        let logs = [];
                        if (fs.existsSync(logFile)) {
                            try {
                                const raw = fs.readFileSync(logFile, 'utf8');
                                logs = JSON.parse(raw);
                                if (!Array.isArray(logs)) logs = [];
                            } catch { logs = []; }
                        }
                        const logZoom = logs.find(l => l.id == rapat.zoom_id && l.nomor_user === from);
                        let accountIdx = logZoom && logZoom.account ? logZoom.account : 1;
                        await deleteZoomMeeting(rapat.zoom_id, accountIdx);

                        // Hapus juga dari log Zoom
                        logs = logs.filter(l => !(l.id == rapat.zoom_id && l.nomor_user === from));
                        fs.writeFileSync(logFile, JSON.stringify(logs, null, 2));
                    } catch (err) {
                        // Jika error 404 (meeting sudah tidak ada di Zoom), abaikan
                        if (err && err.response && err.response.status === 404) {
                            console.warn('⚠️ Meeting Zoom sudah tidak ada di Zoom API, lanjut hapus booking.');
                        } else {
                            console.error('❌ Gagal hapus Zoom meeting saat cancel booking rapat:', err.message);
                        }
                    }
                }

                rapatList.splice(idx, 1);
                fs.writeFileSync('./rapat.json', JSON.stringify(rapatList, null, 2));
                await new Promise(res => setTimeout(res, 2000));
                await msg.reply('Booking rapat berhasil dibatalkan.');
                // Tampilkan submenu setelah hapus booking
                let submenuMsg =
                    `*BOOKING RUANG RAPAT*\n` +
                    `1. List rapat yang akan datang\n` +
                    `2. Booking ruang rapat\n` +
                    `3. Cancel booking rapat\n` +
                    `9. Kembali ke menu utama\n` +
                    `0. Keluar menu\n` +
                    `Ketik angka sesuai pilihan.`;
                await new Promise(res => setTimeout(res, 2000));
                await msg.reply(submenuMsg);
                userMenuState.set(from, 'booking');
                userBookingData.delete(from);
                return;
            } else if (text.toLowerCase() === 'n' || text.toLowerCase() === 'tidak') {
                await new Promise(res => setTimeout(res, 2000));
                await msg.reply('Pembatalan booking dibatalkan.');
                let submenuMsg =
                    `*BOOKING RUANG RAPAT*\n` +
                    `1. List rapat yang akan datang\n` +
                    `2. Booking ruang rapat\n` +
                    `3. Cancel booking rapat\n` +
                    `9. Kembali ke menu utama\n` +
                    `0. Keluar menu\n` +
                    `Ketik angka sesuai pilihan.`;
                await new Promise(res => setTimeout(res, 2000));
                await msg.reply(submenuMsg);
                userMenuState.set(from, 'booking');
                userBookingData.delete(from);
                return;
            } else {
                await new Promise(res => setTimeout(res, 2000));
                await msg.reply('Jawab dengan Y (ya) atau N (tidak). Apakah Anda yakin ingin membatalkan booking rapat ini? (Y/N)');
                let submenuMsg =
                    `*BOOKING RUANG RAPAT*\n` +
                    `1. List rapat yang akan datang\n` +
                    `2. Booking ruang rapat\n` +
                    `3. Cancel booking rapat\n` +
                    `9. Kembali ke menu utama\n` +
                    `0. Keluar menu\n` +
                    `Ketik angka sesuai pilihan.`;
                await new Promise(res => setTimeout(res, 2000));
                await msg.reply(submenuMsg);
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
        await new Promise(res => setTimeout(res, 2000));
        await msg.reply('Anda kembali ke menu utama.\n\n' + menuMsg);
        return;
    }

    // Handler keluar dari menu (hapus state)
    if (userMenuState.get(from) === 'booking' && text === '0') {
        userMenuState.delete(from);
        userBookingData.delete(from);
        await new Promise(res => setTimeout(res, 2000));
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

        let submenuMsg =
            `*BOOKING RUANG RAPAT*\n` +
            `1. List rapat yang akan datang\n` +
            `2. Booking ruang rapat\n` +
            `3. Cancel booking rapat\n` +
            `9. Kembali ke menu utama\n` +
            `0. Keluar menu\n` +
            `Ketik angka sesuai pilihan.`;

        if (rapatList.length === 0) {
            await new Promise(res => setTimeout(res, 2000));
            await msg.reply('Belum ada rapat yang terdaftar.');
            await new Promise(res => setTimeout(res, 2000));
            await msg.reply(submenuMsg);
        } else {
            // Kelompokkan berdasarkan ruang
            const ruangMap = {};
            rapatList.forEach((r, idx) => {
                if (!ruangMap[r.ruang]) ruangMap[r.ruang] = [];
                ruangMap[r.ruang].push({ ...r, idx: idx + 1 });
            });

            // Fungsi untuk meratakan label (10 karakter)
            const padLabel = label => (label + '          ').slice(0, 10);

            let listMsg = '*Daftar Rapat Yang Akan Datang (Berdasarkan Ruang):*\n';
            Object.keys(ruangMap).forEach(ruang => {
                listMsg += `\n*${ruang}*\n`;
                ruangMap[ruang].forEach(r => {
                    listMsg += `#${r.idx}\n`;
                    listMsg += `${padLabel('Tanggal')}: ${r.tanggal}\n`;
                    listMsg += `${padLabel('Jam')}: ${r.jam}\n`;
                    listMsg += `${padLabel('Selesai')}: ${r.jam_selesai || '-'}\n`;
                    listMsg += `${padLabel('Agenda')}: ${r.agenda}\n`;
                    if (r.pic_name) listMsg += `${padLabel('PIC')}: ${r.pic_name}\n`;
                    if (r.pic_nomor) listMsg += `${padLabel('No HP')}: ${r.pic_nomor}\n`;
                    listMsg += '\n';
                });
            });
            await new Promise(res => setTimeout(res, 2000));
            await msg.reply(listMsg);
            await new Promise(res => setTimeout(res, 2000));
            await msg.reply(submenuMsg);
        }
        return;
    }

    // Handler Booking ruang rapat (mulai step by step)
    if (userMenuState.get(from) === 'booking' && text === '2') {
        userBookingData.set(from, { step: 1 });
        await new Promise(res => setTimeout(res, 2000));
        await msg.reply('Masukkan tanggal rapat (format: YYYY-MM-DD):');
        return;
    }

    // Step booking ruang rapat: tanggal, jam mulai, jam selesai, dst
    if (userMenuState.get(from) === 'booking') {
        const booking = userBookingData.get(from);
        if (booking && booking.step === 1) {
            // Validasi tanggal
            if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
                await new Promise(res => setTimeout(res, 2000));
                await msg.reply('Format tanggal salah. Masukkan tanggal rapat (format: YYYY-MM-DD):');
                return;
            }
            const today = dayjs().format('YYYY-MM-DD');
            if (text < today) {
                await new Promise(res => setTimeout(res, 2000));
                await msg.reply('Tanggal rapat tidak boleh sebelum hari ini. Masukkan tanggal rapat (format: YYYY-MM-DD):');
                return;
            }
            booking.tanggal = text;
            booking.step = 2;
            userBookingData.set(from, booking);
            await new Promise(res => setTimeout(res, 2000));
            await msg.reply('Masukkan jam mulai rapat (format: HH:mm, contoh: 13:30):');
            return;
        }
        // Step jam mulai
        if (booking && booking.step === 2) {
            if (!/^\d{2}:\d{2}$/.test(text)) {
                await new Promise(res => setTimeout(res, 2000));
                await msg.reply('Format jam salah. Masukkan jam mulai rapat (format: HH:mm, contoh: 13:30):');
                return;
            }
            // Validasi jam mulai tidak boleh sebelum waktu sekarang jika tanggal hari ini
            const now = dayjs();
            const tanggalBooking = booking.tanggal;
            const jamBooking = text;
            if (tanggalBooking === dayjs().format('YYYY-MM-DD')) {
                const jamNow = now.format('HH:mm');
                if (jamBooking < jamNow) {
                    await new Promise(res => setTimeout(res, 2000));
                    await msg.reply('Jam mulai tidak boleh sebelum waktu sekarang. Masukkan jam mulai rapat (format: HH:mm, contoh: 13:30):');
                    return;
                }
            }
            booking.jam = jamBooking;
            booking.step = 3;
            userBookingData.set(from, booking);
            await new Promise(res => setTimeout(res, 2000));
            await msg.reply('Masukkan jam selesai rapat (format: HH:mm, contoh: 15:00):');
            return;
        }
        // Step jam selesai
        if (booking && booking.step === 3) {
            if (!/^\d{2}:\d{2}$/.test(text)) {
                await new Promise(res => setTimeout(res, 2000));
                await msg.reply('Format jam salah. Masukkan jam selesai rapat (format: HH:mm, contoh: 15:00):');
                return;
            }
            // Validasi jam selesai harus lebih besar dari jam mulai
            const jamMulai = booking.jam;
            const jamSelesai = text;
            const toMinutes = jam => {
                const [h, m] = jam.split(':').map(Number);
                return h * 60 + m;
            };
            if (toMinutes(jamSelesai) <= toMinutes(jamMulai)) {
                await new Promise(res => setTimeout(res, 2000));
                await msg.reply('Jam selesai harus lebih besar dari jam mulai. Masukkan jam selesai rapat (format: HH:mm, contoh: 15:00):');
                return;
            }
            booking.jam_selesai = jamSelesai;
            booking.step = 4;
            userBookingData.set(from, booking);
            await new Promise(res => setTimeout(res, 2000));
            await msg.reply('Masukkan agenda rapat:');
            return;
        }
        // Step agenda
        if (booking && booking.step === 4) {
            if (!text || text.length < 3) {
                await new Promise(res => setTimeout(res, 2000));
                await msg.reply('Agenda rapat tidak boleh kosong. Masukkan agenda rapat:');
                return;
            }
            booking.agenda = text;
            booking.step = 5;
            userBookingData.set(from, booking);
            await new Promise(res => setTimeout(res, 2000));
            await msg.reply(
                'Pilih ruang rapat:\n' +
                'a. Ruang Growth\n' +
                'b. Ruang Harmony\n' +
                'c. Ruang Kopiah\n' +
                'd. Ruang Internasional\n' +
                'Ketik huruf sesuai pilihan.'
            );
            return;
        }
        // Step ruang
        if (booking && booking.step === 5) {
            let ruang = '';
            if (text === 'a') ruang = 'Ruang Growth';
            else if (text === 'b') ruang = 'Ruang Harmony';
            else if (text === 'c') ruang = 'Ruang Kopiah';
            else if (text === 'd') ruang = 'Ruang Internasional';
            else {
                await new Promise(res => setTimeout(res, 2000));
                await msg.reply(
                    'Pilihan ruang tidak valid. Pilih ruang rapat:\n' +
                    'a. Ruang Growth\n' +
                    'b. Ruang Harmony\n' +
                    'c. Ruang Kopiah\n' +
                    'd. Ruang Internasional\n' +
                    'Ketik huruf sesuai pilihan.'
                );
                return;
            }
            booking.ruang = ruang;
            booking.step = 6;
            userBookingData.set(from, booking);
            await new Promise(res => setTimeout(res, 2000));
            await msg.reply('Apakah butuh link Zoom Meeting? (Y/N)');
            return;
        }
        // Step butuh link zoom meeting (Y/N)
        if (booking && booking.step === 6) {
            if (text === 'y' || text === 'ya') {
                booking.butuh_zoom = true;
            } else if (text === 'n' || text === 'tidak') {
                booking.butuh_zoom = false;
            } else {
                await new Promise(res => setTimeout(res, 2000));
                await msg.reply('Jawab dengan Y (ya) atau N (tidak). Apakah butuh link Zoom Meeting? (Y/N)');
                return;
            }
            booking.step = 7;
            userBookingData.set(from, booking);
            await new Promise(res => setTimeout(res, 2000));
            await msg.reply('Apakah butuh konsumsi? (Y/N)');
            return;
        }
        // Step konsumsi (Y/N)
        if (booking && booking.step === 7) {
            if (text === 'y' || text === 'ya') {
                booking.butuh_konsumsi = true;
                booking.step = 8;
                userBookingData.set(from, booking);
                await new Promise(res => setTimeout(res, 2000));
                await msg.reply('Sebutkan detail konsumsi yang diminta (format teks, contoh: "Snack dan kopi untuk 10 orang"):');
                return;
            } else if (text === 'n' || text === 'tidak') {
                booking.butuh_konsumsi = false;
                booking.konsumsi_detail = '';
                booking.step = 9;
                userBookingData.set(from, booking);
                // langsung ke proses konfirmasi
            } else {
                await new Promise(res => setTimeout(res, 2000));
                await msg.reply('Jawab dengan Y (ya) atau N (tidak). Apakah butuh konsumsi? (Y/N)');
                return;
            }
        }
        // Step detail konsumsi
        if (booking && booking.step === 8) {
            if (!text || text.length < 3) {
                await new Promise(res => setTimeout(res, 2000));
                await msg.reply('Detail konsumsi tidak boleh kosong. Sebutkan detail konsumsi yang diminta:');
                return;
            }
            booking.konsumsi_detail = text;
            booking.step = 9;
            userBookingData.set(from, booking);
            // lanjut ke proses konfirmasi
        }
        // Step konfirmasi sebelum simpan booking (step 9)
        if (booking && booking.step === 9) {
            // Tampilkan ringkasan booking untuk konfirmasi
            let konsumsiMsg = booking.butuh_konsumsi
                ? `Konsumsi: ${booking.konsumsi_detail}`
                : 'Konsumsi: Tidak';
            let zoomMsg = booking.butuh_zoom
                ? 'Butuh link Zoom Meeting: Ya'
                : 'Butuh link Zoom Meeting: Tidak';

            let ringkasan =
                `Mohon konfirmasi booking berikut:\n` +
                `Tanggal   : ${booking.tanggal}\n` +
                `Jam Mulai : ${booking.jam}\n` +
                `Jam Selesai: ${booking.jam_selesai}\n` +
                `Agenda    : ${booking.agenda}\n` +
                `Ruang     : ${booking.ruang}\n` +
                `${zoomMsg}\n${konsumsiMsg}\n\n` +
                `Ketik Y untuk simpan, N untuk batalkan.`;
            booking.step = 10;
            userBookingData.set(from, booking);
            await new Promise(res => setTimeout(res, 2000));
            await msg.reply(ringkasan);
            return;
        }
        // Step simpan booking (step 10)
        if (booking && booking.step === 10) {
            if (text === 'y' || text === 'ya') {
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

                // Cek konflik jadwal ruang rapat
                const conflict = isMeetingConflict(rapatList, {
                    tanggal: booking.tanggal,
                    ruang: booking.ruang,
                    jam: booking.jam,
                    jam_selesai: booking.jam_selesai
                });
                if (conflict) {
                    userBookingData.delete(from);
                    await new Promise(res => setTimeout(res, 2000));
                    await msg.reply('❌ Jadwal rapat bentrok/konflik dengan booking lain di ruang dan waktu yang sama. Silakan pilih waktu lain.');
                    // Tampilkan menu booking lagi
                    const submenuMsg =
                        `*BOOKING RUANG RAPAT*
1. List rapat yang akan datang
2. Booking ruang rapat
3. Cancel booking rapat
9. Kembali ke menu utama
0. Keluar menu
Ketik angka sesuai pilihan.`;
                    await new Promise(res => setTimeout(res, 2000));
                    await msg.reply(submenuMsg);
                    return;
                }

                // === Tambahan: Jika butuh Zoom, buat meeting Zoom ===
                let zoomInfo = null;
                if (booking.butuh_zoom) {
                    // Siapkan jam mulai & selesai dalam format ISO (format sama seperti di zoomMeetingHandler.js)
                    const dateStr = booking.tanggal;
                    const jamMulai = booking.jam;
                    const jamSelesai = booking.jam_selesai;

                    // Jam mulai
                    const dateTimeStr = `${dateStr} ${jamMulai}`;
                    const meetingTime = dayjs.tz(dateTimeStr, 'YYYY-MM-DD HH:mm', 'Asia/Jakarta');
                    const isoStart = meetingTime.utc().format();

                    // Jam selesai
                    let isoEnd = null;
                    if (jamSelesai) {
                        const endDateTimeStr = `${dateStr} ${jamSelesai}`;
                        const endTime = dayjs.tz(endDateTimeStr, 'YYYY-MM-DD HH:mm', 'Asia/Jakarta');
                        isoEnd = endTime.utc().format();
                    }

                    // Ambil log Zoom
                    let logFile = './meeting_log.json';
                    let logs = [];
                    if (fs.existsSync(logFile)) {
                        try {
                            const raw = fs.readFileSync(logFile, 'utf8');
                            logs = JSON.parse(raw);
                            if (!Array.isArray(logs)) logs = [];
                        } catch { logs = []; }
                    }

                    // Cek & buat Zoom
                    const { meeting: zoomResult, accountIdx, schedule_for } = await createZoomMeetingWithConflict(
                        booking.agenda || 'Meeting Ruang Rapat',
                        isoStart,
                        isoEnd,
                        checkMeetingConflict,
                        logs
                    );

                    if (!zoomResult) {
                        userBookingData.delete(from);
                        await new Promise(res => setTimeout(res, 2000));
                        await msg.reply('❌ Jadwal Zoom bentrok/konflik dengan meeting lain di kedua akun Zoom. Booking ruang rapat dibatalkan. Silakan pilih waktu lain.');
                        // Tampilkan menu booking lagi
                        const submenuMsg =
                            `*BOOKING RUANG RAPAT*
1. List rapat yang akan datang
2. Booking ruang rapat
3. Cancel booking rapat
9. Kembali ke menu utama
0. Keluar menu
Ketik angka sesuai pilihan.`;
                        await new Promise(res => setTimeout(res, 2000));
                        await msg.reply(submenuMsg);
                        return;
                    }

                    // Simpan log Zoom
                    logs.push({
                        nomor_user: from,
                        employe_id: userData.employeeId,
                        nama: pic_name,
                        topic: booking.agenda || 'Meeting Ruang Rapat',
                        jam: meetingTime.format('HH:mm'),
                        tgl: booking.tanggal,
                        url: zoomResult.join_url || '',
                        id: zoomResult.id || '',
                        account: accountIdx,
                        schedule_for: schedule_for
                    });
                    fs.writeFileSync(logFile, JSON.stringify(logs, null, 2));
                    zoomInfo = zoomResult;
                }

                // Simpan booking ruang rapat
                rapatList.push({
                    tanggal: booking.tanggal,
                    jam: booking.jam,
                    jam_selesai: booking.jam_selesai,
                    agenda: booking.agenda,
                    ruang: booking.ruang,
                    user: from,
                    pic_name,
                    pic_nomor,
                    butuh_zoom: booking.butuh_zoom || false,
                    butuh_konsumsi: booking.butuh_konsumsi,
                    konsumsi_detail: booking.konsumsi_detail || '',
                    zoom_link: zoomInfo ? zoomInfo.join_url : '',
                    zoom_id: zoomInfo ? (zoomInfo.personal_meeting_id || zoomInfo.id || '') : '',
                    zoom_password: zoomInfo ? (zoomInfo.password || '') : ''
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
                if (booking.butuh_zoom && zoomInfo) {
                    zoomMsg =
                        `Butuh link Zoom Meeting: Ya\n` +
                        `🔗 Link: ${zoomInfo.join_url}\n` +
                        `🆔 ID Meeting: ${zoomInfo.personal_meeting_id || zoomInfo.id || '-'}\n` +
                        `🔑 Password: ${zoomInfo.password || '-'}\n`;
                } else if (booking.butuh_zoom) {
                    zoomMsg = 'Butuh link Zoom Meeting: Ya (tidak tersedia karena konflik jadwal)';
                } else {
                    zoomMsg = 'Butuh link Zoom Meeting: Tidak';
                }

                await msg.reply(
                    `Booking ruang rapat berhasil!\nTanggal: ${booking.tanggal}\nJam: ${booking.jam} - ${booking.jam_selesai}\nAgenda: ${booking.agenda}\nRuang: ${booking.ruang}\n${zoomMsg}${konsumsiMsg}`
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
                await new Promise(res => setTimeout(res, 2000));
                await msg.reply(submenuMsg);
                return;
            } else if (text === 'n' || text === 'tidak') {
                userBookingData.delete(from);
                await new Promise(res => setTimeout(res, 2000));
                await msg.reply('Booking rapat dibatalkan.');
                // Tampilkan menu booking lagi
                const submenuMsg =
                    `*BOOKING RUANG RAPAT*
1. List rapat yang akan datang
2. Booking ruang rapat
3. Cancel booking rapat
9. Kembali ke menu utama
0. Keluar menu
Ketik angka sesuai pilihan.`;
                await new Promise(res => setTimeout(res, 2000));
                await msg.reply(submenuMsg);
                return;
            } else {
                await new Promise(res => setTimeout(res, 2000));
                await msg.reply('Jawab dengan Y (ya) atau N (tidak) untuk konfirmasi booking.');
                return;
            }
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
