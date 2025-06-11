import axios from 'axios';
import fs from 'fs';

export async function askGeminiFlash(question, GEMINI_API_KEY, contextFile) {
    let context = '';
    try {
        context = fs.readFileSync(`./${contextFile}`, 'utf8').trim();
    } catch (e) {
        context = '';
    }

    const prompt = context
        ? context + "\n\nJawablah pertanyaan berikut hanya berdasarkan data di atas. Jika jawabannya tidak ada dalam data, balas: 'Maaf, data tidak tersedia dalam sistem.'\n\nPertanyaan: " + question
        : question;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;
    try {
        const response = await axios.post(
            url,
            {
                contents: [
                    {
                        parts: [{ text: prompt }]
                    }
                ]
            },
            {
                headers: {
                    'Content-Type': 'application/json'
                }
            }
        );
        if (
            response.data &&
            Array.isArray(response.data.candidates) &&
            response.data.candidates.length > 0 &&
            response.data.candidates[0].content &&
            Array.isArray(response.data.candidates[0].content.parts) &&
            response.data.candidates[0].content.parts.length > 0 &&
            response.data.candidates[0].content.parts[0].text
        ) {
            return response.data.candidates[0].content.parts[0].text;
        }
        return "Maaf, data tidak tersedia dalam sistem.";
    } catch (err) {
        return "Maaf, data tidak tersedia dalam sistem.";
    }
}
