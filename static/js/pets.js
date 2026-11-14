// Companions: where they live, how they behave, and how they feel. Drawing is in pets3d.js.
//
// They live together at the bottom of the camera view, standing on a strip along the floor. A companion
// sits when it has nothing to do, strolls left and right along the bottom on its arms and legs, plays with
// the toy it was given, and eats the snacks you feed it. Stroke one with an open hand to pet it, or click it.
// Pick one up with the mouse (click and drag) or by pinching it between thumb and index finger and moving your
// hand: it looks shocked and confused while it is carried, and when you let go anywhere above the floor it
// drops back down and carries on. Hit its toy with your hand and it runs after it.
//
// Everything here works in screen pixels and has no browser dependencies, so it can be tested in Node.

export const MAX_PETS = 6;
const SLOT_DX = 140, SLOT_DY = 168;       // px between neighbouring spots in the bottom-right grid
const MIN_STROLL = 150;                   // px: a stroll is at least this long, so it never looks like a twitch
const WALK_SPEED = 52;                    // px/s
const TOY_BOX = { x: 62, floor: 32, top: -66 };   // toys stay in this box around a companion's spot (y points down)
const GRAVITY = 520;

const CONFETTI_S = 4.5;                   // confetti only for the first few seconds after reaching 100

/** How a companion looks, from its happiness (0 to 100).
 *  Below 30 it cries, below 50 it is sad, exactly 50 is neutral, above 50 it smiles, and above 90 it
 *  beams: eyes closed, a wide open smile, and it sits and waves. Confetti is not a mood: it falls for a
 *  few seconds when a companion first reaches 100 (see setPets). */
export function moodOf(h) {
  if (h > 90) return 'bigsmile';
  if (h > 50) return 'smile';
  if (h < 30) return 'cry';
  if (h < 50) return 'sad';
  return 'neutral';
}

const rand = (a, b) => a + Math.random() * (b - a);
/** Distance from the point (px, py) to the line segment a-b. */
function distToSegment(px, py, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  const t = l2 ? clamp(((px - a.x) * dx + (py - a.y) * dy) / l2, 0, 1) : 0;
  return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
}
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export class PetLayer {
  /** `view` draws the companions (pets3d.js). Without one (tests) everything still works. */
  constructor(canvas, onPetted, view = null) {
    this.canvas = canvas; this.view = view;
    this.onPetted = onPetted;           // (pet, seconds) => void, called every ~2 s of stroking
    this.pets = []; this.anim = new Map(); this.hearts = [];
    this.insets = { top: 96, bottom: 24, left: 16, right: 16 };
    this.cur = new Map();               // eased spot of each companion, by uid
    this.radius = 46; this.totalPetSeconds = 0;
    this.mouse = null;
    this.ptr = [];                      // pointer positions last frame, to tell how fast a hand moves
    this.reduceMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /** Where a companion may walk, as offsets from its spot (screen px): a thin strip along the floor at the
   *  bottom of the screen, from the left edge to the right edge (and left of the details panel while it is
   *  open). Never up the screen: only a companion you carry goes anywhere else. */
  roam(p = null) {
    const home = p ? this.center(p) : { x: this.W - 85, y: this.H - 108 };
    const { left, right, bottom } = this.insets;
    const xMin = left + 60, xMax = this.W - right - 60;
    const yMax = this.H - bottom - 92, yMin = yMax - 26;
    return { x0: xMin - home.x, x1: xMax - home.x, y0: yMin - home.y, y1: yMax - home.y };
  }

  /** Current screen position of a pet: its eased spot in the bottom-right grid plus its wander offset. */
  pos(p) {
    const home = this.center(p), a = this.state(p);
    return { x: home.x + a.off.x, y: home.y + a.off.y };
  }

  /** A place to stroll to along the floor: well away from here, and not on top of a neighbour. */
  pickGoal(p, a, R) {
    const home = this.center(p), others = this.pets.filter((q) => q !== p).map((q) => this.pos(q));
    let best = null, bestScore = -1;
    for (let i = 0; i < 14; i++) {
      let x;
      if (Math.random() < 0.3) x = R.x0 + Math.random() * (R.x1 - R.x0);            // now and then a trip along the whole bottom
      else {                                                                          // mostly a stroll of 150 to 380 px
        const d = MIN_STROLL + Math.random() * 230, dir = Math.random() < 0.5 ? -1 : 1;
        x = a.off.x + dir * d;
        if (x < R.x0 || x > R.x1) x = a.off.x - dir * d;                              // no room that way: go the other way
        x = clamp(x, R.x0, R.x1);
      }
      const g = { x, y: R.y0 + Math.random() * (R.y1 - R.y0) };
      const far = Math.abs(g.x - a.off.x);
      const crowd = others.some((o) => Math.abs(home.x + g.x - o.x) < 80 && Math.abs(home.y + g.y - o.y) < 60);
      const score = (crowd ? 0 : 1000) + Math.min(far, MIN_STROLL);
      if (score > bestScore) { best = g; bestScore = score; }
      if (!crowd && far >= MIN_STROLL) return g;
    }
    return best;
  }

  wander(p, a, dt, held) {
    a.moving = false;
    if (this.reduceMotion) return;
    if (held) { a.pause = Math.max(a.pause, 1.5); return; }  // stay put while being stroked
    const R = this.roam(p);
    if (a.off.x < R.x0 - 3 || a.off.x > R.x1 + 3 || a.off.y < R.y0 - 3 || a.off.y > R.y1 + 3) {
      a.goal = { x: clamp(a.off.x, R.x0, R.x1), y: clamp(a.off.y, R.y0, R.y1) };   // the area shrank (panel opened): walk back in
      a.pause = 0;
    }
    if (a.pause > 0) { a.pause -= dt; return; }
    if (!a.goal) a.goal = this.pickGoal(p, a, R);
    const dx = a.goal.x - a.off.x, dy = a.goal.y - a.off.y, dist = Math.hypot(dx, dy);
    const speed = (p.happiness < 30 ? 30 : WALK_SPEED);       // a crying companion dawdles
    if (dist < 2) { a.goal = null; a.pause = 3 + Math.random() * 6; return; }       // a good rest between strolls
    const step = Math.min(dist, speed * dt);
    a.off.x += (dx / dist) * step; a.off.y += (dy / dist) * step;
    if (Math.abs(dx) > 1) a.facing = dx < 0 ? -1 : 1;
    a.moving = true; a.walkT += dt;
  }

  setPets(pets) {
    this.pets = pets.slice(0, MAX_PETS);
    for (const p of this.pets) {
      const a = this.state(p), was = a.h;
      a.h = p.happiness;
      if (was !== undefined && was < 99.5 && p.happiness >= 99.5) {       // it just got to 100: confetti, after it has finished eating
        if (a.eat) a.confettiPending = true; else a.confettiT = CONFETTI_S;
      }
    }
  }
  setInsets(insets) { Object.assign(this.insets, insets); }

  resize(w, h, dpr) {
    this.W = w; this.H = h; this.dpr = dpr;
    this.view?.resize(w, h, dpr);
  }

  /** Where companion number `i` lives: the bottom-right corner first, then leftwards along the floor. */
  target(i) {
    const r = this.radius, { left, bottom, right } = this.insets;
    return { x: Math.max(left + 60, this.W - right - r * 1.5 - i * SLOT_DX), y: this.H - bottom - r * 2.0 };
  }

  center(p) { return this.cur.get(p.uid) || this.target(this.pets.indexOf(p)); }

  ease(dt) {
    this.pets.forEach((p, i) => {
      const tgt = this.target(i), c = this.cur.get(p.uid);
      if (!c) {                                 // a new companion slides in from the right edge
        this.cur.set(p.uid, { x: tgt.x + (this.reduceMotion ? 0 : 220), y: tgt.y });
        return;
      }
      const k = 1 - Math.exp(-dt * 6);
      c.x += (tgt.x - c.x) * k; c.y += (tgt.y - c.y) * k;
    });
  }

  hitPet(pt) {
    for (const p of this.pets) {
      const c = this.pos(p);
      if (Math.hypot(pt.x - c.x, pt.y - c.y) < this.radius * 1.35) return p;
    }
    return null;
  }

  state(p) {
    if (!this.anim.has(p.uid)) {
      this.anim.set(p.uid, { stroke: 0, unsent: 0, happyT: 0, last: null, blinkAt: Math.random() * 3,
        off: { x: 0, y: 0 }, goal: null, pause: 1 + Math.random() * 2, facing: -1, moving: false, walkT: 0,
        sit: 1, walk: 0, armsUp: 0,            // 0..1 blends the renderer eases
        play: null, act: null, toy: null, toyId: null, eat: null, chase: false,
        h: undefined, confettiT: 0, confettiPending: false, wave: 0,
        drag: null, lift: 0, swing: 0, fall: null, land: 0 });
    }
    return this.anim.get(p.uid);
  }

  /** A snack was fed to this companion: it sits, holds it to its mouth and chews. */
  fed(uid, snack = 'space_berry') {
    const p = this.pets.find((x) => x.uid === uid);
    if (!p) return;
    const a = this.state(p);
    this.endPlay(a, 0);
    a.eat = { t: 0, dur: 3.1, snack };
  }

  // ------------------------------------------------------------ picking up

  /** Pick a companion up. `source` names who holds it ('mouse', 'hand0', 'hand1'); pt is the pointer in px. */
  grab(p, pt, source) {
    const a = this.state(p);
    if (a.eat || a.drag) return false;                       // it is busy eating, or someone already has it
    const c = this.pos(p);
    a.drag = { source, ox: c.x - pt.x, oy: c.y - pt.y, target: { x: c.x, y: c.y } };
    a.fall = null; a.goal = null; a.pause = 1;
    this.endPlay(a, 0);
    return true;
  }

  /** Move whatever `source` is holding to the pointer. */
  dragTo(source, pt) {
    for (const p of this.pets) {
      const a = this.state(p);
      if (a.drag?.source !== source) continue;
      a.drag.target = { x: clamp(pt.x + a.drag.ox, 40, this.W - 40), y: clamp(pt.y + a.drag.oy, 100, this.H - 30) };
    }
  }

  holding(source) { return this.pets.find((p) => this.state(p).drag?.source === source) || null; }

  /** Let go. Above the floor it drops back down; on the floor it just stays. Either way it carries on afterwards. */
  drop(source) {
    for (const p of this.pets) {
      const a = this.state(p);
      if (a.drag?.source !== source) continue;
      a.drag = null; a.goal = null; a.pause = Math.max(a.pause, 1.5);
      const R = this.roam(p);
      if (a.off.y < R.y0 - 4) a.fall = { vy: 0 };
      else a.off.y = clamp(a.off.y, R.y0, R.y1);
    }
  }

  /** A quick click: a pat. */
  pat(p) {
    const a = this.state(p), c = this.pos(p);
    a.happyT = 0.8;
    for (let i = 0; i < 3; i++) this.hearts.push({ x: c.x + (Math.random() - 0.5) * 50, y: c.y - this.radius, age: -i * 0.1 });
    this.onPetted?.(p, 1.2);
  }

  followPointer(p, a, dt) {
    const home = this.center(p), tx = a.drag.target.x - home.x, ty = a.drag.target.y - home.y, k = 1 - Math.exp(-dt * 22);
    const swing = clamp((tx - a.off.x) * 0.006, -0.6, 0.6);
    a.off.x += (tx - a.off.x) * k; a.off.y += (ty - a.off.y) * k;
    a.swing += (swing - a.swing) * Math.min(1, dt * 10);        // it dangles and swings as you move it
  }

  stepFall(p, a, dt) {
    const R = this.roam(p), f = a.fall;
    f.vy += 2400 * dt;
    a.off.y += f.vy * dt;
    a.off.x += (clamp(a.off.x, R.x0, R.x1) - a.off.x) * Math.min(1, dt * 8);     // dropped past the edge: slide back in
    if (a.off.y >= R.y1) {
      a.off.y = R.y1; a.land = 0.28;
      if (f.vy > 420) f.vy = -f.vy * 0.28;                                         // one small bounce
      else { a.fall = null; a.pause = 1.5 + Math.random() * 2; }
    }
  }

  // ------------------------------------------------------------ toys

  syncToy(p, a) {
    if (!p.toy) {
      if (a.toy) { a.toy = null; a.toyId = null; a.play = null; a.act = null; }
      return;
    }
    if (a.toyId !== p.toy) {
      a.toyId = p.toy;
      a.toy = { x: -46, y: TOY_BOX.floor, vx: 0, vy: 0, rot: 0, spin: 0, held: false, flying: false, trail: [], cool: 0, tt: 0 };
      if (p.toy === 'mini_rocket') a.toy.rot = 1.25;
    }
  }

  stepToy(p, a, dt) {
    const toy = a.toy;
    if (!toy) return;
    toy.cool = Math.max(0, toy.cool - dt);
    toy.tt += dt;
    if (!toy.held) {
      toy.vy += GRAVITY * dt;
      toy.x += toy.vx * dt; toy.y += toy.vy * dt;
      if (toy.y > TOY_BOX.floor) {
        toy.y = TOY_BOX.floor;
        toy.vy = Math.abs(toy.vy) > 60 ? -toy.vy * 0.52 : 0;
        toy.vx *= 0.82; toy.spin *= 0.85;
      }
      if (toy.y < TOY_BOX.top) { toy.y = TOY_BOX.top; toy.vy = Math.abs(toy.vy) * 0.3; }
      const R = this.roam(p);                       // toys roll anywhere along the floor, up to the screen edges
      if (toy.x > R.x1) { toy.x = R.x1; toy.vx = -Math.abs(toy.vx) * 0.6; }
      if (toy.x < R.x0) { toy.x = R.x0; toy.vx = Math.abs(toy.vx) * 0.6; }
      if (toy.y >= TOY_BOX.floor - 0.5) toy.vx *= 1 - Math.min(1, 1.2 * dt);   // rolling friction
      if (p.toy === 'mini_rocket') toy.rot += ((toy.vx >= 0 ? 1.25 : -1.25) * (toy.y >= TOY_BOX.floor - 1 ? 1 : 0.5) - toy.rot) * Math.min(1, dt * 6);
      else toy.rot += (p.toy === 'yarn_comet' ? toy.vx / 13 : toy.spin) * dt;
    }
    if (p.toy === 'yarn_comet') {                // the loose end of the yarn follows the ball
      toy.trail.forEach((q) => { q.age += dt; });
      const last = toy.trail[toy.trail.length - 1];
      if ((Math.hypot(toy.vx, toy.vy) > 25) && (!last || Math.hypot(last.x - toy.x, last.y - toy.y) > 5)) {
        toy.trail.push({ x: toy.x, y: toy.y, age: 0 });
      }
      toy.trail = toy.trail.filter((q) => q.age < 2.6).slice(-26);
    }
  }

  /** Does a hand or the mouse hit the toy? A quick sweep knocks it away and the companion goes after it.
   *  The whole path travelled since the last frame counts, so a fast flick can't skip over the toy. */
  hitToys(dt, points) {
    const moves = points.map((q) => {
      const prev = this.ptr.reduce((best, o) => (!best || Math.hypot(o.x - q.x, o.y - q.y) < Math.hypot(best.x - q.x, best.y - q.y) ? o : best), null);
      const from = prev && Math.hypot(prev.x - q.x, prev.y - q.y) < 400 ? prev : q;
      return { from, to: q, v: { x: (q.x - from.x) / Math.max(dt, 1e-3), y: (q.y - from.y) / Math.max(dt, 1e-3) } };
    });
    for (const p of this.pets) {
      const a = this.state(p), toy = a.toy;
      if (!toy || a.eat || toy.cool > 0) continue;
      const home = this.center(p), tx = home.x + toy.x, ty = home.y + toy.y;
      for (const m of moves) {
        if (distToSegment(tx, ty, m.from, m.to) > 26 || Math.hypot(m.v.x, m.v.y) < 90) continue;
        toy.held = false; toy.flying = false; toy.cool = 0.3;
        toy.vx = clamp(m.v.x * 0.45, -240, 240);
        toy.vy = clamp(m.v.y * 0.45 - 70, -280, 60);
        toy.spin = clamp(toy.vx / 20, -9, 9);
        a.chase = true;                                       // it goes after what you knocked away (once your hand is off it)
        if (a.play) { a.play.phase = 'approach'; a.play.t = 0; a.act = null; }
        break;
      }
    }
    this.ptr = points.map((q) => ({ x: q.x, y: q.y }));
  }

  startPlay(p, a, max = null) {
    if (a.toy && Math.abs(a.toy.x - a.off.x) > 400) {      // the toy was left a long way off: it brings it out next to itself
      const R = this.roam(p), side = Math.random() < 0.5 ? -1 : 1;
      a.toy.x = clamp(a.off.x + side * 70, R.x0, R.x1); a.toy.y = TOY_BOX.floor - 20; a.toy.vx = 0; a.toy.vy = -120; a.toy.trail = [];
    }
    a.play = { phase: 'approach', t: 0, n: 0, max: max ?? 2 + Math.floor(Math.random() * 3), dir: Math.random() < 0.5 ? -1 : 1, launched: false };
  }

  endPlay(a, pause = 2 + Math.random() * 3.5) {
    a.play = null; a.act = null; a.pause = Math.max(a.pause, pause); a.goal = null;
    if (a.toy) { a.toy.held = false; a.toy.flying = false; }
  }

  /** Walk towards (x, y) (offsets from its spot, kept inside where it may walk). Returns true on arrival. */
  walkTo(p, a, x, y, dt) {
    const R = this.roam(p), tx = clamp(x, R.x0, R.x1), ty = clamp(y, R.y0, R.y1);
    const dx = tx - a.off.x, dy = ty - a.off.y, d = Math.hypot(dx, dy);
    if (d <= 3) return true;
    const step = Math.min(d, 64 * dt);
    a.off.x += (dx / d) * step; a.off.y += (dy / d) * step;
    if (Math.abs(dx) > 1) a.facing = dx < 0 ? -1 : 1;
    a.moving = true; a.walkT += dt;
    return false;
  }

  playStep(p, a, dt) {
    const pl = a.play, toy = a.toy;
    pl.t += dt; a.moving = false;
    if (!toy) { this.endPlay(a); return; }
    if (p.toy === 'mini_rocket') { this.rocketStep(p, a, dt); return; }
    if (pl.phase === 'approach') {
      if (toy.y < TOY_BOX.floor - 12) { if (pl.t > 14) this.endPlay(a); return; }    // still in the air: wait
      const dir = toy.x > 8 ? -1 : toy.x < -8 ? 1 : pl.dir;                          // knock it towards the middle
      pl.dir = dir;
      if (this.walkTo(p, a, toy.x - dir * 26, 0, dt)) { a.facing = dir; pl.phase = 'act'; pl.t = 0; pl.launched = false; }
      else if (pl.t > 14) this.endPlay(a);
    } else if (pl.phase === 'act') {
      const D = 0.62;
      a.act = { kind: p.toy === 'yarn_comet' ? 'bat' : 'kick', p: Math.min(1, pl.t / D) };
      if (!pl.launched && pl.t > D * 0.45) {
        pl.launched = true;
        if (p.toy === 'star_ball') { toy.vx = pl.dir * rand(120, 220); toy.vy = -rand(230, 320); toy.spin = pl.dir * 9; }
        else { toy.vx = pl.dir * rand(120, 210); toy.vy = -rand(90, 130); }
      }
      if (pl.t >= D) { a.act = null; pl.phase = 'watch'; pl.t = 0; }
    } else if (pl.phase === 'watch') {
      if (pl.t > 1.2) {
        pl.n++;
        if (pl.n >= pl.max) this.endPlay(a); else { pl.phase = 'approach'; pl.t = 0; }
      }
    }
  }

  rocketStep(p, a, dt) {
    const pl = a.play, toy = a.toy;
    if (pl.phase === 'approach') {
      if (toy.y < TOY_BOX.floor - 12) { if (pl.t > 6) this.endPlay(a); return; }
      if (this.walkTo(p, a, toy.x, 0, dt)) { pl.phase = 'grab'; pl.t = 0; }
      else if (pl.t > 14) this.endPlay(a);
    } else if (pl.phase === 'grab') {                // pick it up
      const D = 0.7, g = Math.min(1, pl.t / D);
      a.act = { kind: 'grab', p: g };
      if (g > 0.5) { toy.held = true; toy.x = a.off.x + 8; toy.y = TOY_BOX.floor - 10 - (g - 0.5) * 70; toy.rot += (0 - toy.rot) * Math.min(1, dt * 8); }
      if (pl.t >= D) { pl.phase = 'fly'; pl.t = 0; }
    } else if (pl.phase === 'fly') {                 // zoom it around
      const D = 3.0, w = pl.t;
      a.act = { kind: 'fly', p: Math.min(1, pl.t / D) };
      toy.held = true; toy.flying = true;
      toy.x = clamp(a.off.x + 44 * Math.sin(2.4 * w), this.roam(p).x0, this.roam(p).x1);
      toy.y = -56 + 14 * Math.sin(4.8 * w);
      toy.rot = -Math.cos(2.4 * w) * 0.75;
      if (pl.t >= D) { toy.held = false; toy.flying = false; toy.vx = 24; toy.vy = 0; a.act = null; pl.phase = 'land'; pl.t = 0; }
    } else if (pl.phase === 'land') {
      if (toy.y >= TOY_BOX.floor - 2 || pl.t > 2) this.endPlay(a);
    }
  }

  // ------------------------------------------------------------ per frame

  behave(p, a, dt, held) {
    if (a.drag || a.fall) { a.moving = false; return; }                          // being carried, or dropping
    if (a.eat) { a.moving = false; a.pause = Math.max(a.pause, 0.8); return; }
    if (held) { a.act = null; if (a.toy && !a.play) { a.toy.held = false; a.toy.flying = false; } this.wander(p, a, dt, true); return; }   // petting pauses play; it resumes after
    if (a.chase) {
      a.chase = false;
      if (a.toy && !this.reduceMotion && moodOf(p.happiness) !== 'cry' && !a.play) this.startPlay(p, a, 2);
    }
    if (a.play) { this.playStep(p, a, dt); return; }
    if (moodOf(p.happiness) === 'bigsmile') { a.moving = false; return; }       // beaming: it sits and waves unless something sets it off
    if (a.toy && !this.reduceMotion && moodOf(p.happiness) !== 'cry' && a.pause <= 0 && !a.goal && Math.random() < 0.65) {
      this.startPlay(p, a);                          // it fancies its toy
      this.playStep(p, a, dt);
      return;
    }
    this.wander(p, a, dt, false);
  }

  /** hands: [{palm:{x,y}}] in screen px. Returns true while any pet is being stroked. */
  update(dt, hands) {
    this.ease(dt);
    let stroking = false;
    const points = hands.map((h) => h.palm);
    if (this.mouse?.down) points.push(this.mouse);
    this.hitToys(dt, points);
    for (const p of this.pets) {
      const a = this.state(p), c = this.pos(p);
      this.syncToy(p, a);
      const over = a.drag ? null : points.find((q) => Math.hypot(q.x - c.x, q.y - c.y) < this.radius * 1.35);
      this.behave(p, a, dt, !!over);
      this.stepToy(p, a, dt);
      if (a.drag) this.followPointer(p, a, dt);
      else if (a.fall) this.stepFall(p, a, dt);
      a.land = Math.max(0, a.land - dt);
      let moving = false;
      if (over) {
        if (a.last) moving = Math.hypot(over.x - a.last.x, over.y - a.last.y) / Math.max(dt, 1e-3) > 60;
        a.last = { x: over.x, y: over.y };
      } else a.last = null;
      if (over && moving) {
        a.stroke += dt; a.unsent += dt; a.happyT = 0.8; stroking = true; this.totalPetSeconds += dt;
        if (Math.random() < dt * 5) this.hearts.push({ x: c.x + (Math.random() - 0.5) * 50, y: c.y - this.radius, age: 0 });
        if (a.unsent >= 2) { this.onPetted?.(p, a.unsent); a.unsent = 0; }
      } else if (a.unsent > 0.3 && !over) { this.onPetted?.(p, a.unsent); a.unsent = 0; }
      a.happyT = Math.max(0, a.happyT - dt);
      if (a.eat) {
        a.eat.t += dt;
        if (a.eat.t >= a.eat.dur) {                  // swallowed: a little celebration
          a.eat = null; a.happyT = Math.max(a.happyT, 1.2);
          if (a.confettiPending) { a.confettiPending = false; a.confettiT = CONFETTI_S; }
          for (let i = 0; i < 3; i++) this.hearts.push({ x: c.x + (Math.random() - 0.5) * 60, y: c.y - this.radius, age: -i * 0.15 });
        }
      }
      // how seated / walking / cheering it looks eases towards where the behaviour wants it
      const k = Math.min(1, dt * 6);
      const standing = a.moving || !!a.play || !!a.act || !!a.drag || !!a.fall;
      a.lift += ((a.drag ? 1 : 0) - a.lift) * Math.min(1, dt * 9);
      if (!a.drag) a.swing += (0 - a.swing) * k;
      a.sit += ((standing ? 0 : 1) - a.sit) * k;
      a.walk += ((a.moving ? 1 : 0) - a.walk) * k;
      a.armsUp += ((a.happyT > 0 && !a.eat ? 1 : 0) - a.armsUp) * k;
      const waving = moodOf(p.happiness) === 'bigsmile' && !standing && !a.eat && !(a.happyT > 0);
      a.wave += ((waving ? 1 : 0) - a.wave) * k;
      a.confettiT = Math.max(0, a.confettiT - dt);
    }
    for (const hrt of this.hearts) hrt.age += dt;
    this.hearts = this.hearts.filter((h) => h.age < 1.4);
    return stroking;
  }

  draw(t) { this.view?.render(this, t); }
}
