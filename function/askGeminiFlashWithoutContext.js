import axios from 'axios';

export async function askGeminiFlashWithoutContext(question, GEMINI_API_KEY) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;
    try {
        const response = await axios.post(
            url,
            {
                contents: [
                    {
                        parts: [{ text: question }]
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
        return "Maaf, saya tidak dapat menjawab pertanyaan Anda.";
    } catch (err) {
        if (err.response && err.response.data && err.response.data.error && err.response.data.error.message) {
            console.error('❌ Gemini Flash API error:', err.response.data.error.message);
        } else {
            console.error('❌ Gemini Flash API error:', err.message);
        }
        return "Maaf, terjadi kesalahan saat menjawab pertanyaan Anda.";
    }
}
