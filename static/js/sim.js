// Synthetic tracking for demos and testing without a camera.
// Produces landmarks in the same shape MediaPipe returns (normalised, not
// mirrored). mode 'idle' just breathes and sways; mode 'script' acts out the
// main interactions on a loop: point at the chest, turn the model with an open
// hand, close with a fist, then pet the companion in the bottom-right corner.

const VW = 1280, VH = 720;

function lm(x, y, z = 0, visibility = 0.98) { return { x, y, z, visibility }; }

const ease = (t) => (t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t));
const mix = (a, b, t) => a + (b - a) * t;
const mixPt = (a, b, t) => ({ x: mix(a.x, b.x, t), y: mix(a.y, b.y, t) });

/** 21 hand landmarks. wrist & palm length in px; angle = wrist→fingers direction. */
export function makeHand(wrist, angleRad, palmPx, f, thumbSide = 1) {
  const u = { x: Math.cos(angleRad), y: Math.sin(angleRad) };
  const v = { x: -u.y * thumbSide, y: u.x * thumbSide };
  const at = (a, b) => ({ x: wrist.x + (u.x * a + v.x * b) * palmPx, y: wrist.y + (u.y * a + v.y * b) * palmPx });
  const pts = new Array(21);
  pts[0] = at(0, 0);
  // thumb
  pts[1] = at(0.25, 0.25);
  if (f.thumb) { pts[2] = at(0.42, 0.5); pts[3] = at(0.5, 0.75); pts[4] = at(0.55, 1.0); }
  else { pts[2] = at(0.4, 0.35); pts[3] = at(0.6, 0.22); pts[4] = at(0.75, 0.06); }
  const fingers = [[5, 0.95, 0.32, f.index], [9, 1.0, 0.1, f.middle], [13, 0.95, -0.12, f.ring], [17, 0.85, -0.32, f.pinky]];
  for (const [i, a, b, ext] of fingers) {
    pts[i] = at(a, b);
    if (ext) { pts[i + 1] = at(a + 0.45, b); pts[i + 2] = at(a + 0.73, b); pts[i + 3] = at(a + 0.97, b); }
    else { pts[i + 1] = at(a + 0.3, b); pts[i + 2] = at(a + 0.15, b); pts[i + 3] = at(a - 0.05, b); }
  }
  return pts.map((p) => lm(p.x / VW, p.y / VH, 0));
}

const OPEN = { thumb: true, index: true, middle: true, ring: true, pinky: true };
const POINT = { thumb: false, index: true, middle: false, ring: false, pinky: false };
const FIST = { thumb: false, index: false, middle: false, ring: false, pinky: false };
const RELAX = { thumb: true, index: true, middle: true, ring: false, pinky: false };

/** Body in raw image px. Subject's left appears at larger x (camera view). */
function body(t) {
  const sway = Math.sin(t * 0.9) * 6, breath = Math.sin(t * 1.6) * 2;
  const cx = VW / 2 + sway;
  const p = {
    nose: { x: cx, y: 175 }, lEar: { x: cx + 42, y: 168 }, rEar: { x: cx - 42, y: 168 },
    lEye: { x: cx + 18, y: 160 }, rEye: { x: cx - 18, y: 160 },
    lSh: { x: cx + 105, y: 300 + breath }, rSh: { x: cx - 105, y: 300 + breath },
    lHip: { x: cx + 62, y: 545 }, rHip: { x: cx - 62, y: 545 },
    lKnee: { x: cx + 66, y: 690 }, rKnee: { x: cx - 66, y: 690 },
    lAnk: { x: cx + 66, y: 830 }, rAnk: { x: cx - 66, y: 830 },
  };
  p.lElb = { x: p.lSh.x + 22, y: 420 }; p.rElb = { x: p.rSh.x - 22, y: 420 };
  p.lWr = { x: p.lSh.x + 28, y: 535 }; p.rWr = { x: p.rSh.x - 28, y: 535 };
  return p;
}

/** Returns {pose, world, hands, face} for time t (seconds). */
export function simFrame(t, mode = 'idle') {
  const b = body(t);
  let rWr = b.rWr, rElb = b.rElb;
  const lWr = b.lWr, lElb = b.lElb;
  let rHand = null;
  const lHand = null;
  if (mode === 'script') {
    const T = t % 32;
    // right arm: up to point at the chest, open palm swipes, then a fist
    const chest = { x: b.nose.x + 25, y: 370 };
    let k = 0;
    if (T >= 3 && T < 4.5) k = ease((T - 3) / 1.5);
    else if (T >= 4.5 && T < 13.5) k = 1;
    else if (T >= 13.5 && T < 15) k = 1 - ease((T - 13.5) / 1.5);
    const target = { x: chest.x - 175, y: chest.y + 10 };
    if (T >= 8 && T < 12) target.x += Math.sin((T - 8) * Math.PI) * 90;
    rWr = mixPt(b.rWr, target, k);
    rElb = mixPt(b.rElb, { x: b.rSh.x - 40, y: 470 }, k);
    let gesture = RELAX, angle = mix(Math.PI / 2, 0.15, k);
    if (k > 0.6) gesture = T < 7 ? POINT : T < 12 ? OPEN : FIST;
    // then reach to the bottom-right of the mirrored view and stroke the companion
    let j = 0;
    if (T >= 15 && T < 16.5) j = ease((T - 15) / 1.5);
    else if (T >= 16.5 && T < 20) j = 1;
    else if (T >= 20 && T < 21.5) j = 1 - ease((T - 20) / 1.5);
    if (j > 0) {
      const stroke = T >= 16.5 && T < 20 ? Math.sin(T * 7) * 32 : 0;
      rWr = mixPt(b.rWr, { x: 85 + stroke, y: VH - 82 }, j);
      rElb = mixPt(b.rElb, { x: b.rSh.x - 190, y: 520 }, j);
      angle = mix(Math.PI / 2, -Math.PI / 2, j);
      gesture = j > 0.6 ? OPEN : RELAX;
    }
    // finally pinch the companion at the bottom right between thumb and index finger, carry it to the middle and let go
    let pinchHand = null;
    if (T >= 24 && T < 31.5) {
      const P0 = { x: 85, y: VH - 100 }, P1 = { x: 470, y: 400 };
      const reach = T < 25.2 ? ease((T - 24) / 1.2) : T < 30 ? 1 : 1 - ease((T - 30) / 1.5);
      const carry = T < 25.8 ? 0 : T < 28.6 ? ease((T - 25.8) / 2.8) : 1;
      const pinching = T >= 25.4 && T < 28.9;
      const rest = makeHand(b.rWr, Math.PI / 2, 70, RELAX, -1), restTip = { x: rest[8].x * VW, y: rest[8].y * VH };
      const tip = mixPt(restTip, mixPt(P0, P1, carry), reach), ang = mix(Math.PI / 2, -Math.PI / 2, reach);
      const mk = (w) => makeHand(w, ang, 70, reach > 0.6 ? OPEN : RELAX, -1);
      let w = { x: tip.x, y: tip.y + 130 }, h = mk(w);
      w = { x: w.x + tip.x - h[8].x * VW, y: w.y + tip.y - h[8].y * VH }; h = mk(w);
      if (pinching) h[4] = { ...h[8], x: h[8].x + 0.004, y: h[8].y + 0.004 };       // thumb tip onto index tip
      rWr = mixPt(b.rWr, w, reach);
      rElb = mixPt(b.rElb, { x: mix(345, 430, carry), y: mix(520, 570, carry) }, reach);
      pinchHand = h;
    }
    rHand = pinchHand || makeHand(rWr, angle, 70, gesture, -1);
  }
  const n = (p, vis = 0.98) => lm(p.x / VW, p.y / VH, 0, vis);
  const pose = new Array(33).fill(null).map(() => lm(0.5, 0.5, 0, 0.1));
  pose[0] = n(b.nose); pose[2] = n(b.lEye); pose[5] = n(b.rEye); pose[7] = n(b.lEar); pose[8] = n(b.rEar);
  pose[11] = n(b.lSh); pose[12] = n(b.rSh); pose[13] = n(lElb); pose[14] = n(rElb);
  pose[15] = n(lWr); pose[16] = n(rWr);
  const tipOf = (hand, wr) => (hand ? { x: hand[8].x * VW, y: hand[8].y * VH } : { x: wr.x, y: wr.y + 40 });
  pose[19] = n(tipOf(lHand, lWr)); pose[20] = n(tipOf(rHand, rWr));
  pose[23] = n(b.lHip); pose[24] = n(b.rHip); pose[25] = n(b.lKnee, 0.8); pose[26] = n(b.rKnee, 0.8);
  pose[27] = n(b.lAnk, 0.2); pose[28] = n(b.rAnk, 0.2);
  // rough world landmarks in metres around the hips
  const hipC = { x: (b.lHip.x + b.rHip.x) / 2, y: (b.lHip.y + b.rHip.y) / 2 };
  const m = 0.36 / 210; // shoulder width 0.36 m ≈ 210 px
  const world = pose.map((p) => ({ x: (p.x * VW - hipC.x) * m, y: (p.y * VH - hipC.y) * m, z: 0, visibility: p.visibility }));
  if (mode === 'script') { world[16].z = -0.25; world[14].z = -0.12; }
  const hands = [];
  if (rHand) hands.push({ landmarks: rHand, handedness: 'Right' });
  if (lHand) hands.push({ landmarks: lHand, handedness: 'Left' });
  return { pose, world, hands, face: null, videoWidth: VW, videoHeight: VH };
}
