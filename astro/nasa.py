"""Real NASA data, replayed on the mission clock.

data/real/ holds CSVs downloaded by tools/fetch_nasa_data.py:
  iss_dostel_radiation_daily.csv   ISS DOSTEL dose rates (NASA OSDR RadLab), 2024-02-01 .. 2024-11-04
  iss_cabin_environment_daily.csv  ISS cabin CO2 / temperature / humidity (NASA OSDR EDA), 340 days
                                   from 7 Rodent Research missions, 2014-2020

How they map onto the mission (MET 0 = launch, mission day d = MET // DAY):
  * Radiation: mission day d uses the real calendar day RADIATION_LAUNCH + d. RadLab coverage starts
    on 2024-02-01, so that is launch. The real 2024-05-11 solar particle event lands on mission day 100.
  * Cabin air: the 7 missions are joined in ENV_ORDER into one 340-day series; mission day d uses row d.
    The order puts the real May-2016 CO2 rise (RR-3, up to 6,206 ppm daily mean) on mission days
    140-155 (above 5,260 ppm on days ~146-153), so on the demo day (141) cabin CO2 is elevated
    (4,233 ppm) but still below the 4 mmHg flight rule.
Both are cabin/environment data, so every crew member sees the same values. Pre-flight (d < 0) the
crew is on the ground, so these devices produce nothing.

data/reference/expected_trajectory.csv holds published spaceflight adaptation values (with citations).
expected() turns them into "what is normal for this person on mission day d", used by astro/health.py
for comparisons and by astro/synth.py so the simulated crew adapt the way real crews do.
"""
from __future__ import annotations

import csv
import math
import statistics
from datetime import date, timedelta
from functools import lru_cache
from pathlib import Path

DATA = Path(__file__).resolve().parents[1] / "data" / "real"
REFERENCE = Path(__file__).resolve().parents[1] / "data" / "reference"
DAY = 86400.0

RADIATION_LAUNCH = date(2024, 2, 1)
ENV_ORDER = ["RR-5", "RR-12", "RR-3", "RR-6", "RR-1", "RR-9", "RR-19"]

# DOSTEL measures absorbed dose in silicon. 2.5 converts it to an approximate effective dose
# (team assumption, chosen to match NASA's published 80-160 mSv per 6-month ISS increment).
SI_TO_EFFECTIVE = 2.5
SPE_WINDOW_DAYS = 27          # quiet reference = median of the previous solar rotation


def _read(name):
    with open(DATA / name, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


@lru_cache(maxsize=1)
def radiation_days() -> dict[int, dict]:
    """mission day -> real radiation summary for that day."""
    rows = {r["date_utc"]: r for r in _read("iss_dostel_radiation_daily.csv")}
    out, hist, cum = {}, [], 0.0
    d = 0
    while True:
        day = (RADIATION_LAUNCH + timedelta(days=d)).isoformat()
        r = rows.get(day)
        if r is None:
            break
        hl = float(r["high_lat_mean_uGy_per_h"])
        quiet = statistics.median(hist[-SPE_WINDOW_DAYS:]) if hist else hl
        hist.append(hl)
        dose_msv = float(r["daily_absorbed_dose_uGy"]) / 1000 * SI_TO_EFFECTIVE
        cum += dose_msv
        out[d] = {
            "date": day,
            "dose_rate": float(r["mean_uGy_per_h"]),
            "high_lat": hl,
            "high_lat_max": float(r["high_lat_max_uGy_per_h"] or 0),
            "spe_index": hl / quiet,
            "dose_msv": dose_msv,
            "cumulative_msv": cum,
        }
        d += 1
    return out


@lru_cache(maxsize=1)
def environment_days() -> dict[int, dict]:
    """mission day -> real ISS cabin summary (from the stitched mission series)."""
    rows = _read("iss_cabin_environment_daily.csv")
    series = []
    for mission in ENV_ORDER:
        series += sorted((r for r in rows if r["source_mission"] == mission), key=lambda r: r["date_utc"])
    out = {}
    for d, r in enumerate(series):
        out[d] = {
            "date": r["date_utc"], "mission": r["source_mission"],
            "co2": float(r["co2_ppm_mean"]), "co2_max": float(r["co2_ppm_max"]),
            "temp": float(r["cabin_temp_c_mean"]),
            "humidity": float(r["humidity_pct_mean"]) if r["humidity_pct_mean"] else None,
        }
    return out


# ---------------------------------------------------------------- expected in-flight trajectory

# Indicators whose onset timing is given only on a sibling row ("bp_dia ... see bp_sys").
_ONSET_FROM = {"bp_dia": "bp_sys"}


@lru_cache(maxsize=1)
def trajectory() -> dict[str, dict[str, float]]:
    """indicator -> {parameter: value} from expected_trajectory.csv. Empty if the file is missing."""
    path = REFERENCE / "expected_trajectory.csv"
    out: dict[str, dict[str, float]] = {}
    try:
        with open(path, newline="", encoding="utf-8") as f:
            for r in csv.DictReader(f):
                try:
                    out.setdefault(r["indicator"].strip(), {})[r["parameter"].strip()] = float(r["value"])
                except (KeyError, TypeError, ValueError):
                    continue
    except OSError:
        return {}
    return out


def has_trajectory(indicator: str | None) -> bool:
    t = trajectory().get(indicator or "", {})
    return "inflight_change" in t or "inflight_mean" in t


def sd_floor(indicator: str | None, default: float) -> float:
    return trajectory().get(indicator or "", {}).get("personal_sd_floor", default)


def expected(indicator: str, day: float, preflight: float) -> float:
    """Expected value on mission day `day` for someone whose pre-flight mean is `preflight`.

    * inflight_change + onset_tau_days: exponential approach to preflight + change
    * inflight_change + onset_days:     linear ramp, then plateau
    * inflight_change alone:            step change at launch
    * inflight_mean (sleep):            population in-flight mean plus a share of the person's
                                        pre-flight offset from reference_preflight
    Before launch, or for an indicator with no trajectory, the pre-flight mean is returned.
    """
    t = trajectory().get(indicator)
    if not t or day <= 0:
        return preflight
    if "inflight_mean" in t:
        ref = t.get("reference_preflight", preflight)
        return t["inflight_mean"] + t.get("personal_offset_weight", 1.0) * (preflight - ref)
    change = t.get("inflight_change")
    if change is None:
        return preflight
    onset = t if ("onset_tau_days" in t or "onset_days" in t) else trajectory().get(_ONSET_FROM.get(indicator), {})
    if "onset_tau_days" in onset:
        frac = 1 - math.exp(-day / max(onset["onset_tau_days"], 1e-6))
    elif "onset_days" in onset:
        frac = min(1.0, day / max(onset["onset_days"], 1e-6))
    else:
        frac = 1.0
    return preflight + change * frac


def param(indicator: str, name: str, default: float) -> float:
    return trajectory().get(indicator, {}).get(name, default)


def _report_times(t0, t1):
    """Daily summaries are reported at the end of each mission day (23:59)."""
    first = max(0, int(t0 // DAY) - 1)
    for d in range(first, int(t1 // DAY) + 1):
        t = d * DAY + DAY - 60
        if t0 < t <= t1:
            yield d, t


def gen_dosimeter(p, t0, t1):
    days = radiation_days()
    readings = []
    for d, t in _report_times(t0, t1):
        r = days.get(d)
        if not r:
            continue
        readings += [
            ("dosimeter", "rad_dose_rate", round(r["dose_rate"], 2), "µGy/h", t),
            ("dosimeter", "rad_high_lat", round(r["high_lat"], 2), "µGy/h", t),
            ("dosimeter", "rad_spe_index", round(r["spe_index"], 2), "× quiet", t),
            ("dosimeter", "rad_dose_msv", round(r["dose_msv"], 3), "mSv", t),
            ("dosimeter", "rad_cumulative_msv", round(r["cumulative_msv"], 1), "mSv", t),
        ]
    return readings, []


def gen_cabin(p, t0, t1):
    days = environment_days()
    readings = []
    for d, t in _report_times(t0, t1):
        r = days.get(d)
        if not r:
            continue
        readings += [
            ("cabin_env", "cabin_co2_ppm", round(r["co2"]), "ppm", t),
            ("cabin_env", "cabin_co2_max_ppm", round(r["co2_max"]), "ppm", t),
            ("cabin_env", "cabin_temp_c", round(r["temp"], 1), "°C", t),
        ]
        if r["humidity"] is not None:
            readings.append(("cabin_env", "cabin_humidity_pct", round(r["humidity"], 1), "%", t))
    return readings, []


def source_note(device: str, met: float | None) -> str | None:
    """Where a reading really came from, e.g. for the region panel."""
    if met is None or met < 0:
        return None
    d = int(met // DAY)
    if device == "dosimeter":
        r = radiation_days().get(d)
        return r and f"real ISS DOSTEL data, NASA OSDR RadLab, recorded {r['date']}"
    if device == "cabin_env":
        r = environment_days().get(d)
        return r and f"real ISS cabin telemetry, NASA OSDR Environmental Data App ({r['mission']}, {r['date']})"
    return None
