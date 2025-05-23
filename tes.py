import requests
import time
import threading

# Konfigurasi proxy Tor
proxies = {
    'http': 'socks5h://127.0.0.1:9050',
    'https': 'socks5h://127.0.0.1:9050'
}

url = "https://pintoe.co/"

# Fungsi untuk satu permintaan
def curl_once(index):
    try:
        response = requests.get(url, proxies=proxies, timeout=10)
        print(f"[{index}] Status: {response.status_code}")
    except Exception as e:
        print(f"[{index}] Error:", e)

# Loop 60 kali per detik (setiap 0.0167 detik)
for i in range(60):
    t = threading.Thread(target=curl_once, args=(i+1,))
    t.start()
    time.sleep(1/60)
