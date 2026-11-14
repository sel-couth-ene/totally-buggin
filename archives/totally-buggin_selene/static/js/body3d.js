// Anatomical "X-ray" body, built from procedural shapes (no model files, so it works offline) and
// posed live by the MediaPipe landmarks. Two rigs are made from the same code: one overlays the user
// like a filter, the other is a standing model shown large when a body part is selected.
//
// Layers, from the outside in:
//   skin     a glowing low-poly hologram shell: lofted torso (V-shaped, narrow waist), neck, arms and legs
//            with muscle profiles, shown with its triangle edges and vertex dots. Its colour shows the
//            region's health status. Fingers follow MediaPipe's 21 hand landmarks. In the overlay the
//            head is the low-poly skin only; the skull and brain are in the zoomed model.
//   bones    skull and jaw, spine, ribs and sternum, collar bones, pelvis, arm and leg bones. Translucent.
//   organs   brain; lungs, windpipe and bronchi; liver, gall bladder, stomach, spleen, kidneys,
//            small and large intestine. Organs of a flagged region glow in its status colour.
//   heart    four chambers, the great vessels and the coronary arteries, beating in time with the
//            pulse (lub-dub: the atria squeeze first, then the ventricles) and the lungs breathe.
// There are no long red lines running down the body: the only vessels are the short ones at the heart.

import * as THREE from 'three';
import { P } from './geometry.js';

export const STATUS_HEX = {
  good: 0x2f86ff, nodata: 0x2f86ff, warning: 0xfab219, serious: 0xec835a, critical: 0xd03b3b,
};
const GLOW_HEX = { good: 0, nodata: 0, warning: 0xfab219, serious: 0xec835a, critical: 0xd03b3b };
const GLOW_I = { warning: 0.05, serious: 0.075, critical: 0.12 };       // a tint, so organs keep their natural colours
const PARTS = ['head', 'neck', 'chest', 'abdomen', 'left_arm', 'right_arm', 'left_leg', 'right_leg'];
const PART_REGION = { head: 'head', neck: 'neck', chest: 'chest', abdomen: 'abdomen',
  left_arm: 'arms', right_arm: 'arms', left_leg: 'legs', right_leg: 'legs' };

// ---------------------------------------------------------------- the skin shader

const VERT = `
varying vec3 vN;
void main() {
  vN = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const FRAG = `
uniform vec3 uColor; uniform vec3 uRim; uniform float uOpacity; uniform float uTime; uniform float uGlow;
varying vec3 vN;
void main() {
  // see-through in the middle, a bright edge where the surface turns away (glass / X-ray look)
  float rim = pow(1.0 - abs(vN.z), 1.7);
  float scan = 0.94 + 0.06 * sin(gl_FragCoord.y * 0.9 - uTime * 3.0);
  vec3 c = mix(uColor, uRim, rim * 0.8) * (0.9 + 0.5 * rim + uGlow * 0.5);
  float a = uOpacity * (0.15 + 0.56 * rim) * scan + uGlow * 0.12;
  gl_FragColor = vec4(c, a);
}`;
const WHITE = new THREE.Color(0xffffff);
const rimOf = (c) => c.clone().lerp(WHITE, 0.6);

function holo(color, opacity) {
  const c = new THREE.Color(color);
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: c }, uRim: { value: rimOf(c) }, uOpacity: { value: opacity },
      uTime: { value: 0 }, uGlow: { value: 0 } },
    vertexShader: VERT, fragmentShader: FRAG,
    transparent: true, depthWrite: false, side: THREE.FrontSide,
  });
}

// ---------------------------------------------------------------- geometry, built once and shared

const _geo = new Map();
const memo = (k, f) => { if (!_geo.has(k)) _geo.set(k, f()); return _geo.get(k); };
const SPH = memo('sph', () => new THREE.SphereGeometry(1, 22, 14));
const CYL = memo('cyl', () => new THREE.CylinderGeometry(1, 1, 1, 18, 1, false));
const CAP = memo('cap', () => new THREE.CapsuleGeometry(1, 1, 4, 10));
const taper = (top, bot) => memo(`taper${top}|${bot}`, () => new THREE.CylinderGeometry(top, bot, 1, 24, 1, true));
const tube = (key, pts, r, seg = 28, rad = 10) => memo(key, () => new THREE.TubeGeometry(
  new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p))), seg, r, rad, false));

function hash3(x, y, z) { const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return h - Math.floor(h); }
function vnoise(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), xf = x - xi, yf = y - yi, zf = z - zi;
  const s = (t) => t * t * (3 - 2 * t), u = s(xf), v = s(yf), w = s(zf), L = (a, b, t) => a + (b - a) * t;
  const c = (dx, dy, dz) => hash3(xi + dx, yi + dy, zi + dz);
  return L(L(L(c(0, 0, 0), c(1, 0, 0), u), L(c(0, 1, 0), c(1, 1, 0), u), v),
    L(L(c(0, 0, 1), c(1, 0, 1), u), L(c(0, 1, 1), c(1, 1, 1), u), v), w);
}
/** A unit sphere with a lumpy surface, for brain folds and organs. */
function organicSphere(key, amp, freq, seed) {
  return memo(key, () => {
    const g = new THREE.SphereGeometry(1, 36, 26), pos = g.attributes.position, v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const n = vnoise(v.x * freq + seed, v.y * freq + seed * 2, v.z * freq + seed * 3) - 0.5
        + 0.5 * (vnoise(v.x * freq * 2.3 + seed, v.y * freq * 2.3, v.z * freq * 2.3) - 0.5);
      v.multiplyScalar(1 + amp * 2 * n);
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    g.computeVertexNormals();
    return g;
  });
}
const lathe = (key, pts, seg = 44) => memo(key, () => new THREE.LatheGeometry(
  new THREE.SplineCurve(pts.map(([r, y]) => new THREE.Vector2(r, y))).getPoints(34)
    .map((p) => new THREE.Vector2(Math.max(p.x, 0.001), p.y)), seg));

const TAU = Math.PI * 2;
const SPH_LO = memo('sphlo', () => new THREE.SphereGeometry(1, 12, 8));
/** A low-poly tube lofted through elliptical rings ({y, rx, rz, cx, cz}, bottom to top). Flat-shaded, so every facet shows. */
function loft(key, rings, segs = 14) {
  return memo(key, () => {
    const pos = [];
    const at = (i, j) => { const r = rings[i], a = ((j % segs) / segs) * TAU; return [(r.cx || 0) + r.rx * Math.cos(a), r.y, (r.cz || 0) + r.rz * Math.sin(a)]; };
    for (let i = 0; i < rings.length - 1; i++) for (let j = 0; j < segs; j++) {
      const a = at(i, j), b = at(i, j + 1), c = at(i + 1, j), d = at(i + 1, j + 1);
      pos.push(...a, ...c, ...b, ...b, ...c, ...d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    return g;
  });
}
const wireOf = (geo) => memo(`wire${geo.uuid}`, () => new THREE.WireframeGeometry(geo));
/** A limb: relative radius along its length, from 0 (first joint) to 1 (second joint). */
const limbLoft = (key, prof, segs = 10) => loft(key, prof.map(([t, r]) => ({ y: t - 0.5, rx: r, rz: r * 0.93 })), segs);
const UARM = limbLoft('uarm', [[0, 0.92], [0.18, 1.0], [0.35, 1.08], [0.65, 0.92], [0.9, 0.78], [1, 0.72]]);      // deltoid, biceps
const FARM = limbLoft('farm', [[0, 0.95], [0.2, 1.05], [0.45, 1.0], [0.75, 0.72], [1, 0.55]]);                    // forearm
const THIGH = limbLoft('thigh', [[0, 0.95], [0.2, 1.08], [0.45, 1.06], [0.8, 0.8], [1, 0.68]], 12);               // quadriceps
const SHIN = limbLoft('shin', [[0, 0.85], [0.2, 1.0], [0.35, 1.05], [0.75, 0.62], [1, 0.5]], 12);                 // calf
const NECK_GEO = loft('neck', [{ y: -0.5, rx: 1.55, rz: 1.25 }, { y: -0.25, rx: 1.2, rz: 1.05 }, { y: 0.1, rx: 1.0, rz: 0.95 }, { y: 0.5, rx: 0.95, rz: 0.9 }], 12);
const FSEG = [[1, 2], [2, 3], [3, 4], [5, 6], [6, 7], [7, 8], [9, 10], [10, 11], [11, 12], [13, 14], [14, 15], [15, 16], [17, 18], [18, 19], [19, 20]];
const META = [[0, 1], [0, 5], [0, 9], [0, 13], [0, 17]];

// head with a jaw and chin: radius 1, face towards +z (low-poly, used by the zoomed model)
const HEAD_GEO = memo('head', () => {
  const g = new THREE.SphereGeometry(1, 26, 18), pos = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    v.y *= 1.17; v.z *= 1.06;
    const t = Math.min(1, Math.max(0, (-0.05 - v.y) / 1.1));            // lower face narrows into a chin
    v.x *= 1 - 0.34 * t; v.z *= 1 - 0.14 * t;
    if (v.z > 0) v.z += 0.07 * t;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  const flat = g.toNonIndexed();
  flat.computeVertexNormals();
  return flat;
});
// torso: half-width and half-depth (in shoulder widths) at heights given as a fraction of the torso length below the
// shoulders: wide shoulders, a chest, a narrow waist and hips, so it reads as a human body and not a barrel
const CHEST_GEO = loft('chest', [
  { y: -0.50, rx: 0.42, rz: 0.25 }, { y: -0.36, rx: 0.47, rz: 0.29, cz: 0.01 }, { y: -0.20, rx: 0.52, rz: 0.30, cz: 0.02 },
  { y: -0.08, rx: 0.55, rz: 0.27 }, { y: 0.0, rx: 0.50, rz: 0.22 }, { y: 0.06, rx: 0.34, rz: 0.17 },
  { y: 0.11, rx: 0.17, rz: 0.12 }, { y: 0.13, rx: 0.05, rz: 0.05 }], 18);
const ABD_GEO = loft('abd', [
  { y: -1.10, rx: 0.05, rz: 0.05 }, { y: -1.06, rx: 0.24, rz: 0.15 }, { y: -1.0, rx: 0.41, rz: 0.24 }, { y: -0.9, rx: 0.48, rz: 0.27 },
  { y: -0.78, rx: 0.44, rz: 0.25 }, { y: -0.64, rx: 0.40, rz: 0.23 }, { y: -0.5, rx: 0.42, rz: 0.25 }], 18);

// ---------------------------------------------------------------- the rig

const RIBS = 9;
const RIB_W = [0.27, 0.31, 0.34, 0.36, 0.37, 0.37, 0.36, 0.33, 0.30];
const seeded = (s) => () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };

class Rig {
  constructor(opacity, opts = {}) {
    this.opts = opts;
    this.scale = 1;
    this.group = new THREE.Group();
    this.mats = Object.fromEntries(PARTS.map((p) => [p, holo(STATUS_HEX.good, opacity)]));
    // the glowing triangle edges and vertex dots of the hologram skin
    this.edgeMats = Object.fromEntries(PARTS.map((p) => [p, new THREE.LineBasicMaterial({ color: 0x9fd0ff, transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending })]));
    this.dotMats = Object.fromEntries(PARTS.map((p) => [p, new THREE.PointsMaterial({ color: 0xcfe6ff, size: 2.6, sizeAttenuation: false, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending })]));
    this.lit = [];            // organ and bone materials: { mat, base, part, always, nodw, heart }
    this.all = [];            // every pickable mesh
    this.m = {};
    this.centers = {};
    this.beat = 0;
    this._q = new THREE.Quaternion(); this._m4 = new THREE.Matrix4();
    this.build();
  }

  /** A lit material for bones and organs (always inside the skin). */
  litMat(color, part, o = {}) {
    const Cls = o.clear ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial;
    const mat = new Cls({ color, roughness: o.rough ?? 0.6, metalness: 0, side: o.side ?? THREE.FrontSide,
      transparent: !!o.always, opacity: o.op ?? 1, depthWrite: !o.nodw,
      ...(o.clear ? { clearcoat: o.clear, clearcoatRoughness: 0.35 } : {}) });
    this.lit.push({ mat, base: o.op ?? 1, part, always: !!o.always, nodw: !!o.nodw, heart: !!o.heart, emHex: 0, emI: 0, wasT: !!o.always });
    return mat;
  }

  mk(name, geo, material, part, parent, order = 1) {
    const mesh = new THREE.Mesh(geo, material);
    mesh.userData.part = part; mesh.frustumCulled = false; mesh.renderOrder = order;
    (parent || this.group).add(mesh);
    if (name) this.m[name] = mesh;
    this.all.push(mesh);
    return mesh;
  }

  /** Place a unit sphere as an ellipsoid. */
  ell(name, mat, part, parent, [sx, sy, sz], [x, y, z], geo = SPH, order = 1) {
    const m = this.mk(name, geo, mat, part, parent, order);
    m.scale.set(sx, sy, sz); m.position.set(x, y, z); return m;
  }

  build() {
    const G = this.group;
    const bone = (part, op = 0.5) => this.litMat(0xe8f1fb, part, { rough: 0.5, op, always: true, nodw: true, side: THREE.DoubleSide });
    const shell = (name, geo, part, parent, opt = {}) => {
      const m = this.mk(name, geo, this.mats[part], part, parent || G, 10);
      const wl = new THREE.LineSegments(wireOf(geo), this.edgeMats[part]); wl.frustumCulled = false; wl.renderOrder = 11; m.add(wl);
      if (opt.dots) { const d = new THREE.Points(geo, this.dotMats[part]); d.frustumCulled = false; d.renderOrder = 12; m.add(d); }
      return m;
    };

    // ---------- head: skin, nose, ears, skull, jaw, brain
    this.headG = new THREE.Group(); G.add(this.headG);
    shell('headShell', HEAD_GEO, 'head', this.headG);
    this.ell('nose', this.mats.head, 'head', this.headG, [0.085, 0.14, 0.12], [0, -0.1, 1.02], SPH, 10);
    for (const s of [-1, 1]) this.ell(`ear${s}`, this.mats.head, 'head', this.headG, [0.07, 0.17, 0.1], [s * 0.98, -0.02, -0.05], SPH, 10);
    const skull = bone('head', 0.34);
    this.ell('skull', skull, 'head', this.headG, [0.86, 0.98, 0.92], [0, 0.1, -0.04], SPH, 2);
    const jaw = this.mk('jaw', new THREE.TorusGeometry(0.4, 0.045, 8, 26, Math.PI), skull, 'head', this.headG, 2);
    jaw.rotation.x = Math.PI / 2; jaw.position.set(0, -0.66, 0.18);
    const socket = this.litMat(0x182638, 'head', { op: 0.8, always: true, nodw: true });
    for (const s of [-1, 1]) this.ell(`socket${s}`, socket, 'head', this.headG, [0.15, 0.12, 0.08], [s * 0.33, -0.1, 0.8], SPH, 2);
    const brainMat = this.litMat(0xe6a9a5, 'head', { rough: 0.5, clear: 0.25 });
    for (const s of [-1, 1]) this.ell(`brain${s}`, brainMat, 'head', this.headG, [0.4, 0.43, 0.58], [s * 0.21, 0.3, -0.05], organicSphere('brain', 0.055, 4.5, 3));
    this.ell('cerebellum', this.litMat(0xcf8f8a, 'head', { rough: 0.6 }), 'head', this.headG, [0.34, 0.16, 0.24], [0, -0.04, -0.46], organicSphere('cereb', 0.04, 7, 9));
    this.ell('brainstem', this.litMat(0xd89a94, 'head', { rough: 0.6 }), 'head', this.headG, [0.09, 0.3, 0.09], [0, -0.26, -0.26], CYL);

    this.headOuter = ['headShell', 'nose', 'ear-1', 'ear1'].map((n) => this.m[n]);
    this.headInner = ['skull', 'jaw', 'socket-1', 'socket1', 'brain-1', 'brain1', 'cerebellum', 'brainstem'].map((n) => this.m[n]);

    // ---------- neck and torso skin
    shell('neck', NECK_GEO, 'neck', null, { dots: true });
    this.cerv = [];
    const boneN = bone('neck', 0.55);
    for (let i = 0; i < 5; i++) this.cerv.push(this.mk(`cerv${i}`, CYL, boneN, 'neck', G, 2));
    shell('chestShell', CHEST_GEO, 'chest', null, { dots: true });
    shell('abdShell', ABD_GEO, 'abdomen', null, { dots: true });

    // ---------- thorax: ribs, sternum, lungs, windpipe, heart
    this.thorax = new THREE.Group(); G.add(this.thorax);
    const boneR = bone('chest', 0.62);
    this.ribs = [];
    for (let i = 0; i < RIBS; i++) {
      const rg = new THREE.Group(); this.thorax.add(rg); this.ribs.push(rg);
      const w = RIB_W[i], pts = [[0.05, 0.02, -0.2], [w * 0.95, 0.0, -0.14], [w, -0.03, 0.02], [w * 0.68, -0.075, 0.17], [0.045, -0.115, 0.215]];
      const geo = tube(`rib${i}`, pts, 0.017, 26, 8);
      this.mk(`ribR${i}`, geo, boneR, 'chest', rg, 2);
      this.mk(`ribL${i}`, geo, boneR, 'chest', rg, 2).scale.x = -1;
    }
    this.sternum = this.mk('sternum', CYL, boneR, 'chest', this.thorax, 2);
    this.sternum.scale.set(0.034, 0.5, 0.02); this.sternum.position.set(0, 0.0, 0.235);

    const lungMat = this.litMat(0xe5a09d, 'chest', { rough: 0.7, op: 0.8, always: true, nodw: true });
    const lungGeo = organicSphere('lung', 0.03, 3.5, 5);
    this.lungR = new THREE.Group(); this.lungL = new THREE.Group();
    this.thorax.add(this.lungR, this.lungL);
    this.lungR.position.set(0.2, 0.0, -0.04); this.lungL.position.set(-0.21, 0.0, -0.04);
    [[0.15, 0.19, 0.15, 0.01, 0.17, 0.01], [0.15, 0.10, 0.14, 0.0, 0.01, 0.04], [0.16, 0.21, 0.16, -0.01, -0.15, -0.01]]
      .forEach((l, i) => this.ell(`lungR${i}`, lungMat, 'chest', this.lungR, [l[0], l[1], l[2]], [l[3], l[4], l[5]], lungGeo, 1));
    [[0.14, 0.21, 0.15, -0.01, 0.13, 0.01], [0.15, 0.21, 0.16, 0.0, -0.14, -0.01]]
      .forEach((l, i) => this.ell(`lungL${i}`, lungMat, 'chest', this.lungL, [l[0], l[1], l[2]], [l[3], l[4], l[5]], lungGeo, 1));
    const airway = this.litMat(0xbcd8ea, 'chest', { rough: 0.45, op: 0.9, always: true, nodw: true });
    this.mk('trachea', tube('trachea', [[0, 0.66, -0.03], [0, 0.4, -0.04], [0, 0.2, -0.04]], 0.033, 12, 12), airway, 'chest', this.thorax, 1);
    this.mk('bronchR', tube('bronchR', [[0, 0.2, -0.04], [0.07, 0.14, -0.04], [0.17, 0.06, -0.05]], 0.024, 12, 10), airway, 'chest', this.thorax, 1);
    this.mk('bronchL', tube('bronchL', [[0, 0.2, -0.04], [-0.08, 0.13, -0.04], [-0.18, 0.05, -0.05]], 0.024, 12, 10), airway, 'chest', this.thorax, 1);
    for (let i = 0; i < 9; i++) {                                         // cartilage rings on the windpipe
      const ring = this.mk(`ring${i}`, new THREE.TorusGeometry(0.036, 0.0085, 6, 18), airway, 'chest', this.thorax, 1);
      ring.rotation.x = Math.PI / 2; ring.position.set(0, 0.62 - i * 0.045, -0.032);
    }
    this.buildHeart(this.thorax);

    // ---------- abdomen: liver, stomach, spleen, kidneys, intestines
    this.abdG = new THREE.Group(); G.add(this.abdG);
    const A = (name, mat, dims, pos, geo = organicSphere('organ', 0.025, 3, 2), rot = [0, 0, 0]) => {
      const m = this.ell(name, mat, 'abdomen', this.abdG, dims, pos, geo, 1); m.rotation.set(...rot); return m;
    };
    const liverMat = this.litMat(0x8b2e2e, 'abdomen', { rough: 0.42, clear: 0.35 });
    A('liverR', liverMat, [0.27, 0.14, 0.18], [0.15, 0.2, 0.02], undefined, [0, 0, -0.25]);
    A('liverL', liverMat, [0.17, 0.09, 0.13], [-0.06, 0.23, 0.05], undefined, [0, 0, 0.15]);
    A('gall', this.litMat(0x5da66a, 'abdomen', { rough: 0.4, clear: 0.4 }), [0.045, 0.07, 0.045], [0.2, 0.08, 0.1]);
    const stomachMat = this.litMat(0xe0867a, 'abdomen', { rough: 0.5, clear: 0.3 });
    A('stomach', stomachMat, [0.13, 0.19, 0.11], [-0.15, 0.2, 0.06], undefined, [0, 0, 0.6]);
    this.mk('pylorus', tube('pylorus', [[-0.07, 0.13, 0.06], [0.02, 0.1, 0.07], [0.1, 0.07, 0.05]], 0.034, 12, 10), stomachMat, 'abdomen', this.abdG, 1);
    A('spleen', this.litMat(0x6e2634, 'abdomen', { rough: 0.45 }), [0.065, 0.12, 0.055], [-0.27, 0.15, -0.1]);
    const kidney = this.litMat(0x8a2b3a, 'abdomen', { rough: 0.4, clear: 0.3 });
    for (const s of [-1, 1]) A(`kidney${s}`, kidney, [0.06, 0.1, 0.05], [s * 0.14, 0.06, -0.17]);
    const rng = seeded(7), si = [];                                       // small intestine: folded loops
    for (let r = 0; r < 6; r++) for (let c = 0; c < 9; c++) {
      const dir = r % 2 ? -1 : 1;
      si.push([dir * (-0.2 + 0.4 * c / 8) + (rng() - 0.5) * 0.03, -0.0 - r * 0.052 + (rng() - 0.5) * 0.03, (rng() - 0.5) * 0.13]);
    }
    this.mk('smallInt', tube('smallInt', si, 0.024, 200, 7), this.litMat(0xeaa28e, 'abdomen', { rough: 0.45, clear: 0.3 }), 'abdomen', this.abdG, 1);
    this.mk('largeInt', tube('largeInt', [[0.25, -0.26, 0.02], [0.26, -0.1, 0.02], [0.25, 0.06, 0.0], [0.12, 0.12, 0.04], [-0.05, 0.11, 0.05],
      [-0.2, 0.1, 0.03], [-0.26, 0.04, 0.0], [-0.25, -0.12, 0.0], [-0.2, -0.26, 0.02], [-0.08, -0.3, 0.0], [0.02, -0.26, 0.0]], 0.04, 120, 10),
    this.litMat(0xcf9a74, 'abdomen', { rough: 0.5 }), 'abdomen', this.abdG, 1);

    // ---------- pelvis and spine
    this.pelvG = new THREE.Group(); G.add(this.pelvG);
    const boneP = bone('abdomen', 0.55);
    for (const s of [-1, 1]) {
      const il = this.ell(`ilium${s}`, boneP, 'abdomen', this.pelvG, [0.2, 0.15, 0.07], [s * 0.19, 0.06, -0.01], SPH, 2);
      il.rotation.z = -s * 0.45;
    }
    this.ell('sacrum', boneP, 'abdomen', this.pelvG, [0.08, 0.15, 0.05], [0, -0.01, -0.1], SPH, 2);
    this.spine = [];
    for (let i = 0; i < 17; i++) this.spine.push(this.mk(`vert${i}`, CYL, bone(i < 10 ? 'chest' : 'abdomen', 0.9), i < 10 ? 'chest' : 'abdomen', G, 3));

    // ---------- arms and legs: skin, hands, feet, bones
    for (const s of ['left', 'right']) {
      const arm = `${s}_arm`, leg = `${s}_leg`;
      shell(`${s}UpperArm`, UARM, arm, null, { dots: true }); shell(`${s}Forearm`, FARM, arm, null, { dots: true });
      shell(`${s}Shoulder`, SPH_LO, arm); shell(`${s}Elbow`, SPH_LO, arm); shell(`${s}Wrist`, SPH_LO, arm);
      const hand = new THREE.Group(); G.add(hand); this.m[`${s}HandG`] = hand;
      const glowEll = (name, geo, dims, pos) => {          // a fixed hand, for when no hand is tracked: same glowing facets
        const m = this.ell(name, this.mats[arm], arm, hand, dims, pos, geo, 10);
        const wl = new THREE.LineSegments(wireOf(geo), this.edgeMats[arm]); wl.frustumCulled = false; wl.renderOrder = 11; m.add(wl);
        return m;
      };
      glowEll(`${s}Palm`, SPH_LO, [0.34, 0.4, 0.14], [0, 0.4, 0]);
      [[-0.22, 0.24], [-0.075, 0.3], [0.075, 0.33], [0.22, 0.3]].forEach(([x, L], i) => {
        glowEll(`${s}F${i}`, CAP, [0.075, L, 0.075], [x, 0.8 + L * 0.5, 0]);
      });
      const th = glowEll(`${s}Thumb`, CAP, [0.08, 0.22, 0.08], [(s === 'left' ? -1 : 1) * 0.4, 0.45, 0]);
      th.rotation.z = (s === 'left' ? 1 : -1) * 0.7;
      shell(`${s}Thigh`, THIGH, leg, null, { dots: true }); shell(`${s}Shin`, SHIN, leg, null, { dots: true });
      shell(`${s}Hip`, SPH_LO, leg); shell(`${s}Knee`, SPH_LO, leg); shell(`${s}Ankle`, SPH_LO, leg); shell(`${s}Foot`, SPH_LO, leg);
      const ba = bone(arm, 0.6), bl = bone(leg, 0.6);
      for (const n of ['Humerus', 'Ulna', 'Radius', 'ShoulderBall', 'ElbowBone', 'WristBone', 'Clavicle']) this.mk(`${s}${n}`, n.includes('Ball') || n.includes('Bone') ? SPH : CYL, ba, arm, G, 2);
      for (const n of ['Femur', 'Tibia', 'Fibula', 'HipBall', 'KneeCap', 'AnkleBone']) this.mk(`${s}${n}`, n.includes('Ball') || n.includes('Cap') || n.includes('Bone') ? SPH : CYL, bl, leg, G, 2);
      if (this.opts.fingers) this.buildFingers(s, arm, ba);
    }
  }

  /** Fingers that follow the 21 MediaPipe hand landmarks: a skin segment, a bone and a rounded joint for each. */
  buildFingers(s, arm, boneMat) {
    const root = new THREE.Group(); this.group.add(root); root.visible = false;
    const skin = this.mats[arm], seg = loft('fseg', [{ y: -0.5, rx: 1, rz: 1 }, { y: 0.5, rx: 0.8, rz: 0.8 }], 7);
    const glowing = (geo) => {                               // skin with the same glowing triangle edges as the rest of the body
      const m = this.mk(null, geo, skin, arm, root, 10);
      const wl = new THREE.LineSegments(wireOf(geo), this.edgeMats[arm]); wl.frustumCulled = false; wl.renderOrder = 11; m.add(wl);
      return m;
    };
    const F = {
      root,
      shell: FSEG.map(() => glowing(seg)),
      bone: [...FSEG, ...META].map(() => this.mk(null, CYL, boneMat, arm, root, 2)),
      joint: Array.from({ length: 21 }, (_, i) => (i ? glowing(SPH_LO) : null)),
      palm: glowing(SPH_LO),
    };
    (this.fing ??= {})[s] = F;
  }

  /** Pose one hand's fingers from its 21 landmarks (Vector3 in the rig's space). False if there is no hand. */
  poseHand(s, H) {
    const F = this.fing?.[s];
    if (!F) return false;
    if (!H || H.length < 21 || H[0].distanceTo(H[9]) < 2) { F.root.visible = false; return false; }
    F.root.visible = true;
    const hs = H[0].distanceTo(H[9]);                        // hand size: wrist to the knuckle of the middle finger
    FSEG.forEach(([a, b], k) => this.cyl(F.shell[k], H[a], H[b], hs * (0.078 - 0.011 * (k % 3) + (k < 3 ? 0.012 : 0))));
    for (let i = 1; i < 21; i++) this.sphere(F.joint[i], H[i], hs * (i % 4 === 0 ? 0.058 : 0.072) * (i <= 4 ? 1.12 : 1));
    [...FSEG, ...META].forEach(([a, b], k) => this.cyl(F.bone[k], H[a], H[b], hs * 0.02));
    const y = H[9].clone().sub(H[0]).normalize();            // the palm: a flattened shape across the knuckles
    const x = H[5].clone().sub(H[17]); x.sub(y.clone().multiplyScalar(x.dot(y))).normalize();
    const z = new THREE.Vector3().crossVectors(x, y).normalize();
    this._m4.makeBasis(x, y, z);
    F.palm.quaternion.setFromRotationMatrix(this._m4);
    F.palm.position.copy(H[0]).add(H[5]).add(H[9]).add(H[13]).add(H[17]).multiplyScalar(0.2).addScaledVector(y, hs * 0.06);
    F.palm.scale.set(H[5].distanceTo(H[17]) * 0.6, hs * 0.56, hs * 0.13);
    F.palm.visible = true;
    return true;
  }

  /** The heart: four chambers, great vessels and coronary arteries, in units where the heart is 1 tall. */
  buildHeart(parent) {
    const hg = this.heartG = new THREE.Group();
    parent.add(hg);
    hg.position.set(-0.09, 0.03, 0.1); hg.scale.setScalar(0.42); hg.rotation.z = -0.5;
    const H = (color, o = {}) => this.litMat(color, 'chest', { rough: 0.36, clear: 0.6, heart: true, side: THREE.DoubleSide, ...o });
    const muscle = H(0x9a2231), muscle2 = H(0xae2f3d), atrium = H(0x8c2231);
    const artery = H(0xc4252f), vein = H(0x4a51b4), pulm = H(0x6465cf), coro = H(0xe0262e, { rough: 0.3 });
    const vent = this.heartVent = new THREE.Group(), atria = this.heartAtria = new THREE.Group(), vess = this.heartVess = new THREE.Group();
    hg.add(vent, atria, vess);
    const lv = [];
    for (let i = 0; i <= 12; i++) {                                       // the left ventricle: a rounded cone, apex down
      const u = i / 12;
      lv.push([0.37 * Math.pow(Math.sin(u * Math.PI / 2), 0.7) * (1 - 0.2 * u * u), -0.52 + 0.82 * u]);
    }
    lv.push([0.0, 0.3]);
    const LV = this.mk('heartLV', lathe('lv', lv.map(([r, y]) => [Math.max(r, 0.001), y]), 36), muscle, 'chest', vent, 1);
    LV.scale.set(1, 1, 0.88);
    this.ell('heartRV', muscle2, 'chest', vent, [0.25, 0.4, 0.22], [0.2, -0.04, 0.2], organicSphere('rv', 0.02, 3, 4), 1).rotation.z = 0.22;
    this.ell('heartRA', atrium, 'chest', atria, [0.2, 0.2, 0.19], [0.26, 0.24, 0.04], SPH, 1);
    this.ell('heartRAA', atrium, 'chest', atria, [0.12, 0.1, 0.08], [0.15, 0.38, 0.2], SPH, 1).rotation.z = 0.5;
    this.ell('heartLA', atrium, 'chest', atria, [0.2, 0.15, 0.17], [-0.12, 0.33, -0.17], SPH, 1);
    this.ell('heartLAA', atrium, 'chest', atria, [0.09, 0.13, 0.07], [-0.28, 0.31, 0.06], SPH, 1).rotation.z = 0.6;
    const V = (name, pts, r, mat, seg = 24, rad = 12) => this.mk(name, tube(name, pts, r, seg, rad), mat, 'chest', vess, 1);
    V('aorta', [[-0.03, 0.28, 0.02], [-0.05, 0.52, 0.02], [-0.1, 0.72, -0.02], [-0.26, 0.8, -0.09], [-0.4, 0.64, -0.14], [-0.43, 0.3, -0.17], [-0.43, 0.0, -0.19]], 0.082, artery, 40);
    V('brachio', [[-0.1, 0.74, -0.02], [-0.1, 0.98, 0.0]], 0.033, artery, 6, 10);
    V('carotid', [[-0.17, 0.78, -0.05], [-0.17, 1.0, -0.04]], 0.028, artery, 6, 10);
    V('subclav', [[-0.24, 0.8, -0.08], [-0.26, 1.0, -0.08]], 0.03, artery, 6, 10);
    V('pulmTrunk', [[0.1, 0.18, 0.27], [0.05, 0.44, 0.22], [-0.06, 0.62, 0.12]], 0.074, pulm);
    V('LPA', [[-0.06, 0.62, 0.12], [-0.25, 0.64, 0.0], [-0.4, 0.55, -0.1]], 0.048, pulm, 16);
    V('RPA', [[-0.06, 0.62, 0.12], [0.1, 0.62, -0.02], [0.38, 0.56, -0.06]], 0.048, pulm, 16);
    V('svc', [[0.31, 0.32, 0.02], [0.31, 0.62, 0.0], [0.3, 0.92, -0.02]], 0.058, vein, 16);
    V('ivc', [[0.27, 0.08, -0.03], [0.27, -0.22, -0.06], [0.27, -0.5, -0.08]], 0.06, vein, 16);
    V('LAD', [[-0.02, 0.3, 0.26], [0.0, 0.1, 0.33], [0.03, -0.16, 0.34], [0.0, -0.4, 0.22]], 0.015, coro, 20, 6);
    V('Cx', [[-0.06, 0.28, 0.18], [-0.24, 0.25, 0.08], [-0.34, 0.12, -0.08], [-0.3, -0.05, -0.2]], 0.014, coro, 20, 6);
    V('RCA', [[0.02, 0.3, 0.24], [0.2, 0.31, 0.2], [0.33, 0.18, 0.12], [0.34, -0.02, -0.12]], 0.014, coro, 20, 6);
  }

  // ---------------------------------------------------------------- posing

  sphere(name, c, r, sx = 1, sy = 1, sz = 1, quat = null) {
    const mesh = this.m[name] || name;
    if (!c) { mesh.visible = false; return; }
    mesh.visible = true; mesh.position.copy(c);
    mesh.scale.set(r * sx, r * sy, r * sz);
    if (quat) mesh.quaternion.copy(quat); else mesh.quaternion.identity();
  }

  cyl(name, a, b, r, rb = r) {
    const mesh = this.m[name] || name;
    if (!a || !b) { mesh.visible = false; return; }
    const dir = new THREE.Vector3().subVectors(b, a), len = dir.length();
    if (len < 1e-3) { mesh.visible = false; return; }
    mesh.visible = true;
    mesh.position.addVectors(a, b).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.divideScalar(len));
    mesh.scale.set(r, len, r);
  }

  /** Q: 33 entries of THREE.Vector3 (y up) or null when not visible. */
  pose(Q, t = 0, live = {}, hands = null) {
    const ls = Q[P.L_SHOULDER], rs = Q[P.R_SHOULDER];
    if (!ls || !rs) { this.group.visible = false; return false; }
    this.group.visible = true;
    const shW = ls.distanceTo(rs);
    const shMid = ls.clone().add(rs).multiplyScalar(0.5);
    let lh = Q[P.L_HIP], rh = Q[P.R_HIP];
    if (!lh || !rh) {                                       // hips out of frame
      lh = ls.clone().add(new THREE.Vector3(0, -shW * 1.45, 0));
      rh = rs.clone().add(new THREE.Vector3(0, -shW * 1.45, 0));
    }
    const hipMid = lh.clone().add(rh).multiplyScalar(0.5);
    const up = shMid.clone().sub(hipMid); const torso = up.length(); up.normalize();
    const right = rs.clone().sub(ls);
    right.sub(up.clone().multiplyScalar(right.dot(up))).normalize();
    const fwd = new THREE.Vector3().crossVectors(right, up).normalize();
    this._m4.makeBasis(right, up, fwd);
    const q = this._q.setFromRotationMatrix(this._m4).clone();
    const at = (base, r, u, f) => base.clone().addScaledVector(right, r).addScaledVector(up, u).addScaledVector(fwd, f);
    const place = (g, pos, s) => { g.position.copy(pos); g.quaternion.copy(q); g.scale.setScalar(s); };
    const T = torso / shW;
    const chestC = at(shMid, 0, -torso * 0.27, 0), abdC = at(shMid, 0, -torso * 0.74, 0);

    // head and neck
    const le = Q[P.L_EAR], re = Q[P.R_EAR], nose = Q[P.NOSE];
    let headC, headR;
    if (le && re) { headC = le.clone().add(re).multiplyScalar(0.5); headR = Math.max(le.distanceTo(re) * 0.62, shW * 0.26); }
    else if (nose) { headR = shW * 0.3; headC = at(nose, 0, 0, -headR * 0.5); }
    else { headR = shW * 0.3; headC = at(shMid, 0, shW * 0.75, 0); }
    place(this.headG, headC, headR);
    // the overlay never shows the skull and brain (the zoomed model does)
    this.headG.visible = true;
    for (const m of this.headOuter) m.visible = true;
    for (const m of this.headInner) m.visible = !this.opts.hideHeadInner;
    const neckA = at(shMid, 0, shW * 0.02, 0), neckB = at(headC, 0, -headR * 0.8, 0);
    this.cyl('neck', neckA, neckB, shW * 0.1);
    this.cerv.forEach((c, i) => {
      const p = neckA.clone().lerp(neckB, (i + 0.5) / 5).addScaledVector(fwd, -shW * 0.05);
      c.position.copy(p); c.quaternion.copy(q); c.scale.set(shW * 0.04, shW * 0.04, shW * 0.04);
    });

    // torso skin
    for (const n of ['chestShell', 'abdShell']) { const m = this.m[n]; m.position.copy(shMid); m.quaternion.copy(q); m.scale.set(shW, torso, shW); }

    // thorax: ribs, lungs (breathing), heart (beating)
    place(this.thorax, chestC, shW);
    this.ribs.forEach((rg, i) => { rg.position.y = T * (0.21 - 0.43 * i / (RIBS - 1)); });
    this.sternum.position.y = T * 0.0;
    this.sternum.scale.y = T * 0.3;
    const br = live.breathing_rate || 14, hr = live.heart_rate || 64;
    const breath = 0.5 + 0.5 * Math.sin(t * 2 * Math.PI * br / 60);
    for (const lung of [this.lungR, this.lungL]) lung.scale.set(1 + 0.05 * breath, 1 + 0.09 * breath, 1 + 0.05 * breath);
    this.beatHeart(t, hr);

    // abdomen and pelvis
    place(this.abdG, abdC, shW);
    place(this.pelvG, hipMid, shW);

    // spine: vertebrae from the base of the neck to the sacrum, with the natural S curve
    this.spine.forEach((v, i) => {
      const s = i / 16, back = shW * (0.15 + 0.05 * Math.sin(s * Math.PI) - 0.03 * s);
      v.position.copy(shMid).addScaledVector(hipMid.clone().sub(shMid), 0.01 + 0.96 * s).addScaledVector(fwd, -back);
      v.quaternion.copy(q); v.scale.set(shW * 0.058, torso * 0.036, shW * 0.058);
    });

    // limbs
    const V = (i) => Q[i] || null;
    const limbs = [
      ['left', P.L_SHOULDER, P.L_ELBOW, P.L_WRIST, P.L_INDEX, P.L_HIP, P.L_KNEE, P.L_ANKLE, P.L_FOOT, lh],
      ['right', P.R_SHOULDER, P.R_ELBOW, P.R_WRIST, P.R_INDEX, P.R_HIP, P.R_KNEE, P.R_ANKLE, P.R_FOOT, rh],
    ];
    const upV = new THREE.Vector3(0, 1, 0);
    for (const [s, sh, el, wr, ix, , kn, an, ft, hip] of limbs) {
      const S = V(sh), E = V(el), W = V(wr), I = V(ix), K = V(kn), A = V(an), F = V(ft);
      const hipVis = Q[s === 'left' ? P.L_HIP : P.R_HIP] ? hip : null;
      this.cyl(`${s}UpperArm`, S, E, shW * 0.085); this.cyl(`${s}Forearm`, E, W, shW * 0.066);
      this.sphere(`${s}Shoulder`, S, shW * 0.095); this.sphere(`${s}Elbow`, E, shW * 0.062); this.sphere(`${s}Wrist`, W, shW * 0.046);
      const hg = this.m[`${s}HandG`];
      if (W && I && W.distanceTo(I) > 1e-3) {
        hg.visible = true; hg.position.copy(W);
        hg.quaternion.setFromUnitVectors(upV, I.clone().sub(W).normalize()); hg.scale.setScalar(shW * 0.36);
      } else hg.visible = false;
      if (this.poseHand(s, hands?.[s])) hg.visible = false;      // tracked fingers replace the fixed hand
      this.cyl(`${s}Thigh`, hipVis, K, shW * 0.13); this.cyl(`${s}Shin`, K, A, shW * 0.09);
      this.sphere(`${s}Hip`, hipVis, shW * 0.115); this.sphere(`${s}Knee`, K, shW * 0.085); this.sphere(`${s}Ankle`, A, shW * 0.056);
      this.sphere(`${s}Foot`, A && F ? A.clone().lerp(F, 0.5) : null, shW * 0.075, 1.4, 0.6, 1.5);
      // bones inside
      const off = (pt, k) => (pt ? pt.clone().addScaledVector(right, shW * k) : null);
      this.cyl(`${s}Humerus`, S, E, shW * 0.022); this.cyl(`${s}Ulna`, E, W, shW * 0.014); this.cyl(`${s}Radius`, off(E, 0.02), off(W, 0.02), shW * 0.013);
      this.sphere(`${s}ShoulderBall`, S, shW * 0.04); this.sphere(`${s}ElbowBone`, E, shW * 0.032); this.sphere(`${s}WristBone`, W, shW * 0.026);
      const cl = at(shMid, (s === 'left' ? -1 : 1) * shW * 0.05, -torso * 0.035, shW * 0.1);
      this.cyl(`${s}Clavicle`, S ? cl : null, S ? S.clone().addScaledVector(fwd, shW * 0.05) : null, shW * 0.014);
      this.cyl(`${s}Femur`, hipVis, K, shW * 0.03); this.cyl(`${s}Tibia`, K, A, shW * 0.024); this.cyl(`${s}Fibula`, off(K, 0.025), off(A, 0.025), shW * 0.012);
      this.sphere(`${s}HipBall`, hipVis, shW * 0.05); this.sphere(`${s}KneeCap`, K ? at(K, 0, 0, shW * 0.035) : null, shW * 0.05); this.sphere(`${s}AnkleBone`, A, shW * 0.034);
      this.centers[`${s}_arm`] = E ? E.clone() : (S ? S.clone() : null);
      this.centers[`${s}_leg`] = K ? K.clone() : (hipVis ? hipVis.clone() : null);
    }
    Object.assign(this.centers, { head: headC.clone(), neck: at(shMid, 0, shW * 0.25, 0), chest: at(chestC, -shW * 0.05, torso * 0.02, 0), abdomen: abdC });
    // warning badges sit beside each part, never on it: the head's by the ear (not over the face), the neck's on
    // the other side, chest and abdomen at the torso edge, and one outside each elbow and each knee
    const out = (c, side, d) => (c ? c.clone().addScaledVector(right, side * d).addScaledVector(fwd, shW * 0.25) : null);
    this.badges = {
      head: at(headC, headR * 1.45, headR * 0.15, shW * 0.25),
      neck: at(shMid, -shW * 0.24, shW * 0.24, shW * 0.25),
      chest: at(chestC, -shW * 0.5, torso * 0.08, shW * 0.25),
      abdomen: at(abdC, shW * 0.5, 0, shW * 0.25),
      left_arm: out(this.centers.left_arm, -1, shW * 0.2),
      right_arm: out(this.centers.right_arm, 1, shW * 0.2),
      left_leg: out(this.centers.left_leg, -1, shW * 0.22),
      right_leg: out(this.centers.right_leg, 1, shW * 0.22),
    };
    return true;
  }

  /** Lub-dub: the atria squeeze, then the ventricles, then the great vessels swell. */
  beatHeart(t, hr) {
    const ph = (t * hr / 60) % 1;
    const g = (x, c, w) => Math.exp(-(((x - c) / w) ** 2));
    const atrial = g(ph, 0.07, 0.05);
    const sys = ph > 0.12 && ph < 0.42 ? Math.pow(Math.sin(Math.PI * (ph - 0.12) / 0.3), 1.4) : 0;
    const valve = g(ph, 0.46, 0.025);
    const vent = this.heartVent, atria = this.heartAtria, vess = this.heartVess;
    vent.scale.set(1 - 0.07 * sys, 1 - 0.06 * sys, 1 - 0.07 * sys);
    atria.scale.setScalar(1 - 0.09 * atrial + 0.05 * sys);
    vess.scale.set(1 + 0.05 * sys, 1, 1 + 0.05 * sys);
    this.heartG.scale.setScalar(0.42 * (1 + 0.012 * valve));
    this.beat = Math.min(1, sys * 0.8 + atrial * 0.4);
  }

  setTime(t) { for (const m of Object.values(this.mats)) m.uniforms.uTime.value = t; }

  setOpacity(scale) {
    this.scale = scale;
    for (const m of Object.values(this.mats)) m.uniforms.uOpacity.value = (m.userData.base ??= m.uniforms.uOpacity.value) * scale;
    for (const l of this.lit) {
      l.mat.opacity = l.base * scale;
      const tr = l.always || scale < 0.999;
      if (tr !== l.wasT) { l.wasT = tr; l.mat.transparent = tr; l.mat.needsUpdate = true; }
    }
  }

  setStatus(statusByRegion) {
    for (const p of PARTS) {
      const st = statusByRegion?.[PART_REGION[p]] || 'good';
      const u = this.mats[p].uniforms;
      u.uColor.value.setHex(STATUS_HEX[st] ?? STATUS_HEX.good);
      (this.statusColor ??= {})[p] = u.uColor.value.clone();
      u.uRim.value.copy(rimOf(u.uColor.value));
      this.edgeMats[p].color.copy(u.uColor.value).lerp(WHITE, 0.4);    // edges and dots take the status colour too
      this.dotMats[p].color.copy(u.uColor.value).lerp(WHITE, 0.6);
    }
    for (const l of this.lit) {                          // organs of a flagged region glow in its colour
      const st = statusByRegion?.[PART_REGION[l.part]] || 'good';
      l.emHex = GLOW_HEX[st] || 0; l.emI = GLOW_I[st] || 0;
    }
  }

  /** The focused part turns red and pulses (a slow glow running through it); hover just brightens a part. */
  setGlow(selectedPart, hoverPart, t = 0) {
    const selRegion = selectedPart ? PART_REGION[selectedPart] : null;
    const hovRegion = hoverPart ? PART_REGION[hoverPart] : null;
    const pulse = 0.5 + 0.5 * Math.sin(t * 4.2);                    // 0..1, about 0.7 beats a second
    for (const p of PARTS) {
      const r = PART_REGION[p], sel = r === selRegion;
      const g = sel ? 0.7 + 0.9 * pulse : r === hovRegion ? 0.55 : 0;
      const u = this.mats[p].uniforms, base = this.statusColor?.[p];
      if (sel) u.uColor.value.copy(FOCUS_RED).lerp(FOCUS_HOT, pulse);
      else if (base) u.uColor.value.copy(base);
      u.uRim.value.copy(rimOf(u.uColor.value));
      u.uGlow.value = g;
      this.edgeMats[p].color.copy(u.uColor.value).lerp(WHITE, sel ? 0.15 + 0.35 * pulse : 0.4);
      this.dotMats[p].color.copy(u.uColor.value).lerp(WHITE, sel ? 0.3 : 0.6);
      this.edgeMats[p].opacity = 0.4 * this.scale + (sel ? 0.35 + 0.25 * pulse : 0.3 * g);
      this.dotMats[p].opacity = 0.9 * this.scale;
    }
    for (const l of this.lit) {
      const r = PART_REGION[l.part], sel = r === selRegion;
      const extra = sel ? 0.25 + 0.45 * pulse : r === hovRegion ? 0.12 : 0;
      const k = l.emI + extra + (l.heart ? this.beat * 0.14 : 0);
      l.mat.emissive.setHex(sel ? 0xff2020 : (l.emHex || (l.heart ? 0xb01020 : 0x2f86ff)));
      l.mat.emissiveIntensity = k;
    }
  }

  meshes() { return this.all; }
}

// Standing model in metres: x to the viewer's right, y down, z towards the viewer.
// It faces the viewer like a mirror image, so the person's left is on the left.
const CANON = {
  [P.NOSE]: [0, -0.69, 0.1], [P.L_EAR]: [-0.075, -0.7, 0], [P.R_EAR]: [0.075, -0.7, 0],
  [P.L_SHOULDER]: [-0.19, -0.5, 0], [P.R_SHOULDER]: [0.19, -0.5, 0],
  [P.L_ELBOW]: [-0.25, -0.24, 0.02], [P.R_ELBOW]: [0.25, -0.24, 0.02],
  [P.L_WRIST]: [-0.28, 0.0, 0.05], [P.R_WRIST]: [0.28, 0.0, 0.05],
  [P.L_INDEX]: [-0.29, 0.09, 0.06], [P.R_INDEX]: [0.29, 0.09, 0.06],
  [P.L_HIP]: [-0.1, 0, 0], [P.R_HIP]: [0.1, 0, 0],
  [P.L_KNEE]: [-0.11, 0.43, 0.02], [P.R_KNEE]: [0.11, 0.43, 0.02],
  [P.L_ANKLE]: [-0.11, 0.84, 0], [P.R_ANKLE]: [0.11, 0.84, 0],
  [P.L_FOOT]: [-0.12, 0.89, 0.12], [P.R_FOOT]: [0.12, 0.89, 0.12],
};
const FOCUS_RED = new THREE.Color(0xd8121a), FOCUS_HOT = new THREE.Color(0xff5a4a);   // the focused part pulses between these

export class BodyView {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, premultipliedAlpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.scene = new THREE.Scene();
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x3a4668, 0.95));      // bones and organs are lit; the skin is not
    const key = new THREE.DirectionalLight(0xffffff, 1.55); key.position.set(-300, 500, 700); this.scene.add(key);
    const fill = new THREE.DirectionalLight(0x9fc4ff, 0.5); fill.position.set(400, -150, 400); this.scene.add(fill);
    this.camera = new THREE.OrthographicCamera(0, 1, 1, 0, -5000, 5000);
    this.overlay = new Rig(0.95, { fingers: true, hideHeadInner: true });          // only the overlay has tracked fingers
    this.handCache = { left: null, right: null }; this.overlayHands = null;
    this.scene.add(this.overlay.group);
    this.model = new Rig(1.0);
    this.outer = new THREE.Group(); this.inner = new THREE.Group();
    this.outer.add(this.inner); this.inner.add(this.model.group);
    this.scene.add(this.outer);
    this.outer.visible = false;
    this.mode = 'overlay';
    this.view = { yaw: 0, pitch: 0, zoom: 1, cx: 0, cy: 0, fade: 0 };
    this.target = { yaw: 0, pitch: 0, zoom: 1, cx: 0, cy: 0, fade: 0 };
    this.selected = null; this.hover = null;
    this.raycaster = new THREE.Raycaster();
    this.resize(canvas.clientWidth || window.innerWidth, canvas.clientHeight || window.innerHeight);
  }

  resize(w, h) {
    this.W = w; this.H = h;
    this.renderer.setSize(w, h, false);
    Object.assign(this.camera, { left: 0, right: w, top: h, bottom: 0 });
    this.camera.updateProjectionMatrix();
    this.S = (h * 0.74) / 1.75;                  // px per metre for the standing model
    const Q = [];
    for (const [i, [x, y, z]] of Object.entries(CANON)) Q[i] = new THREE.Vector3(x * this.S, -y * this.S, z * this.S);
    for (let i = 0; i < 33; i++) Q[i] ??= null;
    this.model.pose(Q, 0, {});
    this.canonQ = Q;
    // measure the standing model once (no zoom, no turn) so the open view can fit all of it on screen
    this.outer.position.set(0, 0, 0); this.outer.rotation.set(0, 0, 0); this.outer.scale.setScalar(1);
    this.inner.position.set(0, 0, 0); this.scene.updateMatrixWorld(true);
    this.modelBox = new THREE.Box3().setFromObject(this.model.group);
  }

  /** The free part of the screen (px) for the large model: between the side list and the details panel. */
  setViewport(rect) { this.viewport = rect; }

  /** Zoom and centre that show the whole standing model inside the free area. */
  fitModel() {
    const b = this.modelBox, vp = this.viewport || { left: 0, top: 0, right: this.W, bottom: this.H };
    const w = Math.max(1, b.max.x - b.min.x), h = Math.max(1, b.max.y - b.min.y);
    const zoom = Math.min((vp.bottom - vp.top) * 0.9 / h, (vp.right - vp.left) * 0.9 / w);
    return { zoom: Math.max(0.3, zoom), cx: (b.min.x + b.max.x) / 2, cy: (b.min.y + b.max.y) / 2 };
  }

  /** screenPts: 33 {x,y,visibility} in px; world: MediaPipe world landmarks (m).
   *  hands: [{ side: 'left' | 'right', lm: 21 {x,y,z} in px }] from the hand tracker. */
  updateOverlay(screenPts, world, hands = []) {
    if (!screenPts) { this.overlay.group.visible = false; this.overlayQ = null; this.overlayHands = null; return; }
    const ls = screenPts[P.L_SHOULDER], rs = screenPts[P.R_SHOULDER];
    let pxPerM = 600;
    if (world && ls && rs) {
      const wl = world[P.L_SHOULDER], wr = world[P.R_SHOULDER];
      const dm = Math.hypot(wl.x - wr.x, wl.y - wr.y, wl.z - wr.z);
      if (dm > 0.05) pxPerM = Math.hypot(ls.x - rs.x, ls.y - rs.y) / dm;
    }
    this.overlayQ = screenPts.map((p, i) => {
      if (!p || (p.visibility ?? 1) < 0.5) return null;
      const z = world?.[i] ? -world[i].z * pxPerM : 0;
      return new THREE.Vector3(p.x, this.H - p.y, z);
    });
    const wrist = { left: P.L_WRIST, right: P.R_WRIST };
    for (const side of ['left', 'right']) {                 // keep a hand for a few frames if the tracker blinks, so fingers don't flicker
      const h = hands.find((x) => x.side === side);
      if (h) {
        const z0 = this.overlayQ[wrist[side]]?.z ?? 0, w0 = h.lm[0];
        this.handCache[side] = { age: 0, Q: h.lm.map((q) => new THREE.Vector3(q.x, this.H - q.y, z0 - ((q.z || 0) - (w0.z || 0)))) };
      } else if (this.handCache[side]) this.handCache[side].age++;
    }
    const live = (c) => (c && c.age < 8 ? c.Q : null);
    this.overlayHands = { left: live(this.handCache.left), right: live(this.handCache.right) };
  }

  setStatus(statusByRegion) { this.overlay.setStatus(statusByRegion); this.model.setStatus(statusByRegion); }

  open(part) {
    if (!part) return;
    this.mode = 'inspect'; this.selected = part;
    const fit = this.fitModel();                 // the whole body, not just the part: the part is shown by its red glow
    Object.assign(this.target, { zoom: fit.zoom, cx: fit.cx, cy: fit.cy, fade: 1 });
    if (this.view.fade < 0.05) Object.assign(this.view, { yaw: 0, pitch: 0, zoom: fit.zoom * 0.6, cx: fit.cx, cy: fit.cy });
    this.target.yaw = 0; this.target.pitch = 0;
    this.outer.visible = true;
  }

  close() { this.mode = 'overlay'; this.selected = null; this.target.fade = 0; this.target.zoom = 0.6; }

  rotate(dYaw, dPitch) {
    this.target.yaw += dYaw;
    this.target.pitch = Math.max(-0.7, Math.min(0.7, this.target.pitch + dPitch));
  }

  focusPoint() {
    const vp = this.viewport;
    return vp ? { x: (vp.left + vp.right) / 2, y: (vp.top + vp.bottom) / 2 } : { x: this.W * (this.W > 900 ? 0.4 : 0.5), y: this.H * 0.5 };
  }

  /** Which body part of the large model is under a screen point. */
  pick(sx, sy) {
    if (this.mode !== 'inspect') return null;
    const ndc = new THREE.Vector2((sx / this.W) * 2 - 1, -((sy / this.H) * 2 - 1));
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects(this.model.meshes().filter((m) => m.visible), false);
    return hits.length ? hits[0].object.userData.part : null;
  }

  render(t, dt, live) {
    const k = 1 - Math.exp(-dt * 7);
    for (const key of Object.keys(this.view)) this.view[key] += (this.target[key] - this.view[key]) * k;
    const v = this.view;
    if (this.overlayQ) this.overlay.pose(this.overlayQ, t, live, this.overlayHands); else this.overlay.group.visible = false;
    if (v.fade > 0.97) this.overlay.group.visible = false;          // the zoomed model has taken over: don't draw the overlay too
    this.overlay.setOpacity(1 - 0.8 * v.fade);
    if (this.mode === 'inspect') { const fit = this.fitModel(); Object.assign(this.target, { zoom: fit.zoom, cx: fit.cx, cy: fit.cy }); }  // follows panel and window size
    this.overlay.setGlow(this.mode === 'overlay' ? this.selected : null, this.mode === 'overlay' ? this.hover : null, t);
    this.overlay.setTime(t);
    this.model.pose(this.canonQ, t, live);
    this.model.setGlow(this.selected, this.hover, t);
    this.model.setOpacity(v.fade);
    this.model.setTime(t);
    const f = this.focusPoint();
    this.outer.position.set(f.x, this.H - f.y, 0);
    this.outer.rotation.set(v.pitch, v.yaw, 0);
    this.outer.scale.setScalar(v.zoom);
    this.inner.position.set(-v.cx, -v.cy, 0);
    this.outer.visible = v.fade > 0.02;
    this.renderer.render(this.scene, this.camera);
  }

  /** Screen positions (px) of the warning badges for these parts, on whichever body is showing:
   *  the overlay on the person, or the large model once a part is open. [{ part, x, y }] */
  badgeSpots(parts) {
    const rig = this.mode === 'inspect' ? this.model : this.overlay;
    if (!rig.group.visible || !rig.badges || (this.mode === 'inspect' && this.view.fade < 0.6)) return [];
    const spots = [], w = new THREE.Vector3();
    for (const part of parts) {
      const b = rig.badges[part];
      if (!b) continue;
      w.copy(b); rig.group.localToWorld(w);
      spots.push({ part, x: w.x, y: this.H - w.y });
    }
    return spots;
  }
}
