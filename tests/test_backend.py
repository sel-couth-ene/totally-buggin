"""Backend checks. Run: python -m pytest tests  (or python tests/test_backend.py)"""
import os
import sys
import tempfile
from pathlib import Path

os.environ["ASTRO_DB"] = str(Path(tempfile.mkdtemp()) / "test.db")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import app as server  # noqa: E402
from astro import ingest  # noqa: E402

client = server.app.test_client()


def test_state_has_regions_and_recs():
    r = client.get("/api/state?astronaut=okafor").get_json()
    regions = r["health"]["regions"]
    assert set(regions) == {"head", "neck", "chest", "abdomen", "arms", "legs"}
    assert regions["head"]["status"] in ("warning", "serious")
    kinds = {x.get("exercise") for x in r["health"]["recommendations"]}
    assert "wind_down" in kinds
    blood = [m for m in regions["abdomen"]["metrics"] if m["device"] == "rhealth"]
    assert blood and all(m["series"] for m in blood)


def test_sync_produces_batches_after_time_passes():
    conn = server.get_conn if False else None  # noqa
    r = client.post("/api/clock/advance", json={"hours": 2}).get_json()
    devs = {b["device_id"] for b in r["batches"]}
    assert "biomonitor" in devs and "thermomini" in devs
    bio = [b for b in r["batches"] if b["device_id"] == "biomonitor"][0]
    assert bio["n_readings"] > 0
    r2 = client.post("/api/sync").get_json()
    assert not [b for b in r2["batches"] if b["device_id"] == "biomonitor"]  # not due again yet


def test_readings_window():
    now = client.get("/api/state").get_json()["clock"]["met"]
    r = client.get(f"/api/readings?astronaut=okafor&device=biomonitor&since={now - 3600}").get_json()
    assert r["readings"] and all(x["measured_met"] > now - 3600 for x in r["readings"])


def test_game_flow():
    g = client.get("/api/state?astronaut=brandt").get_json()["game"]
    pts = g["points"]
    r = client.post("/api/game/brandt/complete", json={"exercise": "squats", "reps": 12}).get_json()
    assert r["earned"] == 60 and r["game"]["points"] == pts + 60
    again = client.post("/api/game/brandt/complete", json={"exercise": "squats"}).get_json()
    assert again["earned"] == 0  # cooldown
    r = client.post("/api/game/brandt/buy", json={"item": "bunny"}).get_json()
    assert len(r["game"]["pets"]) == 2
    bad = client.post("/api/game/brandt/buy", json={"item": "giraffe"})
    assert bad.status_code == 400 and "more points" in bad.get_json()["error"]
    client.post("/api/game/brandt/buy", json={"item": "space_berry"})
    pet = r["game"]["pets"][0]["uid"]
    fed = client.post("/api/game/brandt/feed", json={"pet": pet, "item": "space_berry"}).get_json()
    assert fed["game"]["inventory"]["snack"]["space_berry"] == 2
    petted = client.post("/api/game/brandt/pet", json={"pet": pet, "seconds": 3}).get_json()
    assert petted["earned"] == 5


def test_checkin():
    r = client.post("/api/checkin/okafor", json={"mood": 4, "stress": 2}).get_json()
    mood = [m for m in r["health"]["regions"]["head"]["metrics"] if m["id"] == "mood"][0]
    assert mood["value"] == 4


def test_checkin_is_daily():
    def today_moods():
        st = client.get("/api/state?astronaut=menon").get_json()
        day0 = st["game"]["checkin"]["day"] * 86400
        r = client.get(f"/api/readings?astronaut=menon&device=crew_app&since={day0 - 1}").get_json()
        return [x["value"] for x in r["readings"] if x["metric"] == "mood"], st["game"]["checkin"]

    first = client.post("/api/checkin/menon", json={"mood": 2, "stress": 4}).get_json()
    assert first["earned"] > 0 and first["game"]["checkin"]["done_today"]
    assert first["game"]["checkin"]["today"] == {"mood": 2, "stress": 4}
    again = client.post("/api/checkin/menon", json={"mood": 4, "stress": 2, "note": "slept badly"}).get_json()
    assert again["earned"] == 0                                  # points once per mission day
    moods, c = today_moods()
    assert moods == [4] and c["today"] == {"mood": 4, "stress": 2}   # replaced, not added
    client.post("/api/clock/advance", json={"hours": 24})
    _, c = today_moods()
    assert not c["done_today"]                                   # a new day opens a new check-in
    assert client.post("/api/checkin/menon", json={"mood": 3, "stress": 3}).get_json()["earned"] > 0


def test_live_delta():
    full = client.get("/api/live?aid=ruiz").get_json()
    assert full["full"] and "health" in full and "devices" in full        # no since: same shape as /api/state
    t = full["clock"]["met"]
    quiet = client.get(f"/api/live?aid=ruiz&since={t}").get_json()
    assert quiet["full"] is False and set(quiet["statuses"]) == set(full["health"]["regions"])
    client.post("/api/clock/advance", json={"hours": 6.5})            # Actiwatch (worn all day) syncs every 6 h
    r = client.get(f"/api/live?aid=ruiz&since={t}").get_json()
    acti = [b for b in r["batches"] if b["device_id"] == "actiwatch"]
    assert r["changed"] and acti and "activity_counts" in acti[0]["latest"] and r["health"]
    assert r["readings"]["activity_counts"]["value"] == acti[-1]["latest"]["activity_counts"]["value"]
    again = client.get(f"/api/live?aid=ruiz&since={r['clock']['met']}").get_json()
    assert not [b for b in again["batches"] if b["device_id"] == "actiwatch"]    # nothing reported twice


def test_real_nasa_data_mapping():
    from astro import nasa
    rad = nasa.radiation_days()
    assert rad[0]["date"] == "2024-02-01"
    assert rad[100]["date"] == "2024-05-11" and rad[100]["spe_index"] > 2.0      # real May 2024 SPE
    assert max(r["spe_index"] for d, r in rad.items() if d != 100) < 1.3          # no other event
    env = nasa.environment_days()
    assert len(env) == 340 and env[141]["mission"] == "RR-3" and env[141]["date"] == "2016-05-08"
    # pre-flight: the crew is on the ground, the cabin devices produce nothing
    assert nasa.gen_dosimeter(None, -10 * ingest.DAY, -1)[0] == []
    r, _ = nasa.gen_dosimeter(None, 100 * ingest.DAY, 101 * ingest.DAY)
    spe = [x for x in r if x[1] == "rad_spe_index"]
    assert len(spe) == 1 and spe[0][2] > 2.0


def test_real_data_in_health():
    h = client.get("/api/state?astronaut=ruiz").get_json()["health"]
    head = {m["id"]: m for m in h["regions"]["head"]["metrics"]}
    chest = {m["id"]: m for m in h["regions"]["chest"]["metrics"]}
    assert head["co2"]["status"] == "warning" and "RR-3" in head["co2"]["source_note"]
    assert chest["spe"]["status"] == "good" and "DOSTEL" in chest["spe"]["source_note"]
    assert 50 < chest["rad_total"]["value"] < 100            # ~0.5 mSv/day on the ISS
    assert any(len(p) for p in [chest["spe"]["series"]]) and max(p["v"] for p in chest["spe"]["series"]) > 2
    assert any(r["kind"] == "action" and r["metric"] == "co2" for r in h["recommendations"])


def test_backfill_adds_history_to_an_old_database():
    from astro import db
    conn = db.connect()
    conn.execute("DELETE FROM readings WHERE device_id IN ('dosimeter', 'cabin_env')")
    conn.execute("DELETE FROM sync_state WHERE device_id IN ('dosimeter', 'cabin_env')")
    conn.commit()
    added = ingest.backfill_new_devices(conn, server.CLOCK.now())
    assert added == ["cabin_env", "dosimeter"]
    n = conn.execute("SELECT COUNT(*) FROM readings WHERE device_id='dosimeter' AND astronaut_id='okafor'").fetchone()[0]
    assert n > 100 * 5
    assert ingest.backfill_new_devices(conn, server.CLOCK.now()) == []       # only once
    conn.close()


# ---------------------------------------------------------------- live pulse sensor

def _feed_sensor(seconds=75, hr=84, breaths_per_min=14, seed=5):
    """Pretend an Arduino has been streaming for a while: fill the sensor buffers with a made-up wave
    whose heart rate, breathing and variability are known, and mark the sensor as connected."""
    import time
    from astro import pulse, pulse_analysis
    pulse.set_paused(False)
    raw, wave = pulse_analysis.simulate(seconds, fs=50, hr=hr, rsa_hz=breaths_per_min / 60, rsa_ms=35, seed=seed)
    now = time.time()
    with pulse._lock:
        pulse._long.clear(); pulse._long_t.clear(); pulse._samples.clear()
        for i, v in enumerate(raw):
            pulse._long.append(v); pulse._long_t.append(now - seconds + i / 50)
        pulse._samples.extend(raw[-300:])
    pulse._last_record.clear()
    pulse._state.update(connected=True, connecting=False, last=time.time(), bpm=hr)
    pulse._analyse()
    return wave


def _chest(aid, metric_id):
    h = client.get(f"/api/health/{aid}").get_json()
    return next(m for m in h["regions"]["chest"]["metrics"] if m["id"] == metric_id)


def test_pulse_analysis_finds_rate_variability_and_breathing():
    import math
    import numpy as np
    from astro import pulse_analysis as pa
    for hr, br, seed in [(72, 15, 1), (58, 12, 2), (95, 18, 3)]:
        raw, wave = pa.simulate(80, fs=48.7, hr=hr, rsa_hz=br / 60, rsa_ms=35, seed=seed)   # the board runs a little slow
        v = pa.analyze(raw[-int(75 * 48.7):], 48.7)
        true = np.array(wave.ibis[-60:])
        assert v["quality"] == "good"
        assert abs(v["hr_avg"] - hr) < 1.5 and abs(v["resting_hr"] - hr) < 1.5, v
        assert abs(v["breathing_rate"] - br) < 1.5, v
        assert abs(v["hrv_rmssd"] - math.sqrt(np.mean(np.diff(true) ** 2))) < 6, v


def test_pulse_analysis_gives_nothing_without_a_pulse():
    import numpy as np
    from astro import pulse_analysis as pa
    noise = (512 + np.random.default_rng(0).normal(0, 2, 4000)).astype(int)    # sensor on the table
    v = pa.analyze(noise, 50.0)
    assert v["quality"] is None and v["resting_hr"] is None and v["hr_avg"] is None
    raw, _ = pa.simulate(5, fs=50, seed=1)                                      # too short to judge
    v = pa.analyze(raw, 50.0)
    assert not v["analyzed"] and v["resting_hr"] is None
    raw, _ = pa.simulate(20, fs=50, seed=1)                                     # a pulse, but not a minute yet
    v = pa.analyze(raw, 50.0)
    assert v["hr_avg"] and v["resting_hr"] is None and v["breathing_rate"] is None


def test_live_pulse_replaces_resting_heart_rate_and_breathing():
    before = _chest("okafor", "resting_hr")
    assert before["device"] == "biomonitor"
    _feed_sensor(hr=84, breaths_per_min=14)
    snap = client.get("/api/pulse?astronaut=okafor").get_json()
    assert snap["receiving"] and snap["recorded"] and snap["vitals"]["quality"] == "good"
    rest, br = _chest("okafor", "resting_hr"), _chest("okafor", "breathing_rate")
    assert rest["device"] == "pulse_sensor" and abs(rest["value"] - 84) <= 1.5
    assert br["device"] == "pulse_sensor" and abs(br["value"] - 14) <= 1.5
    assert rest["series"][-1]["src"] == "pulse_sensor"                  # the trend chart ends on the live point
    assert rest["status"] in ("warning", "serious")                     # 84 is far above Okafor's own baseline
    assert "pulse sensor" in rest["how"].lower()
    # stored under the live device, with HRV kept for the panel
    rows = client.get(f"/api/readings?astronaut=okafor&device=pulse_sensor&since={server.CLOCK.now() - 3600}").get_json()["readings"]
    assert {r["metric"] for r in rows} >= {"pulse_bpm", "pulse_resting_hr", "pulse_hrv_rmssd", "pulse_breathing_rate"}


def test_simulated_data_is_used_unless_a_pulse_is_really_being_read():
    from astro import pulse
    _feed_sensor(hr=84)
    assert client.get("/api/pulse?astronaut=okafor").get_json()["recorded"]
    assert _chest("okafor", "resting_hr")["device"] == "pulse_sensor"
    # finger off: the sensor keeps sending lines and its firmware repeats the last heart rate, but there are no beats
    with pulse._lock:
        pulse._long.clear(); pulse._long_t.clear()
        import time as _t
        now = _t.time()
        for i in range(75 * 50):
            pulse._long.append(512); pulse._long_t.append(now - 75 + i / 50)
    pulse._state.update(last=_t.time(), bpm=84)
    pulse._analyse()
    snap = client.get("/api/pulse?astronaut=okafor").get_json()
    assert snap["receiving"] and snap["bpm"] == 84 and not snap["reading"]
    assert _chest("okafor", "resting_hr")["device"] == "biomonitor"        # straight back to the simulated data
    # unplugged
    _feed_sensor(hr=84); assert _chest("okafor", "resting_hr")["device"] == "pulse_sensor"
    pulse._state.update(connected=False)
    assert _chest("okafor", "resting_hr")["device"] == "biomonitor"
    pulse._state.update(connected=True)


def test_live_pulse_belongs_to_one_crew_member_and_is_throttled():
    _feed_sensor(hr=84)
    assert client.get("/api/pulse?astronaut=okafor").get_json()["recorded"] is True
    assert client.get("/api/pulse?astronaut=okafor").get_json()["recorded"] is False     # stored every few seconds, not every poll
    assert _chest("okafor", "resting_hr")["device"] == "pulse_sensor"
    assert _chest("brandt", "resting_hr")["device"] == "biomonitor"                       # someone else is untouched
    assert client.get("/api/pulse").get_json()["recorded"] is False                       # no astronaut: nothing stored


def test_stopping_the_sensor_goes_back_to_simulated_values_at_once():
    _feed_sensor(hr=84)
    client.get("/api/pulse?astronaut=okafor")
    assert _chest("okafor", "resting_hr")["device"] == "pulse_sensor"
    r = client.post("/api/pulse/pause", json={"paused": True}).get_json()
    assert r["paused"] is True
    snap = client.get("/api/pulse?astronaut=okafor").get_json()
    assert snap["paused"] and not snap["receiving"] and snap["bpm"] == 0 and snap["samples"] == [] and not snap["recorded"]
    assert _chest("okafor", "resting_hr")["device"] == "biomonitor"
    assert _chest("okafor", "breathing_rate")["device"] == "biomonitor"
    client.post("/api/pulse/reset")                                                       # nothing to restart while stopped
    assert client.post("/api/pulse/pause", json={"paused": False}).get_json()["paused"] is False
    assert client.get("/api/pulse").get_json()["paused"] is False


def test_nothing_is_stored_when_no_pulse_is_felt():
    import numpy as np, time
    from astro import pulse
    pulse.set_paused(False)
    with pulse._lock:
        pulse._long.clear(); pulse._long_t.clear()
        now = time.time()
        for i, v in enumerate((512 + np.random.default_rng(1).normal(0, 2, 3000)).astype(int)):
            pulse._long.append(int(v)); pulse._long_t.append(now - 60 + i / 50)
    pulse._last_record.clear()
    pulse._state.update(connected=True, last=time.time(), bpm=70)    # the firmware keeps repeating its last BPM
    pulse._analyse()
    assert client.get("/api/pulse?astronaut=okafor").get_json()["recorded"] is False
    pulse._clear(); pulse._state.update(connected=False, bpm=0)


def test_pulse_sensor_is_listed_as_a_device():
    devs = client.get("/api/devices/okafor").get_json()
    live = [d for d in devs if d["id"] == "pulse_sensor"]
    assert len(live) == 1 and live[0]["kind"] == "live" and live[0]["sync_every"] is None
    assert "pulse_sensor" not in {b["device_id"] for b in client.post("/api/sync").get_json()["batches"]}


# ---------------------------------------------------------------- companions

def test_catalog_has_the_six_companions_with_names():
    from astro import game
    pets = {k: v for k, v in game.CATALOG.items() if v["type"] == "pet"}
    assert set(pets) == {"kitten", "puppy", "panda", "bunny", "giraffe", "koala"}
    assert pets["kitten"]["price"] == 0 and all(pets[k]["price"] > 0 for k in pets if k != "kitten")
    assert game.PET_NAMES == {"kitten": "Selene", "puppy": "Pepper", "panda": "Bao", "bunny": "Anna", "giraffe": "Jolene", "koala": "Abi"}
    st = game.default_state(0.0)
    assert st["pets"][0]["species"] == "kitten" and st["pets"][0]["name"] == "Selene"


def test_all_six_can_be_owned_and_a_seventh_is_refused():
    from astro import game
    st = game.default_state(0.0)
    st["points"] = 5000
    for sp in ("puppy", "panda", "bunny", "giraffe", "koala"):
        game.buy(st, 0.0, sp)
    assert [p["species"] for p in st["pets"]] == ["kitten", "puppy", "panda", "bunny", "giraffe", "koala"]
    assert [p["name"] for p in st["pets"]][1] == "Pepper" and [p["name"] for p in st["pets"]][3] == "Anna"   # puppy, bunny
    try:
        game.buy(st, 0.0, "kitten")
        assert False, "should refuse a duplicate"
    except game.GameError as e:
        assert "already" in str(e)
    st["pets"].pop()
    st["pets"].append({"uid": "x", "species": "kitten", "name": "x", "happiness": 50.0, "outfit": None, "toy": None, "updated_met": 0.0})
    try:
        game.buy(st, 0.0, "koala")
        assert False, "should refuse: full"
    except game.GameError as e:
        assert "six" in str(e)


def test_toy_and_outfit_can_each_be_taken_off():
    from astro import game
    st = game.default_state(0.0)
    st["points"] = 5000
    for it in ("star_ball", "scarf"):
        game.buy(st, 0.0, it)
    uid = st["pets"][0]["uid"]
    game.equip(st, 0.0, uid, "star_ball"); game.equip(st, 0.0, uid, "scarf")
    assert st["pets"][0]["toy"] == "star_ball" and st["pets"][0]["outfit"] == "scarf"
    game.equip(st, 0.0, uid, None, "toy")                       # the "can't be unclicked" bug
    assert st["pets"][0]["toy"] is None and st["pets"][0]["outfit"] == "scarf"
    game.equip(st, 0.0, uid, None, "outfit")
    assert st["pets"][0]["outfit"] is None
    game.equip(st, 0.0, uid, "star_ball"); game.equip(st, 0.0, uid, None)    # no slot: outfit, as before
    assert st["pets"][0]["toy"] == "star_ball"


def test_toy_can_be_put_away_through_the_api():
    from astro import db, game
    conn = db.connect()
    st = game.load(conn, "ruiz", server.CLOCK.now()); st["points"] = 999; game.save(conn, "ruiz", st); conn.close()
    assert client.post("/api/game/ruiz/buy", json={"item": "yarn_comet"}).status_code == 200
    uid = client.get("/api/state?astronaut=ruiz").get_json()["game"]["pets"][0]["uid"]
    r = client.post("/api/game/ruiz/equip", json={"pet": uid, "item": "yarn_comet"}).get_json()
    assert r["game"]["pets"][0]["toy"] == "yarn_comet"
    r = client.post("/api/game/ruiz/equip", json={"pet": uid, "item": None, "slot": "toy"}).get_json()
    assert r["game"]["pets"][0]["toy"] is None


def test_old_saves_with_2d_companions_are_converted():
    import json as _json
    from astro import db, game
    conn = db.connect()
    st = game.default_state(server.CLOCK.now())
    st["pets"] = [
        {"uid": "p1", "species": "comet_cat", "name": "Pixel", "happiness": 60.0, "outfit": "scarf", "toy": None, "corner": "br", "updated_met": server.CLOCK.now()},
        {"uid": "p2", "species": "axolotl", "name": "Gilly", "happiness": 80.0, "outfit": None, "toy": None, "corner": "bl", "updated_met": server.CLOCK.now()},
    ]
    game.save(conn, "menon", st)
    loaded = game.load(conn, "menon", server.CLOCK.now())
    conn.close()
    assert [(p["species"], p["name"]) for p in loaded["pets"]] == [("kitten", "Selene"), ("koala", "Gilly")]   # default name updated, a custom one kept
    assert loaded["pets"][0]["outfit"] == "scarf"



def test_companions_renamed_from_their_old_default_names():
    from astro import db, game
    conn = db.connect()
    st = game.default_state(server.CLOCK.now())
    mk = lambda uid, sp, name: {"uid": uid, "species": sp, "name": name, "happiness": 70.0, "outfit": None, "toy": None, "updated_met": server.CLOCK.now()}
    st["pets"] = [mk("a", "kitten", "Mochi"), mk("b", "puppy", "Biscuit"), mk("c", "giraffe", "Noodle"), mk("d", "koala", "Eucy"), mk("e", "panda", "Bao"), mk("f", "bunny", "Ruby"),
                  mk("g", "puppy", "Anna"), mk("h", "bunny", "Clover")]
    game.save(conn, "ruiz", st)
    names = [p["name"] for p in game.load(conn, "ruiz", server.CLOCK.now())["pets"]]
    conn.close()
    assert names == ["Selene", "Pepper", "Jolene", "Abi", "Bao", "Ruby", "Pepper", "Anna"]   # a name you chose yourself is kept


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
