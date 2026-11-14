// Hand gesture classification from MediaPipe's 21 hand landmarks.
// Works on pixel-space points ({x, y, z}) so the hand's proportions are true.

import { dist } from './geometry.js';

export const H = {
  WRIST: 0, THUMB_MCP: 2, THUMB_IP: 3, THUMB_TIP: 4,
  INDEX_MCP: 5, INDEX_PIP: 6, INDEX_TIP: 8,
  MIDDLE_MCP: 9, MIDDLE_PIP: 10, MIDDLE_TIP: 12,
  RING_MCP: 13, RING_PIP: 14, RING_TIP: 16,
  PINKY_MCP: 17, PINKY_PIP: 18, PINKY_TIP: 20,
};

export const SETTINGS = {
  // The brief: pointing = only the index finger up, all other fingers curled.
  // Set to false if thumbs are being misread on your camera.
  pointRequiresThumbTucked: true,
};

/** Which fingers are extended. A finger counts as extended when its tip is
 *  clearly further from the wrist than its middle joint. */
export function fingerStates(lm) {
  const w = lm[H.WRIST];
  const palm = dist(w, lm[H.MIDDLE_MCP]) || 1e-6;
  const ext = (tip, pip, mcp) =>
    dist(w, lm[tip]) > dist(w, lm[pip]) * 1.12 && dist(lm[tip], lm[mcp]) > palm * 0.5;
  const thumb =
    dist(lm[H.THUMB_TIP], lm[H.MIDDLE_MCP]) > palm * 0.85 &&
    dist(lm[H.THUMB_TIP], lm[H.INDEX_MCP]) > palm * 0.55;
  return {
    thumb,
    index: ext(H.INDEX_TIP, H.INDEX_PIP, H.INDEX_MCP),
    middle: ext(H.MIDDLE_TIP, H.MIDDLE_PIP, H.MIDDLE_MCP),
    ring: ext(H.RING_TIP, H.RING_PIP, H.RING_MCP),
    pinky: ext(H.PINKY_TIP, H.PINKY_PIP, H.PINKY_MCP),
    palm,
  };
}

/** 'point' | 'open' | 'fist' | 'other' */
export function classify(lm, settings = SETTINGS) {
  const f = fingerStates(lm);
  const othersCurled = !f.middle && !f.ring && !f.pinky;
  if (f.index && othersCurled && (!settings.pointRequiresThumbTucked || !f.thumb)) return 'point';
  if (f.index && f.middle && f.ring && f.pinky) return 'open';
  if (!f.index && othersCurled && !f.thumb) return 'fist';
  return 'other';
}

export function palmCenter(lm) {
  const ids = [H.WRIST, H.INDEX_MCP, H.MIDDLE_MCP, H.RING_MCP, H.PINKY_MCP];
  const s = ids.reduce((a, i) => ({ x: a.x + lm[i].x, y: a.y + lm[i].y }), { x: 0, y: 0 });
  return { x: s.x / ids.length, y: s.y / ids.length };
}

/** Holds a gesture only after it has been seen for a few frames in a row,
 *  and lets go only after it has been missing for a few frames. */
export class GestureStabilizer {
  constructor(onFrames = 3, offFrames = 4) {
    this.onFrames = onFrames; this.offFrames = offFrames;
    this.candidate = 'none'; this.count = 0; this.stable = 'none';
  }
  update(raw) {
    if (raw === this.candidate) this.count++; else { this.candidate = raw; this.count = 1; }
    const need = raw === 'none' || raw === 'other' ? this.offFrames : this.onFrames;
    if (this.count >= need) this.stable = raw;
    return this.stable;
  }
}

/** Fires once a target has been held for `ms`. progress() is 0..1. */
export class Dwell {
  constructor(ms = 800) { this.ms = ms; this.target = null; this.since = 0; this.fired = false; }
  update(target, now) {
    if (target !== this.target) { this.target = target; this.since = now; this.fired = false; return null; }
    if (target != null && !this.fired && now - this.since >= this.ms) { this.fired = true; return target; }
    return null;
  }
  progress(now) {
    if (this.target == null) return 0;
    return this.fired ? 1 : Math.min(1, (now - this.since) / this.ms);
  }
  reset() { this.target = null; this.fired = false; }
}

/** Thumb tip and index tip together (a pinch), measured against the size of the hand so it works at any distance.
 *  A little hysteresis stops it flickering, and a short grace period carries it over a frame where the hand blinks out. */
export class PinchTracker {
  constructor(enter = 0.32, leave = 0.5, grace = 8) {
    Object.assign(this, { enter, leave, grace, on: false, lost: 0, point: null });
  }

  /** lm: 21 landmarks in px, or null. Returns { on, started, point } where point is between the two fingertips. */
  update(lm) {
    let started = false;
    if (!lm) {
      if (this.on && ++this.lost > this.grace) { this.on = false; this.point = null; }
      return { on: this.on, started, point: this.point };
    }
    this.lost = 0;
    const size = dist(lm[H.WRIST], lm[H.MIDDLE_MCP]) || 1e-6, ratio = dist(lm[H.THUMB_TIP], lm[H.INDEX_TIP]) / size;
    // the index fingertip must be out from its knuckle: in a fist the thumb also sits by a curled index finger, and that is not a pinch
    const reach = dist(lm[H.INDEX_TIP], lm[H.INDEX_MCP]) / size;
    if (!this.on && ratio < this.enter && reach > 0.45) { this.on = true; started = true; }
    else if (this.on && (ratio > this.leave || reach < 0.3)) this.on = false;
    this.point = { x: (lm[H.THUMB_TIP].x + lm[H.INDEX_TIP].x) / 2, y: (lm[H.THUMB_TIP].y + lm[H.INDEX_TIP].y) / 2 };
    return { on: this.on, started, point: this.point, ratio };
  }
}
