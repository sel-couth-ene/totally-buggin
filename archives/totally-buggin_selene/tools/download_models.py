"""Download the MediaPipe models into static/models so the demo runs offline.

    python tools/download_models.py
"""
import os
import ssl
import urllib.request
from pathlib import Path


def _ssl_context():
    # python.org builds on macOS ship without root certs; fall back to certifi or the system bundle
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        pass
    for path in ("/etc/ssl/cert.pem", "/etc/ssl/certs/ca-certificates.crt"):
        if os.path.exists(path):
            return ssl.create_default_context(cafile=path)
    return ssl.create_default_context()


CTX = _ssl_context()

DEST = Path(__file__).resolve().parents[1] / "static" / "models"
GCS = "https://storage.googleapis.com/mediapipe-models"
MODELS = {
    "pose_landmarker_full.task": "pose_landmarker/pose_landmarker_full/float16",
    "hand_landmarker.task": "hand_landmarker/hand_landmarker/float16",
    "face_landmarker.task": "face_landmarker/face_landmarker/float16",
}

DEST.mkdir(parents=True, exist_ok=True)
for name, folder in MODELS.items():
    out = DEST / name
    if out.exists() and out.stat().st_size > 100_000:
        print(f"have {name}")
        continue
    for version in ("1", "latest"):
        url = f"{GCS}/{folder}/{version}/{name}"
        try:
            with urllib.request.urlopen(url, timeout=120, context=CTX) as r:
                out.write_bytes(r.read())
            print(f"saved {name} ({out.stat().st_size // 1024} KB)")
            break
        except Exception as exc:  # try the next version folder
            print(f"  {url}: {exc}")
    else:
        print(f"could not download {name}")
