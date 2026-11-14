"""Body Atlas - Flask backend.

Serves the page, the anatomy data (/api/parts) and the MediaPipe model files.
All tracking runs in the browser (MediaPipe Tasks Vision), so no video ever
leaves the user's machine.
"""
import threading
import urllib.request
from pathlib import Path

from flask import Flask, abort, jsonify, redirect, render_template, send_from_directory

from body_parts import BODY_PARTS

BASE_DIR = Path(__file__).resolve().parent
MODEL_DIR = BASE_DIR / "static" / "models"
MODEL_DIR.mkdir(parents=True, exist_ok=True)

_GCS = "https://storage.googleapis.com/mediapipe-models"
MODEL_URLS = {
    "pose_landmarker_full.task": f"{_GCS}/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task",
    "hand_landmarker.task": f"{_GCS}/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
    "face_landmarker.task": f"{_GCS}/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
}

app = Flask(__name__)
_download_lock = threading.Lock()


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/parts")
def parts():
    return jsonify(BODY_PARTS)


@app.route("/models/<name>")
def model_file(name):
    """Serve a MediaPipe model. Downloads and caches it on first request."""
    if name not in MODEL_URLS:
        abort(404)
    local = MODEL_DIR / name
    if not local.exists():
        with _download_lock:
            if not local.exists():
                tmp = local.with_suffix(".part")
                try:
                    print(f"Downloading {name} ...")
                    urllib.request.urlretrieve(MODEL_URLS[name], tmp)
                    tmp.replace(local)
                except Exception as exc:  # no internet on the server: let the browser fetch it
                    print(f"Download failed ({exc}); redirecting to the source URL")
                    tmp.unlink(missing_ok=True)
                    return redirect(MODEL_URLS[name])
    return send_from_directory(MODEL_DIR, name, max_age=86400)


if __name__ == "__main__":
    # Camera access works on http://localhost. For other hosts you need HTTPS.
    app.run(host="127.0.0.1", port=5000, debug=True)
