"""What can be read from a finger pulse wave (PPG), using only the raw sensor samples.

The Arduino sketch sends one line every ~20 ms: "<raw 0-1023>,<bpm>". The firmware's BPM is
useful, but the wave itself holds more. From it this module finds each heartbeat and works out:

  * resting heart rate   median beat rate over the last minute, only while the rate is steady
  * heart-rate variability (RMSSD, SDNN)   how much the gap between beats varies
  * breathing rate       the slow rise and fall of the heart rate with each breath
                         (respiratory sinus arrhythmia), so it is an ESTIMATE
  * signal quality       share of beats that look like real beats

What a pulse sensor cannot give: SpO2 (needs red + infrared light) and a trustworthy blood
pressure. Those stay with the other devices.

Everything here is a plain function over numpy arrays, so it is easy to test.
"""
from __future__ import annotations

import math
import random

import numpy as np

MIN_IBI, MAX_IBI = 300.0, 1500.0     # ms between beats: 40 to 200 bpm
REFRACTORY_S = 0.30                  # two beats can't be closer than this
MIN_AMP = 12.0                       # ADC counts: smaller than this is noise or no finger
MIN_ANALYSIS_S = 8.0                 # need this much wave before looking for beats
WINDOW_S = 60.0                      # vitals look at the last minute
REST_MIN_S = 30.0                    # resting rate needs this much clean data
REST_STEADY_BPM = 10.0               # and the rate may not drift more than this between 10 s blocks
HRV_MIN_PAIRS = 20
BR_MIN_BEATS, BR_MIN_S = 35, 40.0
BR_BAND = (0.10, 0.50)               # Hz: 6 to 30 breaths per minute
BR_MIN_PROMINENCE = 4.0              # peak power over the median power in the band


def empty(window_s: float = 0.0, note: str = "Collecting signal…") -> dict:
    return {"analyzed": False, "quality": None, "beats": 0, "window_s": round(window_s, 1),
            "hr_avg": None, "resting_hr": None, "resting_note": note,
            "hrv_rmssd": None, "hrv_sdnn": None, "breathing_rate": None, "strength": None}


def _moving_mean(x: np.ndarray, n: float) -> np.ndarray:
    n = max(1, int(round(n)))
    if n == 1 or len(x) < n:
        return np.full(len(x), float(x.mean()) if len(x) else 0.0)
    pad = n // 2
    xp = np.pad(x, (pad, n - 1 - pad), mode="edge")
    c = np.cumsum(np.insert(xp, 0, 0.0))
    return (c[n:] - c[:-n]) / n


def detect_beats(raw, fs: float) -> dict | None:
    """Find the top of each pulse. Returns peak positions in (fractional) samples, or None
    when there isn't enough wave yet."""
    x = np.asarray(raw, dtype=float)
    if len(x) < fs * MIN_ANALYSIS_S:
        return None
    y = x - _moving_mean(x, fs * 1.5)                # remove drift
    s = _moving_mean(y, fs * 0.08)                   # light smoothing
    lo, hi = np.percentile(s, [5, 95])
    amp = float(hi - lo)
    if amp < MIN_AMP:
        return {"amp": amp, "peaks": np.array([])}
    level = lo + 0.55 * amp
    mid = s[1:-1]
    cand = np.nonzero((mid > s[:-2]) & (mid >= s[2:]) & (mid > level))[0] + 1
    refr = fs * REFRACTORY_S
    kept: list[int] = []
    for i in cand:                                   # of two peaks too close together keep the taller
        if kept and i - kept[-1] < refr:
            if s[i] > s[kept[-1]]:
                kept[-1] = int(i)
        else:
            kept.append(int(i))
    peaks = []
    for i in kept:                                   # sub-sample position: the wave is only 50 Hz
        a, b, c = s[i - 1], s[i], s[i + 1] if i + 1 < len(s) else s[i]
        den = a - 2 * b + c
        peaks.append(i + (0.5 * (a - c) / den if den < -1e-9 else 0.0))
    return {"amp": amp, "peaks": np.array(peaks)}


def analyze(raw, fs: float) -> dict:
    """Vitals from the last stretch of raw samples. `fs` is the real sample rate in Hz."""
    n = len(raw)
    out = empty(n / fs if fs else 0.0)
    det = detect_beats(raw, fs)
    if det is None:
        return out
    out["analyzed"] = True
    out["strength"] = round(det["amp"])
    peaks = det["peaks"]
    if len(peaks) < 4:
        out["quality"] = None
        out["resting_note"] = "No pulse found. Rest a finger on the sensor and hold still."
        return out

    t = peaks / fs                                   # seconds
    ibi = np.diff(t) * 1000.0                        # ms; ibi[k] ends at t[k + 1]
    ibi_t = t[1:]
    ok = (ibi >= MIN_IBI) & (ibi <= MAX_IBI)
    if ok.sum() >= 3:
        med = float(np.median(ibi[ok]))
        ok &= np.abs(ibi - med) <= 0.30 * med        # drop missed or doubled beats
    out["beats"] = int(len(peaks))
    frac = float(ok.mean())
    out["quality"] = "good" if frac >= 0.85 else "fair" if frac >= 0.6 else "weak"
    if ok.sum() < 3:
        out["quality"] = "weak"
        out["resting_note"] = "Signal is too noisy. Hold still and press the sensor gently."
        return out

    recent = ibi_t >= t[-1] - WINDOW_S
    good = ok & recent
    last = ok & (ibi_t >= t[-1] - 20.0)
    if last.sum() >= 3:
        out["hr_avg"] = round(60000.0 / float(np.mean(ibi[last])), 1)

    # heart-rate variability: only gaps between two clean, neighbouring beats count
    pair = (ok[1:] & ok[:-1]) & (ibi_t[1:] >= t[-1] - WINDOW_S)
    d = np.diff(ibi)[pair]
    if len(d) >= HRV_MIN_PAIRS:
        out["hrv_rmssd"] = round(float(math.sqrt(float(np.mean(d * d)))), 1)
        out["hrv_sdnn"] = round(float(np.std(ibi[good])), 1)

    # resting heart rate: steady rate over at least 30 s
    if good.sum() >= 25 and ibi_t[good][-1] - ibi_t[good][0] >= REST_MIN_S:
        gt, gi = ibi_t[good], ibi[good]
        blocks = [60000.0 / float(np.mean(gi[(gt >= b0) & (gt < b0 + 10)]))
                  for b0 in np.arange(gt[0], gt[-1] - 5, 10.0) if ((gt >= b0) & (gt < b0 + 10)).sum() >= 4]
        if len(blocks) >= 3 and max(blocks) - min(blocks) <= REST_STEADY_BPM:
            out["resting_hr"] = round(60000.0 / float(np.median(gi)), 1)
            out["resting_note"] = "Steady for the last minute."
        else:
            out["resting_note"] = "Heart rate is still changing. Sit still for a minute."
    else:
        out["resting_note"] = "Keep still for about 30 seconds to measure resting heart rate."

    # breathing rate from the slow wave in the beat-to-beat gaps (respiratory sinus arrhythmia)
    if good.sum() >= BR_MIN_BEATS and ibi_t[good][-1] - ibi_t[good][0] >= BR_MIN_S:
        out["breathing_rate"] = _breathing(ibi_t[good], ibi[good])
    return out


def _breathing(tb: np.ndarray, ibi: np.ndarray) -> float | None:
    grid = np.arange(tb[0], tb[-1], 0.25)            # 4 Hz
    if len(grid) < 120:
        return None
    y = np.interp(grid, tb, ibi)
    k = np.arange(len(y))
    y = y - np.polyval(np.polyfit(k, y, 1), k)       # straight-line drift out
    y = y * np.hanning(len(y))
    nfft = 2048
    power = np.abs(np.fft.rfft(y, nfft)) ** 2
    freq = np.fft.rfftfreq(nfft, 0.25)
    band = (freq >= BR_BAND[0]) & (freq <= BR_BAND[1])
    p = power[band]
    if not len(p) or float(np.median(p)) <= 0:
        return None
    peak = int(np.argmax(p))
    if p[peak] / float(np.median(p)) < BR_MIN_PROMINENCE:
        return None
    return round(float(freq[band][peak]) * 60.0, 1)


# ---------------------------------------------------------------- demo wave

def _pulse_shape(tau: float) -> float:
    """One finger pulse in ADC counts: a sharp systolic peak, then a smaller bump after the notch."""
    if tau < 0 or tau > 0.9:
        return 0.0
    return 90.0 * (math.exp(-((tau - 0.12) / 0.055) ** 2) + 0.35 * math.exp(-((tau - 0.34) / 0.08) ** 2))


class SimWave:
    """A made-up pulse sensor for demos and tests (PULSE=sim). It steps one sample at a time and
    behaves like the real one: raw wave around 512, and a BPM that updates at each beat."""

    def __init__(self, hr: float = 72.0, rsa_hz: float = 0.25, rsa_ms: float = 35.0, seed: int | None = None):
        self.rng = random.Random(seed)
        self.hr, self.rsa_hz, self.rsa_ms = hr, rsa_hz, rsa_ms
        self.t = 0.0
        self.ibis: list[float] = []                  # every inter-beat gap produced, in ms (the truth)
        self._beats = [0.0]
        self._next = 0.0
        self._advance()
        self.bpm = int(round(hr))

    def _advance(self):
        base = 60000.0 / self.hr
        ibi = base + self.rsa_ms * math.sin(2 * math.pi * self.rsa_hz * self._next) + self.rng.gauss(0, 6)
        self.ibis.append(ibi)
        self._beats = (self._beats + [self._next])[-3:]
        self._next += ibi / 1000.0

    def step(self, dt: float = 0.02) -> tuple[int, int]:
        self.t += dt
        while self.t >= self._next:
            self._advance()
            recent = self.ibis[-5:]
            self.bpm = int(round(60000.0 / (sum(recent) / len(recent))))
        v = 512.0 + sum(_pulse_shape(self.t - b) for b in self._beats) - 25
        v += 6 * math.sin(self.t * 0.35) + self.rng.gauss(0, 2.5)    # slow drift and sensor noise
        return int(max(0, min(1023, round(v)))), self.bpm


def simulate(duration_s: float, fs: float = 50.0, **kw) -> tuple[list[int], SimWave]:
    """Raw samples for `duration_s` seconds at `fs` Hz, plus the generator (its .ibis are the truth)."""
    w = SimWave(**kw)
    return [w.step(1.0 / fs)[0] for _ in range(int(duration_s * fs))], w
