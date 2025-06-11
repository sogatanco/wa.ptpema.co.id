import axios from 'axios';

export async function pollAndSendMessages(isReady, KEY_SYS, formatTanggal, client) {
    if (!isReady) return;
    try {
        let response;
        try {
            response = await axios.get(
                'https://api.ptpema.co.id/dapi/send-message/first',
                { headers: { 'Authorization': `Bearer ${KEY_SYS}` } }
            );
        } catch (err) {
            if (err.response && err.response.status === 404) {
                try {
                    response = await axios.get(
                        'https://api.ptpema.co.id/dapi/send-message/first/',
                        { headers: { 'Authorization': `Bearer ${KEY_SYS}` } }
                    );
                } catch (err2) {
                    if (err2.response) {
                        console.error('❌ Response 404:', err2.response.status, err2.response.data);
                    } else {
                        console.error('❌ Error:', err2.message);
                    }
                    return;
                }
            } else {
                if (err.response) {
                    console.error('❌ Response error:', err.response.status, err.response.data);
                } else {
                    console.error('❌ Error:', err.message);
                }
                return;
            }
        }
        const result = response.data;
        if (result && result.success && result.data && result.data.number && result.data.message) {
            const d = result.data;
            const tanggalFormatted = formatTanggal(d.created_at);
            const formattedMessage =
                `Assalamu'alaikum ${d.panggilan} *${d.reciepint_name}*,\n\n` +
                `Anda baru saja mendapat notifikasi dari sistem *SYS PT PEMA*.\n\n` +
                `📌 *Pengirim:* ${d.actor_name}\n` +
                `📂 *Jenis:* ${d.entity} - ${d.type}\n` +
                `🗒️ *Pesan:* ${d.message}\n` +
                `📅 *Tanggal:* ${tanggalFormatted}\n` +
                `🔗 *Lihat Detail:* ${d.url}\n\n` +
                `Terima kasih.\n\n` +
                `—\n_pesan ini dikirim otomatis oleh sistem SYS PT PEMA_\n\n` +
                `\n_Anda bisa mengajukan Pertanyaan disini, Saya akan membantu anda semampu saya dengan kecerdasan buatan (AI)_`;

            const phoneNumber = d.number.replace(/\D/g, '');
            const chatId = phoneNumber.includes('@c.us') ? phoneNumber : `${phoneNumber}@c.us`;
            try {
                await client.sendMessage(chatId, formattedMessage);
                console.log(`✅ Pesan terkirim ke ${chatId}`);
                try {
                    await axios.post(
                        `https://api.ptpema.co.id/dapi/notif/${d.id}/set-swa`,
                        {},
                        { headers: { 'Authorization': `Bearer ${KEY_SYS}` } }
                    );
                    console.log(`✅ Status notifikasi ${d.id} diupdate ke API eksternal`);
                } catch (err) {
                    console.error(`❌ Gagal update status notifikasi ${d.id}:`, err.message);
                }
            } catch (err) {
                console.error(`❌ Gagal kirim pesan ke ${chatId}:`, err.message);
            }
        } else if (Array.isArray(result)) {
            for (const item of result) {
                if (item.number && item.message) {
                    const phoneNumber = item.number.replace(/\D/g, '');
                    const chatId = phoneNumber.includes('@c.us') ? phoneNumber : `${phoneNumber}@c.us`;
                    try {
                        await client.sendMessage(chatId, item.message);
                        console.log(`✅ Pesan terkirim ke ${chatId}`);
                    } catch (err) {
                        console.error(`❌ Gagal kirim pesan ke ${chatId}:`, err.message);
                    }
                }
            }
        }
    } catch (err) {
        console.error('❌ Gagal mengambil data dari API eksternal:', err.message);
    }
}
