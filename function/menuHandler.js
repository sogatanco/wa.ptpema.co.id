// State menu per user
export const userMenuState = new Map();

export async function handleMenu(msg, from, text) {
    // Handler menu utama
    if (text === 'menu') {
        userMenuState.set(from, 'main');
        const menuMsg =
`*MENU UTAMA*
1. Booking Ruang Rapat
2. Zoom Meeting
3. Persetujuan saya
4. Keluar`;
        await msg.reply(menuMsg);
        return true;
    }

    // Handler submenu Booking Ruang Rapat
    if (userMenuState.get(from) === 'main' && text === '1') {
        userMenuState.set(from, 'booking');
        const submenuMsg =
`*BOOKING RUANG RAPAT*
1. List rapat yang akan datang
2. Booking ruang rapat
Ketik angka sesuai pilihan.`;
        await msg.reply(submenuMsg);
        return true;
    }

    // Handler submenu Booking Ruang Rapat: List rapat yang akan datang
    if (userMenuState.get(from) === 'booking' && text === '1') {
        await msg.reply('Berikut adalah daftar rapat yang akan datang:\n- (dummy data)');
        return true;
    }

    // Handler submenu Booking Ruang Rapat: Booking ruang rapat
    if (userMenuState.get(from) === 'booking' && text === '2') {
        await msg.reply('Silakan masukkan detail booking ruang rapat Anda.');
        return true;
    }

    // Handler keluar dari menu
    if ((userMenuState.get(from) === 'main' || userMenuState.get(from) === 'booking') && text === '4') {
        userMenuState.delete(from);
        await msg.reply('Anda telah keluar dari menu.');
        return true;
    }

    return false; // Tidak ada menu yang dihandle
}
