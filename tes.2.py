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
