import fs from 'fs';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone.js';
dayjs.extend(timezone);

export function normalizeNomor(n) {
    return (n || '').replace(/[^0-9]/g, '').replace(/^(\+?(\d{1,3}|0+))/, '').replace(/^0+/, '');
}

export function checkMeetingConflict(logs, meetingTime) {
    return logs.some(m => {
        if (m.tgl !== meetingTime.format('YYYY-MM-DD')) return false;
        const mTime = dayjs.tz(`${m.tgl} ${m.jam}`, 'YYYY-MM-DD HH:mm', 'Asia/Jakarta');
        const diff = Math.abs(meetingTime.diff(mTime, 'minute'));
        return diff < 60;
    });
}

export function getFutureMeetings(logs) {
    const today = dayjs().tz('Asia/Jakarta').format('YYYY-MM-DD');
    return logs
        .filter(m => m.tgl >= today)
        .sort((a, b) => {
            if (a.tgl === b.tgl) {
                return a.jam.localeCompare(b.jam);
            }
            return a.tgl.localeCompare(b.tgl);
        });
}

export function toTitleCase(str) {
    return str.replace(/\w\S*/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

export function getUserFromContext(nomor) {
    let nama = '';
    let employeeId = '';
    try {
        const context = fs.readFileSync('./context.txt', 'utf8');
        const jsonStart = context.indexOf('[');
        if (jsonStart !== -1) {
            const jsonText = context.slice(jsonStart);
            const data = JSON.parse(jsonText);
            const normNomor = normalizeNomor(nomor);
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
                return nomorFields.some(field => field && normalizeNomor(field) === normNomor);
            });
            if (found) {
                nama = found.first_name || found.nama || found.name || '';
                employeeId = found.employe_id || found.employee_id || found.nip || found.nik || '';
            }
        }
    } catch (e) {
        // ignore
    }
    return { nama, employeeId };
}

export function loadNomorTerdaftar() {
    let nomorTerdaftar = new Set();
    try {
        const context = fs.readFileSync('./context.txt', 'utf8');
        const matches = context.match(/\b\d{10,16}\b/g);
        if (matches) {
            matches.forEach(no => {
                nomorTerdaftar.add(no);
                nomorTerdaftar.add(no.replace(/^62/, ''));
                nomorTerdaftar.add(no.replace(/^0/, ''));
                nomorTerdaftar.add(no.replace(/^62/, '').replace(/^0/, ''));
            });
        }
    } catch (e) {
        nomorTerdaftar = new Set();
    }
    return nomorTerdaftar;
}

/**
 * Cek konflik waktu rapat.
 * @param {Array} meetings - Daftar rapat (array of objects)
 * @param {Object} newMeeting - { tanggal, ruang, jam, jam_selesai }
 * @returns {boolean} true jika ada konflik, false jika tidak
 */
export function isMeetingConflict(meetings, newMeeting) {
    // Pastikan jam mulai dan jam selesai valid
    if (!newMeeting.jam || !newMeeting.jam_selesai) return false;
    const tanggal = newMeeting.tanggal;
    const ruang = newMeeting.ruang;
    const startA = newMeeting.jam;
    const endA = newMeeting.jam_selesai;

    // Helper: konversi jam ke menit
    const toMinutes = jam => {
        const [h, m] = jam.split(':').map(Number);
        return h * 60 + m;
    };

    const startAMin = toMinutes(startA);
    const endAMin = toMinutes(endA);

    return meetings.some(m => {
        if (m.tanggal !== tanggal) return false;
        if (m.ruang !== ruang) return false;
        if (!m.jam || !m.jam_selesai) return false;
        const startBMin = toMinutes(m.jam);
        const endBMin = toMinutes(m.jam_selesai);
        // Cek overlap
        return (startAMin < endBMin && endAMin > startBMin);
    });
}
