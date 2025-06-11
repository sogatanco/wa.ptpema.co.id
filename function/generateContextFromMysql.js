import fs from 'fs';
import mysql from 'mysql2/promise';

export async function generateContextFromMysql(dbConfig, query, fileName = 'context.txt') {
    // Tambahkan deskripsi AI di awal context
    const aiIntro = 'Saya adalah asisten AI PT PEMA, dikembangkan oleh Divisi Teknologi Informasi PT PEMA untuk membantu menjawab pertanyaan dan memberikan informasi seputar perusahaan secara otomatis dan profesional.\n\n';
    const pemaIntro = 'PT. Pembangunan Aceh (PEMA) merupakan Badan Usaha Milik Daerah Aceh (BUMD/BUMA) yang sahamnya 100% dimiliki Pemerintah Aceh, yang bertujuan untuk meningkatkan pembangunan, perekonomian serta Pendapatan Asli Aceh. Website ini merupakan sarana media pelayanan data dan informasi untuk menjembatani keinginan PT PEMA agar lebih mengenal dan dikenal oleh masyarakat melalui media elektronik.\n\n';
    let connection;
    try {
        console.log(`⏳ Mulai mengambil data dari MySQL untuk ${fileName}...`);
        connection = await mysql.createConnection(dbConfig);
        const [rows] = await connection.execute(query);
        const jsonText = JSON.stringify(rows, null, 2);
        const contextText = aiIntro + pemaIntro + jsonText;
        fs.writeFileSync(`./${fileName}`, contextText, 'utf8');
        console.log(`✅ ${fileName} berhasil digenerate dari MySQL`);
    } catch (err) {
        if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
            console.error('❌ Tidak dapat terhubung ke MySQL. Pastikan service MySQL berjalan dan konfigurasi sudah benar.');
        } else {
            console.error(`❌ Gagal generate ${fileName} dari MySQL:`, err.message);
        }
    } finally {
        if (connection) await connection.end();
        console.log(`ℹ️ Proses generate ${fileName} dari MySQL selesai.`);
    }
}
