// Rep counting from pose landmarks (screen px) for the recommended exercises.

import { P, angle, dist2 } from './geometry.js';

const VIS = 0.5;
const seen = (pts, ...ids) => pts && ids.every((i) => pts[i] && (pts[i].visibility ?? 1) >= VIS);

export class SquatCounter {
  constructor() { this.reps = 0; this.phase = 'up'; this.hint = ''; }
  update(pts) {
    const legs = [[P.L_HIP, P.L_KNEE, P.L_ANKLE], [P.R_HIP, P.R_KNEE, P.R_ANKLE]].filter((l) => seen(pts, ...l));
    if (!legs.length) { this.hint = 'Step back so your knees and ankles are in view.'; return this; }
    const a = legs.reduce((s, [h, k, an]) => s + angle(pts[h], pts[k], pts[an]), 0) / legs.length;
    this.angle = a;
    if (this.phase === 'up' && a < 115) { this.phase = 'down'; this.hint = 'Now stand up tall.'; }
    else if (this.phase === 'down' && a > 155) { this.phase = 'up'; this.reps++; this.hint = 'Good. Sit back and down again.'; }
    else if (this.phase === 'up') this.hint = 'Sit back and bend your knees.';
    return this;
  }
}

export class ArmRaiseCounter {
  constructor() { this.reps = 0; this.phase = 'down'; this.hint = ''; }
  update(pts) {
    if (!seen(pts, P.NOSE, P.L_SHOULDER, P.R_SHOULDER, P.L_WRIST, P.R_WRIST)) {
      this.hint = 'Make sure both hands are in view.'; return this;
    }
    const top = pts[P.NOSE].y;
    const sh = Math.max(pts[P.L_SHOULDER].y, pts[P.R_SHOULDER].y);
    const up = pts[P.L_WRIST].y < top && pts[P.R_WRIST].y < top;
    const down = pts[P.L_WRIST].y > sh && pts[P.R_WRIST].y > sh;
    if (this.phase === 'down' && up) { this.phase = 'up'; this.hint = 'Lower to shoulder height.'; }
    else if (this.phase === 'up' && down) { this.phase = 'down'; this.reps++; this.hint = 'Reach up again.'; }
    else if (this.phase === 'down') this.hint = 'Reach both hands above your head.';
    return this;
  }
}

export class MarchCounter {
  constructor() { this.reps = 0; this.last = null; this.thigh = 0; this.hint = ''; }
  update(pts) {
    if (!seen(pts, P.L_HIP, P.R_HIP, P.L_KNEE, P.R_KNEE)) { this.hint = 'Step back so your knees are in view.'; return this; }
    const lt = dist2(pts[P.L_HIP], pts[P.L_KNEE]), rt = dist2(pts[P.R_HIP], pts[P.R_KNEE]);
    this.thigh = Math.max(this.thigh * 0.995, lt, rt);       // standing thigh length
    const lifted = (hip, knee) => pts[knee].y - pts[hip].y < this.thigh * 0.55;
    const l = lifted(P.L_HIP, P.L_KNEE), r = lifted(P.R_HIP, P.R_KNEE);
    const side = l && !r ? 'L' : r && !l ? 'R' : null;
    if (side && side !== this.last) { this.last = side; this.reps++; }
    this.hint = 'Lift each knee towards hip height in turn.';
    return this;
  }
}

/** Timed exercise that only runs while the person is in view. */
export class PresenceTimer {
  constructor(durationS) { this.duration = durationS; this.elapsed = 0; this.hint = ''; }
  update(pts, dtS) {
    if (seen(pts, P.L_SHOULDER, P.R_SHOULDER)) { this.elapsed += dtS; this.hint = ''; }
    else this.hint = 'Paused: step back into view.';
    return this;
  }
  get done() { return this.elapsed >= this.duration; }
}

export function makeCounter(exercise) {
  if (exercise.kind === 'reps') {
    return { squats: new SquatCounter(), arm_raises: new ArmRaiseCounter(), march: new MarchCounter() }[exercise.id];
  }
  if (exercise.kind === 'timer') return new PresenceTimer(exercise.duration_s);
  return null;
}

/** Box breathing phase for the guide animation. */
export function breathPhase(elapsedS) {
  const phases = ['Breathe in', 'Hold', 'Breathe out', 'Hold'];
  const i = Math.floor(elapsedS / 4) % 4;
  return { label: phases[i], t: (elapsedS % 4) / 4, index: i };
}
