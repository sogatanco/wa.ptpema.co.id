import { askGeminiFlash } from './askGeminiFlash.js';
import { askGeminiFlashWithoutContext } from './askGeminiFlashWithoutContext.js';
import fs from 'fs';

import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone.js';
import utc from 'dayjs/plugin/utc.js';
import { createZoomMeeting } from './zoom.js';

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

    // Deteksi perintah zoom meeting lebih luas (bisa bahasa Inggris/campuran)
    const isZoomPrompt =
        /^buat (zoom )?meeting\b/.test(text) ||
        (text.includes('zoom') && text.includes('meeting')) ||
        /create.*zoom.*meeting/i.test(text) ||
        /schedule.*zoom/i.test(text);

    if (isTerdaftar && isZoomPrompt) {
        try {
            // Regex lebih fleksibel (bahasa indo/inggris)
            const timeRegex = /(?:jam|pukul|at|time)[\s:]*([0-9]{1,2})[.:\s]?([0-9]{2})/i;
            const dateRegex = /(?:tanggal|tgl|date)[\s:]*([0-9]{4}-[0-9]{2}-[0-9]{2}|[0-9]{2}[-/][0-9]{2}[-/][0-9]{4})/i;
            const topicRegex = /(?:topik|topic|about|regarding|subject)[\s:]*([^\n]+?)(?=\s+(?:jam|pukul|at|time|tanggal|tgl|date):|$)/i;

            let topicMatch = text.match(topicRegex);
            let timeMatch = text.match(timeRegex);
            let dateMatch = text.match(dateRegex);

            // Jika salah satu tidak ditemukan, gunakan Gemini untuk ekstraksi detail
            if (!topicMatch || !timeMatch || !dateMatch) {
                const extractionPrompt =
                    `Extract the topic, date (YYYY-MM-DD), and time (HH:mm) for a Zoom meeting from this message: "${msg.body}". ` +
                    `Respond ONLY in JSON format: {"topic":"...","date":"YYYY-MM-DD","time":"HH:mm"}. If any value is missing, use an empty string.`;
                try {
                    const extractionResponse = await askGeminiFlashWithoutContext(extractionPrompt, GEMINI_API_KEY);
                    let extracted = {};
                    try {
                        extracted = JSON.parse(extractionResponse);
                    } catch {
                        const jsonMatch = extractionResponse.match(/\{[\s\S]*\}/);
                        if (jsonMatch) {
                            extracted = JSON.parse(jsonMatch[0]);
                        }
                    }
                    if (extracted.topic && !topicMatch) topicMatch = [null, extracted.topic];
                    if (extracted.time && !timeMatch && extracted.time) {
                        const [h, m] = extracted.time.split(':');
                        timeMatch = [null, h, m];
                    }
                    if (extracted.date && !dateMatch) dateMatch = [null, extracted.date];
                } catch (e) {
                    // ignore, biarkan error handling di bawah
                }
            }

            if (!topicMatch || !timeMatch || !dateMatch) {
                await msg.reply(
                    '❗ Mohon sertakan topik, tanggal, dan jam meeting.\n' +
                    'Contoh:\n' +
                    '`buat zoom meeting topik: Rapat Divisi tanggal: 2024-07-01 jam: 14:00`'
                );
                return;
            }

            const topic = topicMatch[1].trim();
            const hour = parseInt(timeMatch[1]);
            const minute = parseInt(timeMatch[2]);

            let dateStr = dateMatch[1].replace(/\//g, '-');
            if (/^\d{2}-\d{2}-\d{4}$/.test(dateStr)) {
                const [d, m, y] = dateStr.split('-');
                dateStr = `${y}-${m}-${d}`;
            }

            // Gabungkan tanggal dan jam secara eksplisit, pastikan timezone Asia/Jakarta
            const dateTimeStr = `${dateStr} ${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}:00`;
            const meetingTime = dayjs.tz(dateTimeStr, 'YYYY-MM-DD HH:mm:ss', 'Asia/Jakarta');
            const isoTime = meetingTime.utc().format();

            // Cek bentrok waktu meeting (±1 jam di tanggal yang sama)
            let logFile = './meeting_log.json';
            let logs = [];
            if (fs.existsSync(logFile)) {
                const raw = fs.readFileSync(logFile, 'utf8');
                try {
                    logs = JSON.parse(raw);
                    if (!Array.isArray(logs)) logs = [];
                } catch {
                    logs = [];
                }
            }
            // Cek bentrok
            const isConflict = logs.some(m => {
                if (m.tgl !== meetingTime.format('YYYY-MM-DD')) return false;
                // Cek selisih waktu dalam menit
                const mTime = dayjs.tz(`${m.tgl} ${m.jam}`, 'YYYY-MM-DD HH:mm', 'Asia/Jakarta');
                const diff = Math.abs(meetingTime.diff(mTime, 'minute'));
                return diff < 60; // bentrok jika kurang dari 1 jam
            });
            if (isConflict) {
                // Ambil list meeting dari hari ini ke depan
                const today = dayjs().tz('Asia/Jakarta').format('YYYY-MM-DD');
                const futureMeetings = logs
                    .filter(m => m.tgl >= today)
                    .sort((a, b) => {
                        if (a.tgl === b.tgl) {
                            return a.jam.localeCompare(b.jam);
                        }
                        return a.tgl.localeCompare(b.tgl);
                    });
                // Fungsi untuk title case
                const toTitleCase = str => str.replace(/\w\S*/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
                let replyMsg = '❗Maaf Waktu meeting yang Anda pilih sudah dipakai. Silakan pilih waktu lain atau konfirmasi ke PIC terkait untuk melakukan perubahan.\n';
                if (futureMeetings.length > 0) {
                    let listMsg = '\n\n📅 *Daftar Meeting Mendatang:*\n';
                    futureMeetings.forEach((m, idx) => {
                        listMsg += `${idx + 1}. *${toTitleCase(m.topic)}*\n   waktu: ${m.tgl} / ${m.jam}\n   PIC: ${m.nama || '-'}\n`;
                    });
                    replyMsg += listMsg;
                }
                await msg.reply(replyMsg.trim());
                return;
            }

            // Cari nama dan employee_id dari context.txt berdasarkan nomor pengirim
            let nama = '';
            let employeeId = '';
            try {
                const context = fs.readFileSync('./context.txt', 'utf8');
                const jsonStart = context.indexOf('[');
                if (jsonStart !== -1) {
                    const jsonText = context.slice(jsonStart);
                    const data = JSON.parse(jsonText);
                    // Normalisasi nomor: hilangkan +, 0, 62, 628, 60, 65, dst di depan
                    const norm = n => (n || '').replace(/[^0-9]/g, '').replace(/^(\+?(\d{1,3}|0+))/, '').replace(/^0+/, '');
                    const normNomor = norm(nomor);
                    // Cek semua kemungkinan field nomor di setiap item
                    const found = data.find(item => {
                        const nomorFields = [
                            item.phone_number,
                            item.nomor,
                            item.no_hp,
                            item.nohp,
                            item.hp,
                            item.telepon,
                            item.phone
                        ];
                        return nomorFields.some(field => field && norm(field) === normNomor);
                    });
                    if (found) {
                        nama = found.first_name || found.nama || found.name || '';
                        employeeId = found.employe_id || found.employee_id || found.nip || found.nik || '';
                    }
                }
            } catch (e) {
                // ignore
            }

            let greet = '';
            if (nama) {
                greet = `Halo ${nama}, `;
            } else {
                greet = 'Halo, ';
            }

            const zoomResult = await createZoomMeeting(topic, isoTime);

            let replyMsg = `${greet}meeting Zoom berhasil dibuat!\n`;
            replyMsg += `📝 Topik: ${topic}\n`;
            replyMsg += `📅 Tanggal: ${meetingTime.format('YYYY-MM-DD')}\n`;
            replyMsg += `🕒 Jam: ${meetingTime.format('HH:mm')}\n`;
            replyMsg += zoomResult.join_url ? `🔗 Link: ${zoomResult.join_url}\n` : '';
            replyMsg += zoomResult.id ? `🆔 ID Meeting: ${zoomResult.id}\n` : '';
            replyMsg += zoomResult.password ? `🔑 Password: ${zoomResult.password}\n` : '';

            // Simpan log meeting ke file dalam bentuk JSON dan tampilkan daftar meeting mendatang
            try {
                const logFile = './meeting_log.json';
                let logs = [];
                if (fs.existsSync(logFile)) {
                    const raw = fs.readFileSync(logFile, 'utf8');
                    try {
                        logs = JSON.parse(raw);
                        if (!Array.isArray(logs)) logs = [];
                    } catch {
                        logs = [];
                    }
                }
                logs.push({
                    nomor_user: nomor,
                    employe_id: employeeId,
                    nama: nama,
                    topic: topic,
                    jam: meetingTime.format('HH:mm'),
                    tgl: meetingTime.format('YYYY-MM-DD'),
                    url: zoomResult.join_url || ''
                });
                fs.writeFileSync(logFile, JSON.stringify(logs, null, 2));

                // Ambil list meeting dari hari ini ke depan
                const today = dayjs().tz('Asia/Jakarta').format('YYYY-MM-DD');
                const futureMeetings = logs
                    .filter(m => m.tgl >= today)
                    .sort((a, b) => {
                        if (a.tgl === b.tgl) {
                            return a.jam.localeCompare(b.jam);
                        }
                        return a.tgl.localeCompare(b.tgl);
                    });

                if (futureMeetings.length > 0) {
                    // Fungsi untuk title case
                    const toTitleCase = str => str.replace(/\w\S*/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
                    let listMsg = '\n\n📅 *Daftar Meeting Mendatang:*\n';
                    futureMeetings.forEach((m, idx) => {
                        listMsg += `${idx + 1}. *${toTitleCase(m.topic)}*\n   waktu: ${m.tgl} / ${m.jam}\n   PIC: ${m.nama || '-'}\n`;
                    });
                    replyMsg += listMsg;
                }
            } catch (e) {
                console.error('❌ Gagal menyimpan log meeting:', e.message);
            }

            await msg.reply(replyMsg.trim());
            return;
        } catch (err) {
            console.error(err);
            await msg.reply(
                '❌ Gagal membuat meeting. Pastikan formatnya benar.\n' +
                'Contoh:\n`buat zoom meeting topik: Rapat A tanggal: 2024-07-01 jam: 14:00`'
            );
            return;
        }
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
