"""Convert PhysioNet MMASH recordings into data/real/mmash_baselines.json.

MMASH (Multilevel Monitoring of Activity and Sleep in Healthy people): 22 healthy young adults,
each recorded for ~24 hours with a Polar H7 chest strap (beat-to-beat intervals) and an
ActiGraph wGT3X-BT (wrist actigraphy, sleep scoring), plus questionnaires. Open access, ODbL v1.0.
  https://physionet.org/content/mmash/1.0.0/

The app uses these as each crew member's real PRE-FLIGHT baseline for the indicators MMASH can
measure. In-flight values stay simulated (astro/synth.py). Blood pressure, SpO2, core temperature and
glucose are not in MMASH, so they are left alone.

Usage
  # download the zip from PhysioNet (24 MB, open access) and convert it
  python tools/mmash_import.py --download

  # or point at the unzipped DataPaper/ folder you already have
  python tools/mmash_import.py --path path/to/MMASH/DataPaper

What is computed per participant (files: RR.csv, sleep.csv, Actigraph.csv, questionnaire.csv):
  rest_hr    bpm. 10th percentile of 1-minute median heart rate while in bed (sleep.csv bouts),
             from RR.csv beat-to-beat intervals after artifact removal. No sleep record: 5th
             percentile over the whole recording (marked in "methods").
  hrv        ms. RMSSD of successive beat intervals while in bed, median over 5-minute windows.
  sleep_h    h. Total sleep time summed over that night's in-bed bouts (MMASH has ONE night).
  sleep_eff  %. Total sleep time / total time in bed over those bouts.
  activity   steps per 24 h from Actigraph.csv (scaled to 24 h if the recording is shorter).
  stress     app 1-5 scale from STAI-Y1 state anxiety (20-80):  1 + 4 * (STAI1 - 20) / 60.
  mood       app 1-5 scale from PANAS, mean of the day's 5 ratings:  3 + (PA - NA) / 10, clipped.
The two questionnaire mappings are team assumptions (the app's check-in uses a 1-5 tap scale);
the raw scores are kept next to them.
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import sys
import urllib.request
import zipfile
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "real" / "mmash_baselines.json"
ZIP_URL = "https://physionet.org/files/mmash/1.0.0/MMASH.zip?download"

SOURCE = ("PhysioNet MMASH v1.0.0 (Open Data Commons ODbL v1.0). Rossi A, Da Pozzo E, Menicagli D, "
          "Tremolanti C, Priami C, Sirbu A, Clifton D, Martini C, Morelli D. Multilevel Monitoring of "
          "Activity and Sleep in Healthy People (version 1.0.0). PhysioNet (2020). "
          "https://doi.org/10.13026/cerq-fc86. Data paper: Rossi A et al. A public dataset of 24-h "
          "multi-levels psycho-physiological responses in young healthy adults. Data 2020, 5(4):91. "
          "Goldberger A et al. PhysioBank, PhysioToolkit, and PhysioNet. Circulation 2000, 101(23):e215-e220.")

MIN_IBI, MAX_IBI = 0.3, 1.5          # s between beats: 40-200 bpm
MAX_JUMP = 0.20                       # a beat may differ at most 20% from the local median
DAY = 86400


def _rows(path: Path):
    with open(path, newline="", encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


def _num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _t(day, hhmm) -> float:
    """MMASH stores a day number (1, 2) and a clock time; turn that into seconds since day 1 00:00."""
    parts = [int(x) for x in str(hhmm).split(":")]
    h, m, s = (parts + [0, 0])[:3]
    return (int(float(day)) - 1) * DAY + h * 3600 + m * 60 + s


# ---------------------------------------------------------------- heart

def load_beats(path: Path):
    """(times, ibi) of beats that pass artifact checks, plus a mask of which raw beats were kept."""
    rows = _rows(path)
    t = np.array([_t(r["day"], r["time"]) for r in rows], dtype=float)
    ibi = np.array([_num(r["ibi_s"]) or 0.0 for r in rows], dtype=float)
    ok = (ibi >= MIN_IBI) & (ibi <= MAX_IBI)
    if ok.sum() > 10:
        # compare each beat with the median of its 11 neighbours (ectopic beats, missed detections)
        med = np.copy(ibi)
        good = np.where(ok)[0]
        vals = ibi[good]
        for j, i in enumerate(good):
            lo, hi = max(0, j - 5), min(len(vals), j + 6)
            med[i] = np.median(vals[lo:hi])
        ok &= np.abs(ibi - med) <= MAX_JUMP * med
    return t, ibi, ok


def minute_hr(t, ibi, ok, windows=None):
    """Median heart rate for each minute that has at least 20 clean beats."""
    sel = ok.copy()
    if windows is not None:
        inside = np.zeros_like(sel)
        for a, b in windows:
            inside |= (t >= a) & (t < b)
        sel &= inside
    if not sel.any():
        return np.array([])
    mins = np.floor(t[sel] / 60).astype(int)
    hr = 60.0 / ibi[sel]
    out = []
    for m in np.unique(mins):
        v = hr[mins == m]
        if len(v) >= 20:
            out.append(np.median(v))
    return np.array(out)


def rmssd(t, ibi, ok, windows):
    """Median RMSSD (ms) over 5-minute windows inside `windows`, using only pairs of clean beats."""
    pair = ok[1:] & ok[:-1]
    d = np.diff(ibi)[pair] * 1000.0
    tp = t[1:][pair]
    vals = []
    for a, b in windows:
        for w0 in np.arange(a, b, 300):
            sel = (tp >= w0) & (tp < w0 + 300)
            if sel.sum() >= 100:
                vals.append(float(np.sqrt(np.mean(d[sel] ** 2))))
    return float(np.median(vals)) if vals else None


# ---------------------------------------------------------------- sleep, activity, questionnaires

def sleep_bouts(path: Path):
    """[(start_s, end_s, minutes_in_bed, minutes_asleep)] for each in-bed bout of the night."""
    out = []
    for r in _rows(path):
        try:
            a = _t(r["In Bed Date"], r["In Bed Time"])
            b = _t(r["Out Bed Date"], r["Out Bed Time"])
        except (KeyError, ValueError):
            continue
        if b <= a:
            b += DAY
        bed, tst = _num(r.get("Total Minutes in Bed")), _num(r.get("Total Sleep Time (TST)"))
        if bed and tst is not None:
            out.append((a, b, bed, tst))
    return out


def steps_per_day(path: Path):
    rows = _rows(path)
    if not rows:
        return None, None
    t = np.array([_t(r["day"], r["time"]) for r in rows], dtype=float)
    steps = float(sum(_num(r.get("Steps")) or 0.0 for r in rows))
    hours = (t.max() - t.min()) / 3600.0
    if hours < 12 or hours > 30:      # too short, or broken day numbers (User_8 and User_9 span ~31 days)
        return None, round(hours, 1)
    return steps * 24.0 / hours, round(hours, 1)


def questionnaire(path: Path):
    rows = _rows(path)
    if not rows:
        return {}
    r = rows[0]
    stai1 = _num(r.get("STAI1"))
    pa = [x for k, v in r.items() if k.startswith("panas_pos") and (x := _num(v)) is not None]
    na = [x for k, v in r.items() if k.startswith("panas_neg") and (x := _num(v)) is not None]
    out = {"stai1": stai1, "stai2": _num(r.get("STAI2")), "daily_stress_dsi": _num(r.get("Daily_stress")),
           "panas_pos_mean": round(float(np.mean(pa)), 1) if pa else None,
           "panas_neg_mean": round(float(np.mean(na)), 1) if na else None,
           "psqi": _num(r.get("Pittsburgh"))}
    out["stress"] = round(float(np.clip(1 + 4 * (stai1 - 20) / 60, 1, 5)), 2) if stai1 is not None else None
    out["mood"] = (round(float(np.clip(3 + (np.mean(pa) - np.mean(na)) / 10, 1, 5)), 2)
                   if pa and na else None)
    return out


# ---------------------------------------------------------------- per participant

def participant(folder: Path) -> dict:
    res = {k: None for k in ("rest_hr", "hrv", "sleep_h", "sleep_eff", "activity", "stress", "mood")}
    methods, raw = {}, {}
    bouts = sleep_bouts(folder / "sleep.csv") if (folder / "sleep.csv").exists() else []
    windows = [(a, b) for a, b, _, _ in bouts]
    if bouts:
        bed = sum(x[2] for x in bouts)
        tst = sum(x[3] for x in bouts)
        res["sleep_h"] = round(tst / 60.0, 2)
        res["sleep_eff"] = round(100.0 * tst / bed, 1) if bed else None
        raw["sleep_bouts"] = len(bouts)
    if (folder / "RR.csv").exists():
        t, ibi, ok = load_beats(folder / "RR.csv")
        raw["beats_kept_pct"] = round(100.0 * ok.mean(), 1) if len(ok) else None
        hr_bed = minute_hr(t, ibi, ok, windows) if windows else np.array([])
        if len(hr_bed) >= 30:
            res["rest_hr"] = round(float(np.percentile(hr_bed, 10)), 1)
            methods["rest_hr"] = "p10 of 1-min median HR while in bed"
        else:
            hr_all = minute_hr(t, ibi, ok)
            if len(hr_all) >= 60:
                res["rest_hr"] = round(float(np.percentile(hr_all, 5)), 1)
                methods["rest_hr"] = "p5 of 1-min median HR over the whole recording (no usable sleep record)"
        if windows:
            v = rmssd(t, ibi, ok, windows)
            res["hrv"] = round(v, 1) if v is not None else None
            if v is not None:
                methods["hrv"] = "median 5-min RMSSD while in bed"
    if (folder / "Actigraph.csv").exists():
        spd, hours = steps_per_day(folder / "Actigraph.csv")
        res["activity"] = round(spd) if spd is not None else None
        raw["actigraph_hours"] = hours
        if spd is None:
            methods["activity"] = f"not used: actigraph spans {hours} h, expected ~24 h"
    if (folder / "questionnaire.csv").exists():
        q = questionnaire(folder / "questionnaire.csv")
        res["stress"], res["mood"] = q.pop("stress", None), q.pop("mood", None)
        raw.update(q)
    if (folder / "user_info.csv").exists():
        info = _rows(folder / "user_info.csv")
        if info:
            raw["age"] = _num(info[0].get("Age"))
    return {**res, "methods": methods, "raw": raw}


def _sort_key(name):
    tail = name.rsplit("_", 1)[-1]
    return int(tail) if tail.isdigit() else 10**6


def convert(datapaper: Path) -> dict:
    folders = sorted([p for p in datapaper.iterdir() if p.is_dir() and p.name.lower().startswith("user_")],
                     key=lambda p: _sort_key(p.name))
    if not folders:
        sys.exit(f"No user_N folders under {datapaper}. Point --path at the unzipped DataPaper/ folder.")
    parts = {}
    for f in folders:
        name = "User_" + f.name.rsplit("_", 1)[-1]
        parts[name] = participant(f)
        p = parts[name]
        print(f"{name:8s} rest_hr={p['rest_hr']} hrv={p['hrv']} sleep_h={p['sleep_h']} "
              f"sleep_eff={p['sleep_eff']} steps={p['activity']} stress={p['stress']} mood={p['mood']}")
    return {
        "source": SOURCE,
        "units": {"rest_hr": "bpm", "hrv": "ms (RMSSD)", "sleep_h": "h", "sleep_eff": "%",
                  "activity": "steps per 24 h", "stress": "app scale 1-5 (from STAI-Y1)",
                  "mood": "app scale 1-5 (from PANAS)"},
        "notes": "One ~24 h recording per participant, so sleep values are from a single night. "
                 "stress and mood are mapped to the app's 1-5 check-in scale (team assumption); raw "
                 "questionnaire scores are under each participant's 'raw'. null = not available.",
        "participants": parts,
    }


def download(dest: Path) -> Path:
    print("Downloading MMASH from PhysioNet (24 MB)…")
    with urllib.request.urlopen(ZIP_URL, timeout=120) as r:
        data = r.read()
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        z.extractall(dest)
    return dest / "DataPaper"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--path", type=Path, help="unzipped MMASH DataPaper/ folder")
    ap.add_argument("--download", action="store_true", help="download MMASH.zip from PhysioNet first")
    ap.add_argument("--out", type=Path, default=OUT)
    a = ap.parse_args()
    if a.download:
        datapaper = download(ROOT / "data" / "raw" / "mmash")
    elif a.path:
        datapaper = a.path
    else:
        ap.error("give --path to the DataPaper/ folder, or --download")
    if not datapaper.is_dir():
        sys.exit(f"Not a folder: {datapaper}")
    out = convert(datapaper)
    a.out.parent.mkdir(parents=True, exist_ok=True)
    a.out.write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {a.out} ({len(out['participants'])} participants)")


if __name__ == "__main__":
    main()
