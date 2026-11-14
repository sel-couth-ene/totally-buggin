"""Plain words for the crew. The health rules live in health.py; this file only says things.

Every indicator gets:
  name     short, plain, no device names or jargon ("Eye scan", "Leg strength")
  explain  one plain line: what is going on, with a simple comparison ("70 bpm, usually 55"),
           then what to do ("Try slow breathing.")
  detail   small print for the medical officer: technical name and exact numbers

Keep lines to about 12 words or fewer.
"""
from __future__ import annotations

# id -> (plain name, said when it is too high, said when it is too low)
PLAIN = {
    "sleep_hours": ("Sleep", "Sleep is longer than usual", "Sleep is short for you"),
    "sleep_efficiency": ("Sleep quality", "Sleep is deeper than usual", "Sleep is restless"),
    "mood": ("Mood", "Mood is higher than usual", "Mood is low for you"),
    "stress": ("Stress", "Stress is high for you", "Stress is lower than usual"),
    "core_temp": ("Body temperature", "Temperature is high for you", "Temperature is low"),
    "light": ("Daylight", "More daylight than usual", "Too little daylight"),
    "onsd": ("Eye scan", "Eye scan has changed", "Eye scan has changed"),
    "co2": ("Cabin air", "Cabin air is stuffy", "Cabin air is stuffy"),
    "ijv_area": ("Neck vein scan", "Neck vein is swollen", "Neck vein is smaller"),
    "ijv_flow": ("Neck vein blood flow", "Neck vein blood is slow", "Neck vein blood is slow"),
    "resting_hr": ("Heart rate", "Heart rate is high for you", "Heart rate is low for you"),
    "sys_bp_est": ("Blood pressure, all day", "Blood pressure is high for you", "Blood pressure is low"),
    "sys_bp": ("Blood pressure", "Blood pressure is high for you", "Blood pressure is low"),
    "dia_bp": ("Blood pressure, lower number", "Blood pressure is high for you", "Blood pressure is low"),
    "spo2": ("Oxygen level", "Oxygen is higher than usual", "Oxygen is low"),
    "breathing_rate": ("Breathing", "Breathing is fast for you", "Breathing is slow for you"),
    "cevis_hr": ("Bike fitness", "Bike workouts are harder for you", "Bike workouts are easier"),
    "spe": ("Solar storm", "Solar storm is on", "Solar storm is on"),
    "rad_dose": ("Radiation today", "Radiation is high today", "Radiation is low today"),
    "rad_total": ("Radiation so far", "Radiation total is high", "Radiation total is low"),
    "bench": ("Arm strength", "Arms are stronger", "Arms are getting weaker"),
    "activity": ("Daily movement", "You are moving more", "You are moving less"),
    "squat": ("Leg strength", "Legs are stronger", "Legs are getting weaker"),
    "t2_speed": ("Running speed", "Running is faster", "Running is slower"),
    "bone_est": ("Hip bone (estimate)", "Hip bone is thinning faster", "Hip bone is fine"),
    # blood (rHEALTH One, real Inspiration4 values)
    "bl_hemoglobin": ("Blood strength", "Blood strength is high", "Blood strength is low"),
    "bl_hematocrit": ("Red cell share", "Red cell share is high", "Red cell share is low"),
    "bl_rbc": ("Red blood cells", "Red blood cells are high", "Red blood cells are low"),
    "bl_platelets": ("Clotting cells", "Clotting cells are high", "Clotting cells are low"),
    "bl_wbc": ("Infection-fighting cells", "Infection-fighting cells are high", "Infection-fighting cells are low"),
    "bl_lymphocytes": ("Virus-fighting cells", "Virus-fighting cells are high", "Virus-fighting cells are low"),
    "bl_neutrophils": ("Germ-fighting cells", "Germ-fighting cells are high", "Germ-fighting cells are low"),
    "bl_glucose": ("Blood sugar", "Blood sugar is high", "Blood sugar is low"),
    "bl_calcium": ("Blood calcium", "Blood calcium is high", "Blood calcium is low"),
    "bl_creatinine": ("Kidney test", "Kidney test is high", "Kidney test is low"),
    "bl_bun": ("Second kidney test", "Second kidney test is high", "Second kidney test is low"),
    "bl_sodium": ("Salt level", "Salt level is high", "Salt level is low"),
    "bl_potassium": ("Potassium", "Potassium is high", "Potassium is low"),
    "bl_albumin": ("Blood protein", "Blood protein is high", "Blood protein is low"),
    "bl_alt": ("Liver test", "Liver test is high", "Liver test is low"),
    "bl_ast": ("Second liver test", "Second liver test is high", "Second liver test is low"),
    "bl_alk_phos": ("Bone and liver test", "Bone and liver test is high", "Bone and liver test is low"),
}

# what to do, as a short sentence (also used as the title of a suggestion card)
DO = {
    "box_breathing": "Try slow breathing",
    "wind_down": "Do a wind-down stretch tonight",
    "pet_time": "Spend a few minutes with your companion",
    "squats": "Do 12 squats today",
    "arm_raises": "Do 12 arm raises today",
    "march": "Do 20 knee lifts today",
    "consult": "Tell your medical officer today",
}
CONSULT_NOTE = "No heavy lifting until then."

# numbers in the main line only where people know the unit; everything else goes to the small print
SHOW_UNIT = {"h", "kg", "km/h", "°C", "%", "/5"}       # "4.1 h, usually 6.1"
BARE_NUMBER = {"bpm", "mmHg"}                           # "70, usually 55", as people say it

# environment readings: plain line per status ({v} is the value with its unit)
ENV_TEXTS = {
    "co2": {"good": "Cabin air is fine.",
            "warning": "Cabin air is stuffy. Run a fan near you.",
            "serious": "Cabin air is over the safe limit. Run a fan near you."},
    "spe": {"good": "No solar storm.",
            "warning": "A solar storm is building. Be ready to shelter.",
            "serious": "Solar storm now. Go to the shielded crew quarters."},
    "rad_dose": {"good": "Normal for the space station."},
    "rad_total": {"good": "Well below your career limit.",
                  "warning": "Over 80% of your career limit.",
                  "serious": "At your career limit. Tell your medical officer."},
}

# environment flags: a thing to do, not an exercise and not a medical review
ACTIONS = {
    "spe": {"title": "Go to the shielded crew quarters", "note": "Stay until the alert ends. Radiation has no symptoms."},
    "co2": {"title": "Run a fan near you", "note": "Report the reading to the ground team."},
}


def name(mid: str, fallback: str) -> str:
    return PLAIN.get(mid, (fallback,))[0]


def _num(v, decimals):
    return f"{v:,.{decimals}f}" if isinstance(v, (int, float)) else str(v)


def with_unit(v, unit, decimals):
    n = _num(v, decimals)
    if not unit:
        return n
    return f"{n}{unit}" if unit.startswith("/") or unit in ("%", "°C") else f"{n} {unit}"


def _lim_hit(lim: dict, value):
    hit = None
    for k, v in lim.items():
        if ("high" in k and value >= v) or ("low" in k and value <= v):
            if hit is None or ("critical" in k) or ("serious" in k and "warning" in hit[0]):
                hit = (k, v)
    return hit


def statement(mid, label, direction):
    plain = PLAIN.get(mid)
    if plain:
        return plain[1] if direction == "high" else plain[2]
    return f"{label} is {direction} for you"


def explain(m, value, ref, status, unit, lim, action=None):
    """One plain line. ref: the comparison from health.reference() (expected value for the day, or pre-flight)."""
    if value is None:
        return "No reading yet."
    dec = min(m["decimals"], 1)                         # 38.2°C, not 38.22°C, in the main line
    v = with_unit(value, unit, dec) if unit in SHOW_UNIT else _num(value, dec)
    numbers = unit in SHOW_UNIT or unit in BARE_NUMBER
    if m["id"] in ENV_TEXTS:
        t = ENV_TEXTS[m["id"]]
        return (t.get(status) or t.get("good", "")).format(v=v)
    tail = f" {action}." if action else ""
    rng = m.get("lab_range")
    direction = None
    if status == "good":
        return "Normal for you." if ref else "Normal."
    if rng and rng[0] is not None and rng[1] is not None and (value < rng[0] or value > rng[1]):
        direction = "low" if value < rng[0] else "high"
        if numbers:
            return f"{statement(m['id'], m['label'], direction)}: {v}, normal {_num(rng[0], dec)}–{_num(rng[1], dec)}.{tail}"
    elif ref:
        usual = ref["mean"]
        direction = "high" if value > usual else "low"
        ud = dec if dec > 0 or abs(usual) >= 10 else 1
        if numbers:
            return f"{statement(m['id'], m['label'], direction)}: {v}, usually {_num(usual, ud)}.{tail}"
    else:
        hit = _lim_hit(lim, value)
        direction = ("high" if "high" in hit[0] else "low") if hit else ("high" if m["bad"] == "high" else "low")
        if numbers and hit:
            return f"{statement(m['id'], m['label'], direction)}: {v}, limit {_num(hit[1], dec)}.{tail}"
    return f"{statement(m['id'], m['label'], direction)}.{tail}"     # the exact numbers are in the small print


def detail(m, value, ref, pct, unit, lim):
    """Small print: the technical name and exact numbers."""
    if value is None:
        return m["label"]
    dec = m["decimals"]
    bd = dec if dec > 0 or (ref and abs(ref["mean"]) >= 10) else max(dec, 1)
    parts = [f"{m['label']}: {with_unit(value, unit, dec)}"]
    if ref and ref.get("kind") == "trajectory":
        parts.append(f"expected {with_unit(ref['mean'], unit, bd)} on mission day {ref['day']}, "
                     f"pre-flight {with_unit(ref['preflight'], unit, bd)}")
    elif ref:
        parts.append(f"pre-flight {with_unit(ref['mean'], unit, bd)} (SD {_num(ref['sd'], max(bd, 1))}, n={ref['n']})")
    if pct is not None:
        parts.append(f"{pct:+.0f}%")
    rng = m.get("lab_range")
    if rng and rng[0] is not None and rng[1] is not None:
        parts.append(f"lab range {_num(rng[0], dec)}–{_num(rng[1], dec)} {unit}".rstrip())
    hit = _lim_hit(lim, value) if lim else None
    if hit:
        parts.append(f"past the {hit[0].split('_')[0]} limit of {with_unit(hit[1], unit, dec)}")
    return "; ".join(parts)
