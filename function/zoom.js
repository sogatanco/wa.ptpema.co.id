import axios from 'axios';
import qs from 'qs';
import dotenv from 'dotenv';

dotenv.config();

const getZoomToken = async (accountIdx = 1) => {
    // Ambil credential sesuai account index (1 atau 2)
    let accountId = accountIdx === 2 ? process.env.ZOOM_ACCOUNT_ID2 : process.env.ZOOM_ACCOUNT_ID;
    let clientId = accountIdx === 2 ? process.env.ZOOM_CLIENT_ID2 : process.env.ZOOM_CLIENT_ID;
    let clientSecret = accountIdx === 2 ? process.env.ZOOM_CLIENT_SECRET2 : process.env.ZOOM_CLIENT_SECRET;

    // Jika env account 2 tidak ada, fallback ke account 1
    if (accountIdx === 2 && (!accountId || !clientId || !clientSecret)) {
        accountId = process.env.ZOOM_ACCOUNT_ID;
        clientId = process.env.ZOOM_CLIENT_ID;
        clientSecret = process.env.ZOOM_CLIENT_SECRET;
    }

    // Tambahkan validasi/debug
    if (!accountId || !clientId || !clientSecret) {
        throw new Error(`Zoom credentials missing for accountIdx=${accountIdx}. Pastikan .env sudah benar.`);
    }

    const data = qs.stringify({
        grant_type: 'account_credentials',
        account_id: accountId
    });

    const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

    const res = await axios.post('https://zoom.us/oauth/token', data, {
        headers: {
            Authorization: `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded'
        }
    });

    return res.data.access_token;
};

// Fungsi create meeting dengan parameter jam selesai (end_time, opsional) dan schedule_for
export const createZoomMeeting = async (topic, start_time_iso, end_time_iso = null, accountIdx = 1, scheduleForEmail = null) => {
    const token = await getZoomToken(accountIdx);

    // Hitung durasi
    let duration = 60;
    if (end_time_iso) {
        const start = new Date(start_time_iso);
        const end = new Date(end_time_iso);
        duration = Math.round((end - start) / 60000); // menit
        if (duration < 1) duration = 60;
    }

    // Tentukan email schedule_for sesuai account
    let schedule_for = scheduleForEmail;
    if (!schedule_for) {
        schedule_for = accountIdx === 2 ? 'pembangunanaceh.pema@gmail.com' : 'mitrapema@gmail.com';
    }

    const payload = {
        topic,
        type: 2, // 2 = Scheduled Meeting
        start_time: start_time_iso,
        duration,
        timezone: 'Asia/Jakarta',
        settings: {
            use_pmi: false,
            join_before_host: true,
            waiting_room: false,
        }
    };

    // schedule_for hanya jika accountIdx === 1
    if (accountIdx === 1 && schedule_for) {
        payload.schedule_for = schedule_for;
    }

    const res = await axios.post(
        'https://api.zoom.us/v2/users/me/meetings',
        payload,
        {
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        }
    );

    return res.data;
};

// Fungsi untuk handle conflict dua account, gunakan schedule_for pada akun 1
export const createZoomMeetingWithConflict = async (topic, start_time_iso, end_time_iso, checkMeetingConflict, logs) => {
    // Ambil tanggal dan jam dari start_time_iso
    const tgl = start_time_iso.slice(0, 10);
    const jam = start_time_iso.slice(11, 16);

    // Helper: cek bentrok berdasarkan waktu (jam mulai & selesai) dan schedule_for
    function isTimeConflict(logs, tgl, jamMulai, jamSelesai, schedule_for) {
        const toMinutes = (str) => {
            const [h, m] = str.split(':').map(Number);
            return h * 60 + m;
        };
        const startA = toMinutes(jamMulai);
        let endA = jamSelesai ? toMinutes(jamSelesai) : startA + 60;

        return logs.some(m => {
            if (m.tgl !== tgl) return false;
            if (!m.jam) return false;
            // Hanya cek bentrok jika schedule_for sama persis
            if ((m.schedule_for || '').toLowerCase() !== (schedule_for || '').toLowerCase()) return false;
            const startB = toMinutes(m.jam);
            let endB = m.jam_selesai ? toMinutes(m.jam_selesai) : startB + 60;
            // Cek overlap
            return (startA < endB && endA > startB);
        });
    }

    // Ambil jam selesai dari end_time_iso jika ada
    const jamSelesai = end_time_iso ? end_time_iso.slice(11, 16) : null;

    // Cek conflict schedule_for mitrapema@gmail.com
    const conflictMitra = isTimeConflict(
        logs.filter(m => m.account === 1),
        tgl,
        jam,
        jamSelesai,
        'mitrapema@gmail.com'
    );
    if (!conflictMitra) {
        return {
            meeting: await createZoomMeeting(topic, start_time_iso, end_time_iso, 1, 'mitrapema@gmail.com'),
            accountIdx: 1,
            schedule_for: 'mitrapema@gmail.com'
        };
    }

    // Jika bentrok di mitrapema, cek pembangunanaceh.pema@gmail.com
    const conflictPembangunan = isTimeConflict(
        logs.filter(m => m.account === 1),
        tgl,
        jam,
        jamSelesai,
        'pembangunanaceh.pema@gmail.com'
    );
    if (!conflictPembangunan) {
        return {
            meeting: await createZoomMeeting(topic, start_time_iso, end_time_iso, 1, 'pembangunanaceh.pema@gmail.com'),
            accountIdx: 1,
            schedule_for: 'pembangunanaceh.pema@gmail.com'
        };
    }

    // Jika keduanya bentrok, return null
    return { meeting: null, accountIdx: 0, schedule_for: null };
};

// Fungsi untuk menghapus meeting Zoom berdasarkan meeting ID dan accountIdx
// export const deleteZoomMeeting = async (meetingId, accountIdx = 1) => {
//     const token = await getZoomToken(accountIdx);
//     await axios.delete(
//         `https://api.zoom.us/v2/meetings/${meetingId}`,
//         {
//             headers: {
//                 Authorization: `Bearer ${token}`,
//                 'Content-Type': 'application/json'
//             }
//         }
//     );
//     return true;
// };

export const deleteZoomMeeting = async (meetingId, accountIdx = 1) => {
    try {
        // Validasi awal
        if (!meetingId || isNaN(meetingId)) {
            throw new Error("Meeting ID tidak valid atau kosong.");
        }

        // Ambil token sesuai akun Zoom
        const token = await getZoomToken(accountIdx);

        // Kirim request DELETE ke Zoom API
        await axios.delete(
            `https://api.zoom.us/v2/meetings/${meetingId}`,
            {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        console.log(`✅ Meeting ${meetingId} berhasil dihapus.`);
        return true;

    } catch (error) {
        // Log detail error dari response Zoom API
        const status = error?.response?.status;
        const message = error?.response?.data || error.message;

        console.error("❌ Gagal menghapus Zoom meeting:", {
            status,
            message
        });

        return false;
    }
}

