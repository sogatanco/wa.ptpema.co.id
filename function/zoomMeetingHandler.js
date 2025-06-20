import fs from 'fs';
import dayjs from 'dayjs';
import { askGeminiFlashWithoutContext } from './askGeminiFlashWithoutContext.js';
import { createZoomMeeting } from './zoom.js';
import {
    checkMeetingConflict,
    getFutureMeetings,
    toTitleCase,
    getUserFromContext
} from './utils.js';

export async function handleZoomMeeting({ msg, nomor, GEMINI_API_KEY }) {
    const text = msg.body ? msg.body.trim().toLowerCase() : "";

    const timeRegex = /(?:jam|pukul|at|time)[\s:]*([0-9]{1,2})[.:\s]?([0-9]{2})/i;
    const dateRegex = /(?:tanggal|tgl|date)[\s:]*([0-9]{4}-[0-9]{2}-[0-9]{2}|[0-9]{2}[-/][0-9]{2}[-/][0-9]{4})/i;
    const topicRegex = /(?:topik|topic|about|regarding|subject)[\s:]*([^\n]+?)(?=\s+(?:jam|pukul|at|time|tanggal|tgl|date):|$)/i;

    let topicMatch = text.match(topicRegex);
    let timeMatch = text.match(timeRegex);
    let dateMatch = text.match(dateRegex);

    if (!topicMatch || !timeMatch || !dateMatch) {
        const extractionPrompt =
            `Extract the topic, date (YYYY-MM-DD), and time (HH:mm) for a Zoom meeting from this message: "${msg.body}". ` +
            `Respond ONLY in JSON format: buat zoom meeting jam: [time] tanggal: [date] topik: [topic]. If any value is missing, use an empty string.`;
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
            // ignore
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

    const dateTimeStr = `${dateStr} ${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}:00`;
    const meetingTime = dayjs.tz(dateTimeStr, 'YYYY-MM-DD HH:mm:ss', 'Asia/Jakarta');
    const isoTime = meetingTime.utc().format();

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
    const isConflict = checkMeetingConflict(logs, meetingTime);
    if (isConflict) {
        const futureMeetings = getFutureMeetings(logs);
        let replyMsg = '❗Maaf Waktu meeting yang Anda pilih sudah dipakai. Silakan pilih waktu lain atau konfirmasi ke PIC terkait untuk melakukan perubahan.\n';
        if (futureMeetings.length > 0) {
            replyMsg += '\n\n📅 *Daftar Meeting Mendatang:*\n' + futureMeetings.map((m, idx) =>
                `${idx + 1}. *${toTitleCase(m.topic)}*\n   waktu: ${m.tgl} / ${m.jam}\n   PIC: ${m.nama || '-'}\n`
            ).join('');
        }
        await msg.reply(replyMsg.trim());
        return;
    }

    const userData = getUserFromContext(nomor);
    let nama = userData.nama;
    let employeeId = userData.employeeId;

    let greet = nama ? `Halo ${nama}, ` : 'Halo, ';

    const zoomResult = await createZoomMeeting(topic, isoTime);

    let replyMsg = `${greet}meeting Zoom berhasil dibuat!\n`;
    replyMsg += `📝 Topik: ${topic}\n`;
    replyMsg += `📅 Tanggal: ${meetingTime.format('YYYY-MM-DD')}\n`;
    replyMsg += `🕒 Jam: ${meetingTime.format('HH:mm')}\n`;
    replyMsg += zoomResult.join_url ? `🔗 Link: ${zoomResult.join_url}\n` : '';
    replyMsg += zoomResult.id ? `🆔 ID Meeting: ${zoomResult.id}\n` : '';
    replyMsg += zoomResult.password ? `🔑 Password: ${zoomResult.password}\n` : '';

    try {
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

        const futureMeetings = getFutureMeetings(logs);
        if (futureMeetings.length > 0) {
            replyMsg += '\n\n📅 *Daftar Meeting Mendatang:*\n' + futureMeetings.map((m, idx) =>
                `${idx + 1}. *${toTitleCase(m.topic)}*\n   waktu: ${m.tgl} / ${m.jam}\n   PIC: ${m.nama || '-'}\n`
            ).join('');
        }
    } catch (e) {
        console.error('❌ Gagal menyimpan log meeting:', e.message);
    }

    await msg.reply(replyMsg.trim());
}
