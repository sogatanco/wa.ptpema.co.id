import requests

proxies = {
    'http': 'socks5h://127.0.0.1:9050',
    'https': 'socks5h://127.0.0.1:9050'
}

url = "https://httpbin.org/ip"  # atau https://check.torproject.org

try:
    response = requests.get(url, proxies=proxies, timeout=10)
    print("IP dari Tor:", response.text)
except Exception as e:
    print("Error:", e)