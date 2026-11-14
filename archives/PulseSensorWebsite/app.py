import threading
import time
from collections import deque

import serial
import serial.tools.list_ports
from flask import Flask, jsonify, render_template

# ---- Settings ---------------------------------------------------------
PORT = None      # e.g. "COM3", "/dev/ttyACM0", "/dev/cu.usbmodem1101". None = auto-detect
BAUD = 115200
HOST = "127.0.0.1"   # use "0.0.0.0" to open the page from other devices on your Wi-Fi
WEB_PORT = 5000
# -----------------------------------------------------------------------

samples = deque(maxlen=300)          # last ~6 seconds of the wave
state = {"bpm": 0, "connected": False, "resetting": False}
reset_requested = threading.Event()


def find_port():
    if PORT:
        return PORT
    for p in serial.tools.list_ports.comports():
        text = f"{p.description} {p.manufacturer}".lower()
        if "arduino" in text or "usb serial" in text or "ch340" in text or "acm" in p.device.lower():
            return p.device
    return None


def restart_arduino(ser):
    """Clear everything and reboot the Arduino so its BPM tracking starts from scratch."""
    state["resetting"] = True
    samples.clear()
    state["bpm"] = 0
    # Toggling DTR reboots an Uno (same thing the IDE does when uploading)
    ser.dtr = False
    time.sleep(0.1)
    ser.dtr = True
    time.sleep(2)                    # wait for the board to boot
    ser.reset_input_buffer()
    samples.clear()
    state["bpm"] = 0
    state["resetting"] = False


def read_serial():
    while True:
        port = find_port()
        if not port:
            state["connected"] = False
            time.sleep(2)
            continue
        try:
            with serial.Serial(port, BAUD, timeout=1) as ser:
                time.sleep(2)        # Arduino resets when the port opens
                state["connected"] = True
                while True:
                    if reset_requested.is_set():
                        reset_requested.clear()
                        restart_arduino(ser)
                        continue
                    line = ser.readline().decode(errors="ignore").strip()
                    parts = line.split(",")
                    if len(parts) == 2 and parts[0].isdigit() and parts[1].isdigit():
                        samples.append(int(parts[0]))
                        state["bpm"] = int(parts[1])
        except (serial.SerialException, OSError):
            state["connected"] = False
            state["resetting"] = False
            time.sleep(2)            # retry if unplugged or port busy


app = Flask(__name__)


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/data")
def data():
    return jsonify(
        bpm=state["bpm"],
        connected=state["connected"],
        resetting=state["resetting"],
        samples=list(samples),
    )


@app.route("/reset", methods=["POST"])
def reset():
    samples.clear()
    state["bpm"] = 0
    state["resetting"] = True
    reset_requested.set()
    return jsonify(ok=True)


if __name__ == "__main__":
    threading.Thread(target=read_serial, daemon=True).start()
    # use_reloader=False: the reloader would start a second serial reader and fight for the port
    app.run(host=HOST, port=WEB_PORT, debug=False, use_reloader=False)
