"""Download real NASA open data into data/real/ as CSV.

Sources (both public, no API key):
  1. RadLab API (NASA OSDR) - ISS DOSTEL1/DOSTEL2 absorbed dose rate, Feb-Nov 2024
     https://visualization.osdr.nasa.gov/radlab/api/
  2. Environmental Data App API (NASA OSDR) - ISS cabin CO2, temperature, humidity
     https://visualization.osdr.nasa.gov/eda/api/

Run:  python tools/fetch_nasa_data.py
Only needs the standard library. Takes ~2-4 minutes. Re-running overwrites the CSVs.
"""
import csv
import io
import json
import os
import ssl
import statistics
import sys
import time
import urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]   # astro-health-demo/
OUT = ROOT / "data" / "real"
OUT.mkdir(parents=True, exist_ok=True)

RADLAB = "https://visualization.osdr.nasa.gov/radlab/api/"
EDA = "https://visualization.osdr.nasa.gov/eda/api/missions"
UA = {"User-Agent": "baseline-hackathon-data-fetch/1.0"}


def _ssl_context():
    """python.org builds on macOS ship without root certs; fall back to certifi or the system bundle."""
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        pass
    for path in ("/etc/ssl/cert.pem", "/etc/ssl/certs/ca-certificates.crt"):
        if os.path.exists(path):
            return ssl.create_default_context(cafile=path)
    return ssl.create_default_context()


SSL_CTX = _ssl_context()

# DOSTEL data on RadLab covers roughly Feb-Nov 2024 (includes the May 2024 solar storm).
DOSTEL_START = date(2024, 2, 1)
DOSTEL_END = date(2024, 11, 30)
DOSTEL_IDS = ["DosTel1", "DosTel2"]

# Rodent Research missions whose ISS cabin telemetry has CO2 + temperature + humidity complete.
EDA_MISSIONS = ["RR-1", "RR-3", "RR-5", "RR-6", "RR-9", "RR-12", "RR-19"]


def get(url, timeout=300, tries=4):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=timeout, context=SSL_CTX) as r:
                return r.read().decode("utf-8")
        except Exception as exc:  # noqa: BLE001 - network flakiness, retry
            if i == tries - 1:
                raise
            print(f"  retry {i + 1} ({exc})", file=sys.stderr)
            time.sleep(2 * (i + 1))


# ── 1. Radiation (RadLab DOSTEL) ──

def fetch_dostel_week(instrument, start):
    end = min(start + timedelta(days=7), DOSTEL_END + timedelta(days=1))
    url = (f"{RADLAB}?instrument_id={instrument}"
           f"&timestamp>{start.isoformat()}T00:00:00&timestamp<{end.isoformat()}T00:00:00"
           f"&absorbed_dose_rate&latitude&longitude")
    rows = list(csv.DictReader(io.StringIO(get(url))))
    print(f"  {instrument} {start} → {end}: {len(rows)} samples")
    return rows


def orbit_zone(lat, lon):
    """Classify an ISS position.

    saa      South Atlantic Anomaly - trapped protons, dominates the daily dose on the ISS.
    high_lat |latitude| > 45 deg - weakest magnetic shielding, where galactic cosmic rays and
             solar particle events show up. Our proxy for 'unshielded' deep-space exposure.
    low_lat  everything else - best shielded by Earth's magnetic field.
    """
    if -50 < lat < 0 and -90 < lon < 40:
        return "saa"
    if abs(lat) > 45:
        return "high_lat"
    return "low_lat"


def fetch_radiation():
    print("Fetching ISS DOSTEL radiation from RadLab ...")
    jobs = []
    d = DOSTEL_START
    while d <= DOSTEL_END:
        for inst in DOSTEL_IDS:
            jobs.append((inst, d))
        d += timedelta(days=7)
    with ThreadPoolExecutor(max_workers=3) as pool:
        results = list(pool.map(lambda j: fetch_dostel_week(*j), jobs))

    samples = []
    for rows in results:
        for r in rows:
            if not (r.get("absorbed_dose_rate") and r.get("latitude") and r.get("longitude")):
                continue
            lat, lon = float(r["latitude"]), float(r["longitude"])
            samples.append((r["timestamp"], r["instrument_id"], float(r["absorbed_dose_rate"]),
                            lat, lon, orbit_zone(lat, lon)))
    samples.sort()

    # Daily summary. DOSTEL samples ~every 68 s inside the SAA but ~every 100 s elsewhere, so a
    # plain mean over-weights the SAA by ~2.5x. Every average below is time-weighted: each sample
    # counts for the seconds until that detector's next sample (capped at 200 s to skip data gaps).
    MAX_DT = 200.0
    by_inst = defaultdict(list)
    for smp in samples:
        by_inst[smp[1]].append(smp)
    daily = defaultdict(lambda: defaultdict(lambda: [0.0, 0.0]))  # day -> key -> [sum(v*dt), sum(dt)]
    hl_max = defaultdict(float)
    for inst, rows in by_inst.items():
        for i, (t, _, v, lat, lon, zone) in enumerate(rows):
            if i + 1 < len(rows):
                dt = (datetime.fromisoformat(rows[i + 1][0]) - datetime.fromisoformat(t)).total_seconds()
                dt = min(max(dt, 0.0), MAX_DT)
            else:
                dt = 100.0
            day = daily[t[:10]]
            for key in ("all", zone, inst):
                day[key][0] += v * dt
                day[key][1] += dt
            if zone == "high_lat":
                hl_max[t[:10]] = max(hl_max[t[:10]], v)

    def twm(acc):
        return round(acc[0] / acc[1], 3) if acc[1] else ""

    with open(OUT / "iss_dostel_radiation_daily.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["date_utc", "mean_uGy_per_h", "high_lat_mean_uGy_per_h", "high_lat_max_uGy_per_h",
                    "saa_mean_uGy_per_h", "low_lat_mean_uGy_per_h",
                    "dostel1_mean_uGy_per_h", "dostel2_mean_uGy_per_h",
                    "daily_absorbed_dose_uGy", "coverage_hours"])
        for day in sorted(daily):
            p = daily[day]
            # coverage = seconds observed per detector, averaged over the two detectors
            cov = (p["DosTel1"][1] + p["DosTel2"][1]) / max(1, sum(1 for k in ("DosTel1", "DosTel2") if p[k][1])) / 3600
            m = p["all"][0] / p["all"][1]
            w.writerow([day, round(m, 3), twm(p["high_lat"]),
                        round(hl_max[day], 2) if day in hl_max else "",
                        twm(p["saa"]), twm(p["low_lat"]), twm(p["DosTel1"]), twm(p["DosTel2"]),
                        round(m * 24, 1), round(cov, 1)])
    print(f"  wrote {len(daily)} days of radiation data")


# ── 2. ISS cabin environment (EDA telemetry) ──

def fetch_environment():
    print("Fetching ISS cabin telemetry from the Environmental Data App ...")
    daily = []
    for mission in EDA_MISSIONS:
        payload = json.loads(get(f"{EDA}/{mission}/telemetry_data/"))
        rows = payload["data"] if isinstance(payload, dict) else payload
        per_day = defaultdict(lambda: defaultdict(list))
        for r in rows:
            for key in ("co2_iss", "temperature_iss", "humidity_iss"):
                if r.get(key) is not None:
                    per_day[r["time"][:10]][key].append(float(r[key]))
        n = 0
        for day in sorted(per_day):
            p = per_day[day]
            if not all(p[k] for k in ("co2_iss", "temperature_iss", "humidity_iss")):
                continue
            # The ISS humidity sensor occasionally reports >100 % (sensor glitch); drop those.
            rh = [v for v in p["humidity_iss"] if 0 < v <= 100]
            daily.append([day, mission,
                          round(statistics.fmean(p["co2_iss"])), round(max(p["co2_iss"])),
                          round(statistics.fmean(p["temperature_iss"]), 2),
                          round(statistics.fmean(rh), 1) if rh else "",
                          len(p["co2_iss"])])
            n += 1
        print(f"  {mission}: {n} days")
    daily.sort(key=lambda r: r[0])
    with open(OUT / "iss_cabin_environment_daily.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["date_utc", "source_mission", "co2_ppm_mean", "co2_ppm_max",
                    "cabin_temp_c_mean", "humidity_pct_mean", "n_samples"])
        w.writerows(daily)
    print(f"  wrote {len(daily)} days of cabin data")


if __name__ == "__main__":
    fetch_radiation()
    fetch_environment()
    print(f"Done. Files in {OUT}")
