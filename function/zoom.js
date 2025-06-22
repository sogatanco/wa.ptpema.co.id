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
            use_pmi: true,
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
    // Cek conflict untuk akun 1 dengan schedule_for mitrapema@gmail.com
    const conflictMitra = logs.some(m =>
        m.tgl === start_time_iso.slice(0, 10) &&
        m.schedule_for === 'mitrapema@gmail.com'
    );
    if (!conflictMitra) {
        return {
            meeting: await createZoomMeeting(topic, start_time_iso, end_time_iso, 1, 'mitrapema@gmail.com'),
            accountIdx: 1,
            schedule_for: 'mitrapema@gmail.com'
        };
    }

    // Jika conflict, cek akun 1 dengan schedule_for pembangunanaceh.pema@gmail.com
    const conflictPembangunan = logs.some(m =>
        m.tgl === start_time_iso.slice(0, 10) &&
        m.schedule_for === 'pembangunanaceh.pema@gmail.com'
    );
    if (!conflictPembangunan) {
        return {
            meeting: await createZoomMeeting(topic, start_time_iso, end_time_iso, 1, 'pembangunanaceh.pema@gmail.com'),
            accountIdx: 1,
            schedule_for: 'pembangunanaceh.pema@gmail.com'
        };
    }

    // Jika kedua email conflict, return null
    return { meeting: null, accountIdx: 0, schedule_for: null };
};

