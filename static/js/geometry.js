// Small geometry helpers shared by tracking, gestures and the 3D body.

export const P = {
  NOSE: 0, L_EYE: 2, R_EYE: 5, L_EAR: 7, R_EAR: 8,
  L_SHOULDER: 11, R_SHOULDER: 12, L_ELBOW: 13, R_ELBOW: 14, L_WRIST: 15, R_WRIST: 16,
  L_INDEX: 19, R_INDEX: 20, L_HIP: 23, R_HIP: 24, L_KNEE: 25, R_KNEE: 26,
  L_ANKLE: 27, R_ANKLE: 28, L_HEEL: 29, R_HEEL: 30, L_FOOT: 31, R_FOOT: 32,
};

export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, (a.z ?? 0) - (b.z ?? 0));
export const dist2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: ((a.z ?? 0) + (b.z ?? 0)) / 2 });
export const lerp = (a, b, t) => a + (b - a) * t;
export const lerpPt = (a, b, t) => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z ?? 0, b.z ?? 0, t) });
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Angle ABC in degrees (2D). */
export function angle(a, b, c) {
  const v1 = { x: a.x - b.x, y: a.y - b.y }, v2 = { x: c.x - b.x, y: c.y - b.y };
  const d = Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y);
  if (!d) return 180;
  return (Math.acos(clamp((v1.x * v2.x + v1.y * v2.y) / d, -1, 1)) * 180) / Math.PI;
}

/** Distance from point p to segment ab (2D). */
export function segDist(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const L = dx * dx + dy * dy;
  const t = L ? clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / L, 0, 1) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function pointInPoly(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/**
 * Map normalised video coords to screen pixels for a video shown with
 * object-fit: cover. Input x should already be mirrored for a selfie view.
 */
export function coverMapper(stageW, stageH, videoW, videoH) {
  const s = Math.max(stageW / videoW, stageH / videoH);
  const w = videoW * s, h = videoH * s;
  const ox = (stageW - w) / 2, oy = (stageH - h) / 2;
  return {
    scale: s, width: w, height: h, ox, oy,
    toScreen: (x, y) => ({ x: ox + x * w, y: oy + y * h }),
    toNorm: (px, py) => ({ x: (px - ox) / w, y: (py - oy) / h }),
  };
}

/** Exponential smoothing of landmark arrays, keyed by name. */
export class Smoother {
  constructor(alpha = 0.5) { this.alpha = alpha; this.prev = new Map(); }
  apply(key, pts) {
    if (!pts) { this.prev.delete(key); return pts; }
    const old = this.prev.get(key);
    if (!old || old.length !== pts.length) { this.prev.set(key, pts.map((p) => ({ ...p }))); return pts; }
    const a = this.alpha;
    const out = pts.map((p, i) => ({
      ...p,
      x: old[i].x + (p.x - old[i].x) * a,
      y: old[i].y + (p.y - old[i].y) * a,
      z: (old[i].z ?? 0) + ((p.z ?? 0) - (old[i].z ?? 0)) * a,
    }));
    this.prev.set(key, out);
    return out;
  }
}
