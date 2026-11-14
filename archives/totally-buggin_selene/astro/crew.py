"""Demo crew. Names are fictional. Each person is linked to:

  * one de-identified Inspiration4 subject (C001-C004): real blood panels for rHEALTH One readings;
  * one PhysioNet MMASH participant: real healthy-volunteer recordings that set the PRE-FLIGHT
    baseline for resting heart rate, stress and mood
    (data/real/mmash_baselines.json, made by tools/mmash_import.py).

Sleep baselines are team estimates on purpose: MMASH has one study night per person (median ~5.6 h),
too short to stand for habitual sleep. Through the expected in-flight drop it pushed healthy crew
under the 5 h "Act now" limit on 6-14% of nights. The MMASH night is kept for reference only.
Baselines MMASH can't provide (blood pressure, SpO2, core temperature, fitness and ultrasound values)
are team estimates too and stay as written below. The numbers written below for the MMASH-covered keys
are only a fallback, used when the JSON is missing or a value is null.

A drift ramps a baseline value linearly between two mission days and then holds. Drifts are the
simulated in-flight medical story; they are synthetic and unchanged by the MMASH baselines.
"""

import json
from pathlib import Path

DAY = 86400.0
MMASH_PATH = Path(__file__).resolve().parents[1] / "data" / "real" / "mmash_baselines.json"
# MMASH field -> crew baseline key read by astro/synth.py
MMASH_KEYS = {"rest_hr": "rest_hr", "stress": "stress", "mood": "mood"}
# Also from MMASH but not used by the simulator; kept so they are visible in the profile.
MMASH_EXTRA = {"hrv": "hrv_rmssd_ms", "activity": "steps_per_day",
               "sleep_h": "mmash_night_sleep_h", "sleep_eff": "mmash_night_sleep_eff"}

CREW = [
    {
        "id": "okafor",
        "mmash_participant": "User_20",
        "name": "Daniel Okafor",
        "role": "Commander",
        "osdr_subject": "C001",
        "story": "Sleep, resting heart rate and mood have drifted over the last week.",
        "baseline": {
            "rest_hr": 58, "sys_bp": 114, "dia_bp": 72, "br": 13.0, "spo2": 98.0,
            "skin_temp": 33.9, "core_temp": 36.95, "sleep_h": 7.1, "sleep_eff": 89,
            "mood": 4.2, "stress": 2.0, "squat_kg": 105, "bench_kg": 62,
            "cevis_hr": 128, "t2_speed": 9.5, "onsd_mm": 5.1, "ijv_area": 75,
        },
        "drifts": [
            {"key": "sleep_h", "from_day": 134, "to_day": 141, "delta": -1.8},
            {"key": "sleep_eff", "from_day": 134, "to_day": 141, "delta": -9},
            {"key": "rest_hr", "from_day": 134, "to_day": 141, "delta": 11},
            {"key": "sys_bp", "from_day": 135, "to_day": 141, "delta": 12},
            {"key": "dia_bp", "from_day": 135, "to_day": 141, "delta": 6},
            {"key": "mood", "from_day": 134, "to_day": 141, "delta": -2.0},
            {"key": "stress", "from_day": 134, "to_day": 141, "delta": 2.0},
            {"key": "core_temp", "from_day": 133, "to_day": 141, "delta": 0.2},
            {"key": "circ_shift", "from_day": 133, "to_day": 141, "delta": 2.2},
        ],
    },
    {
        "id": "brandt",
        "mmash_participant": "User_14",
        "name": "Lena Brandt",
        "role": "Flight engineer",
        "osdr_subject": "C002",
        "story": "Leg strength on ARED has been falling for a month; bone loss estimate rising.",
        "baseline": {
            "rest_hr": 62, "sys_bp": 108, "dia_bp": 68, "br": 14.0, "spo2": 98.2,
            "skin_temp": 34.1, "core_temp": 36.9, "sleep_h": 7.3, "sleep_eff": 91,
            "mood": 4.0, "stress": 2.2, "squat_kg": 78, "bench_kg": 40,
            "cevis_hr": 136, "t2_speed": 8.8, "onsd_mm": 4.9, "ijv_area": 68,
        },
        "drifts": [
            {"key": "squat_kg", "from_day": 110, "to_day": 141, "delta": -11},
            {"key": "cevis_hr", "from_day": 115, "to_day": 141, "delta": 11},
            {"key": "t2_speed", "from_day": 115, "to_day": 141, "delta": -0.9},
        ],
    },
    {
        "id": "menon",
        "mmash_participant": "User_3",
        "name": "Priya Menon",
        "role": "Mission specialist",
        "osdr_subject": "C003",
        "story": "Optic nerve sheath on ultrasound has widened; this needs a flight surgeon.",
        "baseline": {
            "rest_hr": 60, "sys_bp": 110, "dia_bp": 70, "br": 13.5, "spo2": 98.1,
            "skin_temp": 34.0, "core_temp": 36.9, "sleep_h": 7.0, "sleep_eff": 90,
            "mood": 4.1, "stress": 2.1, "squat_kg": 74, "bench_kg": 38,
            "cevis_hr": 132, "t2_speed": 9.0, "onsd_mm": 5.0, "ijv_area": 70,
        },
        "drifts": [
            {"key": "onsd_mm", "from_day": 60, "to_day": 140, "delta": 1.05},
            {"key": "ijv_area", "from_day": 60, "to_day": 140, "delta": 38},
        ],
    },
    {
        "id": "ruiz",
        "mmash_participant": "User_5",
        "name": "Tomás Ruiz",
        "role": "Flight engineer",
        "osdr_subject": "C004",
        "story": "Mostly on track; upper-body strength has dipped slightly.",
        "baseline": {
            "rest_hr": 55, "sys_bp": 118, "dia_bp": 74, "br": 12.5, "spo2": 97.9,
            "skin_temp": 33.8, "core_temp": 36.85, "sleep_h": 7.4, "sleep_eff": 92,
            "mood": 4.4, "stress": 1.8, "squat_kg": 120, "bench_kg": 75,
            "cevis_hr": 122, "t2_speed": 10.4, "onsd_mm": 5.2, "ijv_area": 80,
        },
        "drifts": [
            {"key": "bench_kg", "from_day": 118, "to_day": 141, "delta": -7},
        ],
    },
]



def _apply_mmash(crew, path=MMASH_PATH):
    """Replace the MMASH-covered baselines with each person's real pre-flight values.

    Records where every baseline value came from in crew["baseline_source"]. Missing file, missing
    participant or null value: that baseline keeps its written fallback and is labelled as such."""
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        parts = data.get("participants", {})
    except (OSError, ValueError):
        parts = {}
    for c in crew:
        src = {k: "team estimate" for k in c["baseline"]}
        rec = parts.get(c.get("mmash_participant") or "", {})
        for field, key in MMASH_KEYS.items():
            v = rec.get(field)
            if isinstance(v, (int, float)):
                c["baseline"][key] = float(v)
                src[key] = f"MMASH {c['mmash_participant']}"
            else:
                src[key] = "team estimate (MMASH value unavailable)"
        for field, key in MMASH_EXTRA.items():
            v = rec.get(field)
            if isinstance(v, (int, float)):
                c["baseline"][key] = float(v)
                src[key] = f"MMASH {c['mmash_participant']}"
        c["baseline_source"] = src
    return crew


_apply_mmash(CREW)
CREW_BY_ID = {c["id"]: c for c in CREW}
