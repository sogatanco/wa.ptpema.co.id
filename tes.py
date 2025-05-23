import requests
import threading
import time
from stem import Signal
from stem.control import Controller

# Konfigurasi proxy dan target URL
proxies = {
    'http': 'socks5h://127.0.0.1:9050',
    'https': 'socks5h://127.0.0.1:9050'
}
url = "https://ajnn.net"

# Header agar request terlihat seperti browser
headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
}

# Fungsi untuk request sekali
def curl_once(index):
    try:
        response = requests.get(url, proxies=proxies, headers=headers, timeout=10)
        print(f"[{index}] Status: {response.status_code}")
    except Exception as e:
        print(f"[{index}] Error [{index}]: {e}")

# Fungsi ganti IP Tor dengan mengirim sinyal NEWNYM
def renew_tor_ip():
    try:
        with Controller.from_port(port=9051) as controller:
            controller.authenticate()  # Jika ada password, beri di sini: authenticate(password='yourpassword')
            controller.signal(Signal.NEWNYM)
            print("[*] Tor IP address renewed")
    except Exception as e:
        print(f"[!] Gagal renew IP Tor: {e}")

# Fungsi utama looping 60 request per detik
def main():
    for i in range(60):
        threading.Thread(target=curl_once, args=(i+1,)).start()
        time.sleep(1/60)  # delay ~16.6 ms antara request

if __name__ == "__main__":
    # Contoh: ganti IP Tor dulu sebelum mulai request
    renew_tor_ip()
    time.sleep(5)  # beri jeda 5 detik agar IP benar-benar berubah
    main()
