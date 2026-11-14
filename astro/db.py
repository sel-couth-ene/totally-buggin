"""SQLite storage. One file, created on first run."""
from __future__ import annotations

import json
import os
import sqlite3
import tempfile
from pathlib import Path


def _default_db_path() -> Path:
    """instance/astro_health.db next to the code, unless that folder can't be written to.

    Serverless hosts (Vercel, AWS Lambda) only allow writing to /tmp, so the database goes there
    instead. ASTRO_DB always wins."""
    if os.environ.get("ASTRO_DB"):
        return Path(os.environ["ASTRO_DB"])
    local = Path(__file__).resolve().parents[1] / "instance"
    serverless = os.environ.get("VERCEL") or os.environ.get("AWS_LAMBDA_FUNCTION_NAME")
    if not serverless:
        try:
            local.mkdir(parents=True, exist_ok=True)
            if os.access(local, os.W_OK):
                return local / "astro_health.db"
        except OSError:
            pass
    return Path(tempfile.gettempdir()) / "astro_health.db"


DB_PATH = _default_db_path()

SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS astronauts (
  id TEXT PRIMARY KEY, name TEXT, role TEXT, osdr_subject TEXT, profile_json TEXT);
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY, name TEXT, kind TEXT, sync_every_s REAL, collects TEXT, how TEXT);
CREATE TABLE IF NOT EXISTS batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT, device_id TEXT, astronaut_id TEXT,
  window_start REAL, window_end REAL, n_readings INTEGER, n_events INTEGER,
  synced_met REAL, synced_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS readings (
  id INTEGER PRIMARY KEY, astronaut_id TEXT, device_id TEXT, metric TEXT,
  value REAL, unit TEXT, measured_met REAL, batch_id INTEGER);
CREATE INDEX IF NOT EXISTS idx_readings_metric ON readings(astronaut_id, metric, measured_met);
CREATE INDEX IF NOT EXISTS idx_readings_device ON readings(astronaut_id, device_id, measured_met);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY, astronaut_id TEXT, device_id TEXT, type TEXT,
  payload TEXT, measured_met REAL, batch_id INTEGER);
CREATE INDEX IF NOT EXISTS idx_events ON events(astronaut_id, type, measured_met);
CREATE TABLE IF NOT EXISTS sync_state (
  device_id TEXT, astronaut_id TEXT, last_met REAL, PRIMARY KEY (device_id, astronaut_id));
CREATE TABLE IF NOT EXISTS game (astronaut_id TEXT PRIMARY KEY, state_json TEXT);
"""


def connect(path: Path | None = None) -> sqlite3.Connection:
    p = Path(path or DB_PATH)
    p.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(p, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.executescript(SCHEMA)
    return conn


def get_meta(conn, key, default=None):
    row = conn.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
    return json.loads(row["value"]) if row else default


def set_meta(conn, key, value):
    conn.execute("INSERT INTO meta(key, value) VALUES(?, ?) "
                 "ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key, json.dumps(value)))


def insert_records(conn, astronaut_id, readings, events, batch_id=None):
    conn.executemany(
        "INSERT INTO readings(astronaut_id, device_id, metric, value, unit, measured_met, batch_id) "
        "VALUES (?,?,?,?,?,?,?)",
        [(astronaut_id, d, m, v, u, t, batch_id) for d, m, v, u, t in readings])
    conn.executemany(
        "INSERT INTO events(astronaut_id, device_id, type, payload, measured_met, batch_id) "
        "VALUES (?,?,?,?,?,?)",
        [(astronaut_id, d, ty, json.dumps(pl), t, batch_id) for d, ty, pl, t in events])
