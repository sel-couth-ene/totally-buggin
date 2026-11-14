"""Device simulators.

Each generator returns what the real device would hand over for the time window
(t0, t1], in mission-elapsed seconds (MET, 0 = launch, negative = pre-flight).
Output is deterministic for a given (astronaut, device, window).

readings: list of (device, metric, value, unit, met)
events:   list of (device, type, payload_dict, met)
"""
from __future__ import annotations

import json
import zlib
from pathlib import Path

import numpy as np

DAY = 86400.0
HOUR = 3600.0
EPS = 1e-6

UNITS = {
    "heart_rate": "bpm", "breathing_rate": "breaths/min", "spo2": "%", "skin_temp": "°C",
    "sys_bp_est": "mmHg", "activity": "g", "core_temp": "°C", "activity_counts": "counts",
    "light_lux": "lux", "sleep_hours": "h", "sleep_efficiency": "%", "tempus_hr": "bpm",
    "tempus_sys": "mmHg", "tempus_dia": "mmHg", "tempus_spo2": "%", "tempus_temp": "°C",
    "ared_squat_kg": "kg", "ared_bench_kg": "kg", "t2_speed_kmh": "km/h",
    "t2_duration_min": "min", "cevis_hr_150w": "bpm", "onsd_mm": "mm", "ijv_area_mm2": "mm²",
    "mood": "/5", "stress": "/5",
    "rad_dose_rate": "µGy/h", "rad_high_lat": "µGy/h", "rad_spe_index": "× quiet", "rad_dose_msv": "mSv",
    "rad_cumulative_msv": "mSv", "cabin_co2_ppm": "ppm", "cabin_co2_max_ppm": "ppm", "cabin_temp_c": "°C",
    "cabin_humidity_pct": "%",
}

_BLOOD_PATH = Path(__file__).resolve().parents[1] / "data" / "i4_blood.json"
_blood_cache = None


def blood_data() -> dict:
    global _blood_cache
    if _blood_cache is None:
        _blood_cache = json.loads(_BLOOD_PATH.read_text(encoding="utf-8"))
    return _blood_cache


# --- helpers ---------------------------------------------------------------

def _rng(*parts) -> np.random.Generator:
    return np.random.default_rng(zlib.crc32("|".join(str(p) for p in parts).encode()))


# profile key -> indicator in data/reference/expected_trajectory.csv
TRAJECTORY_KEY = {"rest_hr": "heart_rate", "sys_bp": "bp_sys", "dia_bp": "bp_dia",
                  "sleep_h": "sleep", "core_temp": "core_temp", "spo2": "spo2"}


def level(profile: dict, key: str, met):
    """Baseline value, plus the normal in-flight adaptation from the expected trajectory,
    plus any personal drift active at time(s) met. Drifts are deviations from normal adaptation."""
    met = np.asarray(met, dtype=float)
    base = float(profile["baseline"].get(key, 0.0))
    v = np.full(met.shape, base)
    day = met / DAY
    ind = TRAJECTORY_KEY.get(key)
    if ind and nasa.has_trajectory(ind):
        v = v + np.vectorize(lambda d: nasa.expected(ind, d, base) - base, otypes=[float])(day)
    for d in profile["drifts"]:
        if d["key"] != key:
            continue
        frac = np.clip((day - d["from_day"]) / max(d["to_day"] - d["from_day"], EPS), 0, 1)
        v = v + d["delta"] * frac
    return v


def hour_of_day(met):
    return (np.asarray(met) % DAY) / HOUR


def is_rest_day(day_index: int) -> bool:
    return day_index % 7 == 6


def activity(met, rng) -> np.ndarray:
    h = hour_of_day(met)
    day_idx = np.floor(np.asarray(met) / DAY).astype(int)
    act = 0.22 + np.abs(rng.normal(0, 0.1, h.shape))
    asleep = (h >= 21.5) | (h < 6.0)
    act[asleep] = 0.03 + np.abs(rng.normal(0, 0.015, asleep.sum()))
    workout = ((h >= 9) & (h < 10)) | ((h >= 13) & (h < 13.75)) | ((h >= 16) & (h < 16.5))
    workout &= (day_idx % 7) != 6
    act[workout] = 0.75 + rng.normal(0, 0.08, workout.sum())
    return np.clip(act, 0, 1.5)


def epochs(t0: float, t1: float, step: float, sessions=None) -> np.ndarray:
    start = np.ceil((t0 + EPS) / step) * step
    t = np.arange(start, t1 + EPS, step)
    if sessions is None or t.size == 0:
        return t
    mask = np.zeros(t.shape, dtype=bool)
    for a, b in sessions:
        mask |= (t >= a) & (t < b)
    return t[mask]


def days_in(t0: float, t1: float):
    return range(int(np.floor(t0 / DAY)) - 1, int(np.floor(t1 / DAY)) + 1)


def biomonitor_sessions():
    return [(-20 * DAY, -18 * DAY)] + [(d * DAY, d * DAY + 2 * DAY) for d in range(14, 1000, 14)]


def thermomini_sessions():
    return [(-25 * DAY, -25 * DAY + 36 * HOUR)] + [
        (d * DAY + 18 * HOUR, d * DAY + 54 * HOUR) for d in range(28, 1000, 28)]


def in_session(met: float, sessions) -> bool:
    return any(a <= met < b for a, b in sessions)


def _r(dev, metric, values, times, ndigits=1):
    unit = UNITS.get(metric, "")
    return [(dev, metric, round(float(v), ndigits), unit, float(t)) for v, t in zip(values, times)]


# --- generators --------------------------------------------------------------

def gen_biomonitor(p, t0, t1):
    t = epochs(t0, t1, 300, biomonitor_sessions())
    if t.size == 0:
        return [], []
    rng = _rng(p["id"], "bio", int(t0))
    h = hour_of_day(t)
    act = activity(t, rng)
    circ = np.cos(2 * np.pi * (h - 15) / 24)
    hr = level(p, "rest_hr", t) + act * 70 + 3 * circ + rng.normal(0, 2, t.shape)
    br = level(p, "br", t) + act * 10 + rng.normal(0, 0.8, t.shape)
    spo2 = np.clip(level(p, "spo2", t) - act * 0.6 + rng.normal(0, 0.45, t.shape), 88, 100)
    skin = level(p, "skin_temp", t) + 0.4 * circ + rng.normal(0, 0.15, t.shape)
    sbp = level(p, "sys_bp", t) + act * 22 + rng.normal(0, 4, t.shape)
    out = (_r("biomonitor", "heart_rate", hr, t, 0) + _r("biomonitor", "breathing_rate", br, t)
           + _r("biomonitor", "spo2", spo2, t) + _r("biomonitor", "skin_temp", skin, t, 2)
           + _r("biomonitor", "sys_bp_est", sbp, t, 0) + _r("biomonitor", "activity", act, t, 3))
    return out, []


def gen_thermomini(p, t0, t1):
    t = epochs(t0, t1, 300, thermomini_sessions())
    if t.size == 0:
        return [], []
    rng = _rng(p["id"], "thermo", int(t0))
    h = hour_of_day(t)
    shift = level(p, "circ_shift", t)
    core = (level(p, "core_temp", t) + 0.42 * np.cos(2 * np.pi * (h - 18 - shift) / 24)
            + activity(t, rng) * 0.35 + rng.normal(0, 0.04, t.shape))
    return _r("thermomini", "core_temp", core, t, 2), []


def gen_actiwatch(p, t0, t1, epochs_from=None):
    rng = _rng(p["id"], "acti", int(t0))
    out = []
    e0 = t0 if epochs_from is None else max(t0, epochs_from)
    t = epochs(e0, t1, 600)
    if t.size:
        act = activity(t, rng)
        h = hour_of_day(t)
        asleep = (h >= 21.5) | (h < 6.0)
        lux = np.where(asleep, 0.5, 90 + rng.normal(0, 25, t.shape))
        out += _r("actiwatch", "activity_counts", act * 400, t, 0)
        out += _r("actiwatch", "light_lux", np.clip(lux, 0, None), t, 0)
    # nightly summary, available when the watch scores the night at 06:15
    for d in days_in(t0, t1):
        wake = d * DAY + 6.25 * HOUR
        if not (t0 < wake <= t1):
            continue
        r = _rng(p["id"], "night", d)
        hrs = float(np.clip(level(p, "sleep_h", wake) + r.normal(0, 0.35), 3, 10))
        eff = float(np.clip(level(p, "sleep_eff", wake) + r.normal(0, 2), 50, 99))
        out += [("actiwatch", "sleep_hours", round(hrs, 2), "h", wake),
                ("actiwatch", "sleep_efficiency", round(eff, 0), "%", wake)]
    return out, []


def gen_tempus(p, t0, t1):
    readings, events = [], []
    exam_days = [d for d in days_in(t0, t1) if d > 0 and d % 7 == 2] + [-30, -14, -7]
    for d in exam_days:
        t = d * DAY + 8.5 * HOUR
        if not (t0 < t <= t1):
            continue
        r = _rng(p["id"], "tempus", d)
        readings += [
            ("tempus", "tempus_hr", round(float(level(p, "rest_hr", t) + 4 + r.normal(0, 2))), "bpm", t),
            ("tempus", "tempus_sys", round(float(level(p, "sys_bp", t) + r.normal(0, 3))), "mmHg", t),
            ("tempus", "tempus_dia", round(float(level(p, "dia_bp", t) + r.normal(0, 2))), "mmHg", t),
            ("tempus", "tempus_spo2", round(float(min(100, level(p, "spo2", t) + r.normal(0, 0.4))), 1), "%", t),
            ("tempus", "tempus_temp", round(float(level(p, "core_temp", t) - 0.25 + r.normal(0, 0.08)), 2), "°C", t),
        ]
        events.append(("tempus", "ecg", {"rhythm": "Normal sinus rhythm",
                                          "qtc_ms": int(405 + r.normal(0, 8))}, t))
    return readings, events


def gen_exercise(p, t0, t1):
    readings, events = [], []
    for d in days_in(t0, t1):
        if is_rest_day(d) or (d < 0 and d < -30):
            continue
        r = _rng(p["id"], "ex", d)
        ared, t2, cevis = d * DAY + 9 * HOUR, d * DAY + 13 * HOUR, d * DAY + 16 * HOUR
        if t0 < ared <= t1:
            sq = round(float(level(p, "squat_kg", ared) + r.normal(0, 1.5)) * 2) / 2
            bp = round(float(level(p, "bench_kg", ared) + r.normal(0, 1.0)) * 2) / 2
            readings += [("exercise", "ared_squat_kg", sq, "kg", ared),
                         ("exercise", "ared_bench_kg", bp, "kg", ared)]
            events.append(("exercise", "workout", {"equipment": "ARED", "duration_min": 60,
                                                    "summary": f"Squat {sq} kg, bench {bp} kg"}, ared))
        if t0 < t2 <= t1:
            sp = round(float(level(p, "t2_speed", t2) + r.normal(0, 0.2)), 1)
            readings += [("exercise", "t2_speed_kmh", sp, "km/h", t2),
                         ("exercise", "t2_duration_min", 30, "min", t2)]
            events.append(("exercise", "workout", {"equipment": "T2", "duration_min": 30,
                                                    "summary": f"Treadmill {sp} km/h"}, t2))
        if t0 < cevis <= t1:
            hr = round(float(level(p, "cevis_hr", cevis) + r.normal(0, 2)))
            readings += [("exercise", "cevis_hr_150w", hr, "bpm", cevis)]
            events.append(("exercise", "workout", {"equipment": "CEVIS", "duration_min": 30,
                                                    "summary": f"Bike at 150 W, heart rate {hr} bpm"}, cevis))
    return readings, events


def gen_ultrasound(p, t0, t1):
    readings, events = [], []
    for d in [-30] + list(range(28, 1000, 28)):
        t = d * DAY + 11 * HOUR
        if not (t0 < t <= t1):
            continue
        r = _rng(p["id"], "us", d)
        onsd = float(level(p, "onsd_mm", t) + r.normal(0, 0.05))
        area = float(level(p, "ijv_area", t) + r.normal(0, 3))
        readings += [("ultrasound", "onsd_mm", round(onsd, 2), "mm", t),
                     ("ultrasound", "ijv_area_mm2", round(area, 0), "mm²", t)]
        ratio = area / p["baseline"]["ijv_area"]
        flow = "Normal forward flow" if ratio < 1.4 else "Slow forward flow"
        events.append(("ultrasound", "ijv_flow", {"pattern": flow, "side": "left"}, t))
    return readings, events


BLOOD_TIMEPOINTS = {"L-92": -92 * DAY, "L-44": -44 * DAY, "L-3": -3 * DAY, "R+1": 139 * DAY}


def gen_rhealth(p, t0, t1):
    """Real Inspiration4 values. Pre-flight draws keep their timing; the R+1
    draw (closest to spaceflight exposure) is shown as the latest in-flight panel."""
    subj = blood_data()["subjects"].get(p["osdr_subject"], {})
    readings = []
    for tp, base_t in BLOOD_TIMEPOINTS.items():
        t = base_t + 10 * HOUR
        if not (t0 < t <= t1):
            continue
        for mid, m in subj.items():
            v = m["points"].get(tp)
            if v is not None:
                readings.append(("rhealth", "bl_" + mid, float(v), m["unit"], t))
    return readings, []


def gen_crew_app_history(p, t0, t1):
    readings, events = [], []
    for d in days_in(t0, t1):
        if not (-14 <= d):
            continue
        t = d * DAY + 21 * HOUR
        if not (t0 < t <= t1):
            continue
        r = _rng(p["id"], "mood", d)
        mood = int(np.clip(round(float(level(p, "mood", t) + r.normal(0, 0.45))), 1, 5))
        stress = int(np.clip(round(float(level(p, "stress", t) + r.normal(0, 0.45))), 1, 5))
        readings += [("crew_app", "mood", mood, "/5", t), ("crew_app", "stress", stress, "/5", t)]
    if p["id"] == "okafor":
        for d in (138, 140):
            t = d * DAY + 21.5 * HOUR
            if t0 < t <= t1:
                events.append(("medkit", "medication", {"name": "Sleep aid", "pack": "Pack B",
                                                         "reason": "Trouble falling asleep"}, t))
    return readings, events


from . import nasa  # noqa: E402  (real-data "devices")

GENERATORS = {
    "dosimeter": nasa.gen_dosimeter,      # real NASA RadLab data
    "cabin_env": nasa.gen_cabin,          # real NASA OSDR cabin telemetry
    "biomonitor": gen_biomonitor,
    "thermomini": gen_thermomini,
    "actiwatch": gen_actiwatch,
    "tempus": gen_tempus,
    "exercise": gen_exercise,
    "ultrasound": gen_ultrasound,
    "rhealth": gen_rhealth,
}
