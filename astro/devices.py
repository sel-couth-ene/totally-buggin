"""Registry of the hardware the app pulls from. We don't build any of it; in the
demo each device is replaced by a simulator (see synth.py) that produces data
in the same shape and on the same rhythm the real device would.

kind:
  wearable   records by itself while worn; synced in batches
  session    records by itself, but only during scheduled wear sessions
  exam       astronaut runs a measurement; results arrive after the exam
  log        equipment logs data during each workout
  manual     entered in this app by the astronaut
  support    consumes data, produces none (shown for completeness)
  environment cabin / radiation sensors: same values for the whole crew. These two replay REAL
             NASA data (see astro/nasa.py) instead of a simulator.
  live       a real sensor on a USB port (the pulse sensor). No simulator and no batches: the page
             streams it and the server stores what it reads (astro/pulse.py).
"""

HOUR = 3600.0

DEVICES = [
    {
        "id": "biomonitor", "name": "Bio-Monitor (Astroskin)", "kind": "session",
        "sync_every": 0.25 * HOUR,
        "collects": "Heart rate, breathing rate, SpO₂, skin temperature, estimated systolic BP, activity",
        "how": "Automatic while the smart shirt and headband are worn (48 h sessions).",
    },
    {
        "id": "actiwatch", "name": "Actiwatch Spectrum", "kind": "wearable",
        "sync_every": 6 * HOUR,
        "collects": "Wrist activity and light exposure; nightly sleep estimate",
        "how": "Automatic, worn on the wrist for the whole mission.",
    },
    {
        "id": "thermomini", "name": "Thermo-Mini", "kind": "session",
        "sync_every": 1 * HOUR,
        "collects": "Core body temperature",
        "how": "Automatic while the headband is worn (36 h sessions).",
    },
    {
        "id": "tempus", "name": "Tempus Pro", "kind": "exam",
        "sync_every": 2 * HOUR,
        "collects": "ECG, blood pressure, SpO₂, temperature",
        "how": "Weekly exam: the astronaut attaches the sensors.",
    },
    {
        "id": "rhealth", "name": "rHEALTH One", "kind": "exam",
        "sync_every": 6 * HOUR,
        "collects": "Blood count and blood chemistry from one drop",
        "how": "Manual: finger-prick sample run by the astronaut.",
    },
    {
        "id": "ultrasound", "name": "Portable ultrasound", "kind": "exam",
        "sync_every": 6 * HOUR,
        "collects": "Optic nerve sheath diameter, jugular vein size and flow",
        "how": "Manual scan, often guided by a doctor on the ground.",
    },
    {
        "id": "exercise", "name": "ARED, T2, CEVIS", "kind": "log",
        "sync_every": 1 * HOUR,
        "collects": "Lift loads, treadmill speed, bike heart rate at fixed workload",
        "how": "Logged automatically during each workout.",
    },
    {
        "id": "dosimeter", "name": "Radiation dosimeter (ISS DOSTEL)", "kind": "environment",
        "sync_every": 6 * HOUR,
        "collects": "Dose rate, solar particle activity, daily and cumulative dose. REAL NASA RadLab data",
        "how": "Automatic. Fixed detectors in the cabin; one daily summary per mission day.",
    },
    {
        "id": "cabin_env", "name": "Cabin environment sensors", "kind": "environment",
        "sync_every": 6 * HOUR,
        "collects": "Cabin CO₂, temperature, humidity. REAL ISS telemetry from NASA OSDR",
        "how": "Automatic. Station sensors; one daily summary per mission day.",
    },
    {
        "id": "pulse_sensor", "name": "Pulse sensor (USB, live)", "kind": "live",
        "sync_every": None,
        "collects": "Live heart rate, resting heart rate, heart-rate variability, breathing rate (estimated from the pulse)",
        "how": "Real hardware: an Arduino with a finger pulse sensor. Streams continuously; can be stopped from the Live pulse card.",
    },
    {
        "id": "crew_app", "name": "This app (check-ins)", "kind": "manual",
        "sync_every": None,
        "collects": "Mood, stress, symptoms, medication taken",
        "how": "Entered by the astronaut.",
    },
    {
        "id": "medkit", "name": "Medical kit", "kind": "manual",
        "sync_every": None,
        "collects": "Medication use (logged as events)",
        "how": "Logged by the astronaut when a medication is taken.",
    },
    {
        "id": "cmo_da", "name": "CMO-DA decision support", "kind": "support",
        "sync_every": None,
        "collects": "Nothing: it would read this app's data to support the crew medical officer",
        "how": "Not connected in this demo.",
    },
]

DEVICES_BY_ID = {d["id"]: d for d in DEVICES}
SYNCED_DEVICES = [d for d in DEVICES if d["sync_every"]]
