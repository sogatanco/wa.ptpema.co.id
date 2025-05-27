import subprocess
import threading
import time
import random
import string

def random_string(length=8):
    return ''.join(random.choices(string.ascii_lowercase + string.digits, k=length))

def run_curl(index):
    rand = random_string()
    url = f"http://153.92.9.237/?s={rand}"  # IP dari bisnisia.id
    cmd = [
        "curl",
        "-s",
        "-L",
        "-o", "/dev/null",  # Buang isi response
        "-w", "%{http_code}",  # Tampilkan status HTTP saja
        "-H", "Host: bisnisia.id",
        url
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
        status_code = result.stdout.strip()
        print(f"[{index}] HTTP Status: {status_code}")
    except Exception as e:
        print(f"[{index}] Error: {e}")

def run_50_curl_per_second():
    counter = 0
    while True:
        threads = []
        start = time.time()
        for i in range(50):
            counter += 1
            t = threading.Thread(target=run_curl, args=(counter,))
            t.start()
            threads.append(t)
        for t in threads:
            t.join()
        elapsed = time.time() - start
        time.sleep(max(0, 1 - elapsed))

if __name__ == "__main__":
    run_50_curl_per_second()
