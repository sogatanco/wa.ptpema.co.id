import axios from 'axios';
import qs from 'qs';
import dotenv from 'dotenv';

dotenv.config();

const getZoomToken = async () => {
    const data = qs.stringify({
        grant_type: 'account_credentials',
        account_id: process.env.ZOOM_ACCOUNT_ID
    });

    const auth = Buffer.from(`${process.env.ZOOM_CLIENT_ID}:${process.env.ZOOM_CLIENT_SECRET}`).toString('base64');

    const res = await axios.post('https://zoom.us/oauth/token', data, {
        headers: {
            Authorization: `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded'
        }
    });

    return res.data.access_token;
};

export const createZoomMeeting = async (topic, start_time_iso) => {
    const token = await getZoomToken();

    const res = await axios.post(
        'https://api.zoom.us/v2/users/me/meetings',
        {
            topic,
            type: 2,
            start_time: start_time_iso, // sudah dalam ISO
            duration: 60,
            timezone: 'Asia/Jakarta',
            settings: {
                use_pmi: true, // <== ini penting
                join_before_host: true,
                waiting_room: false,
            }
        },
        {
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        }
    );

    return res.data;
};
