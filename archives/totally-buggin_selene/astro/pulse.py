"""Live pulse from an Arduino + Pulse Sensor over USB serial.

Logic from heart_rate_sensor_code/: the sketch (heart_rate_sensor_code/arduino/pulse_sensor)
prints one line every 20 ms, "<raw sample 0-1023>,<bpm>". A background thread reads those lines,
keeps the last ~6 seconds of the wave for drawing and the last ~75 seconds for analysis, and
works out resting heart rate, heart-rate variability and breathing rate (astro/pulse_analysis.py).
/api/pulse serves all of it, and record() stores the numbers as readings from the "pulse_sensor"
device so the health engine can use them.

Optional: if pyserial isn't installed or no Arduino is plugged in, the rest of the app runs as usual.
Reading can be stopped and started again from the page (set_paused); while stopped the serial port
is closed, so the Arduino IDE can use it.
Settings (environment variables):
  PULSE_PORT   serial port, e.g. /dev/cu.usbmodem1101 or COM3 (default: auto-detect)
  PULSE_BAUD   default 115200, must match Serial.begin() in the sketch
  PULSE=0      don't look for a sensor at all
  PULSE=sim    use a made-up sensor (no hardware needed), for demos and testing
"""
from __future__ import annotations

import os
import threading
import time
from collections import deque

from . import db, pulse_analysis

try:
    import serial
    import serial.tools.list_ports
except ImportError:          # pyserial not installed: sensor support is off
    serial = None

PORT = os.environ.get("PULSE_PORT") or None
BAUD = int(os.environ.get("PULSE_BAUD", 115200))
SIM = os.environ.get("PULSE", "1") == "sim"
ENABLED = os.environ.get("PULSE", "1") != "0"
STALE_S = 3.0                # no line for this long: the board is connected but not sending
NOMINAL_FS = 50.0            # the sketch sends a line every 20 ms
ANALYSIS_EVERY_S = 1.0
RECORD_EVERY_S = 5.0         # how often the numbers are stored for the health engine
DEVICE_ID = "pulse_sensor"

_lock = threading.Lock()
_samples: deque[int] = deque(maxlen=300)     # 300 x 20 ms = last ~6 seconds of the wave, for drawing
_long: deque[int] = deque(maxlen=4000)       # ~80 s of the wave, for the analysis
_long_t: deque[float] = deque(maxlen=4000)   # when each of those lines arrived
_state = {"bpm": 0, "connected": False, "connecting": False, "resetting": False,
          "port": None, "last": 0.0}
_vitals: dict = pulse_analysis.empty()
_next_analysis = 0.0
_last_record: dict[str, float] = {}
_reset_requested = threading.Event()
_paused = threading.Event()
_thread: threading.Thread | None = None


def find_port():
    if PORT:
        return PORT
    for p in serial.tools.list_ports.comports():
        text = f"{p.description} {p.manufacturer}".lower()
        dev = p.device.lower()
        if ("arduino" in text or "usb serial" in text or "ch340" in text
                or "acm" in dev or "usbmodem" in dev or "usbserial" in dev):
            return p.device
    return None


def _clear():
    global _vitals
    with _lock:
        _samples.clear()
        _long.clear()
        _long_t.clear()
        _vitals = pulse_analysis.empty()
        _state["bpm"] = 0


def _push(raw: int, bpm: int):
    """Store one line from the sensor, and re-run the analysis about once a second."""
    global _next_analysis
    now = time.time()
    with _lock:
        _samples.append(raw)
        _long.append(raw)
        _long_t.append(now)
        _state["bpm"] = bpm
        _state["last"] = now
    if now >= _next_analysis:
        _next_analysis = now + ANALYSIS_EVERY_S
        _analyse()


def _analyse():
    global _vitals
    with _lock:
        raw, ts = list(_long), list(_long_t)
    if len(raw) < 20:
        return
    span = ts[-1] - ts[0]
    # real sample rate from the clock: the board's loop runs a little slower than 50 Hz
    fs = min(120.0, max(30.0, (len(raw) - 1) / span)) if span > 5 else NOMINAL_FS
    v = pulse_analysis.analyze(raw, fs)
    with _lock:
        _vitals = v


def _restart_arduino(ser):
    """Reboot the board (toggling DTR resets an Uno, as the IDE does) so BPM tracking starts fresh."""
    _state["resetting"] = True
    _clear()
    ser.dtr = False
    time.sleep(0.1)
    ser.dtr = True
    time.sleep(2)            # wait for the board to boot
    ser.reset_input_buffer()
    _clear()
    _state["resetting"] = False


def _read_serial():
    while True:
        if _paused.is_set():
            _state.update(connected=False, connecting=False, resetting=False)
            time.sleep(0.25)
            continue
        port = find_port()
        if not port:
            _state.update(connected=False, connecting=False, port=None)
            time.sleep(2)
            continue
        try:
            with serial.Serial(port, BAUD, timeout=1) as ser:
                time.sleep(2)    # the Arduino resets when the port opens
                _state.update(connected=True, connecting=False, port=port, last=time.time())
                while not _paused.is_set():
                    if _reset_requested.is_set():
                        _reset_requested.clear()
                        _restart_arduino(ser)
                        _state["last"] = time.time()
                        continue
                    line = ser.readline().decode(errors="ignore").strip()
                    parts = line.split(",")
                    if len(parts) == 2 and parts[0].isdigit() and parts[1].isdigit():
                        _push(int(parts[0]), int(parts[1]))
            # leaving the with-block closes the port (paused)
        except (serial.SerialException, OSError):
            _state.update(connected=False, connecting=False, resetting=False)
            time.sleep(2)        # unplugged or the port is busy (close the Arduino Serial Monitor)


def _read_sim():
    """A made-up sensor: same lines as the Arduino, at the same pace."""
    while True:
        if _paused.is_set():
            _state.update(connected=False, connecting=False, resetting=False)
            time.sleep(0.25)
            continue
        wave = pulse_analysis.SimWave(hr=71.0, rsa_hz=0.24, rsa_ms=38.0)
        _state.update(connected=True, connecting=False, port="simulated sensor", last=time.time())
        tick = time.time()
        while not _paused.is_set():
            if _reset_requested.is_set():
                _reset_requested.clear()
                _clear()
                _state["resetting"] = False
                wave = pulse_analysis.SimWave(hr=71.0, rsa_hz=0.24, rsa_ms=38.0)
            raw, bpm = wave.step(1.0 / NOMINAL_FS)
            _push(raw, bpm)
            tick += 1.0 / NOMINAL_FS
            time.sleep(max(0.0, tick - time.time()))


def start() -> bool:
    """Start the reader thread once. Returns False when sensor support is off."""
    global _thread
    if not ENABLED or (serial is None and not SIM):
        return False
    if _thread is None:
        _thread = threading.Thread(target=_read_sim if SIM else _read_serial, daemon=True, name="pulse-sensor")
        _thread.start()
    return True


def is_receiving() -> bool:
    """True while the sensor is switched on and lines are arriving."""
    return (not _paused.is_set()) and _state["connected"] and time.time() - _state["last"] < STALE_S


def is_reading() -> bool:
    """True only while a real pulse is being read right now: lines are arriving, the heart rate is above 0,
    and the wave analysis finds real beats (signal quality good or fair). A sensor with no finger on it
    still sends lines, and its firmware keeps repeating the last heart rate it saw, so neither counts.
    When this is False the app uses its simulated readings instead."""
    with _lock:
        bpm, quality = _state["bpm"], _vitals.get("quality")
    return is_receiving() and bpm > 0 and quality in ("good", "fair")


def snapshot() -> dict:
    with _lock:
        samples = list(_samples)
        bpm = _state["bpm"]
        vitals = dict(_vitals)
    paused = _paused.is_set()
    connected = _state["connected"] and not paused
    receiving = is_receiving()
    return {
        "available": (serial is not None or SIM) and ENABLED,
        "simulated": SIM,
        "connected": connected, "receiving": receiving, "paused": paused,
        "connecting": _state["connecting"] and not paused,
        "resetting": _state["resetting"], "port": _state["port"],
        "bpm": bpm if receiving else 0,
        "samples": samples if receiving else [],
        "sample_ms": 20,
        "vitals": vitals if receiving else pulse_analysis.empty(),
        "reading": receiving and bpm > 0 and vitals.get("quality") in ("good", "fair"),   # see is_reading()
    }


def set_paused(paused: bool) -> bool:
    """Stop reading from the sensor (the port is released), or start again."""
    if paused:
        _paused.set()
        _clear()
        _state.update(connected=False, connecting=False, resetting=False)
    else:
        _state["connecting"] = True
        _paused.clear()
    return paused


def request_reset() -> bool:
    if not _state["connected"] or _paused.is_set():
        return False             # nothing to restart; don't leave "resetting" stuck on
    _clear()
    _state["resetting"] = True
    _reset_requested.set()
    return True


def record(conn, astronaut_id: str, now_met: float, snap: dict | None = None) -> bool:
    """Store the current numbers as readings from the pulse sensor for this astronaut.

    Called while the page polls /api/pulse, at most once every few seconds. Only stores while a
    pulse is really being read (quality good or fair), so a sensor lying on the table adds nothing.
    The health engine uses these for the resting heart rate and breathing rate (astro/health.py)."""
    snap = snap or snapshot()
    v = snap["vitals"]
    if not snap["receiving"] or not snap["bpm"] or v.get("quality") not in ("good", "fair"):
        return False
    t = time.time()
    if t - _last_record.get(astronaut_id, 0.0) < RECORD_EVERY_S:
        return False
    _last_record[astronaut_id] = t
    rows = [(DEVICE_ID, "pulse_bpm", float(snap["bpm"]), "bpm", now_met)]
    for metric, key, unit in (("pulse_resting_hr", "resting_hr", "bpm"),
                              ("pulse_hrv_rmssd", "hrv_rmssd", "ms"),
                              ("pulse_breathing_rate", "breathing_rate", "breaths/min")):
        if v.get(key) is not None:
            rows.append((DEVICE_ID, metric, float(v[key]), unit, now_met))
    db.insert_records(conn, astronaut_id, rows, [])
    conn.commit()
    return True
