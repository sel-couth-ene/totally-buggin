// Body regions in screen space, built from pose landmarks, for hit-testing a
// fingertip (or mouse) against the user's own body in the camera image.

import { P, dist2, mid, lerpPt, segDist, pointInPoly } from './geometry.js';

export const REGION_OF_PART = {
  head: 'head', neck: 'neck', chest: 'chest', abdomen: 'abdomen',
  left_arm: 'arms', right_arm: 'arms', left_leg: 'legs', right_leg: 'legs',
};

const VIS = 0.5;
const seen = (pts, ...ids) => ids.every((i) => pts[i] && (pts[i].visibility ?? 1) >= VIS);

/** pts: 33 pose landmarks in screen px. Returns shapes for each body part. */
export function buildRegions(pts) {
  if (!pts || !seen(pts, P.L_SHOULDER, P.R_SHOULDER)) return null;
  const ls = pts[P.L_SHOULDER], rs = pts[P.R_SHOULDER];
  const shW = Math.max(dist2(ls, rs), 20);
  const shMid = mid(ls, rs);
  const hipsSeen = seen(pts, P.L_HIP, P.R_HIP);
  // If the hips are out of frame, assume a typical torso length.
  const lh = hipsSeen ? pts[P.L_HIP] : { x: ls.x - shW * 0.05, y: ls.y + shW * 1.45 };
  const rh = hipsSeen ? pts[P.R_HIP] : { x: rs.x + shW * 0.05, y: rs.y + shW * 1.45 };
  const out = { shoulderWidth: shW, parts: {} };

  // head: circle around the ears (or nose)
  const earsSeen = seen(pts, P.L_EAR, P.R_EAR);
  const headC = earsSeen ? mid(pts[P.L_EAR], pts[P.R_EAR]) : (seen(pts, P.NOSE) ? pts[P.NOSE] : { x: shMid.x, y: shMid.y - shW * 0.75 });
  const headR = Math.max(earsSeen ? dist2(pts[P.L_EAR], pts[P.R_EAR]) * 0.75 : 0, shW * 0.36);
  out.parts.head = { type: 'circle', c: headC, r: headR };

  // neck: from the shoulder line up to the bottom of the head circle
  const neckTop = { x: headC.x, y: headC.y + headR * 0.75 };
  out.parts.neck = { type: 'capsule', a: { x: shMid.x, y: shMid.y - shW * 0.02 }, b: neckTop, r: shW * 0.17 };

  // chest and abdomen: the torso quad split at 45% of the way to the hips
  const pad = shW * 0.08;
  const lsP = { x: ls.x + Math.sign(ls.x - rs.x) * pad, y: ls.y }, rsP = { x: rs.x + Math.sign(rs.x - ls.x) * pad, y: rs.y };
  const lMid = lerpPt(lsP, lh, 0.45), rMid = lerpPt(rsP, rh, 0.45);
  const lLow = lerpPt(ls, lh, 1.1), rLow = lerpPt(rs, rh, 1.1);
  out.parts.chest = { type: 'poly', pts: [lsP, rsP, rMid, lMid] };
  out.parts.abdomen = { type: 'poly', pts: [lMid, rMid, rLow, lLow] };

  // arms: capsules along upper arm, forearm and hand
  for (const side of ['left', 'right']) {
    const S = side === 'left' ? [P.L_SHOULDER, P.L_ELBOW, P.L_WRIST, P.L_INDEX] : [P.R_SHOULDER, P.R_ELBOW, P.R_WRIST, P.R_INDEX];
    const segs = [];
    if (seen(pts, S[0], S[1])) segs.push([pts[S[0]], pts[S[1]], shW * 0.17]);
    if (seen(pts, S[1], S[2])) segs.push([pts[S[1]], pts[S[2]], shW * 0.15]);
    if (seen(pts, S[2], S[3])) segs.push([pts[S[2]], pts[S[3]], shW * 0.14]);
    if (segs.length) out.parts[`${side}_arm`] = { type: 'capsules', segs };
    const L = side === 'left' ? [P.L_HIP, P.L_KNEE, P.L_ANKLE] : [P.R_HIP, P.R_KNEE, P.R_ANKLE];
    const lsegs = [];
    if (seen(pts, L[0], L[1])) lsegs.push([pts[L[0]], pts[L[1]], shW * 0.22]);
    if (seen(pts, L[1], L[2])) lsegs.push([pts[L[1]], pts[L[2]], shW * 0.17]);
    if (lsegs.length) out.parts[`${side}_leg`] = { type: 'capsules', segs: lsegs };
  }
  return out;
}

function inside(p, shape) {
  switch (shape.type) {
    case 'circle': return dist2(p, shape.c) <= shape.r;
    case 'capsule': return segDist(p, shape.a, shape.b) <= shape.r;
    case 'poly': return pointInPoly(p, shape.pts);
    case 'capsules': return shape.segs.some(([a, b, r]) => segDist(p, a, b) <= r);
    default: return false;
  }
}

const ORDER = ['head', 'neck', 'chest', 'abdomen', 'left_arm', 'right_arm', 'left_leg', 'right_leg'];

/** Which body part is under point p. `exclude` skips the pointing arm. */
export function hitTest(p, regions, exclude = null) {
  if (!regions || !p) return null;
  for (const name of ORDER) {
    if (name === exclude) continue;
    const shape = regions.parts[name];
    if (shape && inside(p, shape)) return name;
  }
  return null;
}

/** The pose arm whose wrist is closest to a hand's wrist. */
export function armForHand(handWrist, pts) {
  if (!pts) return null;
  const l = pts[P.L_WRIST], r = pts[P.R_WRIST];
  const dl = l ? dist2(handWrist, l) : Infinity, dr = r ? dist2(handWrist, r) : Infinity;
  return dl <= dr ? 'left_arm' : 'right_arm';
}
