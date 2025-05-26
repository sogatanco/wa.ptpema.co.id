import requests
import random
import string

def random_string(length=8):
    return ''.join(random.choices(string.ascii_lowercase + string.digits, k=length))

# IP target langsung
ip_url = "http://123.456.78.90"
domain_name = "harianpaparazzi.com"

# Tambahkan query string acak seperti `?s=abc123`
url = f"{ip_url}/?s={random_string()}"

# Header disesuaikan agar mirip curl
headers = {
    "Host": domain_name,
    "User-Agent": "curl/8.5.0",  # Versi bisa disesuaikan
    "Accept": "*/*",
    "Connection": "close"
}

try:
    response = requests.get(url, headers=headers, allow_redirects=True, timeout=10)
    print(f"Status: {response.status_code}")
    print(response.text[:500])  # Menampilkan sebagian respon HTML
except requests.RequestException as e:
    print(f"Request failed: {e}")
