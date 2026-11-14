"""Mission clock, first-run seeding, and batched device sync.

The mission clock runs faster than real time (TIME_SCALE) so the demo shows
devices syncing within minutes. It is saved to the database, so stopping the
server pauses the mission instead of skipping ahead.
"""
from __future__ import annotations

import json
import threading
import time

from . import db, synth
from .crew import CREW, CREW_BY_ID
from .devices import DEVICES, SYNCED_DEVICES

DAY = 86400.0
HOUR = 3600.0
TIME_SCALE = 60.0                     # 1 real second = 1 mission minute
START_MET = 141 * DAY + 10 * HOUR     # demo opens on mission day 141, 10:00
HISTORY_FROM = -95 * DAY              # covers the earliest pre-flight blood draw
ACTIWATCH_EPOCH_DAYS = 7              # keep raw 10-min epochs for the last week only

_lock = threading.Lock()


class MissionClock:
    def __init__(self, conn):
        self.anchor_met = db.get_meta(conn, "clock_met", START_MET)
        self.anchor_real = time.time()

    def now(self) -> float:
        return self.anchor_met + (time.time() - self.anchor_real) * TIME_SCALE

    def save(self, conn):
        db.set_meta(conn, "clock_met", self.now())

    def set(self, conn, met: float):
        self.anchor_met, self.anchor_real = met, time.time()
        self.save(conn)

    def advance(self, conn, seconds: float):
        self.set(conn, self.now() + seconds)


def backfill_new_devices(conn, until_met: float):
    """A database seeded before a device existed has no history for it. Fill that gap once, so
    adding a data source (like the real NASA radiation and cabin feeds) doesn't need a reset."""
    added = []
    for d in DEVICES:
        conn.execute("INSERT OR REPLACE INTO devices VALUES (?,?,?,?,?,?)",
                     (d["id"], d["name"], d["kind"], d["sync_every"], d["collects"], d["how"]))
    for dev, gen in synth.GENERATORS.items():
        for p in CREW:
            if conn.execute("SELECT 1 FROM sync_state WHERE device_id=? AND astronaut_id=?",
                            (dev, p["id"])).fetchone():
                continue
            r, e = gen(p, HISTORY_FROM, until_met)
            db.insert_records(conn, p["id"], r, e, batch_id=None)
            conn.execute("INSERT OR REPLACE INTO sync_state VALUES (?,?,?)", (dev, p["id"], until_met))
            added.append(dev)
    conn.commit()
    return sorted(set(added))


def seed(conn, until_met: float = START_MET):
    """Fill the database with the mission so far. Runs once."""
    if db.get_meta(conn, "seeded"):
        return False
    for d in DEVICES:
        conn.execute("INSERT OR REPLACE INTO devices VALUES (?,?,?,?,?,?)",
                     (d["id"], d["name"], d["kind"], d["sync_every"], d["collects"], d["how"]))
    for p in CREW:
        conn.execute("INSERT OR REPLACE INTO astronauts VALUES (?,?,?,?,?)",
                     (p["id"], p["name"], p["role"], p["osdr_subject"], json.dumps(p)))
        for dev, gen in synth.GENERATORS.items():
            if dev == "actiwatch":
                r, e = gen(p, HISTORY_FROM, until_met,
                           epochs_from=until_met - ACTIWATCH_EPOCH_DAYS * DAY)
            else:
                r, e = gen(p, HISTORY_FROM, until_met)
            db.insert_records(conn, p["id"], r, e, batch_id=None)
            conn.execute("INSERT OR REPLACE INTO sync_state VALUES (?,?,?)", (dev, p["id"], until_met))
        r, e = synth.gen_crew_app_history(p, HISTORY_FROM, until_met)
        db.insert_records(conn, p["id"], r, e, batch_id=None)
    db.set_meta(conn, "seeded", True)
    db.set_meta(conn, "clock_met", until_met)
    conn.commit()
    return True


def sync_due(conn, now_met: float, astronaut_ids=None):
    """Pull a batch from every device whose sync interval has elapsed."""
    batches = []
    ids = astronaut_ids or [p["id"] for p in CREW]
    with _lock:
        for dev in SYNCED_DEVICES:
            gen = synth.GENERATORS[dev["id"]]
            for aid in ids:
                row = conn.execute("SELECT last_met FROM sync_state WHERE device_id=? AND astronaut_id=?",
                                   (dev["id"], aid)).fetchone()
                last = row["last_met"] if row else now_met
                if now_met - last < dev["sync_every"]:
                    continue
                readings, events = gen(CREW_BY_ID[aid], last, now_met)
                cur = conn.execute(
                    "INSERT INTO batches(device_id, astronaut_id, window_start, window_end, "
                    "n_readings, n_events, synced_met) VALUES (?,?,?,?,?,?,?)",
                    (dev["id"], aid, last, now_met, len(readings), len(events), now_met))
                bid = cur.lastrowid
                db.insert_records(conn, aid, readings, events, batch_id=bid)
                conn.execute("INSERT OR REPLACE INTO sync_state VALUES (?,?,?)", (dev["id"], aid, now_met))
                batches.append({"batch_id": bid, "device_id": dev["id"], "device": dev["name"],
                                "astronaut_id": aid, "window_start": last, "window_end": now_met,
                                "n_readings": len(readings), "n_events": len(events)})
        conn.commit()
    return batches


def device_status(conn, astronaut_id: str, now_met: float):
    out = []
    for d in DEVICES:
        row = conn.execute("SELECT last_met FROM sync_state WHERE device_id=? AND astronaut_id=?",
                           (d["id"], astronaut_id)).fetchone()
        last_data = conn.execute(
            "SELECT MAX(measured_met) AS t FROM readings WHERE astronaut_id=? AND device_id=?",
            (astronaut_id, d["id"])).fetchone()["t"]
        active = None
        if d["id"] == "biomonitor":
            active = synth.in_session(now_met, synth.biomonitor_sessions())
        elif d["id"] == "thermomini":
            active = synth.in_session(now_met, synth.thermomini_sessions())
        nxt = (row["last_met"] + d["sync_every"]) if (row and d["sync_every"]) else None
        out.append({**d, "last_sync_met": row["last_met"] if row else None, "next_sync_met": nxt,
                    "last_data_met": last_data, "session_active": active})
    return out


def reset(conn):
    for t in ("readings", "events", "batches", "sync_state", "game", "meta", "astronauts", "devices"):
        conn.execute(f"DELETE FROM {t}")
    conn.commit()
    seed(conn)
