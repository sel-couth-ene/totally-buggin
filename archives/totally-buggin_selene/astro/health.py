"""Turn stored readings into a per-body-region health picture.

Every indicator is compared with what is expected for this astronaut on this
mission day: their own pre-flight baseline (MET < 0), moved along the normal
spaceflight adaptation in data/reference/expected_trajectory.csv (for example
blood pressure falls about 8 mmHg, core temperature rises about 1 °C over 75
days). The question is "is this abnormal for you, on day 147", not "is this
different from your pre-flight average". Indicators with no trajectory fall
back to the plain pre-flight baseline. Fixed safety limits sit on top.

Thresholds here are demo values for a hackathon prototype, not clinical
guidance.
"""
from __future__ import annotations

import json
import math
from statistics import mean, pstdev

from . import nasa, synth, wording
from .crew import CREW_BY_ID

DAY = 86400.0
HOUR = 3600.0
RANK = {"nodata": -1, "good": 0, "warning": 1, "serious": 2, "critical": 3}

# A live pulse sensor (astro/pulse.py) can stand in for two simulated indicators while it is
# reading: resting heart rate and breathing rate. Its numbers are real, so they are compared with
# the same baseline and expected-trajectory as the simulated ones.
LIVE_DEVICE = "pulse_sensor"
LIVE_OVERRIDE = {"resting_hr": "pulse_resting_hr", "breathing_rate": "pulse_breathing_rate"}
LIVE_FRESH = 20 * 60.0       # mission seconds (about 20 real seconds at the demo's 60x clock)
LIVE_HOW = ("Live from the pulse sensor on your finger (USB). Resting heart rate needs about 30 "
            "seconds of steady pulse; breathing rate is estimated from the rise and fall of your "
            "heart rate over about a minute.")
live_gate = lambda: True     # app.py swaps in "is the sensor delivering right now"

# ---------------------------------------------------------------- catalogue

def _m(**kw):
    kw.setdefault("decimals", 1)
    kw.setdefault("sd_floor", 1.0)
    kw.setdefault("limits", {})
    kw.setdefault("bad", "both")
    kw.setdefault("series", "daily")
    return kw


METRICS = [
    # head
    _m(id="sleep_hours", label="Sleep last night", region="head", device="actiwatch",
       metric="sleep_hours", agg="last", bad="low", sd_floor=0.35, series="points", trajectory="sleep",
       limits={"serious_low": 5.0, "critical_low": 3.5}, unit="h",
       how="Estimated each morning from wrist movement (automatic)."),
    _m(id="sleep_efficiency", label="Sleep efficiency", region="head", device="actiwatch",
       metric="sleep_efficiency", agg="last", bad="low", sd_floor=2.5, decimals=0, series="points",
       unit="%", how="Share of time in bed spent asleep (automatic)."),
    _m(id="mood", label="Mood", region="head", device="crew_app", metric="mood", agg="last",
       bad="low", sd_floor=0.5, decimals=0, series="points", limits={"serious_low": 2}, trajectory="mood",
       unit="/5", how="Your daily check-in in this app (manual)."),
    _m(id="stress", label="Stress", region="head", device="crew_app", metric="stress", agg="last",
       bad="high", sd_floor=0.5, decimals=0, series="points", limits={"serious_high": 4.5},
       unit="/5", how="Your daily check-in in this app (manual)."),
    _m(id="core_temp", label="Core body temperature", region="head", device="thermomini",
       metric="core_temp", agg="mean24", bad="high", sd_floor=0.12, decimals=2, trajectory="core_temp",
       # the ~1 °C in-flight rise is normal (Stahn 2017), so these limits move with it
       limits_follow_trajectory=True,
       limits={"serious_high": 37.8, "critical_high": 38.3, "serious_low": 35.5}, unit="°C",
       how="Thermo-Mini headband, automatic during 36 h wear sessions."),
    _m(id="light", label="Daytime light exposure", region="head", device="actiwatch",
       metric="light_lux", agg="mean_awake24", bad="low", sd_floor=12, decimals=0, unit="lux",
       how="Light sensor on the Actiwatch; low daytime light weakens the body clock."),
    _m(id="onsd", label="Optic nerve sheath diameter", region="head", device="ultrasound",
       metric="onsd_mm", agg="last", bad="high", sd_floor=0.08, decimals=2, series="points",
       limits={"serious_high": 5.8}, unit="mm",
       how="Eye ultrasound, monthly (manual). Widening can signal raised pressure behind the eye."),
    _m(id="co2", label="Cabin CO₂", region="head", device="cabin_env", metric="cabin_co2_ppm",
       agg="last", bad="high", decimals=0, series="points", unit="ppm",
       limits={"warning_high": 3950, "serious_high": 5260},
       how="Station CO₂ sensors, daily average (automatic). Same air for the whole crew."),
    # neck
    _m(id="ijv_area", label="Jugular vein size", region="neck", device="ultrasound",
       metric="ijv_area_mm2", agg="last", bad="high", sd_floor=6, decimals=0, series="points",
       unit="mm²", how="Neck ultrasound, monthly (manual)."),
    # chest
    _m(id="resting_hr", label="Resting heart rate", region="chest", device="biomonitor",
       metric="heart_rate", agg="rest24", bad="high", sd_floor=2.5, decimals=0, trajectory="heart_rate",
       limits={"serious_high": 100, "critical_high": 120, "serious_low": 40}, unit="bpm",
       how="Bio-Monitor shirt while resting (automatic), or the weekly Tempus Pro exam."),
    _m(id="sys_bp_est", label="Blood pressure estimate (continuous)", region="chest",
       device="biomonitor", metric="sys_bp_est", agg="rest24", bad="high", sd_floor=4, decimals=0,
       trajectory="bp_sys",
       limits={"serious_high": 145}, unit="mmHg",
       how="Estimated systolic pressure from the Bio-Monitor (automatic). Less exact than a cuff."),
    _m(id="sys_bp", label="Blood pressure, systolic", region="chest", device="tempus",
       metric="tempus_sys", agg="last", bad="high", sd_floor=4, decimals=0, series="points", trajectory="bp_sys",
       limits={"serious_high": 140, "critical_high": 160, "serious_low": 90}, unit="mmHg",
       how="Weekly Tempus Pro exam with an arm cuff (manual)."),
    _m(id="dia_bp", label="Blood pressure, diastolic", region="chest", device="tempus",
       metric="tempus_dia", agg="last", bad="high", sd_floor=3, decimals=0, series="points", trajectory="bp_dia",
       limits={"serious_high": 90, "critical_high": 100}, unit="mmHg",
       how="Weekly Tempus Pro exam with an arm cuff (manual)."),
    _m(id="spo2", label="Blood oxygen (SpO₂)", region="chest", device="biomonitor",
       metric="spo2", agg="mean24", bad="low", sd_floor=0.5, trajectory="spo2",
       limits={"serious_low": 94, "critical_low": 90}, unit="%",
       how="Bio-Monitor headband sensor (automatic during sessions)."),
    _m(id="breathing_rate", label="Breathing rate", region="chest", device="biomonitor",
       metric="breathing_rate", agg="rest24", bad="both", sd_floor=1.0,
       limits={"serious_high": 24, "serious_low": 8}, unit="breaths/min",
       how="Bio-Monitor shirt chest bands (automatic during sessions)."),
    _m(id="cevis_hr", label="Heart rate on the bike at 150 W", region="chest", device="exercise",
       metric="cevis_hr_150w", agg="mean3", bad="high", sd_floor=2.5, decimals=0, unit="bpm",
       how="Logged by CEVIS each workout. Rising at the same workload means fitness is slipping."),
    _m(id="spe", label="Solar particle activity", region="chest", device="dosimeter",
       metric="rad_spe_index", agg="last", bad="high", decimals=2, series="points", unit="× quiet",
       limits={"warning_high": 1.3, "serious_high": 1.6},
       how="High-latitude dose rate divided by its median over the previous 27 days. This is "
           "where the station is least shielded, so solar events show up here first."),
    _m(id="rad_dose", label="Radiation dose yesterday", region="chest", device="dosimeter",
       metric="rad_dose_msv", agg="last", bad="high", decimals=2, series="points", unit="mSv",
       how="Daily absorbed dose from the cabin dosimeters, converted to an approximate effective dose."),
    _m(id="rad_total", label="Radiation dose this mission", region="chest", device="dosimeter",
       metric="rad_cumulative_msv", agg="last", bad="high", decimals=0, series="points", unit="mSv",
       limits={"warning_high": 480, "serious_high": 600},
       how="Running total of the daily doses since launch."),
    # arms
    _m(id="bench", label="Upper-body strength (ARED bench)", region="arms", device="exercise",
       metric="ared_bench_kg", agg="mean3", bad="low", sd_floor=1.5, unit="kg",
       how="Logged by ARED each workout (automatic)."),
    _m(id="activity", label="Daily movement", region="arms", device="actiwatch",
       metric="activity_counts", agg="mean_awake24", bad="low", sd_floor=12, decimals=0,
       unit="counts", how="Wrist accelerometer on the Actiwatch (automatic)."),
    # legs
    _m(id="squat", label="Leg strength (ARED squat)", region="legs", device="exercise",
       metric="ared_squat_kg", agg="mean3", bad="low", sd_floor=2.0, unit="kg",
       how="Logged by ARED each workout (automatic)."),
    _m(id="t2_speed", label="Treadmill speed (T2)", region="legs", device="exercise",
       metric="t2_speed_kmh", agg="mean3", bad="low", sd_floor=0.25, unit="km/h",
       how="Logged by the T2 treadmill each workout (automatic)."),
]

BLOOD_REGION = {
    "hemoglobin": "chest", "hematocrit": "chest", "rbc": "chest", "platelets": "chest",
    "wbc": "abdomen", "lymphocytes": "abdomen", "neutrophils": "abdomen", "glucose": "abdomen",
    "creatinine": "abdomen", "bun": "abdomen", "sodium": "abdomen", "potassium": "abdomen",
    "albumin": "abdomen", "alt": "abdomen", "ast": "abdomen",
    "calcium": "legs", "alk_phos": "legs",
}

REGIONS = {
    "head": {
        "title": "Head",
        "about": "Your brain runs sleep, mood and focus.",
        "space": ["Fluid moves to the head and can change the eyes.",
                  "Many sunrises a day upset your sleep."],
        "act": "Keep a regular bedtime. Report headaches or blurry vision.",
    },
    "neck": {
        "title": "Neck",
        "about": "Your neck veins carry blood from your head to your heart.",
        "space": ["Fluid moves up and can swell these veins.",
                  "Slow blood here can form a clot."],
        "act": "Report neck swelling, pain or a full-headed feeling.",
    },
    "chest": {
        "title": "Chest",
        "about": "Your heart and lungs move oxygen around your body.",
        "space": ["Your heart gets less fit without gravity.",
                  "Radiation and stuffy air add risk over time."],
        "act": "Do your bike and treadmill sessions. Shelter during solar storms.",
    },
    "abdomen": {
        "title": "Abdomen",
        "about": "Your kidneys, liver and gut clean blood and fight germs.",
        "space": ["Bone calcium can cause kidney stones.",
                  "Your immune system gets weaker in space."],
        "act": "Drink to your water target. Report any illness.",
    },
    "arms": {
        "title": "Arms",
        "about": "Your arms and shoulders move you around the station.",
        "space": ["Muscles shrink without resistance training."],
        "act": "Keep the upper-body sets in your strength routine.",
    },
    "legs": {
        "title": "Legs",
        "about": "Your hips and legs carry your weight on Earth.",
        "space": ["Leg bones lose about 1% each month.",
                  "Leg muscles shrink quickly without load."],
        "act": "Do your squats and treadmill runs every day.",
    },
}

EXERCISES = {
    "box_breathing": {"name": "Box breathing", "kind": "timer", "duration_s": 64, "points": 40,
                      "do": wording.DO["box_breathing"],
                      "how": "Breathe in 4, hold 4, out 4, hold 4. Four rounds.",
                      "why": "Slow breathing lowers heart rate and blood pressure."},
    "wind_down": {"name": "Wind-down stretch", "kind": "timer", "duration_s": 60, "points": 40,
                  "do": wording.DO["wind_down"],
                  "how": "Roll your neck and shoulders slowly. Reach up, breathe out.",
                  "why": "A calm routine helps you fall asleep sooner."},
    "pet_time": {"name": "Time with your companion", "kind": "petting", "duration_s": 10, "points": 30,
                 "do": wording.DO["pet_time"],
                 "how": "Stroke your companion with an open hand for 10 seconds.",
                 "why": "A short, happy break eases the strain of isolation."},
    "squats": {"name": "Squats", "kind": "reps", "reps": 12, "points": 60,
               "do": wording.DO["squats"],
               "how": "Step back so your knees show. Sit back, then stand tall.",
               "why": "Loading your legs slows bone loss in your hips."},
    "arm_raises": {"name": "Arm raises", "kind": "reps", "reps": 12, "points": 50,
                   "do": wording.DO["arm_raises"],
                   "how": "Raise both hands above your head, then lower to shoulders.",
                   "why": "Keeps your shoulders and upper back strong."},
    "march": {"name": "Knee lifts", "kind": "reps", "reps": 20, "points": 50,
              "do": wording.DO["march"],
              "how": "Lift each knee to hip height in turn. Step back first.",
              "why": "Short bursts of cardio keep your heart fit."},
}

# metric id -> (direction that triggers, exercise id)
REC_RULES = {
    "resting_hr": ("high", "box_breathing"),
    "sys_bp": ("high", "box_breathing"),
    "sys_bp_est": ("high", "box_breathing"),
    "dia_bp": ("high", "box_breathing"),
    "stress": ("high", "box_breathing"),
    "sleep_hours": ("low", "wind_down"),
    "sleep_efficiency": ("low", "wind_down"),
    "light": ("low", "wind_down"),
    "mood": ("low", "pet_time"),
    "squat": ("low", "squats"),
    "bone_est": ("high", "squats"),
    "bl_calcium": ("high", "squats"),
    "t2_speed": ("low", "march"),
    "cevis_hr": ("high", "march"),
    "bench": ("low", "arm_raises"),
}
# environment flags: something to do, not an exercise and not a medical review
ACTIONS = wording.ACTIONS                                  # environment flags: something to do
CONSULT_ALWAYS = {"onsd", "ijv_area", "ijv_flow"}          # any flag: a person should look
CONSULT_IF_SERIOUS = {"core_temp", "spo2"}                  # only once it is serious


# ---------------------------------------------------------------- queries

def _values(conn, aid, metric, t0, t1):
    return conn.execute(
        "SELECT value, measured_met AS t, device_id FROM readings WHERE astronaut_id=? AND metric=? "
        "AND measured_met>? AND measured_met<=? ORDER BY measured_met", (aid, metric, t0, t1)).fetchall()


def _last(conn, aid, metric, t1):
    return conn.execute(
        "SELECT value, measured_met AS t, device_id FROM readings WHERE astronaut_id=? AND metric=? "
        "AND measured_met<=? ORDER BY measured_met DESC LIMIT 1", (aid, metric, t1)).fetchone()


def _rest_values(conn, aid, metric, t0, t1):
    """Values recorded while the Bio-Monitor saw little movement."""
    return conn.execute(
        "SELECT r.value, r.measured_met AS t FROM readings r JOIN readings a "
        "ON a.astronaut_id=r.astronaut_id AND a.measured_met=r.measured_met AND a.metric='activity' "
        "WHERE r.astronaut_id=? AND r.metric=? AND r.measured_met>? AND r.measured_met<=? "
        "AND a.value<0.12 ORDER BY r.measured_met", (aid, metric, t0, t1)).fetchall()


def _awake(rows):
    return [r for r in rows if 6.0 <= (r["t"] % DAY) / HOUR < 21.5]


def _window_value(conn, m, aid, t0, t1):
    """Aggregate value for a window, or None."""
    agg = m["agg"]
    if agg == "rest24":
        rows = _rest_values(conn, aid, m["metric"], t0, t1)
    elif agg == "mean_awake24":
        rows = _awake(_values(conn, aid, m["metric"], t0, t1))
    else:
        rows = _values(conn, aid, m["metric"], t0, t1)
    if not rows:
        return None, None
    return mean(r["value"] for r in rows), rows[-1]["t"]


def _live_value(conn, m, aid, now):
    """(value, t) from the live pulse sensor for this indicator, or None when it isn't reading."""
    metric = LIVE_OVERRIDE.get(m["id"])
    if not metric or not live_gate():
        return None
    r = _last(conn, aid, metric, now)
    if r and 0 <= now - r["t"] <= LIVE_FRESH:
        return r["value"], r["t"]
    return None


def _with_live_point(points, t, value):
    """Trend chart: swap today's partial daily average for the live reading."""
    day = math.floor(t / DAY)
    kept = [p for p in points if math.floor(p["t"] / DAY) != day]
    kept.append({"t": t, "v": round(value, 3), "src": LIVE_DEVICE})
    return kept


def current_value(conn, m, aid, now):
    live = _live_value(conn, m, aid, now)
    if live:
        return live[0], live[1], LIVE_DEVICE
    agg = m["agg"]
    if agg == "last":
        r = _last(conn, aid, m["metric"], now)
        return (r["value"], r["t"], r["device_id"]) if r else (None, None, None)
    if agg == "mean3":
        rows = conn.execute(
            "SELECT value, measured_met AS t FROM readings WHERE astronaut_id=? AND metric=? "
            "AND measured_met<=? ORDER BY measured_met DESC LIMIT 3", (aid, m["metric"], now)).fetchall()
        if not rows:
            return None, None, None
        return mean(r["value"] for r in rows), rows[0]["t"], m["device"]
    v, t = _window_value(conn, m, aid, now - DAY, now)
    if v is not None:
        return v, t, m["device"]
    # no data in the last day: use the most recent day that has data
    last = _last(conn, aid, m["metric"], now)
    if not last:
        if m["id"] == "resting_hr":   # fall back to the weekly exam
            r = _last(conn, aid, "tempus_hr", now)
            return (r["value"], r["t"], "tempus") if r else (None, None, None)
        return None, None, None
    v, t = _window_value(conn, m, aid, last["t"] - DAY, last["t"])
    if v is None:
        v, t = last["value"], last["t"]
    if m["id"] == "resting_hr":
        r = _last(conn, aid, "tempus_hr", now)
        if r and r["t"] > t:
            return r["value"], r["t"], "tempus"
    return v, t, m["device"]


_baseline_cache: dict = {}


def baseline(conn, m, aid):
    key = (aid, m["id"])
    if key in _baseline_cache:
        return _baseline_cache[key]
    t0, t1 = -100 * DAY, 0.0
    vals = []
    if m["agg"] in ("last", "mean3"):
        vals = [r["value"] for r in _values(conn, aid, m["metric"], t0, t1)]
    else:
        for d in range(-100, 0):
            v, _ = _window_value(conn, m, aid, d * DAY, (d + 1) * DAY)
            if v is not None:
                vals.append(v)
    res = None
    if vals:
        res = {"mean": mean(vals), "sd": pstdev(vals) if len(vals) > 1 else 0.0, "n": len(vals)}
    _baseline_cache[key] = res
    return res


def reference(m, base, met):
    """What to compare a reading taken at `met` with.

    For an indicator in the expected-trajectory CSV: the expected value for this person on that
    mission day, with the person's pre-flight day-to-day SD (floored by the CSV's personal_sd_floor).
    Otherwise: the plain pre-flight baseline. None when there is no pre-flight data at all.
    """
    if not base:
        return None
    ind = m.get("trajectory")
    floor = nasa.sd_floor(ind, m["sd_floor"])
    ref = {**base, "sd": max(base["sd"], floor), "preflight": base["mean"], "kind": "baseline", "day": None}
    if met is not None and met > 0 and nasa.has_trajectory(ind):
        day = met / DAY
        ref.update(mean=nasa.expected(ind, day, base["mean"]), kind="trajectory", day=int(day))
    return ref


def series(conn, m, aid, now, days=21):
    """Points for the trend chart."""
    if m["series"] == "points" or m["agg"] in ("last", "mean3"):
        span = 200 * DAY if m["device"] in ("ultrasound", "rhealth", "dosimeter") else days * DAY
        rows = _values(conn, aid, m["metric"], now - span, now)
        return [{"t": r["t"], "v": round(r["value"], 3), "src": r["device_id"]} for r in rows]
    pts = []
    d_now = math.floor(now / DAY)
    for d in range(d_now - days + 1, d_now + 1):
        v, t = _window_value(conn, m, aid, d * DAY, min((d + 1) * DAY, now))
        if v is not None:
            pts.append({"t": d * DAY + 12 * HOUR, "v": round(v, 3), "src": m["device"]})
    return pts


# ---------------------------------------------------------------- evaluation

def classify(m, value, base):
    if value is None:
        return "nodata", None, None
    status, z, pct = "good", None, None
    if m.get("lab_range"):
        if base:
            pct = (value - base["mean"]) / base["mean"] * 100 if base["mean"] else None
            z = (value - base["mean"]) / max(base["sd"], m["sd_floor"])
            if pct is not None and abs(pct) >= 30:
                status = "warning"
        base = None   # status below comes from the lab range
    if base:
        sd = max(base["sd"], m["sd_floor"])
        z = (value - base["mean"]) / sd       # base["mean"] is the expected value for the day
        pct = (value - base["mean"]) / base["mean"] * 100 if base["mean"] else None
        zeff = z if m["bad"] == "high" else (-z if m["bad"] == "low" else abs(z))
        if zeff >= 3:
            status = "serious"
        elif zeff >= 2:
            status = "warning"
    lim = m.get("limits", {})
    if base and m.get("limits_follow_trajectory") and base.get("kind") == "trajectory":
        shift = base["mean"] - base["preflight"]
        lim = {k: v + shift for k, v in lim.items()}
    def bump(s):
        nonlocal status
        if RANK[s] > RANK[status]:
            status = s
    if "critical_high" in lim and value >= lim["critical_high"]: bump("critical")
    if "critical_low" in lim and value <= lim["critical_low"]: bump("critical")
    if "serious_high" in lim and value >= lim["serious_high"]: bump("serious")
    if "serious_low" in lim and value <= lim["serious_low"]: bump("serious")
    if "warning_high" in lim and value >= lim["warning_high"]: bump("warning")
    if "warning_low" in lim and value <= lim["warning_low"]: bump("warning")
    rng = m.get("lab_range")
    if rng and rng[0] is not None and rng[1] is not None:
        width = rng[1] - rng[0]
        if value < rng[0] or value > rng[1]:
            bump("warning")
        if value < rng[0] - 0.2 * width or value > rng[1] + 0.2 * width:
            bump("serious")
    return status, z, pct


def fmt(v, unit, decimals=1):
    num = f"{v:.{decimals}f}" if isinstance(v, (int, float)) else str(v)
    if not unit:
        return num
    return f"{num}{unit}" if unit.startswith("/") or unit in ("%", "°C") else f"{num} {unit}"


def needs_consult(mid, status, device):
    """A flag that a person (the crew medical officer) should look at."""
    return RANK[status] >= 1 and (mid in CONSULT_ALWAYS or status == "critical"
                                  or (device == "rhealth" and RANK[status] >= 2)
                                  or (mid in CONSULT_IF_SERIOUS and RANK[status] >= 2))


def _limits_for(m, ref):
    lim = m.get("limits", {})
    if ref and m.get("limits_follow_trajectory") and ref.get("kind") == "trajectory":
        shift = ref["mean"] - ref["preflight"]
        lim = {k: v + shift for k, v in lim.items()}
    return lim


def _action(mid, status, device, high):
    """The short "what to do" sentence for a flagged reading, or None."""
    if RANK[status] < 1:
        return None
    if needs_consult(mid, status, device):
        return wording.DO["consult"]
    rule = REC_RULES.get(mid)
    if rule and (rule[0] == "high") == high:
        return wording.DO[rule[1]]
    return None


def words(m, value, ref, status, pct, unit, device):
    """(plain name, plain line, small technical line) for one reading."""
    lim = _limits_for(m, ref)
    high = (value > ref["mean"]) if (ref and isinstance(value, (int, float))) else m["bad"] == "high"
    act = _action(m["id"], status, device, high)
    line = wording.explain(m, value, ref, status, unit, lim, act)
    if act == wording.DO["consult"]:
        line += f" {wording.CONSULT_NOTE}"
    return wording.name(m["id"], m["label"]), line, wording.detail(m, value, ref, pct, unit, lim)


def _decimals(values):
    vals = list(values)
    if all(float(v).is_integer() for v in vals):
        return 0
    return 2 if any(abs(v * 10 - round(v * 10)) > 1e-6 for v in vals) else 1


def blood_metrics(aid):
    p = CREW_BY_ID[aid]
    subj = synth.blood_data()["subjects"].get(p["osdr_subject"], {})
    out = []
    for mid, info in subj.items():
        out.append(_m(id="bl_" + mid, label=info["label"], region=BLOOD_REGION.get(mid, "abdomen"),
                      device="rhealth", metric="bl_" + mid, agg="last", bad="both",
                      sd_floor=0.0001, series="points", unit=info["unit"],
                      decimals=_decimals(info["points"].values()),
                      lab_range=info["range"], source_note="OSDR Inspiration4 subject " + p["osdr_subject"],
                      how="rHEALTH One finger-prick blood test (manual). Values are real "
                          "Inspiration4 data from NASA OSDR."))
    return out


def bone_estimate(conn, aid, now):
    """Model estimate, not a measurement: monthly loss grows when ARED leg load falls."""
    base = baseline(conn, next(m for m in METRICS if m["id"] == "squat"), aid)
    loads = _values(conn, aid, "ared_squat_kg", 0, now)
    if not base or not loads:
        return None
    monthly = nasa.param("bone", "monthly_loss_pct", 1.0)   # LeBlanc 2000, with full exercise
    total, last_t = 0.0, 0.0
    for r in loads:
        ratio = min(1.0, r["value"] / base["mean"])
        rate_per_day = (monthly + 4.0 * (1 - ratio)) / 30.0   # % per day
        total += rate_per_day * (r["t"] - last_t) / DAY
        last_t = r["t"]
    expected = monthly / 30.0 * now / DAY
    return {"value": total, "expected": expected, "t": loads[-1]["t"]}


def evaluate(conn, aid, now):
    metrics = METRICS + blood_metrics(aid)
    results = []
    for m in metrics:
        value, t, dev = current_value(conn, m, aid, now)
        # Blood measures: compare the latest panel with the pre-flight draws.
        base = baseline(conn, m, aid)
        ref = reference(m, base, t)
        status, z, pct = classify(m, value, ref)
        unit = m.get("unit") or synth.UNITS.get(m["metric"], "")
        is_live = dev == LIVE_DEVICE
        ser = series(conn, m, aid, now)
        if is_live and value is not None:
            ser = _with_live_point(ser, t, value)
        nm, line, small = words(m, value, ref, status, pct, unit, dev or m["device"])
        results.append({
            "id": m["id"], "label": m["label"], "name": nm, "region": m["region"], "unit": unit,
            "value": None if value is None else round(value, m["decimals"]),
            "measured_met": t, "device": dev or m["device"], "status": status,
            "z": None if z is None else round(z, 2), "pct": None if pct is None else round(pct, 1),
            "baseline": None if not base else {"mean": round(base["mean"], 3),
                                               "sd": round(ref["sd"], 3), "n": base["n"]},
            "expected": None if not ref or ref["kind"] != "trajectory" else
            {"mean": round(ref["mean"], 3), "sd": round(ref["sd"], 3), "day": ref["day"]},
            "lab_range": m.get("lab_range"), "how": LIVE_HOW if is_live else m["how"], "bad": m["bad"],
            "explain": line, "detail": small,
            "series": ser, "decimals": m["decimals"],
            "source_note": m.get("source_note") or nasa.source_note(m["device"], t),
        })
    be = bone_estimate(conn, aid, now)
    if be:
        excess = be["value"] - be["expected"]
        st = "serious" if excess > 1.5 else ("warning" if excess > 0.6 else "good")
        results.append({
            "id": "bone_est", "label": "Estimated hip bone loss since launch", "name": wording.name("bone_est", ""),
            "region": "legs",
            "unit": "%", "value": round(be["value"], 1), "measured_met": be["t"], "device": "model",
            "status": st, "z": None, "pct": None, "bad": "high",
            "baseline": {"mean": round(be["expected"], 2), "sd": 0.3, "n": 0}, "lab_range": None,
            "how": "Model estimate from your ARED leg loads, not a scan. Bone density is "
                   "measured properly only after landing.",
            "explain": (f"Hip bone is thinning faster: {be['value']:.1f}% lost, usually {be['expected']:.1f}%. "
                        f"{wording.DO['squats']}.") if st != "good" else "Normal for your exercise.",
            "detail": (f"Model estimate of hip BMD loss since launch: {be['value']:.2f}%; expected with full ARED "
                       f"loads {be['expected']:.2f}%; excess {excess:+.2f} points"),
            "series": [], "decimals": 1, "source_note": None,
        })
    # categorical: jugular flow pattern
    ev = conn.execute("SELECT payload, measured_met FROM events WHERE astronaut_id=? AND type='ijv_flow' "
                      "AND measured_met<=? ORDER BY measured_met DESC LIMIT 1", (aid, now)).fetchone()
    if ev:
        pl = json.loads(ev["payload"])
        results.append({
            "id": "ijv_flow", "label": "Jugular vein flow", "name": wording.name("ijv_flow", ""), "region": "neck", "unit": "",
            "value": pl["pattern"], "measured_met": ev["measured_met"], "device": "ultrasound",
            "status": "good" if pl["pattern"].startswith("Normal") else "warning", "z": None, "pct": None,
            "bad": "both", "baseline": None, "lab_range": None,
            "how": "Read from the neck ultrasound (manual).",
            "explain": "Normal." if pl["pattern"].startswith("Normal")
            else f"Neck vein blood is slow. {wording.DO['consult']}. {wording.CONSULT_NOTE}",
            "detail": f"Jugular vein flow pattern ({pl.get('side', 'left')} IJV, ultrasound): {pl['pattern']}",
            "series": [], "decimals": 0, "source_note": None,
        })
    return results


def _reason(r):
    """The plain line without its trailing action (the card's title already says what to do)."""
    line = r["explain"]
    for act in list(wording.DO.values()) + [a["title"] for a in wording.ACTIONS.values()]:
        line = line.replace(f" {act}.", "")
    return line.replace(f" {wording.CONSULT_NOTE}", "").strip()


def recommendations(results, done_ids=()):
    recs, seen = [], set()
    flagged = sorted([r for r in results if RANK[r["status"]] >= 1], key=lambda r: -RANK[r["status"]])
    for r in flagged:
        high = (r["pct"] or 0) > 0 if r["pct"] is not None else r["bad"] == "high"
        reason = _reason(r)
        if needs_consult(r["id"], r["status"], r["device"]):
            key = "consult"
            if key in seen:
                continue
            seen.add(key)
            recs.append({"id": f"consult_{r['id']}", "kind": "consult", "region": r["region"],
                         "metric": r["id"], "status": r["status"],
                         "title": wording.DO["consult"], "reason": reason, "note": wording.CONSULT_NOTE,
                         "detail": r.get("detail")})
            continue
        if r["id"] in ACTIONS:
            a = ACTIONS[r["id"]]
            if r["id"] == "spe" and RANK[r["status"]] < 2:
                continue                      # only a full event calls for shelter
            recs.append({"id": f"action_{r['id']}", "kind": "action", "region": r["region"],
                         "metric": r["id"], "status": r["status"], "title": a["title"],
                         "reason": reason, "note": a["note"], "detail": r.get("detail")})
            continue
        rule = REC_RULES.get(r["id"])
        if not rule:
            continue
        want, ex = rule
        if (want == "high") != high or ex in seen:
            continue
        seen.add(ex)
        e = EXERCISES[ex]
        recs.append({"id": f"{ex}:{r['id']}", "kind": "exercise", "exercise": ex, "region": r["region"],
                     "metric": r["id"], "status": r["status"], "title": e["do"], "exercise_name": e["name"],
                     "reason": reason, "points": e["points"], "detail": r.get("detail"),
                     "done": ex in done_ids})
    return recs


def summary(conn, aid, now, done_ids=()):
    results = evaluate(conn, aid, now)
    regions = {}
    for rid, info in REGIONS.items():
        ms = [r for r in results if r["region"] == rid]
        worst = max((r["status"] for r in ms), key=lambda s: RANK[s], default="nodata")
        regions[rid] = {**info, "id": rid, "status": worst, "metrics": ms,
                        "flags": sum(1 for r in ms if RANK[r["status"]] >= 1)}
    live = {}
    hr = _last(conn, aid, "heart_rate", now)
    br = _last(conn, aid, "breathing_rate", now)
    live["heart_rate"] = hr["value"] if hr and now - hr["t"] < 2 * HOUR else None
    live["breathing_rate"] = br["value"] if br and now - br["t"] < 2 * HOUR else None
    rest = next((r for r in results if r["id"] == "resting_hr"), None)
    if live["heart_rate"] is None and rest:
        live["heart_rate"] = rest["value"]
    return {"astronaut_id": aid, "now_met": now, "regions": regions,
            "recommendations": recommendations(results, done_ids), "live": live}
