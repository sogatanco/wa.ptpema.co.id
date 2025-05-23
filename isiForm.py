import requests
from bs4 import BeautifulSoup
import random
import string

def random_text(length=8):
    return ''.join(random.choices(string.ascii_letters + string.digits, k=length))

def isi_form_ajnn(name, email, address, subject, message):
    session = requests.Session()
    # Ambil halaman kontak untuk dapatkan kode captcha (code)
    resp = session.get("https://www.ajnn.net/kontak.html")
    soup = BeautifulSoup(resp.text, "html.parser")
    # Ambil value code dari input name="code"
    code = ""
    code_input = soup.find("input", {"name": "code"})
    if code_input:
        code = code_input.get("value", "")

    payload = {
        "name": name,
        "email": email,
        "address": address,
        "subject": subject,
        "message": message,
        "code": code,
        "current": "https://www.ajnn.net/kontak.html",
        "form": "contact",
        "section": "contact"
    }

    headers = {
        "Referer": "https://www.ajnn.net/kontak.html",
        "Origin": "https://www.ajnn.net",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Content-Type": "application/x-www-form-urlencoded"
    }

    url_post = "https://www.ajnn.net/request.html?1747993243525"
    r = session.post(url_post, data=payload, headers=headers)
    return r.status_code, r.text

def isi_form_ajnn_random():
    session = requests.Session()
    resp = session.get("https://www.ajnn.net/kontak.html")
    soup = BeautifulSoup(resp.text, "html.parser")
    code = ""
    code_input = soup.find("input", {"name": "code"})
    if code_input:
        code = code_input.get("value", "")

    payload = {
        "name": random_text(10),
        "email": f"{random_text(7)}@{random_text(5)}.com",
        "address": random_text(12),
        "subject": random_text(15),
        "message": random_text(30),
        "code": code,
        "current": "https://www.ajnn.net/kontak.html",
        "form": "contact",
        "section": "contact"
    }

    headers = {
        "Referer": "https://www.ajnn.net/kontak.html",
        "Origin": "https://www.ajnn.net",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Content-Type": "application/x-www-form-urlencoded"
    }

    url_post = "https://www.ajnn.net/request.html?1747993243525"
    r = session.post(url_post, data=payload, headers=headers)
    return r.status_code, r.text

# Contoh penggunaan:
# status, resp = isi_form_ajnn("Nama", "email@contoh.com", "Alamat", "Subjek", "Isi pesan")
# print(status, resp)

# status, resp = isi_form_ajnn_random()
# print(status, resp)
