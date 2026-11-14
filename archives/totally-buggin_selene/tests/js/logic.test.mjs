// Unit tests for the camera-free logic. Run: node tests/js/logic.test.mjs
import assert from 'node:assert/strict';
import { classify, GestureStabilizer, Dwell, SETTINGS, PinchTracker } from '../../static/js/gestures.js';
import { buildRegions, hitTest, armForHand } from '../../static/js/regions.js';
import { SquatCounter, ArmRaiseCounter, MarchCounter } from '../../static/js/exercises.js';
import { makeHand, simFrame } from '../../static/js/sim.js';
import { coverMapper } from '../../static/js/geometry.js';
import { PetLayer, moodOf, MAX_PETS } from '../../static/js/pets.js';

const px = (pts) => pts.map((p) => ({ x: p.x * 1280, y: p.y * 720, z: 0 }));
const F = (thumb, index, middle, ring, pinky) => ({ thumb, index, middle, ring, pinky });
let n = 0;
const test = (name, fn) => { fn(); n++; console.log('ok', name); };

test('gestures at many angles', () => {
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
    const w = { x: 640, y: 360 };
    assert.equal(classify(px(makeHand(w, a, 70, F(false, true, false, false, false)))), 'point', `point @${a}`);
    assert.equal(classify(px(makeHand(w, a, 70, F(true, true, true, true, true)))), 'open', `open @${a}`);
    assert.equal(classify(px(makeHand(w, a, 70, F(false, false, false, false, false)))), 'fist', `fist @${a}`);
    // index + middle up is not pointing
    assert.notEqual(classify(px(makeHand(w, a, 70, F(false, true, true, false, false)))), 'point');
  }
});

test('thumb out blocks pointing only in strict mode', () => {
  const lm = px(makeHand({ x: 640, y: 360 }, 0.3, 70, F(true, true, false, false, false)));
  assert.equal(classify(lm), 'other');
  assert.equal(classify(lm, { ...SETTINGS, pointRequiresThumbTucked: false }), 'point');
});

test('stabilizer needs consecutive frames', () => {
  const s = new GestureStabilizer(3, 4);
  assert.equal(s.update('point'), 'none'); assert.equal(s.update('point'), 'none'); assert.equal(s.update('point'), 'point');
  assert.equal(s.update('other'), 'point'); assert.equal(s.update('point'), 'point');
  for (let i = 0; i < 3; i++) s.update('none');
  assert.equal(s.update('none'), 'none');
});

test('dwell fires once after the hold time', () => {
  const d = new Dwell(800);
  assert.equal(d.update('chest', 0), null);
  assert.equal(d.update('chest', 500), null);
  assert.equal(d.update('chest', 820), 'chest');
  assert.equal(d.update('chest', 2000), null);
  assert.equal(d.update('head', 2100), null);
});

function screenFrame(t, mode = 'script') {
  const det = simFrame(t, mode);
  const map = coverMapper(1280, 720, det.videoWidth, det.videoHeight);
  const conv = (p) => { const s = map.toScreen(1 - p.x, p.y); return { x: s.x, y: s.y, z: 0, visibility: p.visibility }; };
  return { pose: det.pose.map(conv), hands: det.hands.map((h) => h.landmarks.map(conv)) };
}

test('regions: head, chest, abdomen and arms hit where expected', () => {
  const { pose } = screenFrame(1, 'idle');
  const r = buildRegions(pose);
  const ls = pose[11], rs = pose[12], lh = pose[23];
  assert.equal(hitTest({ x: (pose[7].x + pose[8].x) / 2, y: pose[7].y }, r), 'head');
  assert.equal(hitTest({ x: (ls.x + rs.x) / 2, y: ls.y + 40 }, r), 'chest');
  assert.equal(hitTest({ x: (ls.x + rs.x) / 2, y: lh.y - 30 }, r), 'abdomen');
  assert.equal(hitTest(pose[13], r), 'left_arm');
  assert.equal(hitTest(pose[25], r), 'left_leg');
  assert.equal(hitTest({ x: 5, y: 5 }, r), null);
});

test('scripted pointing lands on the chest, excluding the pointing arm', () => {
  const { pose, hands } = screenFrame(5.5);
  assert.equal(hands.length, 1);
  const lm = hands[0];
  assert.equal(classify(lm), 'point');
  const r = buildRegions(pose);
  const arm = armForHand(lm[0], pose);
  assert.equal(arm, 'right_arm');
  assert.equal(hitTest(lm[8], r, arm), 'chest');
});

test('scripted open hand and fist', () => {
  assert.equal(classify(screenFrame(9.5).hands[0]), 'open');
  assert.equal(classify(screenFrame(12.8).hands[0]), 'fist');
});

test('squat counter', () => {
  const c = new SquatCounter();
  const legs = (kneeBend) => {
    const pts = new Array(33).fill({ x: 0, y: 0, visibility: 0.1 });
    const hip = { x: 0, y: 0, visibility: 1 };
    const knee = { x: 0, y: 100, visibility: 1 };
    const ank = { x: Math.sin(kneeBend) * 100, y: 100 + Math.cos(kneeBend) * 100, visibility: 1 };
    pts[23] = pts[24] = hip; pts[25] = pts[26] = knee; pts[27] = pts[28] = ank;
    return pts;
  };
  for (let rep = 0; rep < 3; rep++) { c.update(legs(0.1)); c.update(legs(1.5)); c.update(legs(0.1)); }
  assert.equal(c.reps, 3);
});

test('arm raise and march counters', () => {
  const base = () => { const p = new Array(33).fill(null).map(() => ({ x: 0, y: 0, visibility: 1 })); p[0] = { x: 0, y: 100, visibility: 1 }; p[11] = { x: -50, y: 200, visibility: 1 }; p[12] = { x: 50, y: 200, visibility: 1 }; return p; };
  const a = new ArmRaiseCounter();
  for (let i = 0; i < 2; i++) {
    const up = base(); up[15] = { x: -40, y: 50, visibility: 1 }; up[16] = { x: 40, y: 50, visibility: 1 }; a.update(up);
    const dn = base(); dn[15] = { x: -40, y: 300, visibility: 1 }; dn[16] = { x: 40, y: 300, visibility: 1 }; a.update(dn);
  }
  assert.equal(a.reps, 2);
  const m = new MarchCounter();
  const step = (lUp, rUp) => { const p = base(); p[23] = { x: -30, y: 400, visibility: 1 }; p[24] = { x: 30, y: 400, visibility: 1 };
    p[25] = { x: -30, y: lUp ? 430 : 520, visibility: 1 }; p[26] = { x: 30, y: rUp ? 430 : 520, visibility: 1 }; return p; };
  m.update(step(false, false));
  for (let i = 0; i < 4; i++) { m.update(step(true, false)); m.update(step(false, false)); m.update(step(false, true)); m.update(step(false, false)); }
  assert.equal(m.reps, 8);
});

// ---- companions: every one lives at the bottom right, whatever corner the server saved
const petLayer = (n, W = 1440, H = 800) => {
  const L = new PetLayer({ getContext: () => ({}) }, () => {});
  L.resize(W, H, 1);
  L.setInsets({ top: 84, bottom: 16, left: 16, right: 16 });
  L.setPets(['comet_cat', 'orbit_bot', 'moon_pup', 'nebula_jelly'].slice(0, n)
    .map((species, i) => ({ uid: `p${i}`, species, name: species, happiness: 70, corner: ['bl', 'br', 'tr', 'tl'][i] })));
  for (let k = 0; k < 200; k++) L.ease(0.05);          // let them settle
  return L;
};

test('all companions sit at the bottom right, even if the server saved other corners', () => {
  const L = petLayer(4);
  const spots = L.pets.map((p) => L.center(p));
  for (const c of spots) {
    assert.ok(c.x > L.W / 2 && c.x < L.W, `x ${c.x} is on the right half`);
    assert.ok(c.y > L.H / 2 && c.y < L.H, `y ${c.y} is on the lower half`);
  }
  assert.deepEqual([spots[0].x, spots[0].y].map(Math.round), [L.W - 16 - 69, L.H - 16 - 92]);   // the first one keeps the old corner spot
  for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) {
    assert.ok(Math.hypot(spots[i].x - spots[j].x, spots[i].y - spots[j].y) > L.radius * 2.7, `pets ${i} and ${j} don't overlap`);
  }
});

test('a newly bought companion joins the group and the others stay put', () => {
  const L = petLayer(2);
  const before = L.pets.map((p) => ({ ...L.center(p) }));
  L.setPets([...L.pets, { uid: 'p2', species: 'moon_pup', name: 'Crater', happiness: 70, corner: 'tr' }]);
  L.ease(0.016);
  assert.ok(L.center(L.pets[2]).x > L.target(2).x + 100, 'the new one starts off to the right and slides in');
  for (let k = 0; k < 200; k++) L.ease(0.05);
  L.pets.slice(0, 2).forEach((p, i) => assert.deepEqual([L.center(p).x, L.center(p).y].map(Math.round), [before[i].x, before[i].y].map(Math.round)));
  const c = L.center(L.pets[2]);
  assert.ok(c.x > L.W / 2 && c.y > L.H / 2);
});

test('companions step left of the details panel while it is open', () => {
  const L = petLayer(4);
  const open = { ...L.center(L.pets[0]) };
  L.setInsets({ right: 16 + 430 + 16 });
  for (let k = 0; k < 200; k++) L.ease(0.05);
  const shifted = L.center(L.pets[0]);
  assert.ok(Math.abs(shifted.x - (open.x - 446)) < 1 && Math.abs(shifted.y - open.y) < 1);
  assert.ok(L.pets.every((p) => L.center(p).x < L.W - 446), 'none sits under a 430 px panel');
});

test('companions only stroll along the floor at the bottom, from the left edge to the right edge', () => {
  const L = petLayer(1, 1440, 800), p = L.pets[0], a = L.state(p);
  const R = L.roam(p), home = L.center(p);
  assert.ok(R.x1 - R.x0 > 1100, 'nearly the full width');
  assert.ok(R.y1 - R.y0 <= 30 && home.y + R.y0 > 600, 'a thin strip at the bottom, never up the screen or in the middle');
  const floor = 800 - 16 - 92;
  let minX = 1e9, maxX = -1e9, walks = [], from = null, moving = 0;
  for (let k = 0; k < 40000; k++) {
    const before = { ...a.off };
    L.wander(p, a, 0.05, false);
    const pos = L.pos(p);
    minX = Math.min(minX, pos.x); maxX = Math.max(maxX, pos.x);
    if (a.moving) moving++;
    if (a.moving && !from) from = { ...before };
    if (!a.moving && from) { walks.push(Math.hypot(a.off.x - from.x, a.off.y - from.y)); from = null; }
    assert.ok(pos.x >= 60 - 3 && pos.x <= 1440 - 16 - 60 + 3 && pos.y >= floor - 26 - 3 && pos.y <= floor + 3, `${pos.x},${pos.y}`);
  }
  assert.ok(maxX - minX > 900, `covered ${maxX - minX}px of the width`);
  const median = walks.sort((x, y) => x - y)[Math.floor(walks.length / 2)];
  assert.ok(median >= 150 && walks.length > 20, `median walk ${median}px over ${walks.length} walks`);
  assert.ok(moving / 40000 > 0.25 && moving / 40000 < 0.7, `walking ${(100 * moving / 40000).toFixed(0)}% of the time`);
});

test('strolls keep out of a neighbour\'s way and step aside when the panel opens', () => {
  const L = petLayer(4);
  const close = (a, b) => Math.abs(a.x - b.x) < 80 && Math.abs(a.y - b.y) < 60;
  let overlaps = 0, samples = 0;
  for (let k = 0; k < 6000; k++) {
    L.update(0.05, []);
    L.pets.forEach((p, i) => L.pets.slice(i + 1).forEach((q) => { samples++; if (close(L.pos(p), L.pos(q))) overlaps++; }));
  }
  assert.ok(overlaps / samples < 0.3, `${(100 * overlaps / samples).toFixed(1)}% of the time two stood on each other`);
  L.setInsets({ right: 16 + 446 });                       // the details panel opens on the right
  for (let k = 0; k < 600; k++) L.update(0.05, []);
  for (const p of L.pets) assert.ok(L.pos(p).x <= 1440 - 462 - 60 + 3, `still under the panel at ${L.pos(p).x}`);
});

test('a beaming companion (above 90) sits and waves, and only moves when something sets it off', () => {
  const L = petLayer(1);
  L.setPets([{ uid: 'u0', species: 'kitten', name: 'Mochi', happiness: 95, toy: 'star_ball' }]);
  const p = L.pets[0], a = L.state(p);
  a.pause = 0; a.goal = null;
  let walked = false, played = false;
  for (let k = 0; k < 1200; k++) { L.update(0.05, []); walked ||= a.moving; played ||= !!a.play; }
  assert.ok(!walked && !played, 'no strolling or playing by itself');
  assert.ok(a.sit > 0.95 && a.wave > 0.95, `sit ${a.sit.toFixed(2)} wave ${a.wave.toFixed(2)}`);
  L.setPets([{ ...p, happiness: 70 }]);                  // happiness falls to 70: it gets up and about again
  a.pause = 0; a.goal = null;
  for (let k = 0; k < 400; k++) { L.update(0.05, []); walked ||= a.moving || !!a.play; }
  assert.ok(walked && a.wave < 0.05);
  L.setPets([{ ...p, happiness: 95 }]);                  // beaming again, but a hit toy sets it off
  a.pause = 99; a.play = null; a.toy.vx = 0; a.toy.vy = 0; a.toy.x = -46; a.toy.y = 32;
  for (let k = 0; k < 40; k++) L.update(0.05, []);
  const h = L.center(p), tx = h.x + a.toy.x, ty = h.y + a.toy.y;
  for (let i = 0; i < 8; i++) L.update(0.05, [{ palm: { x: tx - 90 + i * 28, y: ty - 4 } }]);
  let chased = false;
  for (let k = 0; k < 100; k++) { L.update(0.05, []); chased ||= !!a.play; }
  assert.ok(chased, 'a triggered companion still plays');
});

test('confetti falls for a few seconds when a companion first reaches 100, not while it stays there', () => {
  const L = petLayer(1);
  const set = (h) => L.setPets([{ uid: 'u0', species: 'kitten', name: 'Mochi', happiness: h }]);
  set(100);                                              // first seen already at 100 (page load): no confetti
  const a = L.state(L.pets[0]);
  assert.equal(a.confettiT, 0);
  set(80); set(100);                                     // reached 100
  assert.ok(a.confettiT > 4 && a.confettiT <= 5);
  for (let k = 0; k < 40; k++) L.update(0.05, []);       // 2 s later: still falling
  assert.ok(a.confettiT > 2);
  for (let k = 0; k < 80; k++) L.update(0.05, []);       // 6 s later: over, and it stays over
  assert.equal(a.confettiT, 0);
  set(100); set(100);
  assert.equal(a.confettiT, 0);
  set(99.0); set(100);                                   // drained a little and topped up again: confetti again
  assert.ok(a.confettiT > 4);
  a.confettiT = 0; set(60); L.fed('u0', 'space_berry'); set(100);   // fed up to 100: confetti waits until it has eaten
  assert.equal(a.confettiT, 0); assert.ok(a.confettiPending);
  for (let k = 0; k < 70; k++) L.update(0.05, []);
  assert.ok(a.confettiT > 0 && !a.confettiPending);
});

test('a companion can be stroked where it lives', () => {
  const L = petLayer(3);
  for (const p of L.pets) assert.equal(L.hitPet(L.pos(p)), p);
  assert.equal(L.hitPet({ x: 100, y: 100 }), null);
});

test('mood follows happiness: cry below 30, sad below 50, smile above 50, beaming above 90', () => {
  const cases = [[0, 'cry'], [29.9, 'cry'], [30, 'sad'], [49.9, 'sad'], [50, 'neutral'], [50.1, 'smile'], [90, 'smile'],
    [90.1, 'bigsmile'], [99.4, 'bigsmile'], [99.6, 'bigsmile'], [100, 'bigsmile']];
  for (const [h, mood] of cases) assert.equal(moodOf(h), mood, `happiness ${h}`);
});

test('six companions fit and each gets its own spot at the bottom right', () => {
  assert.equal(MAX_PETS, 6);
  const L = petLayer(4);
  L.setPets(['kitten', 'puppy', 'panda', 'bunny', 'giraffe', 'koala'].map((species, i) => ({ uid: `u${i}`, species, name: species, happiness: 70 })));
  for (let k = 0; k < 200; k++) L.ease(0.05);
  const spots = L.pets.map((p) => L.center(p));
  assert.equal(new Set(spots.map((c) => `${Math.round(c.x)},${Math.round(c.y)}`)).size, 6);
  for (const c of spots) assert.ok(c.x > 0 && c.y > L.H / 2);
  L.setPets([...L.pets, { uid: 'u7', species: 'kitten', name: 'x', happiness: 70 }]);
  assert.equal(L.pets.length, 6, 'a seventh is ignored');
});

const withToy = (toy, happiness = 75) => {
  const L = petLayer(1);
  L.setPets([{ uid: 'u0', species: 'kitten', name: 'Mochi', happiness, toy }]);
  for (let k = 0; k < 60; k++) L.update(0.05, []);
  return { L, p: L.pets[0], a: L.state(L.pets[0]) };
};

test('a companion plays with its star ball: walks over, kicks it up and sees it bounce', () => {
  const { L, p, a } = withToy('star_ball');
  L.startPlay(p, a, 3);                                  // start the session directly: when it fancies a game is random
  const phases = new Set(); let top = 0, kicked = false;
  for (let k = 0; k < 800; k++) {
    L.update(0.05, []);
    if (a.play) phases.add(a.play.phase);
    if (a.act?.kind === 'kick') kicked = true;
    if (a.toy) top = Math.max(top, 32 - a.toy.y);
  }
  assert.ok(['approach', 'act', 'watch'].every((x) => phases.has(x)), [...phases].join());
  assert.ok(kicked && top > 40 && top < 100, `ball flew ${top}px up`);
  const R = L.roam(L.pets[0]);
  assert.ok(a.toy.y <= 32 && a.toy.x >= R.x0 - 1 && a.toy.x <= R.x1 + 1, 'the ball stays on the floor strip');
});

test('the rocket is picked up and flown around, the yarn is batted and leaves a trail', () => {
  const r = withToy('mini_rocket'); r.L.startPlay(r.p, r.a, 3);
  let flew = false, armsUp = false;
  for (let k = 0; k < 900; k++) { r.L.update(0.05, []); flew ||= !!r.a.toy?.flying; armsUp ||= r.a.act?.kind === 'fly'; }
  assert.ok(flew && armsUp);
  const y = withToy('yarn_comet'); y.L.startPlay(y.p, y.a, 3);
  let trail = 0, bat = false;
  for (let k = 0; k < 800; k++) { y.L.update(0.05, []); trail = Math.max(trail, y.a.toy?.trail.length || 0); bat ||= y.a.act?.kind === 'bat'; }
  assert.ok(bat && trail >= 3, `trail ${trail}`);
});

test('a crying companion does not play', () => {
  const { L, a } = withToy('star_ball', 20);
  a.pause = 0; a.goal = null;
  for (let k = 0; k < 600; k++) L.update(0.05, []);
  assert.equal(a.play, null);
});

test('sweeping a hand through the toy knocks it away and the companion chases it', () => {
  const { L, p, a } = withToy('star_ball');
  a.pause = 99; a.play = null; a.toy.vx = 0; a.toy.vy = 0; a.toy.x = -46; a.toy.y = 32;
  for (let k = 0; k < 20; k++) L.update(0.05, []);
  const h = L.center(p), tx = h.x + a.toy.x, ty = h.y + a.toy.y;
  let hit = false;
  for (let i = 0; i < 8; i++) {                         // a hand crossing the ball at about 600 px/s
    L.update(0.05, [{ palm: { x: tx - 90 + i * 28, y: ty - 4 } }]);
    hit ||= Math.abs(a.toy.vx) > 50;
  }
  assert.ok(hit, 'the ball was knocked');
  let chased = false;
  for (let k = 0; k < 120; k++) { L.update(0.05, []); chased ||= !!a.play; }
  assert.ok(chased, 'and the companion goes after it');
  const slow = withToy('star_ball');                     // a hand that barely moves does nothing
  slow.a.pause = 99; slow.a.toy.vx = 0;
  const hh = slow.L.center(slow.p);
  for (let i = 0; i < 10; i++) slow.L.update(0.05, [{ palm: { x: hh.x + slow.a.toy.x + i * 0.5, y: hh.y + slow.a.toy.y } }]);
  assert.ok(Math.abs(slow.a.toy.vx) < 5);
});

test('feeding: it sits, chews for about three seconds, then cheers', () => {
  const { L, p, a } = withToy(null);
  a.pause = 0; a.goal = null;
  L.fed('u0', 'space_berry');
  assert.ok(a.eat && a.eat.snack === 'space_berry');
  let still = true;
  for (let k = 0; k < 40; k++) { L.update(0.05, []); still &&= !a.moving; }
  assert.ok(still && a.eat, 'holds still while eating');
  for (let k = 0; k < 40; k++) L.update(0.05, []);
  assert.equal(a.eat, null);
  assert.ok(a.happyT > 0, 'cheers when done');
  L.fed('nobody', 'space_berry');                       // an unknown companion is ignored
});

test('a pinch is thumb tip on index tip, and a fist or a pointing hand is not one', () => {
  const open = px(makeHand({ x: 640, y: 360 }, 0.3, 70, F(true, true, true, true, true)));
  const pt = new PinchTracker();
  assert.ok(!pt.update(open).on);
  const touch = (gap) => { const h = open.map((q) => ({ ...q })); h[4] = { ...h[8], x: h[8].x + gap, y: h[8].y + gap }; return h; };
  let r = pt.update(touch(2));
  assert.ok(r.on && r.started, 'thumb on index tip starts a pinch');
  assert.ok(Math.abs(r.point.x - (open[8].x + 1)) < 3 && Math.abs(r.point.y - (open[8].y + 1)) < 3, 'the point is between the fingertips');
  r = pt.update(touch(2)); assert.ok(r.on && !r.started, 'it only starts once');
  assert.ok(pt.update(touch(20)).on, 'a slightly looser pinch is still a pinch (no flicker)');
  assert.ok(!pt.update(touch(60)).on, 'opening the fingers ends it');
  assert.ok(!new PinchTracker().update(px(makeHand({ x: 640, y: 360 }, 0.3, 70, F(false, true, false, false, false)))).on, 'pointing');
  assert.ok(!new PinchTracker().update(px(makeHand({ x: 640, y: 360 }, 0.3, 70, F(false, false, false, false, false)))).on, 'a fist closes panels, it must not pick things up');
  const held = new PinchTracker(); held.update(touch(2));
  for (let i = 0; i < 8; i++) assert.ok(held.update(null).on, 'a hand that blinks out for a moment keeps hold');
  assert.ok(!held.update(null).on, 'but not for long');
});

test('carrying a companion: it follows the pointer anywhere on screen, then drops to the floor and carries on', () => {
  const L = petLayer(1), p = L.pets[0], a = L.state(p), floor = 800 - 16 - 92;
  for (let k = 0; k < 20; k++) L.update(0.05, []);
  const start = L.pos(p);
  assert.ok(L.grab(p, { x: start.x + 5, y: start.y - 10 }, 'mouse'));
  assert.equal(L.holding('mouse'), p);
  assert.ok(!L.grab(p, { x: start.x, y: start.y }, 'hand0'), 'only one holder at a time');
  L.dragTo('mouse', { x: 700, y: 300 });
  for (let k = 0; k < 30; k++) L.update(0.05, []);
  let pos = L.pos(p);
  assert.ok(Math.abs(pos.x - 695) < 8 && Math.abs(pos.y - 310) < 8, `carried to ${pos.x},${pos.y}`);
  assert.ok(a.lift > 0.9 && !a.moving, 'dangling, not walking');
  L.dragTo('mouse', { x: -500, y: -500 });
  for (let k = 0; k < 30; k++) L.update(0.05, []);
  pos = L.pos(p); assert.ok(pos.x >= 40 - 8 && pos.y >= 100 - 8, 'it cannot be carried off the screen');
  L.dragTo('mouse', { x: 700, y: 300 });
  for (let k = 0; k < 30; k++) L.update(0.05, []);
  L.drop('mouse');
  assert.ok(a.fall && !a.drag, 'let go above the floor: it falls');
  let landed = false;
  for (let k = 0; k < 60; k++) { L.update(0.05, []); landed ||= a.land > 0; if (landed && !a.fall) break; }
  pos = L.pos(p);
  assert.ok(landed && !a.fall && Math.abs(pos.y - floor) < 1.5 && Math.abs(pos.x - 695) < 10, `landed at ${pos.x},${pos.y}`);
  assert.ok(a.lift < 0.05, 'its usual self again');
  a.pause = 0; a.goal = null;
  let walked = false;
  for (let k = 0; k < 300; k++) { L.update(0.05, []); walked ||= a.moving; }
  assert.ok(walked, 'and it strolls along the floor again');
});

test('a companion put down on the floor stays there; one that is eating cannot be picked up', () => {
  const L = petLayer(1), p = L.pets[0], a = L.state(p);
  for (let k = 0; k < 20; k++) L.update(0.05, []);
  const c = L.pos(p);
  L.grab(p, c, 'hand0');
  L.dragTo('hand0', { x: c.x - 300, y: c.y });
  for (let k = 0; k < 30; k++) L.update(0.05, []);
  L.drop('hand0');
  assert.ok(!a.fall, 'nothing to fall');
  for (let k = 0; k < 5; k++) L.update(0.05, []);
  assert.ok(Math.abs(L.pos(p).x - (c.x - 300)) < 10 && Math.abs(L.pos(p).y - c.y) < 3);
  L.fed('p0', 'space_berry');
  assert.ok(!L.grab(p, L.pos(p), 'mouse'), 'busy eating');
  const q = petLayer(2);
  const qa = q.state(q.pets[0]);
  q.grab(q.pets[0], q.pos(q.pets[0]), 'mouse'); q.pat(q.pets[1]);
  assert.ok(qa.drag && q.state(q.pets[1]).happyT > 0, 'patting another one does not drop the one being carried');
});

test('a companion that wandered far from its toy brings it out and plays, instead of walking back for ages', () => {
  const { L, p, a } = withToy('star_ball');
  const R = L.roam(p);
  a.off.x = R.x0 + 60; a.toy.x = R.x1 - 60; a.toy.y = 32;            // far apart along the floor
  a.pause = 0; a.goal = null; a.play = null;
  L.startPlay(p, a, 2);
  assert.ok(Math.abs(a.toy.x - a.off.x) < 100, 'the toy is brought next to it');
  let kicked = false;
  for (let k = 0; k < 400; k++) { L.update(0.05, []); kicked ||= a.act?.kind === 'kick'; }
  assert.ok(kicked, 'and it plays');
  for (let k = 0; k < 4000; k++) { L.update(0.05, []); assert.ok(a.toy.x >= R.x0 - 1 && a.toy.x <= R.x1 + 1); }
});

console.log(`\n${n} tests passed`);
