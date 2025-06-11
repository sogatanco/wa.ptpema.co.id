import { askGeminiFlash } from './askGeminiFlash.js';
import { askGeminiFlashWithoutContext } from './askGeminiFlashWithoutContext.js';

export async function handleIncomingMessage(msg, { client, GEMINI_API_KEY, greetedNumbers }) {
    const chat = await msg.getChat();
    if (chat.isGroup) return;
    const from = msg.from;
    const text = msg.body ? msg.body.trim().toLowerCase() : "";

    // Fitur: jika pesan "p", balas dengan pertanyaan konfirmasi tombol ya/tidak
    if (text === 'p') {
        const { Buttons } = await import('whatsapp-web.js');
        const buttons = new Buttons(
            'Apakah Anda ingin melanjutkan?',
            [
                { body: 'Ya' },
                { body: 'Tidak' }
            ],
            'Konfirmasi',
            'Silakan pilih Ya atau Tidak'
        );
        await client.sendMessage(from, buttons);
        return;
    }

    // Coba dengan context dulu
    let response = await askGeminiFlash(text, GEMINI_API_KEY);

    // Jika jawaban adalah "Maaf, data tidak tersedia dalam sistem." atau terlalu pendek/generik
    let isUnclear =
        !response ||
        response.trim().length < 10 ||
        /maaf, data tidak tersedia dalam sistem/i.test(response) ||
        /maaf|tidak dapat|tidak tahu|kurang jelas|saya tidak/.test(response.toLowerCase());

    // Jika unclear, coba ulangi ke Gemini tanpa konteks
    if (isUnclear) {
        const fallbackResponse = await askGeminiFlashWithoutContext(text, GEMINI_API_KEY);
        let isUnclearFallback =
            !fallbackResponse ||
            fallbackResponse.trim().length < 10 ||
            /maaf, data tidak tersedia dalam sistem/i.test(fallbackResponse) ||
            /maaf|tidak dapat|tidak tahu|kurang jelas|saya tidak/.test(fallbackResponse.toLowerCase());

        await msg.reply(fallbackResponse);
        return;
    }

    await msg.reply(response);

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
