"""Optional: download the MediaPipe model files ahead of time (so the first run is instant)."""
from app import MODEL_DIR, MODEL_URLS
import urllib.request

for name, url in MODEL_URLS.items():
    target = MODEL_DIR / name
    if target.exists():
        print(f"{name}: already there")
        continue
    print(f"{name}: downloading ...")
    urllib.request.urlretrieve(url, target)
print("Done.")
