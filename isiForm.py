import requests
from bs4 import BeautifulSoup
import random
import string
from PIL import Image
from io import BytesIO
import pytesseract

def random_text(length=8):
    return ''.join(random.choices(string.ascii_letters + string.digits, k=length))

def get_captcha_text(session, base_url, soup):
    """
    Ambil gambar captcha dari halaman, jalankan OCR, kembalikan hasil teksnya.
    """
    captcha_img = soup.find("img", {"id": "captcha"})
    if not captcha_img:
        print("Captcha image not found.")
        return ""

    # Ambil URL gambar captcha lengkap
    src = captcha_img.get("src", "")
    if not src.startswith("http"):
        # Buat url absolut
        src = base_url.rstrip("/") + "/" + src.lstrip("/")
    
    print(f"Fetching captcha image from: {src}")
    resp = session.get(src)
    img = Image.open(BytesIO(resp.content))

    # Jalankan OCR
    captcha_text = pytesseract.image_to_string(img).strip()
    print(f"Captcha OCR result: '{captcha_text}'")
    return captcha_text

def isi_form_ajnn(name, email, address, subject, message):
    base_url = "https://ajnn.net"  # Ganti dengan domain kamu
    session = requests.Session()

    # 1. Ambil halaman kontak untuk dapatkan kode captcha dan gambar captcha
    resp = session.get(f"{base_url}/kontak.html")
    soup = BeautifulSoup(resp.text, "html.parser")

    # 2. Jalankan OCR untuk dapatkan kode captcha otomatis
    code = get_captcha_text(session, base_url, soup)

    # 3. Siapkan payload
    payload = {
        "name": name,
        "email": email,
        "address": address,
        "subject": subject,
        "message": message,
        "code": code,
        "current": f"{base_url}/kontak.html",
        "form": "contact",
        "section": "contact"
    }

    headers = {
        "Referer": f"{base_url}/kontak.html",
        "Origin": base_url,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Content-Type": "application/x-www-form-urlencoded"
    }

    # 4. Kirim POST ke endpoint request.html
    url_post = f"{base_url}/request.html"
    r = session.post(url_post, data=payload, headers=headers)

    print("Status:", r.status_code)
    print("Response:", r.text)

# Contoh penggunaan
if __name__ == "__main__":
    isi_form_ajnn(
        name="ewewyw",
        email="wahyudinlsm98@gmail.com",
        address="Rumah budaya",
        subject="sdhsdh",
        message="dshsdh"
    )
