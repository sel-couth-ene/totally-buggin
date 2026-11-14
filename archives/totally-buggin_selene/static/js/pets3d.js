// 3D companions: a kitten, puppy, panda, bunny, giraffe and koala built from simple shapes (all
// original), each with a head, arms and legs. They sit with their legs out in front and walk on
// their legs with their arms swinging. Their face follows how happy they are (moodOf in pets.js):
// big open smile and confetti at the top, a smile, neutral, sad, and crying with tears at the bottom.
// This file only draws; behaviour and layout are in pets.js.

import * as THREE from 'three';
import { moodOf } from './pets.js';

const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);
const lerp = (a, b, k) => a + (b - a) * k;

// ---------------------------------------------------------------- small helpers

const SPH = new THREE.SphereGeometry(1, 28, 20);
const _caps = new Map();
const capsGeo = (r, len) => {
  const k = `${r}|${len}`;
  if (!_caps.has(k)) _caps.set(k, new THREE.CapsuleGeometry(r, len, 6, 14));
  return _caps.get(k);
};
const _mats = new Map();
const std = (color, o = {}) => {
  const k = color + JSON.stringify(o);
  if (!_mats.has(k)) _mats.set(k, new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0, ...o }));
  return _mats.get(k);
};
const basic = (color, o = {}) => new THREE.MeshBasicMaterial({ color, ...o });
const asMat = (m) => (m && m.isMaterial ? m : std(m));

function ell(parent, color, rx, ry, rz, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(SPH, asMat(color));
  m.scale.set(rx, ry, rz); m.position.set(x, y, z);
  parent.add(m); return m;
}
function part(parent, geo, color, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, asMat(color));
  m.position.set(x, y, z); parent.add(m); return m;
}
function grp(parent, x = 0, y = 0, z = 0) {
  const g = new THREE.Group(); g.position.set(x, y, z); parent && parent.add(g); return g;
}
/** A flat patch laid on an ellipsoid surface (spots, stripes). */
function spot(parent, color, dims, x, y, sx, sy) {
  const [rx, ry, rz] = dims;
  const z = rz * Math.sqrt(Math.max(0.02, 1 - (x / rx) ** 2 - (y / ry) ** 2));
  const m = ell(parent, color, sx, sy, 0.035, x, y, z);
  m.rotation.set(-(y / ry) * 0.8, (x / rx) * 0.8, 0);
  return m;
}
function tube(points, radius, mat, parent, x = 0, y = 0, z = 0) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
  return part(parent, new THREE.TubeGeometry(curve, 18, radius, 8), mat, x, y, z);
}

// ---------------------------------------------------------------- the six species

const SP = {
  kitten:  { fur: 0xf6a944, belly: 0xffe2b4, pad: 0xff9fb0, nose: 0xff7b92, hx: 0.64, hy: 0.56, hz: 0.54, scale: 1.0 },
  puppy:   { fur: 0xf2aa52, belly: 0xffdfae, pad: 0x6b4a3a, nose: 0x2a1d22, hx: 0.64, hy: 0.56, hz: 0.55, scale: 1.0 },
  panda:   { fur: 0xfbfbf8, belly: 0xfbfbf8, body: 0x2d2d33, limb: 0x2d2d33, pad: 0x55555d, nose: 0x1b1b20, hx: 0.66, hy: 0.57, hz: 0.56, scale: 1.0 },
  bunny:   { fur: 0xf8d7cc, belly: 0xfff1ec, pad: 0xf59aa6, nose: 0xf2788c, hx: 0.6, hy: 0.56, hz: 0.54, scale: 0.95 },
  giraffe: { fur: 0xf8c94a, belly: 0xfff0cf, foot: 0x5a3a22, pad: 0x3b2616, nose: 0x6a4527, hx: 0.54, hy: 0.47, hz: 0.5, neck: 0.5, scale: 0.8, mouthY: -0.21 },
  koala:   { fur: 0xbcbcc4, belly: 0xe0e0e5, foot: 0xf6ead2, pad: 0xe7aeb0, nose: 0x2b2838, hx: 0.66, hy: 0.58, hz: 0.56, scale: 1.0, mouthY: -0.3 },
};
export const PET_SCALE = Object.fromEntries(Object.entries(SP).map(([k, v]) => [k, v.scale]));

const DARK = 0x15151f;

export class PetModel {
  constructor(species) {
    const S = this.S = SP[species] || SP.kitten;
    this.species = species;
    this.root = new THREE.Group();
    this.pivot = grp(this.root);
    const bodyMat = std(S.body ?? S.fur), limbMat = std(S.limb ?? S.body ?? S.fur), footMat = std(S.foot ?? S.limb ?? S.body ?? S.fur);
    const fur = std(S.fur);
    const bodyH = this.bodyH = S.neck ? 0.5 : 0.43;
    this.body = ell(this.pivot, bodyMat, 0.46, bodyH, 0.40);
    ell(this.pivot, std(S.belly), 0.30, bodyH * 0.7, 0.14, 0, -0.04, 0.3);

    // head (a giraffe's sits on a long neck)
    const { hx, hy, hz } = S;
    const headY = this.headY = S.neck ? 0.62 + S.neck + 0.1 : 0.66;
    this.head = grp(this.pivot, 0, headY, 0.03);
    ell(this.head, fur, hx, hy, hz);
    this.dim = [hx, hy, hz];
    const zOn = (x, y) => hz * Math.sqrt(Math.max(0.03, 1 - (x / hx) ** 2 - (y / hy) ** 2));
    this.zOn = zOn;
    if (S.neck) {
      const total = headY - 0.45;
      part(this.pivot, capsGeo(0.17, total - 0.34), fur, 0, 0.3 + total / 2, 0.0);
    }

    // arms and legs
    this.arms = {}; this.legs = {};
    const hipY = this.hipY = -0.32 * (bodyH / 0.43);
    this.floorY = hipY - 0.415;                                  // where the soles are when standing
    this.sitDrop = -this.floorY - bodyH - 0.035;                 // how far the body drops to rest on the floor
    for (const s of [-1, 1]) {
      const sh = grp(this.pivot, s * 0.4, bodyH * 0.46, 0.05);
      part(sh, capsGeo(0.105, 0.2), limbMat, 0, -0.17, 0);
      const hand = ell(sh, limbMat, 0.125, 0.115, 0.115, 0, -0.34, 0.015);
      this.arms[s] = { pv: sh, hand };
      const hp = grp(this.pivot, s * 0.23, hipY, 0.05);
      part(hp, capsGeo(0.15, 0.14), limbMat, 0, -0.15, 0);
      const fs = S.neck ? 0.85 : 1;
      ell(hp, footMat, 0.175 * fs, 0.105 * fs, 0.23 * fs, 0, -0.32, 0.06);
      ell(hp, std(S.pad), 0.1 * fs, 0.014, 0.14 * fs, 0, -0.32 - 0.098 * fs, 0.06);   // sole, seen from the front when sitting
      this.legs[s] = { pv: hp };
    }

    // face
    this.eyes = [];
    const eyeX = hx * (species === 'koala' ? 0.44 : 0.4), eyeY = hy * 0.06;
    this.eyeX = eyeX; this.eyeY = eyeY;
    this.tearMats = [];
    this.cheekMat = basic(0xff7f98, { transparent: true, opacity: 0.5, depthWrite: false });
    for (const s of [-1, 1]) {
      const ex = s * eyeX, ez = zOn(ex, eyeY);
      const g = grp(this.head, ex, eyeY, ez);
      g.rotation.y = s * 0.38;
      const open = grp(g);
      const k = species === 'koala' ? 0.9 : 1;
      const sclera = ell(open, 0xffffff, 0.118 * k, 0.145 * k, 0.04, 0, 0, -0.014); sclera.visible = false;   // the white of a wide, shocked eye
      const ball = ell(open, DARK, 0.078 * k, 0.1 * k, 0.05);
      const hl = ell(open, 0xffffff, 0.03, 0.03, 0.02, 0.028, 0.035, 0.045);
      ell(open, 0xffffff, 0.014, 0.014, 0.012, -0.025, -0.03, 0.045);
      const happy = part(g, new THREE.TorusGeometry(0.075, 0.017, 8, 20, Math.PI), std(DARK), 0, -0.03, 0.02);
      happy.visible = false;
      const browY = eyeY + 0.17;
      const brow = part(this.head, capsGeo(0.014, 0.09), std(0x3b2a22), ex, browY, zOn(ex, browY) + 0.005);
      brow.visible = false;
      const streak = ell(this.head, basic(0x78cfff, { transparent: true, opacity: 0.5, depthWrite: false }), 0.022, 0.13, 0.01, ex * 1.04, eyeY - 0.17, zOn(ex, eyeY - 0.17) + 0.012);
      streak.visible = false;
      const drops = [0, 1].map(() => {
        const m = basic(0x78cfff, { transparent: true, opacity: 0.9, depthWrite: false });
        this.tearMats.push(m);
        const d = ell(this.head, m, 0.034, 0.05, 0.03, ex, eyeY - 0.1, zOn(ex, eyeY - 0.1) + 0.03);
        d.visible = false; return d;
      });
      const cheek = ell(this.head, this.cheekMat, 0.095, 0.06, 0.02, s * hx * 0.62, -hy * 0.2, zOn(s * hx * 0.62, -hy * 0.2) - 0.005);
      cheek.rotation.y = s * 0.7;
      this.eyes.push({ s, open, hl, happy, brow, streak, drops, ex, ball, sclera, base: [0.078 * k, 0.1 * k, 0.05] });
    }
    this.nosePush = 0; this.mouthPush = 0; this.noseY = -hy * 0.1;
    this.ears = [];
    this.tail = null; this.tailWag = { amp: 0.4, droop: 0.4 };
    this.buildSpecies(species, { fur, zOn, hx, hy, hz });
    const noseZ = zOn(0, this.noseY) + 0.035 + this.nosePush;
    if (species !== 'koala') ell(this.head, species === 'panda' ? std(S.nose, { roughness: 0.35 }) : std(S.nose, { roughness: 0.4 }), 0.055, 0.04, 0.04, 0, this.noseY, noseZ);

    // mouth: a smile line, or an open mouth that is also used for wailing and chewing
    const mouthY = this.mouthY = S.mouthY ?? -hy * 0.3;
    this.mouthAnchor = grp(this.head, 0, mouthY, zOn(0, mouthY) + 0.02 + this.mouthPush);
    const lineMat = std(0x3a2020, { roughness: 0.8 });
    this.mSmile = part(this.mouthAnchor, new THREE.TorusGeometry(0.085, 0.014, 8, 22, Math.PI), lineMat, 0, 0.045, 0);
    this.mSmile.rotation.z = Math.PI;
    this.mOpen = grp(this.mouthAnchor, 0, 0.03, 0.004);
    const hole = new THREE.Mesh(new THREE.CircleGeometry(0.11, 28, Math.PI, Math.PI), basic(0x4a1424, { side: THREE.DoubleSide }));
    this.mOpen.add(hole);
    this.tongue = ell(this.mOpen, basic(0xff7f95), 0.065, 0.04, 0.01, 0, -0.07, 0.003);
    this.mOpen.visible = false;
    this.outfitGroup = null; this.outfit = null; this.antennaBall = null;
    this.floorShift = 0;
  }

  /** Features that make each animal itself. */
  buildSpecies(species, { fur, zOn, hx, hy, hz }) {
    const S = this.S, head = this.head, pivot = this.pivot;
    const addEar = (s, pv, fn) => { this.ears.push({ s, pv, fn }); fn(0, 0); };
    const tailOf = (pts, r, mat, tip, amp, droop, y = -0.12, z = -0.36) => {
      const pv = grp(pivot, 0, y, z);
      tube(pts, r, mat, pv);
      if (tip) { const e = pts[pts.length - 1]; ell(pv, tip.color, tip.r, tip.r, tip.r, e[0], e[1], e[2]); }
      this.tail = pv; this.tailWag = { amp, droop };
    };
    switch (species) {
      case 'kitten': {
        const dark = std(0xd6821f);
        for (const s of [-1, 1]) {
          const pv = grp(head, s * hx * 0.62, hy * 0.8, 0);
          const outer = part(pv, new THREE.ConeGeometry(0.21, 0.38, 3), fur, 0, 0.12, 0); outer.scale.z = 0.55;
          const inner = part(pv, new THREE.ConeGeometry(0.12, 0.26, 3), std(S.pad), 0, 0.08, 0.06); inner.scale.z = 0.5;
          addEar(s, pv, (d, tw) => { pv.rotation.z = -s * (0.32 + 0.6 * d) + tw; });
          for (let j = 0; j < 2; j++) {             // cheek stripes
            const m = ell(head, dark, 0.1, 0.018, 0.02, s * 0.57, -0.02 + j * 0.1, zOn(s * 0.57, -0.02 + j * 0.1) - 0.01);
            m.rotation.set(0, s * 0.9, s * 0.15 * (j ? 1 : -1));
          }
          for (let j = 0; j < 2; j++) ell(pivot, dark, 0.03, 0.09, 0.05, s * 0.435, 0.12 - j * 0.15, 0.04);   // body stripes
          for (let i = 0; i < 3; i++) {             // whiskers
            const w = part(head, capsGeo(0.006, 0.34), std(0x7a5233), s * 0.66, -0.13 + (i - 1) * 0.055, 0.3);
            w.rotation.z = Math.PI / 2 + s * (i - 1) * 0.2;
          }
        }
        for (const x of [-0.07, 0, 0.07]) {          // forehead stripes
          const m = ell(head, dark, 0.022, 0.085, 0.02, x, hy * 0.62, zOn(x, hy * 0.62) - 0.005);
          m.rotation.x = -0.5; m.rotation.z = -x * 2.5;
        }
        tailOf([[0, 0, 0], [0, 0.02, -0.2], [0, 0.22, -0.38], [0, 0.5, -0.42]], 0.065, fur, { color: dark, r: 0.075 }, 0.45, 0.5);
        break;
      }
      case 'puppy': {
        const earMat = std(0xcc8836);
        for (const s of [-1, 1]) {
          const pv = grp(head, s * hx * 0.8, hy * 0.5, -0.02);
          ell(pv, earMat, 0.17, 0.31, 0.1, 0, -0.2, 0);
          addEar(s, pv, (d, tw) => { pv.rotation.z = s * (0.28 + 0.25 * d) + tw; });
        }
        ell(head, std(S.belly), 0.27, 0.17, 0.15, 0, -0.2, zOn(0, -0.2) + 0.03);       // muzzle
        const ex = this.eyeX, ez = zOn(ex, this.eyeY);
        const patch = ell(head, std(0xd9953f), 0.17, 0.17, 0.04, ex, this.eyeY, ez - 0.012);   // eye patch
        patch.rotation.y = 0.38;
        this.noseY = -0.1; this.nosePush = 0.1; this.mouthPush = 0.15;
        tailOf([[0, 0, 0], [0, 0.06, -0.16], [0, 0.22, -0.26]], 0.07, fur, null, 0.8, 0.3);
        break;
      }
      case 'panda': {
        const black = std(0x2d2d33);
        for (const s of [-1, 1]) {
          const pv = grp(head, s * hx * 0.74, hy * 0.78, -0.06);
          ell(pv, black, 0.19, 0.19, 0.11);
          addEar(s, pv, (d, tw) => { pv.rotation.z = -s * 0.1 * d + tw; });
          const ex = this.eyeX * s, ez = zOn(ex, this.eyeY);
          const p = ell(head, std(0x3c3c44), 0.15, 0.19, 0.05, ex, this.eyeY - 0.01, ez - 0.012);   // eye patch
          p.rotation.set(0, s * 0.38, s * 0.5);
        }
        const tl = grp(pivot, 0, -0.14, -0.38); ell(tl, std(0xfbfbf8), 0.15, 0.15, 0.15); this.tail = tl;
        this.tailWag = { amp: 0.15, droop: 0.2 };
        break;
      }
      case 'bunny': {
        const pink = std(0xf59aa0);
        for (const s of [-1, 1]) {
          const pv = grp(head, s * 0.22, hy * 0.82, 0);
          part(pv, capsGeo(0.13, 0.5), fur, 0, 0.38, 0);
          ell(pv, pink, 0.07, 0.3, 0.03, 0, 0.38, 0.11);
          addEar(s, pv, (d, tw) => { pv.rotation.z = -s * (0.14 + 0.95 * d) + tw; pv.rotation.x = -0.45 * d; });
        }
        const tl = grp(pivot, 0, -0.18, -0.4); ell(tl, std(0xffffff), 0.17, 0.17, 0.17); this.tail = tl;
        this.tailWag = { amp: 0.25, droop: 0.2 };
        break;
      }
      case 'giraffe': {
        const spotC = std(0xb87a34), dims = [0.46, this.bodyH, 0.4];
        for (const [x, y, sx, sy] of [[-0.2, 0.14, 0.1, 0.085], [0.22, -0.02, 0.09, 0.08], [-0.1, -0.2, 0.08, 0.07], [0.06, 0.28, 0.07, 0.06]]) spot(pivot, spotC, dims, x, y, sx, sy);
        for (const [y, x, r] of [[0.78, -0.07, 0.07], [0.96, 0.09, 0.065], [1.14, -0.06, 0.06]]) ell(pivot, spotC, r, r * 0.9, 0.03, x, y, 0.16);   // neck spots
        for (const [x, y, sx, sy] of [[-0.26, 0.28, 0.07, 0.06], [0.3, 0.26, 0.065, 0.055], [-0.1, 0.36, 0.05, 0.045]]) spot(head, spotC, [hx, hy, hz], x, y, sx, sy);
        for (const s of [-1, 1]) {
          const horn = grp(head, s * 0.16, hy * 0.95 + 0.04, 0);
          horn.rotation.z = -s * 0.12;
          part(horn, new THREE.CylinderGeometry(0.035, 0.045, 0.22, 10), fur, 0, 0.1, 0);
          ell(horn, std(0x8a5a2b), 0.065, 0.065, 0.065, 0, 0.22, 0);
          const pv = grp(head, s * hx * 0.93, hy * 0.3, 0);
          ell(pv, fur, 0.17, 0.09, 0.05, s * 0.1, 0, 0);
          ell(pv, std(0xf59aa0), 0.1, 0.055, 0.03, s * 0.1, 0, 0.03);
          addEar(s, pv, (d, tw) => { pv.rotation.z = s * (0.35 - 0.85 * d) + tw; });
        }
        const mz = ell(head, std(0xfff3dc), 0.3, 0.22, 0.2, 0, -hy * 0.4, zOn(0, -0.18) + 0.05);   // cream muzzle
        mz.userData.muzzle = true;
        this.noseY = -0.13; this.nosePush = 0.25; this.mouthPush = 0.27;       // the cream muzzle sticks out, so nose and mouth sit on its front
        tailOf([[0, 0, 0], [0, -0.12, -0.14], [0, -0.3, -0.18], [0, -0.45, -0.16]], 0.03, fur, { color: std(0x5a3a22), r: 0.07 }, 0.3, 0.2, -0.05, -0.38);
        break;
      }
      case 'koala': {
        const inner = std(0x7d7d88), rim = std(0xdadae0);
        for (const s of [-1, 1]) {
          const pv = grp(head, s * hx * 0.82, hy * 0.62, -0.08);
          ell(pv, std(0xb2b2ba), 0.3, 0.3, 0.15);
          ell(pv, inner, 0.19, 0.19, 0.06, 0, 0, 0.12);
          for (let k = 0; k < 12; k++) {             // fluffy edge
            const a = (k / 12) * TAU;
            ell(pv, rim, 0.075, 0.075, 0.055, Math.cos(a) * 0.3, Math.sin(a) * 0.3, 0.02);
          }
          addEar(s, pv, (d, tw) => { pv.rotation.z = -s * 0.12 * d + tw; });
        }
        ell(head, std(S.nose, { roughness: 0.3 }), 0.14, 0.16, 0.1, 0, 0.03, zOn(0, 0.03) + 0.07);   // big nose
        this.mouthPush = 0.06;
        const lf = std(0x7cc242);                     // a eucalyptus sprig in its left hand
        const sprig = grp(this.arms[-1].pv, 0, -0.36, 0.12);
        for (const [a, y] of [[0.5, 0.12], [-0.5, 0.2]]) { const l = ell(sprig, lf, 0.06, 0.19, 0.02, 0, y, 0); l.rotation.z = a; }
        break;
      }
      default: break;
    }
  }

  setOutfit(id) {
    if (id === this.outfit) return;
    if (this.outfitGroup) { this.outfitGroup.parent?.remove(this.outfitGroup); this.outfitGroup = null; this.antennaBall = null; }
    this.outfit = id;
    if (id) this.outfitGroup = buildOutfit(id, this);
  }

  mouthWorld(out) { this.root.updateMatrixWorld(true); return this.mouthAnchor.getWorldPosition(out); }

  /** s: { t, sit, walk, walkT, yaw, mood, blink, act, armsUp, eat } */
  pose(s) {
    const { t, sit, walk, mood } = s, [hx, hy] = this.dim;
    const sw = Math.sin(s.walkT * 9);
    const droop = mood === 'cry' ? 1 : mood === 'sad' ? 0.6 : 0;
    const act = s.act, eat = s.eat, up = s.armsUp || 0, wv = s.wave || 0, lift = s.lift || 0;
    this.root.rotation.set(0.17, s.yaw, s.swing || 0);                     // swing: it dangles when carried
    const breathe = Math.sin(t * 2.2) * 0.012;
    this.pivot.position.set(mood === 'cry' ? Math.sin(t * 38) * 0.008 : 0, -this.sitDrop * sit + Math.abs(sw) * 0.075 * walk - droop * 0.02, 0);
    this.body.scale.set(0.46 * (1 + breathe * 0.5), this.bodyH * (1 + breathe), 0.4);

    this.head.position.y = this.headY + Math.abs(sw) * 0.03 * walk;
    this.head.rotation.set(droop * 0.2 - (eat ? 0.04 : 0), Math.sin(t * 0.9) * 0.1 * (1 - walk) + lift * Math.sin(t * 8) * 0.08,
      Math.sin(t * 1.3) * 0.04 + up * Math.sin(t * 6) * 0.05 + lift * 0.24);     // a confused head tilt when carried

    for (const side of [-1, 1]) {
      const leg = this.legs[side].pv, arm = this.arms[side].pv;
      // legs: swing while walking, stretch out in front when sitting, kick when asked
      let lx = sw * 0.75 * walk * side * (1 - sit) + -1.42 * sit;
      let lz = side * (0.22 * sit + 0.05 * (1 - sit));
      if (act?.kind === 'kick' && side > 0) lx = -1.35 * Math.sin(Math.PI * act.p);
      if (lift > 0.01) { lx = lerp(lx, 0.12 + Math.sin(t * 9 + side) * 0.5, lift); lz = lerp(lz, side * 0.14, lift); }   // legs dangle and kick
      leg.rotation.set(lx, 0, lz);
      // arms
      let ax = -sw * 0.9 * walk * side * (1 - sit) + -0.45 * sit;
      let az = side * 0.14 * (1 - sit) - side * 0.28 * sit;
      if (act?.kind === 'bat' && side > 0) { ax = -2.1 * Math.sin(Math.PI * act.p); az = -0.1; }
      if (act && (act.kind === 'grab' || act.kind === 'fly')) {
        const g = act.kind === 'fly' ? 1 : act.p;
        ax = lerp(ax, -2.55, g); az = lerp(az, -side * 0.28, g);
      }
      if (wv > 0.01) {                       // beaming: both hands up, waving
        ax = lerp(ax, -0.2, wv); az = lerp(az, side * (2.05 + 0.5 * Math.sin(t * 7 + (side > 0 ? 0 : 1.1))), wv);
      }
      if (up > 0.01) { ax = lerp(ax, 0, up); az = lerp(az, side * (2.45 + Math.sin(t * 12) * 0.22), up); }
      if (eat && eat.arm > 0.01) {
        ax = lerp(ax, -2.15 - Math.sin(t * 15) * 0.05 * eat.open, eat.arm);
        az = lerp(az, -side * 0.5, eat.arm);
      }
      if (lift > 0.01) { ax = lerp(ax, Math.sin(t * 10) * 0.5, lift); az = lerp(az, side * (2.15 + Math.sin(t * 13 + side * 1.7) * 0.4), lift); }   // arms flail
      arm.rotation.set(ax, 0, az);
    }

    // ears and tail
    const happyWag = { confetti: 14, bigsmile: 12, smile: 8, neutral: 3, sad: 1.2, cry: 0.8, shocked: 20 }[mood];
    for (const e of this.ears) e.fn(droop, Math.pow(Math.max(0, Math.sin(t * 1.7 + e.s * 2)), 24) * 0.22);
    if (this.tail) {
      this.tail.rotation.set(droop * this.tailWag.droop, Math.sin(t * happyWag) * this.tailWag.amp, 0);
    }

    this.face(mood, t, s.blink, eat);
    if (this.antennaBall) this.antennaBall.scale.setScalar(0.065 * (1 + 0.25 * Math.sin(t * 6)));
  }

  face(mood, t, blink, eat) {
    const big = mood === 'bigsmile' || mood === 'confetti', sad = mood === 'sad', cry = mood === 'cry', shocked = mood === 'shocked';
    const eating = !!eat && eat.open > 0.02;
    for (const e of this.eyes) {
      e.open.visible = !big; e.happy.visible = big;
      const wide = shocked ? 1.22 : 1;                                  // shocked: wide eyes with tiny pupils
      e.open.scale.set(wide, shocked ? wide : blink ? 0.1 : cry ? 0.62 : sad ? 0.88 : 1, 1);
      e.sclera.visible = shocked;
      e.ball.scale.set(e.base[0] * (shocked ? 0.62 : 1), e.base[1] * (shocked ? 0.62 : 1), e.base[2]);
      e.hl.scale.setScalar(0.03 * (sad || cry ? 1.35 : shocked ? 1.6 : 1));      // 0.03 is its resting size
      e.brow.visible = sad || cry || shocked;
      if (shocked) {                                                    // confused: one brow high and arched, the other low and slanted
        const hi = e.s < 0;
        e.brow.rotation.z = -Math.PI / 2 - e.s * (hi ? -0.3 : 0.55);
        e.brow.position.y = this.eyeY + (hi ? 0.29 : 0.14);
      } else {
        e.brow.rotation.z = -Math.PI / 2 - e.s * (cry ? 0.62 : 0.42);
        e.brow.position.y = this.eyeY + (cry ? 0.15 : 0.17);
      }
      e.streak.visible = cry;
      e.drops.forEach((d, k) => {
        d.visible = cry;
        if (!cry) return;
        const u = (t * 1.1 + k * 0.5 + (e.s > 0 ? 0.2 : 0)) % 1;
        d.position.y = this.eyeY - 0.08 - u * 0.4;
        d.position.x = e.ex * (1 + u * 0.1);
        d.scale.set(0.034 * (1 - 0.3 * u), 0.05 * (1 - 0.2 * u), 0.03);
        this.tearMats[e.s > 0 ? 2 + k : k].opacity = 0.95 * (1 - u * u);
      });
    }
    this.cheekMat.opacity = big ? 0.78 : mood === 'smile' ? 0.55 : sad ? 0.18 : cry || shocked ? 0.12 : 0.3;
    // mouth
    const S = this.mSmile, O = this.mOpen;
    S.visible = false; O.visible = false;
    O.rotation.z = 0; this.tongue.visible = true;
    if (eating || (eat && eat.chewing)) {
      O.visible = true;
      const o = Math.max(0.05, eat.open);
      O.scale.set(0.7 + 0.3 * o, 0.12 + 0.95 * o, 1);
    } else if (shocked) {                                              // a small, gaping "o"
      O.visible = true; this.tongue.visible = false; O.position.y = 0.03;
      O.scale.set(0.5 + 0.05 * Math.sin(t * 12), 0.66, 1);
    } else if (cry) {
      O.visible = true; O.rotation.z = Math.PI; this.tongue.visible = false;
      O.position.y = 0.06;
      const w = Math.sin(t * 9);
      O.scale.set(0.8 + 0.08 * w, 0.95 + 0.2 * Math.sin(t * 9 + 1), 1);
    } else if (big) {
      O.visible = true; O.position.y = 0.03;
      O.scale.set(mood === 'confetti' ? 1.15 : 1, mood === 'confetti' ? 1.15 : 1, 1);
    } else if (mood === 'smile') {
      S.visible = true; S.rotation.z = Math.PI; S.position.y = 0.045; S.scale.set(1, 1, 1);
    } else if (sad) {
      S.visible = true; S.rotation.z = 0; S.position.y = -0.045; S.scale.set(0.8, 0.8, 1);
    } else {
      S.visible = true; S.rotation.z = Math.PI; S.position.y = 0.0; S.scale.set(0.55, 0.12, 1);
    }
    if (!cry) O.position.y = 0.03;
    // chewing puffs the cheeks
    this.head.scale.set(1 + (eat?.chewing ? 0.025 * eat.open : 0), 1, 1);
  }
}

// ---------------------------------------------------------------- outfits

function buildOutfit(id, m) {
  const [hx, hy, hz] = m.dim, g = new THREE.Group();
  const longNeck = !!m.S.neck;
  if (id === 'bubble_helmet') {
    const R = Math.max(hx, hy, hz) * 1.3;
    const glass = new THREE.Mesh(SPH, new THREE.MeshPhysicalMaterial({ color: 0xcfe9ff, transparent: true, opacity: 0.2, roughness: 0.05, clearcoat: 1, depthWrite: false }));
    glass.scale.set(R, R * 1.04, R); glass.renderOrder = 5; g.add(glass);
    const hi = part(g, new THREE.TorusGeometry(R * 0.82, 0.022, 6, 24, 1.1), basic(0xffffff, { transparent: true, opacity: 0.7 }), 0, R * 0.05, R * 0.55);
    hi.rotation.z = Math.PI * 0.55;
    const ring = part(g, new THREE.TorusGeometry(R * 0.76, 0.07, 10, 32), std(0xdfe6ee, { metalness: 0.4, roughness: 0.35 }), 0, -hy * 0.95, 0);
    ring.rotation.x = Math.PI / 2;
    m.head.add(g);
  } else if (id === 'scarf') {
    const parent = longNeck ? m.pivot : m.head;
    const y = longNeck ? 0.82 : -hy * 0.9, r = longNeck ? 0.23 : hx * 0.72;
    const ring = part(g, new THREE.TorusGeometry(r, 0.1, 12, 36), std(0xff5b1f), 0, y, 0);
    ring.rotation.x = Math.PI / 2; ring.scale.set(1, 1.05, 1.6);
    for (const dy of [-0.045, 0, 0.045]) { const s = part(g, new THREE.TorusGeometry(r + 0.005, 0.022, 8, 36), std(0xffd34d), 0, y + dy, 0); s.rotation.x = Math.PI / 2; s.scale.set(1, 1.05, 1.6); }
    const tail = part(g, new THREE.BoxGeometry(0.17, 0.4, 0.06), std(0xff5b1f), r * 0.45, y - 0.22, r * 1.0);
    tail.rotation.set(0.1, 0, -0.12);
    part(g, new THREE.BoxGeometry(0.17, 0.05, 0.065), std(0xffd34d), r * 0.45 - 0.03, y - 0.3, r * 1.0 + 0.005).rotation.set(0.1, 0, -0.12);
    parent.add(g);
  } else if (id === 'bowtie') {
    const parent = longNeck ? m.pivot : m.head;
    const y = longNeck ? 0.84 : -hy * 0.9, z = longNeck ? 0.2 : m.zOn(0, -hy * 0.9) + 0.06;
    for (const s of [-1, 1]) { const c = part(g, new THREE.ConeGeometry(0.13, 0.24, 18), std(0xd03b3b), s * 0.12, y, z); c.rotation.z = -s * Math.PI / 2; c.scale.z = 0.7; }
    ell(g, std(0xb02a2a), 0.065, 0.065, 0.06, 0, y, z);
    parent.add(g);
  } else if (id === 'antenna_cap') {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 14, 0, TAU, 0, Math.PI / 2), std(0x2f6fd6));
    cap.scale.set(hx * 0.8, hy * 0.62, hz * 0.8); cap.position.set(0, hy * 0.46, 0.03); cap.rotation.x = -0.2;
    g.add(cap);
    const brim = part(g, new THREE.TorusGeometry(hx * 0.78, 0.045, 8, 28), std(0x2459ad), 0, hy * 0.5, 0.03); brim.rotation.x = Math.PI / 2 - 0.2; brim.scale.set(1, 0.95, 1);
    part(g, new THREE.CylinderGeometry(0.018, 0.018, 0.26, 8), std(0xcfd8e3), 0, hy * 0.46 + hy * 0.62 + 0.1, 0.0);
    m.antennaBall = ell(g, basic(0xffd34d), 0.065, 0.065, 0.065, 0, hy * 0.46 + hy * 0.62 + 0.25, 0);
    m.head.add(g);
  }
  return g;
}

// ---------------------------------------------------------------- toys and snacks

const TOY_SIZE = { star_ball: 15, mini_rocket: 12, yarn_comet: 13 };

export function makeToy(kind) {
  const g = new THREE.Group();
  g.userData.size = TOY_SIZE[kind] || 13;
  if (kind === 'star_ball') {
    const shape = new THREE.Shape();
    for (let i = 0; i < 10; i++) {
      const a = (i * Math.PI) / 5 - Math.PI / 2, r = i % 2 ? 0.5 : 1;
      i ? shape.lineTo(Math.cos(a) * r, Math.sin(a) * r) : shape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.5, bevelEnabled: true, bevelThickness: 0.14, bevelSize: 0.1, bevelSegments: 3 });
    geo.center();
    const m = new THREE.Mesh(geo, std(0xffd34d, { emissive: 0x6a4a00, emissiveIntensity: 0.35, roughness: 0.4 }));
    g.add(m); g.userData.spin = m;
  } else if (kind === 'mini_rocket') {
    part(g, new THREE.CylinderGeometry(0.4, 0.4, 1.3, 20), std(0xf1f4f8, { roughness: 0.35 }), 0, 0, 0);
    part(g, new THREE.ConeGeometry(0.4, 0.62, 20), std(0xd03b3b), 0, 0.96, 0);
    ell(g, std(0x2f6fd6, { roughness: 0.2 }), 0.17, 0.17, 0.1, 0, 0.22, 0.38);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * TAU, f = part(g, new THREE.BoxGeometry(0.08, 0.5, 0.36), std(0xd03b3b), Math.cos(a) * 0.42, -0.55, Math.sin(a) * 0.42);
      f.rotation.y = -a;
    }
    const flame = part(g, new THREE.ConeGeometry(0.24, 0.7, 14), basic(0xff9f43), 0, -1.0, 0); flame.rotation.x = Math.PI;
    flame.visible = false; g.userData.flame = flame;
  } else if (kind === 'yarn_comet') {
    ell(g, std(0xb07cff, { roughness: 0.85 }), 1, 1, 1);
    for (let i = 0; i < 3; i++) {
      const r = part(g, new THREE.TorusGeometry(1.01, 0.07, 8, 32), std(0x8a55e0, { roughness: 0.9 }));
      r.rotation.set(i * 1.05, i * 0.7, i * 0.4);
    }
    g.userData.ball = true;
  }
  return g;
}

export function makeSnack(id) {
  const g = new THREE.Group();
  if (id === 'stardust_cookie') {
    part(g, new THREE.CylinderGeometry(1, 1, 0.38, 28), std(0xc98b4a), 0, 0, 0).rotation.x = Math.PI / 2;
    for (let i = 0; i < 6; i++) ell(g, std(0xfff6c2), 0.13, 0.13, 0.1, Math.cos(i * 1.3) * 0.5, Math.sin(i * 1.9) * 0.5, 0.2);
  } else if (id === 'freeze_dried_icecream') {
    part(g, new THREE.BoxGeometry(0.62, 1.2, 0.8), std(0xf7d6e0), -0.62, 0, 0);
    part(g, new THREE.BoxGeometry(0.62, 1.2, 0.8), std(0xfff4d6), 0, 0, 0);
    part(g, new THREE.BoxGeometry(0.62, 1.2, 0.8), std(0x7a4b2a), 0.62, 0, 0);
  } else {
    ell(g, std(0xb5179e, { roughness: 0.35 }), 1, 1, 1);
    const leaf = ell(g, std(0x3aa655), 0.5, 0.2, 0.15, 0.25, 1.0, 0); leaf.rotation.z = -0.5;
    part(g, new THREE.CylinderGeometry(0.05, 0.05, 0.3, 6), std(0x5a3a22), 0, 1.0, 0);
  }
  g.userData.size = 12;
  return g;
}

// ---------------------------------------------------------------- confetti, hearts, labels

class Confetti {
  constructor() {
    this.N = 44;
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(7, 11), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), this.N);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    const cols = [0xff5c7a, 0xffd34d, 0x4cc9f0, 0x7bd88f, 0xb07cff, 0xff9f43].map((c) => new THREE.Color(c));
    this.seed = Array.from({ length: this.N }, (_, i) => {
      this.mesh.setColorAt(i, cols[i % cols.length]);
      return { x: rand(-70, 70), ph: Math.random(), sp: rand(0.35, 0.62), r: [rand(0, 6), rand(0, 6), rand(0, 6)], w: [rand(2, 6), rand(2, 6), rand(1, 4)] };
    });
    this.dummy = new THREE.Object3D();
  }
  update(t, x, topY, H, fade = 1, z = 70) {
    this.seed.forEach((s, i) => {
      const u = (t * s.sp + s.ph) % 1, d = this.dummy;
      d.position.set(x + s.x + Math.sin(t * 2 + s.ph * 9) * 8, H - (topY + u * 200), z);
      d.scale.setScalar(fade);
      d.rotation.set(s.r[0] + t * s.w[0], s.r[1] + t * s.w[1], s.r[2] + t * s.w[2]);
      d.updateMatrix(); this.mesh.setMatrixAt(i, d.matrix);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

function shockSprite() {                                  // a "?!" bubble above a companion that is being carried
  const c = document.createElement('canvas'); c.width = 128; c.height = 72;
  const x = c.getContext('2d');
  x.fillStyle = 'rgba(20,33,61,0.92)'; x.beginPath(); x.roundRect(4, 4, 120, 50, 18); x.fill();
  x.beginPath(); x.moveTo(40, 52); x.lineTo(30, 68); x.lineTo(58, 52); x.fill();
  x.fillStyle = '#ffd34d'; x.font = '700 38px Archivo, system-ui, sans-serif'; x.textAlign = 'center'; x.fillText('?!', 64, 42);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sp.scale.set(52, 29, 1); sp.renderOrder = 70;
  return sp;
}

function heartTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d'); x.fillStyle = '#ff5c7a'; x.beginPath();
  x.moveTo(32, 54); x.bezierCurveTo(2, 34, 10, 6, 32, 20); x.bezierCurveTo(54, 6, 62, 34, 32, 54); x.fill();
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function labelCanvas(name, happiness) {
  const c = document.createElement('canvas'), x = c.getContext('2d');
  x.font = '600 26px Archivo, system-ui, sans-serif';
  const w = Math.max(Math.ceil(x.measureText(name).width) + 40, 148), h = 60;
  c.width = w; c.height = h;
  x.font = '600 26px Archivo, system-ui, sans-serif'; x.textAlign = 'center';
  x.fillStyle = 'rgba(233,238,242,0.94)'; x.beginPath(); x.roundRect(0, 0, w, h, 16); x.fill();
  x.fillStyle = '#14213d'; x.fillText(name, w / 2, 28);
  x.fillStyle = 'rgba(20,33,61,0.15)'; x.fillRect(20, 40, w - 40, 8);
  x.fillStyle = happiness < 30 ? '#d03b3b' : happiness < 50 ? '#ec835a' : '#0ca30c';
  x.fillRect(20, 40, (w - 40) * Math.max(0, Math.min(1, happiness / 100)), 8);
  return c;
}

class Ribbon {
  constructor(max = 28) {
    this.max = max;
    this.geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 2 * 3);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    const idx = [];
    for (let i = 0; i < max - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    this.geo.setIndex(idx);
    this.mesh = new THREE.Mesh(this.geo, new THREE.MeshBasicMaterial({ color: 0xb07cff, side: THREE.DoubleSide }));
    this.mesh.frustumCulled = false;
  }
  update(points) {                       // points: [{x, y}] in scene px, oldest first
    const n = Math.min(points.length, this.max);
    this.mesh.visible = n >= 2;
    if (n < 2) return;
    for (let i = 0; i < n; i++) {
      const p = points[points.length - n + i], q = points[Math.min(points.length - 1, points.length - n + i + 1)], o = points[Math.max(0, points.length - n + i - 1)];
      let dx = q.x - o.x, dy = q.y - o.y; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
      const w = 1.7 * (i / (n - 1) + 0.15);
      this.pos.set([p.x - dy * w, p.y + dx * w, 12, p.x + dy * w, p.y - dx * w, 12], i * 6);
    }
    this.geo.setDrawRange(0, (n - 1) * 6);
    this.geo.attributes.position.needsUpdate = true;
  }
}

function addLights(scene) {
  scene.add(new THREE.HemisphereLight(0xffffff, 0xb9c3e6, 1.5));
  const d = new THREE.DirectionalLight(0xffffff, 2.2);
  d.position.set(-220, 380, 600); scene.add(d);
  const f = new THREE.DirectionalLight(0xbcd0ff, 0.6);
  f.position.set(300, -100, 300); scene.add(f);
}

// ---------------------------------------------------------------- pose state shared by the screen and the shop

/** What the model needs to pose, from a companion and its behaviour state. */
function poseState(p, a, t) {
  const mood = a?.drag ? 'shocked' : moodOf(p.happiness);          // being carried: shocked and confused, whatever its happiness
  const eatRaw = a?.eat;
  let eat = null;
  if (eatRaw) {
    const tt = eatRaw.t, chewStart = 0.55, chewEnd = eatRaw.dur - 0.45;
    const chewing = tt >= chewStart && tt < chewEnd;
    eat = {
      chewing, tt,
      open: chewing ? 0.25 + 0.75 * Math.abs(Math.sin((tt - chewStart) * Math.PI * 2.4)) : tt < chewStart ? clamp01((tt - (chewStart - 0.25)) / 0.25) * 0.55 : 0,
      arm: clamp01(tt / 0.4) * (tt < chewEnd ? 1 : clamp01(1 - (tt - chewEnd) / 0.3)),
      chewStart, chewEnd, kind: eatRaw.snack,
    };
  }
  const sit = a ? a.sit : 1, walk = a ? a.walk : 0, face = a ? a.facing : -1;
  return {
    t, sit, walk, walkT: a ? a.walkT : 0, mood,
    yaw: face * (0.85 * walk + 0.5 * (1 - sit) * (1 - walk)) * (1 - (a ? a.lift : 0)),
    blink: ((t + (a ? a.blinkAt : 0)) % 3.6) < 0.13,
    lift: a ? a.lift : 0, swing: a ? a.swing : 0,
    act: a ? a.act : null, armsUp: a ? a.armsUp : 0, wave: a ? a.wave : 0, confetti: a ? a.confettiT : 0, eat,
  };
}
const clamp01 = (v) => Math.max(0, Math.min(1, v));

/** Put a snack near the mouth: it flies in, then shrinks bite by bite. Returns false when it is gone. */
function placeSnack(obj, eat, mouth, unit, start) {
  const { tt, chewStart, chewEnd } = eat;
  const size = unit * 0.2 * (obj.userData.size / 12);       // about a fifth of a model unit: a snack in the paws
  if (tt >= chewEnd) { obj.visible = false; return; }
  obj.visible = true;
  const target = new THREE.Vector3(mouth.x, mouth.y - 0.3 * unit, mouth.z + 0.42 * unit);   // held in the paws just below the chin, so the chewing shows
  if (tt < chewStart) {
    const u = tt / chewStart, e = u * u * (3 - 2 * u);
    obj.position.set(lerp(start.x, target.x, e), lerp(start.y, target.y, e) + Math.sin(u * Math.PI) * 0.4 * unit, lerp(start.z, target.z, e));
    obj.scale.setScalar(size);
  } else {
    const bites = 3, k = Math.min(bites - 1, Math.floor(((tt - chewStart) / (chewEnd - chewStart)) * bites));
    obj.position.copy(target);
    obj.scale.setScalar(size * (1 - 0.3 * k));
  }
  obj.rotation.z = Math.sin(tt * 4) * 0.15;
}

// ---------------------------------------------------------------- the screen renderer

export class PetView {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    this.renderer.setClearColor(0x000000, 0);
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(0, 1, 1, 0, -2000, 2000);
    addLights(this.scene);
    this.entries = new Map();
    this.hearts = [];
    this.heartTex = heartTexture();
    this.W = 1; this.H = 1;
  }

  resize(w, h, dpr) {
    this.W = w; this.H = h;
    this.renderer.setPixelRatio(dpr || 1);
    this.renderer.setSize(w, h, false);
    Object.assign(this.camera, { left: 0, right: w, top: h, bottom: 0 });
    this.camera.updateProjectionMatrix();
  }

  entry(p) {
    let e = this.entries.get(p.uid);
    if (e && e.species !== p.species) { this.drop(p.uid); e = null; }
    if (!e) {
      const model = new PetModel(p.species);
      this.scene.add(model.root);
      const shadow = new THREE.Mesh(new THREE.CircleGeometry(1, 32), basic(0x101a33, { transparent: true, opacity: 0.32, depthWrite: false }));
      this.scene.add(shadow);
      const label = new THREE.Sprite(new THREE.SpriteMaterial({ depthTest: false, transparent: true }));
      label.renderOrder = 50; this.scene.add(label);
      e = { species: p.species, model, shadow, label, labelKey: '', confetti: null, toy: null, snack: null, ribbon: null };
      this.entries.set(p.uid, e);
    }
    return e;
  }

  drop(uid) {
    const e = this.entries.get(uid);
    if (!e) return;
    for (const o of [e.model.root, e.shadow, e.label, e.confetti?.mesh, e.toy?.obj, e.snack?.obj, e.ribbon?.mesh, e.shock]) o && this.scene.remove(o);
    this.entries.delete(uid);
  }

  render(layer, t) {
    const H = this.H, seen = new Set();
    let heartN = 0;
    for (const p of layer.pets) {
      seen.add(p.uid);
      const e = this.entry(p), a = layer.state(p), c = layer.pos(p), home = layer.center(p);
      const K = 54 * (SP[p.species] || SP.kitten).scale, m = e.model;
      m.setOutfit(p.outfit || null);
      const st = poseState(p, a, t);
      m.pose(st);
      const sq = a.land > 0 ? Math.sin(Math.PI * (1 - a.land / 0.28)) : 0;       // a little squash when it lands
      m.root.scale.set(K * (1 + 0.1 * sq), K * (1 - 0.14 * sq), K);
      const floorScreen = c.y + 44;
      m.root.position.set(c.x, H - floorScreen - m.floorY * K, c.y * 0.6);          // lower on screen = nearer
      m.root.updateMatrixWorld(true);
      e.shadow.position.set(c.x, H - floorScreen - 1, c.y * 0.6 - 45);
      e.shadow.scale.set(K * 0.62 * (0.9 + 0.1 * st.sit), K * 0.14, 1);
      // name tag and happiness bar
      const key = `${p.name}|${Math.round(p.happiness)}`;
      if (key !== e.labelKey) {
        e.labelKey = key;
        const cv = labelCanvas(p.name, p.happiness), old = e.label.material.map;
        const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
        e.label.material.map = tex; e.label.material.needsUpdate = true; old?.dispose();
        e.label.scale.set(cv.width / 2, cv.height / 2, 1);
      }
      e.label.position.set(c.x, H - (c.y + 44 + 24), 80);
      if (a.drag) {
        if (!e.shock) { e.shock = shockSprite(); this.scene.add(e.shock); }
        e.shock.visible = true; e.shock.position.set(c.x + 30, H - (c.y - 84 + Math.sin(t * 10) * 3), 95);
      } else if (e.shock) e.shock.visible = false;
      // confetti at full happiness
      if (st.confetti > 0) {
        if (!e.confetti) { e.confetti = new Confetti(); this.scene.add(e.confetti.mesh); }
        e.confetti.mesh.visible = true;
        e.confetti.update(t, c.x, c.y - 150, H, Math.min(1, st.confetti / 0.6), c.y * 0.6 + 70);
      } else if (e.confetti) e.confetti.mesh.visible = false;
      this.renderToy(e, p, a, home, H, t);
      this.renderSnack(e, a, st, m, home, c, K, H);
      // petting hearts
    }
    for (const id of [...this.entries.keys()]) if (!seen.has(id)) this.drop(id);
    for (const h of layer.hearts) {
      if (h.age < 0) continue;
      let s = this.hearts[heartN];
      if (!s) { s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.heartTex, transparent: true, depthTest: false })); s.renderOrder = 60; this.scene.add(s); this.hearts.push(s); }
      heartN++;
      s.visible = true; s.position.set(h.x, H - (h.y - h.age * 50), 90);
      s.scale.set(22, 22, 1); s.material.opacity = 1 - h.age / 1.4;
    }
    for (let i = heartN; i < this.hearts.length; i++) this.hearts[i].visible = false;
    this.renderer.render(this.scene, this.camera);
  }

  renderToy(e, p, a, home, H, t) {
    const toy = a.toy;
    if (!toy || !p.toy) {
      if (e.toy) { this.scene.remove(e.toy.obj); e.toy = null; }
      if (e.ribbon) e.ribbon.mesh.visible = false;
      return;
    }
    if (!e.toy || e.toy.kind !== p.toy) {
      if (e.toy) this.scene.remove(e.toy.obj);
      const obj = makeToy(p.toy);
      obj.scale.setScalar(obj.userData.size);
      this.scene.add(obj);
      e.toy = { kind: p.toy, obj };
      if (p.toy === 'yarn_comet' && !e.ribbon) { e.ribbon = new Ribbon(); this.scene.add(e.ribbon.mesh); }
    }
    const o = e.toy.obj, x = home.x + toy.x, y = H - (home.y + toy.y);
    o.position.set(x, y, home.y * 0.6 + 30);
    if (p.toy === 'star_ball') o.rotation.set(0.3, toy.tt * 1.2, toy.rot);
    else if (p.toy === 'mini_rocket') {
      o.rotation.set(0, 0, toy.rot);
      const fl = o.userData.flame;
      fl.visible = toy.flying; if (toy.flying) fl.scale.set(1, 0.8 + 0.5 * Math.sin(t * 40), 1);
    } else o.rotation.set(0, 0, -toy.rot);
    if (e.ribbon) e.ribbon.update(toy.trail.map((q) => ({ x: home.x + q.x, y: H - (home.y + q.y) })));
  }

  renderSnack(e, a, st, m, home, c, K, H) {
    if (!a.eat) { if (e.snack) { this.scene.remove(e.snack.obj); e.snack = null; } return; }
    if (!e.snack || e.snack.kind !== a.eat.snack) {
      if (e.snack) this.scene.remove(e.snack.obj);
      const obj = makeSnack(a.eat.snack); this.scene.add(obj); e.snack = { kind: a.eat.snack, obj };
    }
    const mouth = m.mouthWorld(new THREE.Vector3());
    placeSnack(e.snack.obj, st.eat, mouth, K, new THREE.Vector3(c.x + 70, H - (c.y - 80), 60));
  }
}

// ---------------------------------------------------------------- previews in the shop

let _pv = null;
function previewer() {
  if (_pv) return _pv;
  const canvas = document.createElement('canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene(); addLights(scene);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -50, 50);
  camera.position.z = 10;
  _pv = { renderer, scene, camera };
  return _pv;
}

const _frames = new Map();
function frameOf(key, obj) {
  if (!_frames.has(key)) {
    obj.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(obj), c = b.getCenter(new THREE.Vector3()), s = b.getSize(new THREE.Vector3());
    _frames.set(key, { cx: c.x, cy: c.y, w: s.x, h: s.y });
  }
  return _frames.get(key);
}

function renderPreview(target, objects, frame) {
  const { renderer, scene, camera } = previewer();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = target.clientWidth || 72, h = target.clientHeight || 72;
  const W = Math.round(w * dpr), Hh = Math.round(h * dpr);
  if (target.width !== W || target.height !== Hh) { target.width = W; target.height = Hh; }
  renderer.setSize(W, Hh, false);
  const aspect = w / h, half = Math.max(frame.h / 2 * 1.12, (frame.w / 2 * 1.12) / aspect);
  Object.assign(camera, { left: frame.cx - half * aspect, right: frame.cx + half * aspect, top: frame.cy + half, bottom: frame.cy - half });
  camera.updateProjectionMatrix();
  objects.forEach((o) => scene.add(o));
  renderer.render(scene, camera);
  objects.forEach((o) => scene.remove(o));
  const ctx = target.getContext('2d');
  ctx.clearRect(0, 0, W, Hh);
  ctx.drawImage(renderer.domElement, 0, 0, W, Hh);
}

const _previewModels = new Map();
const previewModel = (species) => {
  if (!_previewModels.has(species)) _previewModels.set(species, new PetModel(species));
  return _previewModels.get(species);
};
const NEUTRAL = { t: 0, sit: 1, walk: 0, walkT: 0, yaw: 0, mood: 'smile', blink: false, act: null, armsUp: 0, eat: null };

/** Still picture of a shop item: a companion, an outfit on the kitten, a toy, or a snack. */
export function drawPreview(canvas, itemId, type, t = 0) {
  try {
    if (type === 'pet' || type === 'outfit') {
      const m = type === 'pet' ? previewModel(itemId) : previewModel('kitten');
      m.setOutfit(type === 'outfit' ? itemId : null);
      m.pose({ ...NEUTRAL, t: t + 0.4, yaw: type === 'outfit' ? 0 : -0.25 });
      const fr = frameOf(`pet:${type}:${itemId}`, m.root);
      renderPreview(canvas, [m.root], fr);
      m.setOutfit(null);
    } else {
      const obj = type === 'toy' ? makeToy(itemId) : makeSnack(itemId);
      obj.scale.setScalar(1);
      if (type === 'toy') obj.rotation.set(0.25, -0.5, itemId === 'mini_rocket' ? -0.5 : 0);
      else obj.rotation.set(0.35, -0.5, 0);
      renderPreview(canvas, [obj], frameOf(`${type}:${itemId}`, obj));
    }
  } catch (err) { console.warn('preview failed', err); }
}

/** A companion in the shop's "Your companions" list. It shows the live mood and outfit, and chews
 *  when you feed it, which matters because the shop dims the main view behind it. */
export function livePreview(canvas, pet, layer) {
  const model = new PetModel(pet.species);
  model.setOutfit(pet.outfit || null);
  model.pose({ ...NEUTRAL });
  const frame = frameOf(`live:${pet.species}:${pet.outfit || ''}`, model.root);   // framed once, on the resting pose
  const t0 = performance.now();
  let snack = null, snackKind = null;
  const tick = () => {
    if (!canvas.isConnected) return;
    try {
      const t = (performance.now() - t0) / 1000, a = layer?.anim.get(pet.uid) || null;
      const st = { ...poseState(pet, a, t), sit: 1, walk: 0, walkT: 0, yaw: -0.2, act: null };
      model.pose(st);
      const objs = [model.root];
      if (a?.eat && st.eat) {
        if (snackKind !== a.eat.snack) { snack = makeSnack(a.eat.snack); snackKind = a.eat.snack; }
        const mouth = model.mouthWorld(new THREE.Vector3());
        placeSnack(snack, st.eat, mouth, 1, new THREE.Vector3(mouth.x + 0.9, mouth.y + 0.7, mouth.z + 0.4));
        objs.push(snack);
      } else { snack = null; snackKind = null; }
      renderPreview(canvas, objs, frame);
    } catch (err) { console.warn('live preview failed', err); return; }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
