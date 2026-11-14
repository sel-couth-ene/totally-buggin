// Turns MediaPipe landmarks into gestures:
//   point  -> index finger out, middle/ring/pinky curled (either hand), mapped to a body part
//   pinch  -> one hand drags to rotate, two hands pull apart / together to zoom
//
// All maths is done in pixels of the camera image. "left" and "right" are the person's own sides.

export const CFG = {
  EXTENDED: 1.65,   // fingertip-to-wrist / knuckle-to-wrist ratio above which a finger counts as straight
  CURLED: 1.38,     // ratio below which a finger counts as curled
  PINCH_ON: 0.30,   // thumb-index distance (relative to palm size) that starts a pinch
  PINCH_OFF: 0.45,  // distance that ends it (hysteresis stops flicker)
  TOLERANCE: 1.35,  // enlarges every body-part region so pointing is forgiving
  REACH: 3.2,       // how far the finger ray travels, in shoulder-widths
};

const d3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const d2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/* ------------------------------------------------------------------ */
/* Hand analysis                                                      */
/* ------------------------------------------------------------------ */

export function analyzeHand(lm, w, h) {
  // z uses roughly the same scale as x, so multiply by the image width
  const p = lm.map((l) => ({ x: l.x * w, y: l.y * h, z: l.z * w }));
  const wrist = p[0];
  const ratio = (tip, knuckle) => d3(p[tip], wrist) / Math.max(1e-6, d3(p[knuckle], wrist));

  const r = { index: ratio(8, 5), middle: ratio(12, 9), ring: ratio(16, 13), pinky: ratio(20, 17) };
  const indexUp = r.index > CFG.EXTENDED && d3(p[8], wrist) > d3(p[6], wrist);
  const othersCurled = r.middle < CFG.CURLED && r.ring < CFG.CURLED && r.pinky < CFG.CURLED;
  const pointing = indexUp && othersCurled; // thumb is ignored on purpose

  const palm = Math.max(1e-6, d3(p[0], p[9]));
  const pinchRatio = d3(p[4], p[8]) / palm;

  // pointing direction on screen: knuckle -> fingertip
  const vx = p[8].x - p[5].x;
  const vy = p[8].y - p[5].y;
  const len = Math.hypot(vx, vy);
  // if the finger points at the camera it looks short; then only the fingertip itself is used
  const dir = len > 0.45 * d2(p[0], p[9]) ? { x: vx / len, y: vy / len } : null;

  return { pointing, pinchRatio, tip: { x: p[8].x, y: p[8].y }, dir, ratios: r };
}

// MediaPipe's handedness label is unreliable for un-mirrored video, so match each hand to the
// nearest pose wrist instead. Falls back to the label (inverted, because the video is not mirrored).
function assignSides(pose, handsRes, w, h) {
  const lms = handsRes.landmarks;
  const fallback = (i) => {
    const c = handsRes.handedness && handsRes.handedness[i] && handsRes.handedness[i][0]
      ? handsRes.handedness[i][0].categoryName : 'Right';
    return c === 'Left' ? 'r' : 'l';
  };
  if (!pose) return lms.map((_, i) => fallback(i));

  const wr = { l: { x: pose[15].x * w, y: pose[15].y * h }, r: { x: pose[16].x * w, y: pose[16].y * h } };
  const cost = (i, s) => d2({ x: lms[i][0].x * w, y: lms[i][0].y * h }, wr[s]);

  if (lms.length === 1) return [cost(0, 'l') <= cost(0, 'r') ? 'l' : 'r'];
  const a = cost(0, 'l') + cost(1, 'r');
  const b = cost(0, 'r') + cost(1, 'l');
  const out = a <= b ? ['l', 'r'] : ['r', 'l'];
  return lms.map((_, i) => out[i] || fallback(i));
}

/* ------------------------------------------------------------------ */
/* Body-part regions built from the 33 pose landmarks                 */
/* ------------------------------------------------------------------ */

export function buildRegions(lm, w, h) {
  const vis = (i) => (lm[i].visibility ?? 1) > 0.4;
  const P = (i) => ({ x: lm[i].x * w, y: lm[i].y * h });
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

  if (!vis(11) || !vis(12)) return null;

  const sL = P(11), sR = P(12);
  const sm = mid(sL, sR);
  const hm = vis(23) && vis(24) ? mid(P(23), P(24)) : { x: sm.x, y: sm.y + d2(sL, sR) * 1.35 };
  const s = Math.max(d2(sL, sR), d2(sm, hm) / 1.3); // body scale in pixels

  const list = [];
  const add = (id, a, b, r, joint = false) => list.push({ id, a, b, r: r * s * CFG.TOLERANCE, joint });

  // head and neck
  const earsOk = vis(7) && vis(8);
  const headC = earsOk ? mid(P(7), P(8)) : P(0);
  add('head', headC, headC, 0.42);
  const mouth = vis(9) && vis(10) ? mid(P(9), P(10)) : P(0);
  add('neck', lerp(mouth, sm, 0.5), lerp(mouth, sm, 0.85), 0.17);

  // torso, split along the shoulder-to-hip line
  const T = { x: hm.x - sm.x, y: hm.y - sm.y };
  const along = (t) => ({ x: sm.x + T.x * t, y: sm.y + T.y * t });
  add('chest', along(0.12), along(0.5), 0.5);
  add('abdomen', along(0.52), along(0.82), 0.42);
  add('pelvis', along(0.86), along(1.08), 0.42);

  const SIDES = [
    // side, shoulder, elbow, wrist, pinky, index, hip, knee, ankle, foot index
    ['l', 11, 13, 15, 17, 19, 23, 25, 27, 31],
    ['r', 12, 14, 16, 18, 20, 24, 26, 28, 32],
  ];
  for (const [sd, sho, elb, wri, pin, idx, hip, kne, ank, toe] of SIDES) {
    add(`shoulder_${sd}`, P(sho), P(sho), 0.2, true);
    if (vis(elb)) {
      add(`upper_arm_${sd}`, P(sho), P(elb), 0.15);
      add(`elbow_${sd}`, P(elb), P(elb), 0.16, true);
      if (vis(wri)) add(`forearm_${sd}`, P(elb), P(wri), 0.13);
    }
    if (vis(wri)) {
      const knuckles = vis(pin) && vis(idx) ? mid(P(pin), P(idx)) : P(wri);
      add(`hand_${sd}`, P(wri), knuckles, 0.14);
    }
    if (vis(hip) && vis(kne)) {
      add(`thigh_${sd}`, P(hip), P(kne), 0.2);
      add(`knee_${sd}`, P(kne), P(kne), 0.2, true);
      if (vis(ank)) add(`shin_${sd}`, P(kne), P(ank), 0.16);
    }
    if (vis(ank)) add(`foot_${sd}`, P(ank), vis(toe) ? P(toe) : P(ank), 0.16);
  }
  return { list, s };
}

function segDist(p, a, b) {
  const vx = b.x - a.x, vy = b.y - a.y;
  const l2 = vx * vx + vy * vy;
  let t = l2 ? ((p.x - a.x) * vx + (p.y - a.y) * vy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
}

// Walk along the finger ray, starting at the fingertip, and return the first body part it meets.
// The pointing hand's own hand and forearm are skipped, since the ray starts inside them.
function findTarget(regs, tip, dir, side) {
  const skip = new Set([`hand_${side}`, `forearm_${side}`]);
  const cands = regs.list.filter((r) => !skip.has(r.id));
  const step = regs.s * 0.06;
  const n = dir ? Math.ceil((regs.s * CFG.REACH) / step) : 0;

  for (let i = 0; i <= n; i++) {
    const pt = dir ? { x: tip.x + dir.x * step * i, y: tip.y + dir.y * step * i } : tip;
    let best = null;
    let bestScore = 1;
    for (const r of cands) {
      const sc = (segDist(pt, r.a, r.b) / r.r) * (r.joint ? 0.8 : 1); // joints win ties
      if (sc < bestScore) { bestScore = sc; best = r; }
    }
    if (best) return { id: best.id, region: best, point: pt, score: bestScore };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Engine                                                             */
/* ------------------------------------------------------------------ */

export class GestureEngine {
  constructor() {
    this.pinch = { l: false, r: false };
    this.reset();
  }

  reset() {
    this.prev = null;       // last pinch point (single-hand rotate)
    this.prevZoom = null;   // last distance between two pinch points
    this.sm = { dx: 0, dy: 0 };
    this.pinch.l = this.pinch.r = false;
  }

  /**
   * @returns {{pointers:Array, point:object|null, rotate:{dx,dy}|null, zoom:number|null, pinches:Array}}
   */
  update(pose, handsRes, w, h) {
    const out = { pointers: [], point: null, rotate: null, zoom: null, pinches: [] };
    const hands = handsRes && handsRes.landmarks ? handsRes.landmarks : [];
    if (!hands.length) { this.reset(); return out; }

    const regs = pose ? buildRegions(pose, w, h) : null;
    const sides = assignSides(pose, handsRes, w, h);
    const seen = { l: false, r: false };

    hands.forEach((lm, i) => {
      const side = sides[i];
      seen[side] = true;
      const info = analyzeHand(lm, w, h);

      // a pinch (thumb touching index tip) always wins over a pointing pose
      const was = this.pinch[side];
      const isPinch = was ? info.pinchRatio < CFG.PINCH_OFF : info.pinchRatio < CFG.PINCH_ON;
      this.pinch[side] = isPinch;
      if (isPinch) {
        out.pinches.push({
          side,
          pt: { x: ((lm[4].x + lm[8].x) / 2) * w, y: ((lm[4].y + lm[8].y) / 2) * h },
        });
      }

      if (info.pointing && !isPinch) {
        const hit = regs ? findTarget(regs, info.tip, info.dir, side) : null;
        out.pointers.push({ side, tip: info.tip, dir: info.dir, hit });
      }
    });
    for (const s of ['l', 'r']) if (!seen[s]) this.pinch[s] = false;

    out.point = out.pointers.find((p) => p.hit) || null;

    // pinch: one hand rotates, two hands zoom
    if (out.pinches.length === 1) {
      const { side, pt } = out.pinches[0];
      const x = 1 - pt.x / w;   // mirrored, so moving your hand right moves the model right
      const y = pt.y / h;
      if (this.prev && this.prev.side === side) {
        const dx = x - this.prev.x;
        const dy = y - this.prev.y;
        this.sm.dx = this.sm.dx * 0.5 + dx * 0.5;
        this.sm.dy = this.sm.dy * 0.5 + dy * 0.5;
        out.rotate = { dx: this.sm.dx, dy: this.sm.dy };
      } else {
        this.sm = { dx: 0, dy: 0 };
      }
      this.prev = { side, x, y };
      this.prevZoom = null;
    } else if (out.pinches.length >= 2) {
      const dist = d2(out.pinches[0].pt, out.pinches[1].pt);
      if (this.prevZoom) out.zoom = Math.max(0.8, Math.min(1.25, this.prevZoom / dist));
      this.prevZoom = dist;
      this.prev = null;
    } else {
      this.prev = null;
      this.prevZoom = null;
    }
    return out;
  }
}

/* ------------------------------------------------------------------ */
/* Overlay drawing (called with an un-mirrored canvas context)        */
/* ------------------------------------------------------------------ */

export function drawGestureOverlay(ctx, g, w, h, nameOf) {
  const mx = (x) => w - x; // the camera view is mirrored
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.font = '650 17px "Bricolage Grotesque", system-ui, sans-serif';
  ctx.textBaseline = 'middle';

  for (const p of g.pointers) {
    const reach = p.hit ? p.hit.point : p.dir ? { x: p.tip.x + p.dir.x * w * 0.1, y: p.tip.y + p.dir.y * w * 0.1 } : p.tip;

    if (p.hit) {
      // highlight the body part as a translucent capsule
      const r = p.hit.region;
      ctx.strokeStyle = 'rgba(122, 105, 255, 0.34)';
      ctx.lineWidth = r.r * 2;
      ctx.beginPath();
      ctx.moveTo(mx(r.a.x), r.a.y);
      ctx.lineTo(mx(r.b.x), r.b.y);
      if (r.a.x === r.b.x && r.a.y === r.b.y) ctx.lineTo(mx(r.b.x) + 0.01, r.b.y);
      ctx.stroke();
    }

    // finger ray
    ctx.setLineDash([9, 7]);
    ctx.strokeStyle = '#ffc857';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(mx(p.tip.x), p.tip.y);
    ctx.lineTo(mx(reach.x), reach.y);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = '#ffc857';
    ctx.beginPath();
    ctx.arc(mx(p.tip.x), p.tip.y, 7, 0, Math.PI * 2);
    ctx.fill();

    if (p.hit) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(mx(reach.x), reach.y, 11, 0, Math.PI * 2);
      ctx.stroke();

      const label = nameOf(p.hit.id) || p.hit.id;
      const tw = ctx.measureText(label).width;
      let lx = mx(reach.x) + 18;
      if (lx + tw + 20 > w) lx = mx(reach.x) - 18 - tw - 20;
      const ly = Math.max(20, reach.y - 22);
      ctx.fillStyle = '#4a3cf0';
      ctx.beginPath();
      ctx.roundRect(lx, ly - 15, tw + 20, 30, 8);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillText(label, lx + 10, ly + 1);
    }
  }

  for (const pn of g.pinches) {
    ctx.strokeStyle = '#ffc857';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(mx(pn.pt.x), pn.pt.y, 16, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (g.pinches.length) {
    const first = g.pinches[0].pt;
    const label = g.pinches.length > 1 ? 'Zoom' : 'Rotate';
    const tw = ctx.measureText(label).width;
    const lx = Math.min(w - tw - 24, mx(first.x) + 24);
    const ly = Math.max(20, first.y - 28);
    ctx.fillStyle = '#8a6200';
    ctx.beginPath();
    ctx.roundRect(lx, ly - 15, tw + 20, 30, 8);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText(label, lx + 10, ly + 1);
  }
  ctx.restore();
}
