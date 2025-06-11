import { askGeminiFlash } from './askGeminiFlash.js';
import { askGeminiFlashWithoutContext } from './askGeminiFlashWithoutContext.js';

// Menyimpan riwayat chat per user (sederhana, memory only)
const chatHistory = new Map();

export async function handleIncomingMessage(msg, { client, GEMINI_API_KEY, greetedNumbers }) {
    const chat = await msg.getChat();
    if (chat.isGroup) return;
    const from = msg.from;
    // Pisahkan nomor saja dari msg.from (misal: 6281234567890@c.us -> 6281234567890)
    const nomor = from.replace(/@.*$/, '');
    console.log(`📥 Pesan masuk dari ${nomor}: ${msg.body}`);
    const text = msg.body ? msg.body.trim().toLowerCase() : "";

    // Simpan riwayat chat user (maksimal 5 pesan terakhir)
    let history = chatHistory.get(from) || [];
    // Deteksi apakah pesan ini berkaitan (misal: tanya "siapa kamu", lalu "siapa yang buat")
    // Sederhana: jika pesan sebelumnya mengandung kata tanya (siapa/apa/dimana/dll) atau pesan sekarang mengandung kata "siapa|apa|dimana|kapan|mengapa|bagaimana|kenapa|siapa yang"
    const kataTanya = /(siapa|apa|dimana|kapan|mengapa|bagaimana|kenapa|siapa yang)/i;
    const isRelated = history.length > 0 && (kataTanya.test(history[history.length - 1]) || kataTanya.test(text));
    if (isRelated) {
        history.push(text);
        if (history.length > 5) history = history.slice(-5);
        chatHistory.set(from, history);
    } else {
        history = [text];
        chatHistory.set(from, history);
    }

    // Fitur: jika pesan "p", balas dengan teks saja tanpa tombol
    if (text === 'p') {
        await client.sendMessage(from, 'Apakah Anda ingin melanjutkan? Balas dengan "ya" atau "tidak".');
        return;
    }

    // Gabungkan riwayat chat sebagai konteks tambahan hanya jika berkaitan
    let fullPrompt = text;
    if (isRelated && history.length > 1) {
        const historyPrompt = history.slice(0, -1).map((h) => `User: ${h}`).join('\n');
        fullPrompt = `${historyPrompt}\nUser: ${text}`;
    }

    // Coba dengan context dulu (pakai fullPrompt)
    let response = await askGeminiFlash(fullPrompt, GEMINI_API_KEY);

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
