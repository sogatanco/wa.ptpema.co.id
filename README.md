# WA AutoSender

Kirim WhatsApp otomatis tanpa pihak ketiga, cukup scan QR dari WhatsApp Web.

## Cara Pakai

1. **Install dependensi**
   ```
   npm install
   ```

2. **Jalankan server**
   ```
   npm start
   ```

3. **Scan QR**
   - QR code akan muncul di terminal (bukan di browser/web).
   - Scan QR tersebut menggunakan aplikasi WhatsApp Anda.

4. **Kirim Pesan**
   - Kirim POST ke endpoint `/send`:
     ```
     POST http://localhost:3000/send
     Content-Type: application/json

     {
       "number": "628xxxxxxx",
       "message": "Halo dari API!"
     }
     ```
   - Nomor WA harus format internasional tanpa `+`, misal: `6281234567890`.

5. **Cek status**
   - GET http://localhost:3000/status

## Catatan

- QR code hanya muncul di terminal saat belum login.
- Setelah scan, sesi akan tersimpan otomatis.
- Bisa di-deploy di server sendiri (VPS, cloud, dsb).
