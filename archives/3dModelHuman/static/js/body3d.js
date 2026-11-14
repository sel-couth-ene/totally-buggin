// 3D mannequin built from primitives (no model file needed), with a smooth orbit camera.
// Conventions: the model faces +z, its LEFT side is +x. theta = 0 means the camera is in front.
import * as THREE from 'three';

const ACCENT = 0x4a3cf0;
const SKIN = 0xe7dac7;
const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

// Where to look from for each part: azimuth (degrees, towards the model's left for left-side
// parts and mirrored for right-side parts) and polar angle (90 = level with the part).
const FOCUS = {
  head:      { az: 0,  pol: 84 },
  neck:      { az: 0,  pol: 84 },
  chest:     { az: 0,  pol: 86 },
  abdomen:   { az: 0,  pol: 88 },
  pelvis:    { az: 0,  pol: 90 },
  shoulder:  { az: 35, pol: 82 },
  upper_arm: { az: 50, pol: 86 },
  elbow:     { az: 65, pol: 88 },
  forearm:   { az: 55, pol: 88 },
  hand:      { az: 40, pol: 80 },
  thigh:     { az: 35, pol: 88 },
  knee:      { az: 40, pol: 90 },
  shin:      { az: 40, pol: 90 },
  foot:      { az: 40, pol: 78 },
};

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const nearestAngle = (cur, target) => target + TAU * Math.round((cur - target) / TAU);
const V = (x, y, z = 0) => new THREE.Vector3(x, y, z);

export class Body3D {
  /**
   * @param {HTMLElement} container
   * @param {{onPick?:(id:string)=>void, getOffset?:()=>{x:number,y:number}}} opts
   */
  constructor(container, opts = {}) {
    this.container = container;
    this.opts = opts;
    this.parts = new Map();
    this.selected = null;
    this.hover = null;
    this.baseRadius = 4;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.05, 50);
    this.raycaster = new THREE.Raycaster();

    this.cur = { theta: 0.35, phi: 1.4, radius: 4, tx: 0, ty: 0.93, tz: 0 };
    this.goal = { ...this.cur };

    this._lights();
    this._plate();
    this._build();
    this._events();

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    this.overview(true);

    this._last = performance.now();
    requestAnimationFrame(this._tick);
  }

  /* ---------------- public API ---------------- */

  /** Rotate and zoom to a body part. */
  focus(id) {
    const p = this.parts.get(id);
    if (!p) return;
    const base = id.replace(/_[lr]$/, '');
    const side = id.endsWith('_l') ? 1 : id.endsWith('_r') ? -1 : 0;
    const f = FOCUS[base] || { az: 0, pol: 85 };

    this.selected = id;
    this.goal.tx = p.center.x;
    this.goal.ty = p.center.y;
    this.goal.tz = p.center.z;
    this.goal.radius = clamp(p.size * 3.0, 0.75, 3.0);
    this.goal.theta = nearestAngle(this.goal.theta, side * f.az * DEG);
    this.goal.phi = f.pol * DEG;
    this._refresh();
  }

  /** Back to the whole body, seen from the front. */
  overview(instant = false) {
    this.selected = null;
    Object.assign(this.goal, {
      tx: 0, ty: 0.93, tz: 0,
      radius: this.baseRadius,
      theta: nearestAngle(this.goal.theta, 0),
      phi: 1.4,
    });
    if (instant) Object.assign(this.cur, this.goal);
    this._refresh();
  }

  /** Rotate by a normalised hand movement (1 = full width / height of the camera image). */
  dragBy(dx, dy) {
    this.goal.theta -= dx * 3.6;
    this.goal.phi = clamp(this.goal.phi - dy * 2.4, 0.25, Math.PI - 0.25);
  }

  /** factor < 1 zooms in, > 1 zooms out. */
  zoomBy(factor) {
    this.goal.radius = clamp(this.goal.radius * factor, 0.5, 6);
  }

  setSelected(id) {
    this.selected = id;
    this._refresh();
  }

  resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;

    const off = this.opts.getOffset ? this.opts.getOffset() : { x: 0, y: 0 };
    if (off.x || off.y) {
      this.camera.setViewOffset(w, h, -off.x * w, off.y * h, w, h);
    } else {
      this.camera.clearViewOffset();
    }
    this.camera.updateProjectionMatrix();

    this.baseRadius = Math.max(3.75, 2.1 / this.camera.aspect);
    if (!this.selected) this.goal.radius = this.baseRadius;
  }

  /* ---------------- scene ---------------- */

  _lights() {
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xb4c1ce, 1.0));
    const key = new THREE.DirectionalLight(0xffffff, 1.8);
    key.position.set(2.5, 3.5, 3);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xb9ccff, 0.7);
    fill.position.set(-3, 1.5, 2);
    this.scene.add(fill);
    const rim = new THREE.DirectionalLight(0xffffff, 0.9);
    rim.position.set(0, 2.5, -3.5);
    this.scene.add(rim);
  }

  _plate() {
    const g = new THREE.Group();

    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(1.0, 96),
      new THREE.MeshBasicMaterial({ color: 0xf5f8fb, transparent: true, opacity: 0.8 })
    );
    disc.rotation.x = -Math.PI / 2;
    g.add(disc);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.985, 1.0, 128),
      new THREE.MeshBasicMaterial({ color: 0x13202b, transparent: true, opacity: 0.55, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.0005;
    g.add(ring);

    // degree ticks around the plate, longer every 30 degrees
    const pts = [];
    for (let a = 0; a < 360; a += 5) {
      const r0 = 1.0;
      const r1 = a % 30 === 0 ? 1.08 : 1.035;
      const c = Math.cos(a * DEG), s = Math.sin(a * DEG);
      pts.push(c * r0, 0.001, s * r0, c * r1, 0.001, s * r1);
    }
    const tickGeo = new THREE.BufferGeometry();
    tickGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    g.add(new THREE.LineSegments(
      tickGeo,
      new THREE.LineBasicMaterial({ color: 0x13202b, transparent: true, opacity: 0.5 })
    ));

    // soft contact shadow
    const cv = document.createElement('canvas');
    cv.width = cv.height = 128;
    const cx = cv.getContext('2d');
    const grad = cx.createRadialGradient(64, 64, 4, 64, 64, 62);
    grad.addColorStop(0, 'rgba(19,32,43,0.38)');
    grad.addColorStop(1, 'rgba(19,32,43,0)');
    cx.fillStyle = grad;
    cx.fillRect(0, 0, 128, 128);
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(0.95, 0.6),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.002;
    g.add(shadow);

    this.scene.add(g);
  }

  _build() {
    const model = new THREE.Group();
    this.model = model;
    this.scene.add(model);

    const sphere = new THREE.SphereGeometry(1, 40, 28);
    const dark = new THREE.MeshStandardMaterial({ color: 0x1b2430, roughness: 0.4 });

    const part = (id) => {
      const group = new THREE.Group();
      group.name = id;
      model.add(group);
      const mat = new THREE.MeshStandardMaterial({ color: SKIN, roughness: 0.62, metalness: 0.02 });
      mat.emissive = new THREE.Color(ACCENT);
      mat.emissiveIntensity = 0;
      const rec = {
        id, group, mat, mats: [mat],
        cur: { op: 1, em: 0 }, target: { op: 1, em: 0 },
        center: new THREE.Vector3(), size: 0.3,
      };
      this.parts.set(id, rec);
      return rec;
    };

    const ellipsoid = (rec, c, r, mat = rec.mat, parent = rec.group) => {
      const m = new THREE.Mesh(sphere, mat);
      m.position.copy(c);
      m.scale.set(r[0], r[1], r[2]);
      m.userData.part = rec.id;
      parent.add(m);
      return m;
    };

    // a stretched ellipsoid running from a to b (looks like a muscle, overlaps neighbours at the joints)
    const spindle = (rec, a, b, rx, rz = rx, parent = rec.group) => {
      const dir = b.clone().sub(a);
      const len = dir.length();
      const m = new THREE.Mesh(sphere, rec.mat);
      m.position.copy(a).add(b).multiplyScalar(0.5);
      m.scale.set(rx, len / 2 + rx * 0.6, rz);
      m.quaternion.setFromUnitVectors(V(0, 1, 0), dir.normalize());
      m.userData.part = rec.id;
      parent.add(m);
      return m;
    };

    /* torso and head (centre line) */
    const pelvis = part('pelvis');
    ellipsoid(pelvis, V(0, 0.95, 0), [0.175, 0.115, 0.105]);
    const abdomen = part('abdomen');
    ellipsoid(abdomen, V(0, 1.14, 0), [0.15, 0.115, 0.092]);
    const chest = part('chest');
    ellipsoid(chest, V(0, 1.34, 0), [0.195, 0.165, 0.108]);
    const neck = part('neck');
    spindle(neck, V(0, 1.5, 0), V(0, 1.62, 0), 0.048);

    const head = part('head');
    ellipsoid(head, V(0, 1.71, 0.005), [0.093, 0.118, 0.1]);
    ellipsoid(head, V(0, 1.685, 0.1), [0.013, 0.021, 0.02]);               // nose
    for (const s of [1, -1]) {
      ellipsoid(head, V(s * 0.036, 1.725, 0.087), [0.0095, 0.0095, 0.0095], dark); // eyes
      ellipsoid(head, V(s * 0.094, 1.705, 0), [0.011, 0.026, 0.018]);          // ears
    }

    /* limbs, built once per side. Left = +x. */
    for (const [sgn, sfx] of [[1, 'l'], [-1, 'r']]) {
      const P = (x, y, z = 0) => V(x * sgn, y, z);

      const sh = part(`shoulder_${sfx}`);
      ellipsoid(sh, P(0.205, 1.455), [0.062, 0.062, 0.062]);
      spindle(sh, P(0.03, 1.525), P(0.195, 1.47), 0.04);

      const ua = part(`upper_arm_${sfx}`);
      spindle(ua, P(0.205, 1.455), P(0.30, 1.18), 0.05);

      const el = part(`elbow_${sfx}`);
      ellipsoid(el, P(0.30, 1.18), [0.044, 0.044, 0.044]);

      const fa = part(`forearm_${sfx}`);
      spindle(fa, P(0.30, 1.18), P(0.37, 0.92), 0.041);

      // hand: palm and fingers hang along the forearm direction, palm facing the thigh
      const hd = part(`hand_${sfx}`);
      const hg = new THREE.Group();
      hg.position.copy(P(0.372, 0.915));
      hg.quaternion.setFromUnitVectors(V(0, -1, 0), P(0.37, 0.92).sub(P(0.30, 1.18)).normalize());
      hd.group.add(hg);
      ellipsoid(hd, V(0, -0.045, 0), [0.017, 0.05, 0.034], hd.mat, hg);
      const fingers = [[0.024, 0.07], [0.008, 0.078], [-0.008, 0.072], [-0.024, 0.058]];
      for (const [z, len] of fingers) {
        spindle(hd, V(0, -0.085, z), V(0, -0.085 - len, z), 0.0105, 0.0105, hg);
      }
      spindle(hd, V(0, -0.03, 0.03), V(0, -0.085, 0.058), 0.012, 0.012, hg); // thumb

      const th = part(`thigh_${sfx}`);
      spindle(th, P(0.095, 0.95), P(0.115, 0.53), 0.086);

      const kn = part(`knee_${sfx}`);
      ellipsoid(kn, P(0.115, 0.52, 0.01), [0.06, 0.06, 0.06]);

      const sn = part(`shin_${sfx}`);
      spindle(sn, P(0.115, 0.52), P(0.125, 0.11), 0.056);

      const ft = part(`foot_${sfx}`);
      ellipsoid(ft, P(0.125, 0.10), [0.042, 0.042, 0.042]);                   // ankle
      ellipsoid(ft, P(0.125, 0.04, 0.055), [0.05, 0.04, 0.115]);              // foot
    }

    // part centres and sizes, used by focus()
    model.updateMatrixWorld(true);
    const box = new THREE.Box3();
    const size = new THREE.Vector3();
    for (const rec of this.parts.values()) {
      box.setFromObject(rec.group);
      box.getCenter(rec.center);
      box.getSize(size);
      rec.size = Math.max(size.x, size.y, size.z);
    }
  }

  /* ---------------- interaction ---------------- */

  _events() {
    const el = this.renderer.domElement;
    const ptrs = new Map();
    let moved = 0;
    let pinchD = 0;

    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      moved = 0;
      if (ptrs.size === 2) {
        const [a, b] = [...ptrs.values()];
        pinchD = Math.hypot(a.x - b.x, a.y - b.y);
      }
    });

    el.addEventListener('pointermove', (e) => {
      const prev = ptrs.get(e.pointerId);
      if (!prev) { this._hoverAt(e); return; }
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (ptrs.size === 1) {
        moved += Math.abs(dx) + Math.abs(dy);
        this.goal.theta -= dx * 0.008;
        this.goal.phi = clamp(this.goal.phi - dy * 0.006, 0.25, Math.PI - 0.25);
      } else if (ptrs.size === 2) {
        const [a, b] = [...ptrs.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchD) this.zoomBy(pinchD / d);
        pinchD = d;
        moved += 10;
      }
    });

    const end = (e, allowPick) => {
      if (allowPick && ptrs.size === 1 && moved < 5) {
        const id = this._pick(e);
        if (id && this.opts.onPick) this.opts.onPick(id);
      }
      ptrs.delete(e.pointerId);
      pinchD = 0;
    };
    el.addEventListener('pointerup', (e) => end(e, true));
    el.addEventListener('pointercancel', (e) => end(e, false));
    el.addEventListener('pointerleave', () => {
      if (this.hover) { this.hover = null; this._refresh(); }
    });

    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoomBy(Math.exp(e.deltaY * 0.001));
    }, { passive: false });
  }

  _pick(e) {
    const el = this.renderer.domElement;
    const r = el.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - r.left) / r.width) * 2 - 1,
      -(((e.clientY - r.top) / r.height) * 2 - 1)
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObject(this.model, true);
    let o = hits.length ? hits[0].object : null;
    while (o && !o.userData.part) o = o.parent;
    return o ? o.userData.part : null;
  }

  _hoverAt(e) {
    const id = this._pick(e);
    if (id !== this.hover) {
      this.hover = id;
      this.renderer.domElement.style.cursor = id ? 'pointer' : '';
      this._refresh();
    }
  }

  /* ---------------- rendering ---------------- */

  // work out target opacity / glow for every part
  _refresh() {
    for (const [id, p] of this.parts) {
      const isSel = id === this.selected;
      const isHover = id === this.hover;
      if (this.selected === null) {
        p.target = { op: 1, em: isHover ? 0.35 : 0 };
      } else if (isSel) {
        p.target = { op: 1, em: 0.5 };
      } else {
        p.target = { op: isHover ? 0.5 : 0.2, em: 0 };
      }
    }
  }

  _tick = (now) => {
    requestAnimationFrame(this._tick);
    const dt = Math.min(0.05, (now - this._last) / 1000 || 0.016);
    this._last = now;

    // ease the camera towards its goal
    const k = 1 - Math.exp(-dt * 6.5);
    for (const key of ['theta', 'phi', 'radius', 'tx', 'ty', 'tz']) {
      this.cur[key] += (this.goal[key] - this.cur[key]) * k;
    }
    const { theta, phi, radius, tx, ty, tz } = this.cur;
    this.camera.position.set(
      tx + radius * Math.sin(phi) * Math.sin(theta),
      ty + radius * Math.cos(phi),
      tz + radius * Math.sin(phi) * Math.cos(theta)
    );
    this.camera.lookAt(tx, ty, tz);

    // fade parts in and out
    const kf = 1 - Math.exp(-dt * 9);
    for (const p of this.parts.values()) {
      p.cur.op += (p.target.op - p.cur.op) * kf;
      p.cur.em += (p.target.em - p.cur.em) * kf;
      const transparent = p.cur.op < 0.995;
      for (const m of p.mats) {
        m.transparent = transparent;
        m.depthWrite = !transparent;
        m.opacity = p.cur.op;
        m.emissiveIntensity = p.cur.em;
      }
    }

    this.renderer.render(this.scene, this.camera);
  };
}
