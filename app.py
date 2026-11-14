"""Astronaut health copilot: Flask demo server.

Run:  python app.py      then open http://localhost:5000
"""
from __future__ import annotations

import os
import threading
import time

from flask import Flask, g, jsonify, render_template, request

from astro import db, game, health, ingest, pulse
from astro.crew import CREW, CREW_BY_ID
from astro.devices import DEVICES_BY_ID

app = Flask(__name__)

# The pulse sensor's numbers only count towards the health picture while it is really reading.
health.live_gate = pulse.is_reading     # real pulse data only while it is actually reading a pulse


def get_conn():
    if "conn" not in g:
        g.conn = db.connect()
    return g.conn


@app.teardown_appcontext
def _close(_exc):
    conn = g.pop("conn", None)
    if conn is not None:
        conn.close()


with app.app_context():
    _c = db.connect()
    if ingest.seed(_c):
        print("Seeded the database with the mission so far.")
    CLOCK = ingest.MissionClock(_c)
    _new = ingest.backfill_new_devices(_c, CLOCK.now())
    if _new:
        print("Added history for new data sources:", ", ".join(_new))
    _c.close()


def _ingest_loop(period_s=5.0):
    """Stands in for the devices: every few seconds, store whatever batches are due."""
    conn = db.connect()
    while True:
        try:
            now = CLOCK.now()
            ingest.sync_due(conn, now)
            CLOCK.save(conn)
            conn.commit()
        except Exception as exc:  # keep the demo running
            print("ingest error:", exc)
        time.sleep(period_s)


def start_ingest_thread():
    t = threading.Thread(target=_ingest_loop, daemon=True, name="device-ingest")
    t.start()
    return t


def _aid():
    aid = request.args.get("astronaut") or (request.get_json(silent=True) or {}).get("astronaut") or "okafor"
    if aid not in CREW_BY_ID:
        raise KeyError(aid)
    return aid


def clock_json(now):
    return {"met": now, "mission_day": int(now // ingest.DAY),
            "hour": (now % ingest.DAY) / ingest.HOUR, "time_scale": ingest.TIME_SCALE}


CHECKIN_METRICS = ("mood", "stress")


def _checkin_today(conn, aid, now):
    """Today's check-in entry (mission day of `now`) as {"mood": .., "stress": ..}, or None."""
    rows = conn.execute(
        "SELECT metric, value FROM readings WHERE astronaut_id=? AND device_id='crew_app' "
        "AND metric IN ('mood','stress') AND measured_met>=? AND measured_met<=? ORDER BY measured_met",
        (aid, (now // ingest.DAY) * ingest.DAY, now)).fetchall()
    vals = {r["metric"]: int(r["value"]) for r in rows}
    return vals or None


def checkin_json(conn, aid, now, st):
    """The check-in is daily: one entry per mission day. Points come with the first one each day."""
    day = int(now // ingest.DAY)
    done = st.get("last_checkin_day") == day
    return {"day": day, "done_today": done, "today": _checkin_today(conn, aid, now) if done else None,
            "next_day_met": (day + 1) * ingest.DAY}


def game_json(conn, aid, now, st=None):
    st = st or game.load(conn, aid, now)
    return {**st, "exercise_done": sorted(game.done_exercises(st, now)),
            "checkin": checkin_json(conn, aid, now, st)}


@app.errorhandler(KeyError)
def _unknown(e):
    return jsonify(error=f"Unknown crew member or item: {e}"), 404


@app.errorhandler(game.GameError)
def _game_error(e):
    return jsonify(error=str(e)), 400


@app.get("/")
def index():
    return render_template("index.html")


def state_json(conn, aid, now):
    st = game.load(conn, aid, now)
    return dict(
        clock=clock_json(now),
        crew=[{k: c[k] for k in ("id", "name", "role", "osdr_subject", "story")} for c in CREW],
        astronaut=aid,
        devices=ingest.device_status(conn, aid, now),
        health=health.summary(conn, aid, now, game.done_exercises(st, now)),
        game=game_json(conn, aid, now, st),
        catalog=game.CATALOG,
        exercises=health.EXERCISES,
    )


@app.get("/api/state")
def state():
    conn, aid, now = get_conn(), _aid(), CLOCK.now()
    return jsonify(state_json(conn, aid, now))


@app.get("/api/live")
def live():
    """What changed since mission time `since`, for the page's live loop (polled every ~5 s).

    Syncs any device batches that are now due (the same sync_due() the background thread runs),
    then returns: new batches for this astronaut with the newest value per metric in each, the
    newest reading per metric since `since` (batches plus un-batched readings such as the live
    pulse sensor and check-ins), the region statuses, and the clock. The full health summary is
    included only when something changed. Without `since` it returns the full initial state."""
    conn, now = get_conn(), CLOCK.now()
    aid = request.args.get("aid") or request.args.get("astronaut") or "okafor"
    if aid not in CREW_BY_ID:
        raise KeyError(aid)
    since = request.args.get("since", type=float)
    ingest.sync_due(conn, now)
    if since is None or since > now:              # first load, or the clock was reset behind the page
        return jsonify(full=True, **state_json(conn, aid, now))
    batches = []
    for b in conn.execute(
            "SELECT id, device_id, n_readings, n_events, window_start, window_end FROM batches "
            "WHERE astronaut_id=? AND synced_met>? AND synced_met<=? ORDER BY id", (aid, since, now)).fetchall():
        latest = conn.execute(
            "SELECT metric, value, unit, MAX(measured_met) AS measured_met FROM readings "
            "WHERE batch_id=? GROUP BY metric", (b["id"],)).fetchall()
        batches.append({**dict(b), "device": DEVICES_BY_ID[b["device_id"]]["name"],
                        "latest": {r["metric"]: dict(r) for r in latest}})
    loose = conn.execute(                          # readings that arrive outside device batches
        "SELECT device_id, metric, value, unit, MAX(measured_met) AS measured_met FROM readings "
        "WHERE astronaut_id=? AND batch_id IS NULL AND measured_met>? AND measured_met<=? GROUP BY metric",
        (aid, since, now)).fetchall()
    readings = {}
    for b in batches:
        for m, r in b["latest"].items():
            readings[m] = {**r, "device_id": b["device_id"]}
    for r in loose:
        readings[r["metric"]] = dict(r)
    st = game.load(conn, aid, now)
    summary = health.summary(conn, aid, now, game.done_exercises(st, now))
    changed = bool(readings) or any(b["n_events"] for b in batches)
    return jsonify(
        full=False, astronaut=aid, since=since, clock=clock_json(now), changed=changed,
        batches=batches, readings=readings,
        statuses={k: v["status"] for k, v in summary["regions"].items()},
        health=summary if changed else None,
    )


@app.post("/api/sync")
def sync():
    """Pull every device batch that is due. The page calls this on a timer."""
    conn, now = get_conn(), CLOCK.now()
    batches = ingest.sync_due(conn, now)
    CLOCK.save(conn)
    conn.commit()
    return jsonify(clock=clock_json(now), batches=batches)


@app.get("/api/health/<aid>")
def health_view(aid):
    conn, now = get_conn(), CLOCK.now()
    if aid not in CREW_BY_ID:
        raise KeyError(aid)
    st = game.load(conn, aid, now)
    return jsonify(health.summary(conn, aid, now, game.done_exercises(st, now)))


@app.get("/api/devices/<aid>")
def devices_view(aid):
    conn, now = get_conn(), CLOCK.now()
    return jsonify(ingest.device_status(conn, aid, now))


@app.get("/api/readings")
def readings():
    """Batched fetch for one device: readings measured in (since, until]."""
    conn, aid, now = get_conn(), _aid(), CLOCK.now()
    device = request.args.get("device", "biomonitor")
    if device not in DEVICES_BY_ID:
        raise KeyError(device)
    since = float(request.args.get("since", now - 6 * ingest.HOUR))
    until = float(request.args.get("until", now))
    limit = min(int(request.args.get("limit", 2000)), 10000)
    rows = conn.execute(
        "SELECT metric, value, unit, measured_met, batch_id FROM readings WHERE astronaut_id=? "
        "AND device_id=? AND measured_met>? AND measured_met<=? ORDER BY measured_met LIMIT ?",
        (aid, device, since, until, limit)).fetchall()
    return jsonify(device=device, since=since, until=until, clock=clock_json(now),
                   readings=[dict(r) for r in rows])


@app.post("/api/checkin/<aid>")
def checkin(aid):
    conn, now = get_conn(), CLOCK.now()
    if aid not in CREW_BY_ID:
        raise KeyError(aid)
    body = request.get_json(force=True)
    rows = []
    for key in CHECKIN_METRICS:
        if body.get(key) is not None:
            v = int(body[key])
            if not 1 <= v <= 5:
                return jsonify(error=f"{key} must be between 1 and 5"), 400
            rows.append(("crew_app", key, v, "/5", now))
    events = []
    if body.get("note"):
        events.append(("crew_app", "symptom_note", {"text": str(body["note"])[:500]}, now))
    st = game.load(conn, aid, now)
    if rows and st.get("last_checkin_day") == int(now // ingest.DAY):
        # already checked in today: the new answers replace today's entry (notes are always kept)
        conn.execute(
            "DELETE FROM readings WHERE astronaut_id=? AND device_id='crew_app' AND metric IN ('mood','stress') "
            "AND measured_met>=? AND measured_met<=?", (aid, (now // ingest.DAY) * ingest.DAY, now))
    db.insert_records(conn, aid, rows, events)
    earned = game.checkin_reward(st, now)
    game.save(conn, aid, st)
    conn.commit()
    return jsonify(earned=earned, game=game_json(conn, aid, now, st),
                   health=health.summary(conn, aid, now, game.done_exercises(st, now)))


@app.post("/api/game/<aid>/<action>")
def game_action(aid, action):
    conn, now = get_conn(), CLOCK.now()
    if aid not in CREW_BY_ID:
        raise KeyError(aid)
    body = request.get_json(force=True) if request.data else {}
    st = game.load(conn, aid, now)
    earned = 0
    if action == "buy":
        game.buy(st, now, body["item"])
    elif action == "equip":
        game.equip(st, now, body["pet"], body.get("item"), body.get("slot"))
    elif action == "feed":
        game.feed(st, now, body["pet"], body["item"])
    elif action == "pet":
        earned = game.pet_stroke(st, now, body["pet"], float(body.get("seconds", 2)))
    elif action == "complete":
        earned = game.complete_exercise(st, now, body["exercise"], body.get("reps"))
    else:
        return jsonify(error="Unknown action"), 404
    game.save(conn, aid, st)
    out = {"earned": earned, "game": game_json(conn, aid, now, st)}
    if action == "complete":
        out["health"] = health.summary(conn, aid, now, game.done_exercises(st, now))
    return jsonify(out)


@app.post("/api/clock/advance")
def advance():
    conn = get_conn()
    hours = float((request.get_json(silent=True) or {}).get("hours", 6))
    CLOCK.advance(conn, max(0.0, min(hours, 72.0)) * ingest.HOUR)
    conn.commit()
    now = CLOCK.now()
    batches = ingest.sync_due(conn, now)
    return jsonify(clock=clock_json(now), batches=batches)


@app.get("/api/pulse")
def pulse_view():
    """Live pulse sensor (Arduino over USB): latest BPM, the last ~6 s of the raw wave, and the
    vitals worked out from it. With ?astronaut=<id> the numbers are also stored for that crew
    member (every few seconds), which is how they reach the health engine."""
    snap = pulse.snapshot()
    aid = request.args.get("astronaut")
    snap["recorded"] = bool(aid in CREW_BY_ID and pulse.record(get_conn(), aid, CLOCK.now(), snap))
    return jsonify(snap)


@app.post("/api/pulse/reset")
def pulse_reset():
    return jsonify(ok=pulse.request_reset())


@app.post("/api/pulse/pause")
def pulse_pause():
    """Stop reading from the sensor ({"paused": true}) or start again ({"paused": false})."""
    paused = bool((request.get_json(silent=True) or {}).get("paused", True))
    return jsonify(ok=True, paused=pulse.set_paused(paused))


@app.post("/api/demo/reset")
def reset():
    conn = get_conn()
    ingest.reset(conn)
    health._baseline_cache.clear()
    CLOCK.set(conn, ingest.START_MET)
    conn.commit()
    return jsonify(ok=True, clock=clock_json(CLOCK.now()))


if __name__ == "__main__":
    start_ingest_thread()
    if pulse.start():
        print("Using a simulated pulse sensor (PULSE=sim)." if pulse.SIM else
              "Looking for a pulse sensor on USB serial (set PULSE=0 to turn this off).")
    port = int(os.environ.get("PORT", 5000))
    # threaded so the page's polling and actions don't queue behind each other
    app.run(host="127.0.0.1", port=port, debug=False, threaded=True)
