import fs from 'fs';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone.js';
import axios from 'axios';
import FormData from 'form-data';
import path from 'path';
dayjs.extend(timezone);

export function normalizeNomor(n) {
    return (n || '').replace(/[^0-9]/g, '').replace(/^(\+?(\d{1,3}|0+))/, '').replace(/^0+/, '');
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
    } catch (e) {}
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
    if (!newMeeting.jam || !newMeeting.jam_selesai) return false;
    const tanggal = newMeeting.tanggal;
    const ruang = newMeeting.ruang;
    const startA = newMeeting.jam;
    const endA = newMeeting.jam_selesai;
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
        return (startAMin < endBMin && endAMin > startBMin);
    });
}

/**
 * Upload file ke Synology FileStation.
 * @param {string} localFilePath - Path file lokal yang akan diupload.
 * @param {string} nomor - Nomor user (akan jadi nama folder di Synology).
 * @returns {Promise<boolean>} true jika sukses, false jika gagal.
 */
export async function uploadToSynology(localFilePath, nomor) {
    const synoUrl = 'https://cloud.ptpema.co.id/webapi';
    const account = 'ruangrapat';
    const passwd = 'Ptpema2019';
    const pathUpload = `/PUBLIC/8. Bahan Rapat/${nomor}`;
    try {
        const { Agent } = await import('https');
        const loginRes = await axios.get(`${synoUrl}/auth.cgi`, {
            params: {
                api: 'SYNO.API.Auth',
                version: 6,
                method: 'login',
                account,
                passwd,
                session: 'FileStation',
                format: 'sid'
            },
            httpsAgent: new Agent({ rejectUnauthorized: false })
        });
        const sid = loginRes.data && loginRes.data.data && loginRes.data.data.sid;
        if (!sid) throw new Error('Gagal mendapatkan SID Synology');
        const form = new FormData();
        form.append('api', 'SYNO.FileStation.Upload');
        form.append('version', '2');
        form.append('method', 'upload');
        form.append('path', pathUpload);
        form.append('create_parents', 'true');
        form.append('overwrite', 'true');
        form.append('file', fs.createReadStream(localFilePath), path.basename(localFilePath));
        const uploadRes = await axios.post(
            `${synoUrl}/entry.cgi?_sid=${sid}`,
            form,
            {
                headers: form.getHeaders(),
                maxContentLength: Infinity,
                maxBodyLength: Infinity,
                httpsAgent: new Agent({ rejectUnauthorized: false })
            }
        );
        return uploadRes.data && uploadRes.data.success;
    } catch (err) {
        console.error('❌ Gagal upload ke Synology:', err.message);
        return false;
    }
}
   