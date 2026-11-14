// Crew health check: camera tracking, gestures, 3D body, device feeds and the game loop.

import { BodyView } from './body3d.js';
import { createTracker, POSE_PAIRS, HAND_PAIRS } from './tracking.js';
import { simFrame } from './sim.js';
import { coverMapper, Smoother, P } from './geometry.js';
import { classify, palmCenter, GestureStabilizer, Dwell, PinchTracker } from './gestures.js';
import { buildRegions, hitTest, armForHand, REGION_OF_PART } from './regions.js';
import { makeCounter, breathPhase } from './exercises.js';
import { PetLayer } from './pets.js';
import { PetView } from './pets3d.js';
import { api } from './api.js';
import { startPulse } from './pulse.js';
import * as UI from './ui.js';
import { fmtMET, fmtValue, DAY, resetTrendScales } from './trend.js';

const { $, h } = UI;
const params = new URLSearchParams(location.search);

// Live loop: every LIVE_POLL_MS of real time the page asks /api/live what changed. The server
// writes device batches on the mission clock (60x real time: Bio-Monitor every ~15 real s),
// so polling faster than LIVE_MIN_MS only makes the server re-sync and recompute for nothing.
const LIVE_POLL_MS = 5000;
const LIVE_MIN_MS = 3000;
const ROUTINE_TOAST_GAP_MS = 60000;       // a "readings updated" toast at most once a minute; the ticker logs every batch
const RANK = { nodata: -1, good: 0, warning: 1, serious: 2, critical: 3 };
const S = {
  aid: params.get('astronaut') || 'okafor',
  health: null, game: null, catalog: null, exercises: null, devices: [], crew: [],
  clock: { met: 0, at: 0, scale: 60 },
  region: null, part: null, expanded: false,
  recsOpen: false, recDetail: new Set(), recsSeen: new Set(),   // bottom suggestion tray
  exercise: null, feed: [], shopTab: 'pet', shop: null,
  live: { since: null, inflight: false, busy: false, lastOk: 0, failed: false, alerts: [],
    lastRoutineToast: 0, synced: false },
  showFace: params.get('face') === '1',           // the white MediaPipe face mesh: off by default, press F or use ?face=1
  showTracking: params.get('lines') === '1',      // the thin pose and hand skeleton, off unless asked for (press T)
  sim: params.get('sim'),                     // 'script' | 'idle' | null (camera)
  healthDirty: false, lastHealthFetch: 0, mouse: null,
  tracker: null, connections: null, debug: { gestures: [], part: null },
  pulseBpm: null,                             // live BPM from the Arduino pulse sensor, if connected
  pulseBreath: null,                          // breaths/min estimated from that pulse, once it has a minute of data
};
let pulseUI = null;                             // the live pulse card (pulse.js), set in boot()
window.__crew = S;                              // handy for debugging in the console

const video = $('#video');
const skel = $('#skeleton'), skelCtx = skel.getContext('2d');
const pointer = $('#pointer'), ptrCtx = pointer.getContext('2d');
const body = new BodyView($('#three'));
window.__body = body;                            // handy for debugging in the console
let petView = null;
try { petView = new PetView($('#pets')); } catch (e) { console.warn('3D companions need WebGL', e); }
const pets = new PetLayer($('#pets'), onPetted, petView);
window.__petview = petView;
window.__pets = pets;                           // handy for debugging in the console
let W = innerWidth, H = innerHeight, DPR = Math.min(devicePixelRatio || 1, 2);

// ---------------------------------------------------------------- layout

function layout() {
  W = innerWidth; H = innerHeight; DPR = Math.min(devicePixelRatio || 1, 2);
  for (const c of [skel, pointer]) { c.width = W * DPR; c.height = H * DPR; }
  body.resize(W, H);
  pets.resize(W, H, DPR);
  updatePetInsets();
}

function updatePetInsets() {
  const top = $('#topbar').getBoundingClientRect().bottom + 12;
  // companions live together at the bottom right; while the details panel is open they step left of it
  const panel = $('#panel');
  const shift = panel.hidden ? 0 : panel.getBoundingClientRect().width + 16;
  pets.setInsets({ top, bottom: 16, left: 16, right: 16 + shift });
  // the open body part's large model fits in the free area: right of the side list, left of the panel, under the top bar
  const rail = $('#rail').getBoundingClientRect();
  const right = panel.hidden ? W - 16 : panel.getBoundingClientRect().left - 12;
  body.setViewport({ left: Math.min(rail.right + 12, right - 200), top, right, bottom: H - 16 });
}

// ---------------------------------------------------------------- clock & state

const nowMet = () => S.clock.met + ((performance.now() - S.clock.at) / 1000) * S.clock.scale;
function setClock(c) { S.clock = { met: c.met, at: performance.now(), scale: c.time_scale }; }
function tickClock() {
  $('#clock').textContent = fmtMET(nowMet());
  renderCheckin();                // a new mission day reopens the check-in
  renderLive();
  flushAlerts();                  // status alerts held back while a dialog was open
}

async function loadState(aid) {
  const d = await api.state(aid);
  S.aid = aid; S.health = d.health; S.game = d.game; S.catalog = d.catalog; S.exercises = d.exercises;
  S.devices = d.devices; S.crew = d.crew;
  setClock(d.clock);
  resetTrendScales();
  Object.assign(S.live, { since: d.clock.met, lastOk: performance.now(), failed: false, alerts: [], synced: false });
  renderAll();
}

const statusMap = () => Object.fromEntries(Object.entries(S.health.regions).map(([k, v]) => [k, v.status]));

function renderAll() {
  const sel = $('#crew-select');
  if (!sel.options.length) {
    for (const c of S.crew) sel.append(h('option', { value: c.id }, c.name));
  }
  sel.value = S.aid;
  const me = S.crew.find((c) => c.id === S.aid);
  $('#who-role').textContent = me ? me.role : '';
  renderPoints();
  renderCheckin();
  renderHealth();
  pets.setPets(S.game.pets);
  tickClock();
}

function renderPoints(bump = false) {
  const el = $('#points');
  el.querySelector('b').textContent = S.game.points;
  if (bump) { el.classList.add('bump'); setTimeout(() => el.classList.remove('bump'), 1200); }
}

// The bottom tray starts collapsed. It shows "New" when a suggestion appears that you haven't seen.
function renderRecs(hidden = !!S.region || !!S.exercise) {
  const todo = S.health.recommendations.filter((r) => !r.done);
  const fresh = todo.some((r) => !S.recsSeen.has(r.id));
  if (S.recsOpen) todo.forEach((r) => S.recsSeen.add(r.id));
  UI.renderRecs(S.health.recommendations, startExercise, selectRegion, hidden, {
    open: S.recsOpen, fresh, exercises: S.exercises, detailOpen: S.recDetail,
    onToggleTray: () => { S.recsOpen = !S.recsOpen; renderRecs(); },
    onToggleDetail: (id) => { if (S.recDetail.has(id)) S.recDetail.delete(id); else S.recDetail.add(id); renderRecs(); },
  });
}

function renderHealth() {
  UI.renderRail(S.health, S.region, selectRegion);
  renderRecs();
  body.setStatus(statusMap());
  if (S.region) renderPanel();
}

function renderPanel() {
  UI.renderPanel(S.health.regions[S.region], S.health, S.health.recommendations, {
    onClose: closePanel, onStart: startExercise, onSelectRegion: selectRegion,
    expanded: S.expanded, onExpand: () => { S.expanded = true; renderPanel(); },
  });
  // the chest panel has a slot for the live pulse card; any other panel sends it back to the top left
  // (the floating card, top right, steps left of any other panel so it is never covered)
  const slot = S.region === 'chest' ? $('#pulse-slot') : null;
  if (slot) pulseUI?.dock(slot); else pulseUI?.undock();
  document.body.classList.toggle('panel-open', !!S.region && S.region !== 'chest');
  requestAnimationFrame(updatePetInsets);
}

async function refreshHealth() {
  S.lastHealthFetch = performance.now(); S.healthDirty = false;
  try { applyHealth(await api.health(S.aid)); } catch (e) { console.warn(e); }
}
function maybeRefreshHealth() {
  // while the live pulse feeds the open chest panel, keep its numbers fresher
  const every = S.region === 'chest' && S.pulseBpm ? 4000 : 8000;
  if (S.healthDirty && performance.now() - S.lastHealthFetch > every) refreshHealth();
}

// ---------------------------------------------------------------- device feeds
// Each device is fetched in batches on its own interval: the real device's
// sync interval in mission time, divided by the demo's time speed-up.

const LABEL = {
  heart_rate: ['heart rate', 'bpm', 0], spo2: ['SpO₂', '%', 1], core_temp: ['core temperature', '°C', 2],
  sleep_hours: ['slept', 'h', 1], tempus_sys: ['systolic BP', 'mmHg', 0], ared_squat_kg: ['squat', 'kg', 1],
  t2_speed_kmh: ['treadmill', 'km/h', 1], cevis_hr_150w: ['bike heart rate', 'bpm', 0], onsd_mm: ['optic nerve sheath', 'mm', 2],
  bl_glucose: ['glucose', 'mg/dL', 0], light_lux: ['light', 'lux', 0],
  rad_spe_index: ['solar particle index', '× quiet', 2], rad_dose_msv: ['radiation dose', 'mSv', 2],
  cabin_co2_ppm: ['cabin CO₂', 'ppm', 0], cabin_temp_c: ['cabin temperature', '°C', 1],
};
const FEED_KEYS = { biomonitor: ['heart_rate', 'spo2'], thermomini: ['core_temp'], actiwatch: ['sleep_hours', 'light_lux'],
  tempus: ['tempus_sys'], exercise: ['ared_squat_kg', 't2_speed_kmh', 'cevis_hr_150w'], ultrasound: ['onsd_mm'], rhealth: ['bl_glucose'],
  dosimeter: ['rad_spe_index', 'rad_dose_msv'], cabin_env: ['cabin_co2_ppm', 'cabin_temp_c'] };

// ---------------------------------------------------------------- live loop

const overlayOpen = () => !!document.querySelector('.modal-back') || !!S.exercise;

/** Take a new health summary from the server. Regions that got worse raise an alert toast. */
function applyHealth(next, { compare = true } = {}) {
  const before = S.health ? statusMap() : null;
  S.health = next;
  renderHealth();
  if (!compare || !before) return;
  for (const [rid, r] of Object.entries(next.regions)) {
    if (RANK[r.status] > RANK[before[rid] ?? 'nodata']) {
      S.live.alerts = S.live.alerts.filter((a) => a.region !== rid);   // keep only the latest per region
      S.live.alerts.push({ region: rid, status: r.status, aid: S.aid });
    }
  }
  flushAlerts();
}

/** Status alerts wait while a dialog or exercise is open, then show once it closes. */
function flushAlerts() {
  if (!S.live.alerts.length || overlayOpen()) return;
  const alerts = S.live.alerts.filter((a) => a.aid === S.aid); S.live.alerts = [];
  for (const a of alerts) {
    UI.toast(`${UI.REGION_NAME[a.region]} status changed to <b>${UI.STATUS_WORD[a.status]}</b>. Tap to view.`, {
      kind: `alert ${a.status}`, onClick: () => selectRegion(a.region),
      label: `${UI.REGION_NAME[a.region]} status changed to ${UI.STATUS_WORD[a.status]}. Open details.`,
    });
  }
}

function batchText(b) {
  const keys = (FEED_KEYS[b.device_id] || []).filter((k) => b.latest[k]).slice(0, 2);
  const bits = keys.map((k) => `${LABEL[k][0]} ${fmtValue(b.latest[k].value, LABEL[k][1], LABEL[k][2])}`);
  return `${b.device.split(' (')[0]}: ${bits.length ? bits.join(', ') : `${b.n_readings} new reading${b.n_readings === 1 ? '' : 's'}`}`;
}

/** One short headline for the batches of one poll, e.g. "Bio-Monitor: heart rate, SpO₂ updated". */
function routineToastText(batches) {
  if (batches.length === 1) {
    const b = batches[0];
    const names = (FEED_KEYS[b.device_id] || []).filter((k) => b.latest[k]).slice(0, 2).map((k) => LABEL[k][0]);
    return `${b.device.split(' (')[0]}: ${names.length ? names.join(', ') : 'new readings'} updated`;
  }
  return `${batches.length} device batches synced`;
}

async function pollLive({ force = false } = {}) {
  const L = S.live;
  if (L.inflight || L.busy || !S.health) return;            // never overlap, never during crew switch or skip
  if (!force && (document.hidden || overlayOpen())) return; // paused: hidden tab, or the user is in a dialog
  L.inflight = true;
  const aid = S.aid;
  let r;
  try { r = await api.live(aid, L.since); }
  catch (e) { L.failed = true; renderLive(); console.warn('live', e); return; }  // keep the last good display
  finally { L.inflight = false; }
  if (aid !== S.aid || L.busy) return;                      // the crew member changed while this was in flight
  L.failed = false; L.lastOk = performance.now();
  setClock(r.clock);
  if (r.full) {                                             // the server clock was reset behind the page
    S.game = r.game; S.devices = r.devices; L.since = r.clock.met;
    applyHealth(r.health, { compare: false }); renderAll(); renderLive(); return;
  }
  L.since = r.clock.met;
  const landed = r.batches.filter((b) => b.n_readings || b.n_events);
  for (const b of landed) {
    const text = batchText(b);
    S.feed.unshift({ met: b.window_end, text, device: b.device_id });
    $('#ticker').textContent = text;
  }
  S.feed = S.feed.slice(0, 60);
  if (r.health) applyHealth(r.health);
  else if (S.health && Object.entries(r.statuses).some(([k, v]) => S.health.regions[k]?.status !== v)) refreshHealth();
  // a brief headline when data lands: the first sync, then at most once a minute (the ticker has the rest)
  const now = performance.now();
  if (landed.length && !overlayOpen() && (!L.synced || now - L.lastRoutineToast > ROUTINE_TOAST_GAP_MS)) {
    UI.toast(routineToastText(landed), { kind: 'quiet' });
    L.lastRoutineToast = now;
  }
  if (landed.length) L.synced = true;
  renderLive();
}

function renderLive() {
  const el = $('#live'), txt = $('#live-text');
  if (!el) return;
  const L = S.live;
  const state = L.failed ? 'error' : document.hidden || overlayOpen() || L.busy ? 'paused' : 'on';
  el.dataset.state = state;
  const ago = Math.max(0, Math.round((performance.now() - L.lastOk) / 1000));
  const text = state === 'error' ? `Reconnecting, last update ${ago} s ago`
    : state === 'paused' ? 'Paused until you close this' : `Last update ${ago} s ago`;
  if (txt.textContent !== text) txt.textContent = text;
}

// ---------------------------------------------------------------- selection

function selectRegion(rid) { selectPart(UI.PART_FOR_REGION[rid] || rid); }

function selectPart(part) {
  if (S.exercise) return;
  S.part = part; S.region = REGION_OF_PART[part] || part; S.expanded = false;
  body.open(part);
  UI.renderRail(S.health, S.region, selectRegion);
  renderRecs(true);
  $('#panel').scrollTop = 0;
  renderPanel();
}

function closePanel() {
  body.close();
  S.region = null; S.part = null;
  pulseUI?.undock();
  document.body.classList.remove('panel-open');
  $('#panel').hidden = true;
  renderHealth();
  updatePetInsets();
}

// ---------------------------------------------------------------- exercises

function startExercise(rec) {
  const def = { id: rec.exercise, ...S.exercises[rec.exercise] };
  if (!def.kind) return;
  if (S.region) closePanel();
  const card = $('#exercise');
  const count = h('div', { class: 'count' });
  const hint = h('p', { class: 'hint' });
  const bar = h('span');
  const breath = def.id === 'box_breathing' ? h('div', { class: 'breath', html:
    '<svg viewBox="0 0 64 64"><rect x="8" y="8" width="48" height="48" rx="6" fill="none" stroke="#c3ccd6" stroke-width="3"/><circle r="6" fill="#ff5b1f"/></svg>' }) : null;
  card.replaceChildren(
    h('h2', {}, def.name), count, h('p', { class: 'how' }, def.how), h('p', { class: 'how' }, def.why),
    hint, h('div', { class: 'bar' }, bar),
    h('div', { class: 'row' }, breath || h('span'),
      h('button', { class: 'btn quiet', 'data-dwell': true, onclick: () => stopExercise(false) }, 'Stop')));
  card.hidden = false;
  S.exercise = { def, counter: makeCounter(def), petStart: pets.totalPetSeconds, done: false, el: { count, hint, bar, breath } };
  renderRecs(true);
}

function stopExercise() {
  S.exercise = null;
  $('#exercise').hidden = true;
  renderHealth();
  flushAlerts();
}

function updateExercise(pose, dt) {
  const ex = S.exercise;
  if (!ex || ex.done) return;
  const { def, counter, el } = ex;
  let progress = 0, countHtml = '', hint = '';
  if (def.kind === 'reps') {
    counter.update(pose || []);
    progress = counter.reps / def.reps;
    countHtml = `${counter.reps}<small>/${def.reps}</small>`;
    hint = counter.hint;
  } else if (def.kind === 'timer') {
    counter.update(pose || [], dt);
    progress = counter.elapsed / def.duration_s;
    countHtml = `${Math.max(0, Math.ceil(def.duration_s - counter.elapsed))}<small> s</small>`;
    if (def.id === 'box_breathing') {
      const b = breathPhase(counter.elapsed);
      hint = counter.hint || b.label;
      const side = b.index, f = b.t, c = el.breath.querySelector('circle');
      const pts = [[8, 56], [8, 8], [56, 8], [56, 56], [8, 56]];
      const [ax, ay] = pts[side], [bx, by] = pts[side + 1];
      c.setAttribute('cx', ax + (bx - ax) * f); c.setAttribute('cy', ay + (by - ay) * f);
    } else hint = counter.hint || 'Keep going, slowly.';
  } else if (def.kind === 'petting') {
    const s = pets.totalPetSeconds - ex.petStart;
    progress = s / def.duration_s;
    countHtml = `${Math.floor(s)}<small>/${def.duration_s} s</small>`;
    hint = S.game.pets.length ? 'Hold an open hand over a companion and stroke it.' : 'Adopt a companion in the shop first.';
  }
  if (el.count.innerHTML !== countHtml) el.count.innerHTML = countHtml;
  if (el.hint.textContent !== hint) el.hint.textContent = hint;
  el.bar.style.width = `${Math.min(100, progress * 100)}%`;
  if (progress >= 1) finishExercise(def, counter?.reps);
}

async function finishExercise(def, reps) {
  S.exercise.done = true;
  S.exercise.el.hint.textContent = 'Done. Nice work.';
  try {
    const r = await api.game(S.aid, 'complete', { exercise: def.id, reps });
    S.game = r.game; applyHealth(r.health);
    renderPoints(r.earned > 0);
    UI.toast(r.earned ? `${def.name} done <b>+${r.earned} points</b>` : `${def.name} done. Points for this one return in a few mission hours.`);
  } catch (e) { UI.toast(e.message); }
  setTimeout(stopExercise, 1600);
}

// ---------------------------------------------------------------- game

async function onPetted(pet, seconds) {
  try {
    const r = await api.game(S.aid, 'pet', { pet: pet.uid, seconds });
    S.game = r.game; pets.setPets(S.game.pets);
    if (r.earned) { renderPoints(true); UI.toast(`${pet.name} loved that <b>+${r.earned} points</b>`); }
  } catch (e) { console.warn(e); }
}

function openShop(tab = S.shopTab) {
  S.shopTab = tab;
  const holder = h('div');
  const render = () => holder.replaceChildren(UI.shopBody(S.game, S.catalog, S.shopTab, actions));
  // closeWith(result, args): a message when this action should close the shop so you can watch your companion
  const act = (fn, closeWith = null) => async (...a) => {
    try {
      const r = await fn(...a);
      if (r?.game) { S.game = r.game; pets.setPets(S.game.pets); renderPoints(); }
      const msg = closeWith?.(...a);
      if (msg) { S.shop?.close(); UI.toast(msg); } else render();
    } catch (e) { UI.toast(e.message); }
  };
  const petName = (uid) => S.game.pets.find((p) => p.uid === uid)?.name || 'Your companion';
  const actions = {
    pets,
    tab: (k) => { S.shopTab = k; render(); },
    buy: act(async (id) => { const r = await api.game(S.aid, 'buy', { item: id }); UI.toast(`Bought ${S.catalog[id].name.toLowerCase()}`); return r; }),
    // giving a toy closes the shop (watch them play); outfits and putting a toy away keep it open
    equip: act((uid, item, slot) => api.game(S.aid, 'equip', { pet: uid, item, slot }),
      (uid, item, slot) => (slot === 'toy' && item ? `${petName(uid)} is playing with the ${S.catalog[item].name.toLowerCase()}` : null)),
    // feeding closes the shop too, so you see them eat
    feed: act(async (uid, item) => { const r = await api.game(S.aid, 'feed', { pet: uid, item }); pets.fed(uid, item); return r; },
      (uid, item) => `${petName(uid)} is eating the ${S.catalog[item].name.toLowerCase()}`),
  };
  render();
  S.shop = UI.openModal('Shop', holder, { onClose: () => { S.shop = null; } });
}

// The check-in is daily: one per mission day (24 real minutes at the demo's 60x clock).
function checkinDoneToday() {
  const c = S.game?.checkin;
  return !!c?.done_today && Math.floor(nowMet() / DAY) === c.day;
}

function renderCheckin() {
  const btn = $('#btn-checkin'), done = checkinDoneToday();
  if (btn.dataset.done === String(done)) return;
  btn.dataset.done = String(done);
  btn.textContent = done ? 'Checked in ✓' : 'Daily check-in';
  btn.classList.toggle('quiet', done);
  btn.title = done ? 'Today\'s check-in is done. Open it to change your answers.' : 'Today\'s check-in is waiting';
}

function openCheckin() {
  const done = checkinDoneToday();
  const day = Math.floor(nowMet() / DAY);
  const m = UI.openModal(`Daily check-in, day ${day}`, UI.checkinBody(async (vals) => {
    if (!vals.mood || !vals.stress) { UI.toast('Pick a mood and a stress level first.'); return; }
    try {
      const r = await api.checkin(S.aid, vals);
      S.game = r.game; applyHealth(r.health); renderPoints(r.earned > 0); renderCheckin();
      UI.toast(r.earned ? `Check-in saved <b>+${r.earned} points</b>` : done ? 'Today\'s check-in updated.' : 'Check-in saved.');
      m.close();
    } catch (e) { UI.toast(e.message); }
  }, done ? S.game.checkin.today : null), {
    lead: done ? 'You have already checked in today. If something has changed, update your answers: they replace today\'s entry. The next check-in opens tomorrow.'
      : 'Once a day: mood and stress are things only you can measure. A quick daily check-in lets the app spot changes early.',
  });
}

async function openDevices() {
  const devices = await api.devices(S.aid);
  UI.openModal('Devices and data batches', UI.devicesBody(devices, S.feed, nowMet(), S.clock.scale), {
    lead: 'Each device sends its data in batches. Wearables record by themselves; exams and blood tests need you to run them. The mission clock runs 60 times faster than real time in this demo.',
  });
}

// ---------------------------------------------------------------- input

function status(msg, corner = false) {
  const el = $('#status-msg');
  if (!msg) { el.hidden = true; return; }
  el.textContent = msg; el.hidden = false; el.classList.toggle('corner', corner);
  if (corner) { clearTimeout(status.t); status.t = setTimeout(() => { el.hidden = true; }, 9000); }
}

async function startInput() {
  if (!S.sim) {
    try {
      status('Starting the camera…');
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' }, audio: false });
      video.srcObject = stream; await video.play();
      S.tracker = await createTracker((m) => status(`${m}…`));
      S.connections = S.tracker.connections;
      status(null);
      return;
    } catch (e) {
      console.warn(e);
      video.srcObject?.getTracks().forEach((tr) => tr.stop());
      S.tracker = null;
      S.sim = 'idle';
      status(`Camera or tracking isn't available (${e.message}). Showing a simulated person; use your mouse to pick body parts.`, true);
    }
  }
  $('#no-camera').hidden = false; video.hidden = true;
  if (S.sim === 'script') status('Demo mode: a simulated person points at their chest, turns the model, closes it with a fist, then pets a companion.', true);
}

function bindControls() {
  $('#crew-select').addEventListener('change', async (e) => {
    closePanel(); S.feed = []; S.live.busy = true;
    try { await loadState(e.target.value); } finally { S.live.busy = false; }
  });
  $('#btn-shop').addEventListener('click', () => openShop());
  $('#btn-checkin').addEventListener('click', openCheckin);
  $('#btn-devices').addEventListener('click', openDevices);
  $('#btn-skip').addEventListener('click', async () => {
    S.live.busy = true;
    let r;
    try { r = await api.advance(6); setClock(r.clock); await loadState(S.aid); } finally { S.live.busy = false; }
    UI.toast(`Mission clock moved to ${fmtMET(r.clock.met)}. ${r.batches.length} device batches arrived.`);
  });
  addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea, select')) return;
    if (e.key === 'Escape') { if (S.exercise) stopExercise(); else if (S.region) closePanel(); }
    if (e.key === 't') S.showTracking = !S.showTracking;
    if (e.key === 'f') S.showFace = !S.showFace;
    const n = Number(e.key);
    if (n >= 1 && n <= 6) selectRegion(UI.REGION_ORDER[n - 1]);
  });
  // mouse fallback: hover/click your body in the camera view, drag to turn the model
  const onStage = (e) => !e.target.closest('.card, #modal-root, button, select');
  let drag = null;
  addEventListener('pointermove', (e) => {
    S.mouse = { x: e.clientX, y: e.clientY, over: onStage(e), down: !!drag };
    pets.mouse = drag && !drag.pet ? { x: e.clientX, y: e.clientY, down: true } : null;     // an empty-handed drag can still knock a toy
    if (drag?.pet) {
      pets.dragTo('mouse', { x: e.clientX, y: e.clientY });                                   // carrying a companion
      if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 5) drag.moved = true;
    } else if (drag && body.mode === 'inspect') {
      body.rotate((e.clientX - drag.x) / W * 4, (e.clientY - drag.y) / H * 2);
      drag.moved = true;
    }
    if (drag) { drag.x = e.clientX; drag.y = e.clientY; }
  });
  addEventListener('pointerdown', (e) => {
    if (!onStage(e)) return;
    const pt = { x: e.clientX, y: e.clientY }, pet = pets.hitPet(pt);
    drag = { x: pt.x, y: pt.y, sx: pt.x, sy: pt.y, moved: false, pet: pet && pets.grab(pet, pt, 'mouse') ? pet : null };
  });
  const release = (e) => {
    const d = drag; drag = null; pets.mouse = null;
    if (d?.pet) { pets.drop('mouse'); if (!d.moved) pets.pat(d.pet); return; }                // dragged: put down. Clicked: a pat
    if (!d || d.moved || !onStage(e)) return;
    const part = body.mode === 'inspect' ? body.pick(e.clientX, e.clientY) : hitTest({ x: e.clientX, y: e.clientY }, S.regions);
    if (part) selectPart(part);
    else if (body.mode === 'inspect') closePanel();
  };
  addEventListener('pointerup', release);
  addEventListener('pointercancel', release);
}

// ---------------------------------------------------------------- per-frame

const poseSmooth = new Smoother(0.55), handSmooth = new Smoother(0.65), faceSmooth = new Smoother(0.6);
const stab = [new GestureStabilizer(), new GestureStabilizer()];
const pinch = [new PinchTracker(), new PinchTracker()];
const dwell = new Dwell(800);
let lastT = performance.now(), t0 = lastT, lastPalm = null, fistSince = null, dwellEl = null;
let lastVideoTime = -1, lastDet = null;

function toScreen(det) {
  const map = coverMapper(W, H, det.videoWidth || 1280, det.videoHeight || 720);
  const conv = (p) => {
    const s = map.toScreen(1 - p.x, p.y);              // mirror for a selfie view
    return { x: s.x, y: s.y, z: (p.z || 0) * map.width, visibility: p.visibility ?? 1 };
  };
  const pose = det.pose ? poseSmooth.apply('pose', det.pose.map(conv)) : poseSmooth.apply('pose', null);
  const hands = (det.hands || []).map((hd) => ({ lm: hd.landmarks.map(conv), handedness: hd.handedness }))
    .sort((a, b) => a.lm[0].x - b.lm[0].x)
    .map((hd, i) => ({ ...hd, lm: handSmooth.apply(`h${i}`, hd.lm) }));
  for (let i = hands.length; i < 2; i++) handSmooth.apply(`h${i}`, null);
  const face = faceSmooth.apply('face', det.face ? det.face.map(conv) : null);
  return { pose, world: det.world, hands, face };
}

function frame(now) {
  const dt = Math.min(0.1, (now - lastT) / 1000); lastT = now;
  const t = (now - t0) / 1000;
  let det = null;
  if (S.tracker && video.readyState >= 2) {
    if (video.currentTime !== lastVideoTime) { lastVideoTime = video.currentTime; lastDet = S.tracker.detect(video, { face: S.showFace }); }
    det = lastDet;
  } else if (S.sim) det = simFrame(S.simFreeze ?? t, S.sim);      // simFreeze: debug, holds the demo person on one moment of the script
  const v = det ? toScreen(det) : { pose: null, world: null, hands: [], face: null };
  S.regions = buildRegions(v.pose);

  // gestures
  v.hands.forEach((hd, i) => { hd.gesture = stab[i] ? stab[i].update(classify(hd.lm)) : classify(hd.lm); hd.palm = palmCenter(hd.lm); });
  for (let i = v.hands.length; i < stab.length; i++) stab[i].update('none');
  // a pinch (thumb tip to index tip) picks a companion up, and moving the hand carries it; opening the fingers puts it down
  for (let i = 0; i < pinch.length; i++) {
    const hd = v.hands[i], res = pinch[i].update(hd ? hd.lm : null), src = `hand${i}`;
    if (hd && res.on) hd.gesture = 'pinch';
    if (res.on) {
      if (res.started && !pets.holding(src)) { const pet = pets.hitPet(res.point); if (pet) pets.grab(pet, res.point, src); }
      else if (pets.holding(src)) pets.dragTo(src, res.point);
    } else if (pets.holding(src)) pets.drop(src);
  }
  S.debug.gestures = v.hands.map((hd) => hd.gesture);

  // pointing: hold over a control to press it, or over a body part to open it
  const pointing = v.hands.find((hd) => hd.gesture === 'point');
  let hoverPart = null, key = null, el = null, tip = null;
  if (pointing) {
    tip = pointing.lm[8];
    el = document.elementFromPoint(tip.x, tip.y)?.closest('[data-dwell]');
    if (el && !el.disabled) key = el;
    else if (!S.exercise && !document.querySelector('.modal-back')) {
      const part = body.mode === 'inspect' ? body.pick(tip.x, tip.y)
        : hitTest(tip, S.regions, armForHand(pointing.lm[0], v.pose));
      if (part) { hoverPart = part; key = `part:${part}`; }
    }
  } else if (S.mouse?.over && !S.exercise) {
    hoverPart = body.mode === 'inspect' ? body.pick(S.mouse.x, S.mouse.y) : hitTest(S.mouse, S.regions);
  }
  S.debug.part = hoverPart;
  const fired = dwell.update(key, now);
  if (dwellEl && dwellEl !== el) dwellEl.classList.remove('dwelling');
  dwellEl = key instanceof Element ? el : null;
  if (dwellEl) dwellEl.classList.add('dwelling');
  if (fired instanceof Element) fired.click();
  else if (typeof fired === 'string') selectPart(fired.slice(5));

  // open hand turns the model; a raised fist held briefly closes it
  const open = v.hands.find((hd) => hd.gesture === 'open' && !pets.hitPet(hd.palm));
  if (open && body.mode === 'inspect') {
    if (lastPalm) body.rotate(((open.palm.x - lastPalm.x) / W) * 4, ((open.palm.y - lastPalm.y) / H) * 2);
    lastPalm = open.palm;
  } else lastPalm = null;
  const hipY = v.pose?.[P.L_HIP]?.y ?? H;
  const fist = v.hands.find((hd) => hd.gesture === 'fist' && hd.lm[0].y < hipY);
  if (fist && S.region) {
    fistSince ??= now;
    if (now - fistSince > 700) { closePanel(); fistSince = Infinity; }
  } else fistSince = null;

  // companions, exercises, 3D
  pets.update(dt, v.hands.filter((hd) => hd.gesture !== 'point' && hd.gesture !== 'pinch').map((hd) => ({ palm: hd.palm })));
  pets.draw(t);
  if (S.exercise) updateExercise(v.pose, dt);
  body.hover = hoverPart;
  body.updateOverlay(v.pose, v.world, handsForBody(v));   // the 3D head sits over your face, placed by the ears and nose
  const live = S.health?.live || {};
  // the real pulse drives the 3D heart, and the breathing it implies drives the lungs
  body.render(t, dt, { ...live, ...(S.pulseBpm ? { heart_rate: S.pulseBpm } : {}),
    ...(S.pulseBpm && S.pulseBreath ? { breathing_rate: S.pulseBreath } : {}) });
  updateBadges();                 // red "!" beside parts at "Act now" or "Urgent"
  if (S.tracker) checkFace(v, now);
  drawTracking(v);
  drawPointer(tip, dwell.progress(now), !!key);
  requestAnimationFrame(frame);
}

const GESTURE_WORD = { point: 'Pointing', open: 'Open hand', fist: 'Fist', pinch: 'Pinch' };

/** Which body hand (left or right) each detected hand belongs to: the one whose wrist it is nearest. */
function handsForBody(v) {
  const ls = v.pose?.[P.L_SHOULDER], rs = v.pose?.[P.R_SHOULDER];
  if (!ls || !rs || !v.hands.length) return [];
  const wrists = { left: v.pose[P.L_WRIST], right: v.pose[P.R_WRIST] };
  const limit = Math.hypot(ls.x - rs.x, ls.y - rs.y) * 0.9;
  const pairs = [];
  for (const hd of v.hands) for (const side of ['left', 'right']) {
    const w = wrists[side];
    if (w && (w.visibility ?? 1) > 0.3) pairs.push({ hd, side, d: Math.hypot(hd.lm[0].x - w.x, hd.lm[0].y - w.y) });
  }
  pairs.sort((a, b) => a.d - b.d);
  const usedHand = new Set(), usedSide = new Set(), out = [];
  for (const q of pairs) {
    if (usedHand.has(q.hd) || usedSide.has(q.side) || q.d > limit) continue;
    usedHand.add(q.hd); usedSide.add(q.side); out.push({ side: q.side, lm: q.hd.lm });
  }
  return out;
}

// Face check: the pose model also finds the nose and eyes. If it clearly sees a face for a few seconds
// but the face model finds nothing, try the face model on the other processor, then say so on screen.
const faceWatch = { since: null, warned: false };
function checkFace(v, now) {
  const info = S.tracker?.faceInfo;
  if (!info || !S.showFace) return;
  if (!info.loaded) {
    if (!faceWatch.warned) { faceWatch.warned = true; status(`The face mesh is off: the face model did not load (${info.error || 'unknown error'}). Run "python tools/download_models.py" and reload.`, true); }
    return;
  }
  const P0 = v.pose?.[P.NOSE], eL = v.pose?.[P.L_EYE], eR = v.pose?.[P.R_EYE];
  const poseSeesFace = !!(P0 && eL && eR && Math.min(P0.visibility ?? 0, eL.visibility ?? 0, eR.visibility ?? 0) > 0.8);
  if (v.face || !poseSeesFace) { faceWatch.since = null; return; }
  faceWatch.since ??= now;
  if (now - faceWatch.since < 4000) return;
  faceWatch.since = null;
  if (!info.swapped) {
    S.tracker.swapFaceDelegate();
  } else if (!faceWatch.warned) {
    faceWatch.warned = true;
    status('Your face is in view but the face mesh can\'t find it. Face the camera in even light, about an arm\'s length away.', true);
  }
}

// ---------------------------------------------------------------- warning badges on the body
// A red "!" beside every part at "Act now" or "Urgent", on the overlay or on the open model. They are buttons
// with data-dwell, so pointing and holding at one opens that part, like pointing at the part itself.

const BADGE_PARTS = { head: ['head'], neck: ['neck'], chest: ['chest'], abdomen: ['abdomen'],
  arms: ['left_arm', 'right_arm'], legs: ['left_leg', 'right_leg'] };
const badgeEls = new Map();

function updateBadges() {
  const layer = $('#badges');
  const want = new Map();                                   // part -> region status
  if (S.health) for (const [rid, r] of Object.entries(S.health.regions)) {
    if (r.status === 'serious' || r.status === 'critical') for (const part of BADGE_PARTS[rid] || []) want.set(part, { rid, status: r.status });
  }
  const spots = want.size ? body.badgeSpots([...want.keys()]) : [];
  const shown = new Set();
  for (const { part, x, y } of spots) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < -40 || y < -40 || x > W + 40 || y > H + 40) continue;
    const { rid, status } = want.get(part);
    let el = badgeEls.get(part);
    if (!el) {
      el = h('button', { class: 'badge', type: 'button', 'data-dwell': true, onclick: () => selectPart(part) }, '!');
      badgeEls.set(part, el); layer.append(el);
    }
    const label = `${UI.REGION_NAME[rid]}: ${UI.STATUS_WORD[status]}. Open details.`;
    if (el.getAttribute('aria-label') !== label) { el.setAttribute('aria-label', label); el.title = label; el.dataset.status = status; }
    const cx = Math.min(W - 22, Math.max(22, x)), cy = Math.min(H - 22, Math.max(22, y));
    el.style.transform = `translate(${cx.toFixed(1)}px, ${cy.toFixed(1)}px) translate(-50%, -50%)`;
    el.hidden = false; shown.add(part);
  }
  for (const [part, el] of badgeEls) if (!shown.has(part)) el.hidden = true;
}

function drawTracking(v) {
  const c = skelCtx;
  c.setTransform(DPR, 0, 0, DPR, 0, 0);
  c.clearRect(0, 0, W, H);
  c.globalAlpha = body.mode === 'inspect' ? 0.3 : 1;     // let the large model take focus
  const pairs = (conns, fallback) => (conns ? conns.map((x) => [x.start, x.end]) : fallback);
  const line = (pts, prs, color, width) => {
    c.strokeStyle = color; c.lineWidth = width; c.beginPath();
    for (const [a, b] of prs) {
      const A = pts[a], B = pts[b];
      if (!A || !B || (A.visibility ?? 1) < 0.5 || (B.visibility ?? 1) < 0.5) continue;
      c.moveTo(A.x, A.y); c.lineTo(B.x, B.y);
    }
    c.stroke();
  };
  const dots = (pts, r, color) => {
    c.fillStyle = color;
    for (const p of pts) { if (!p || (p.visibility ?? 1) < 0.5) continue; c.beginPath(); c.arc(p.x, p.y, r, 0, Math.PI * 2); c.fill(); }
  };
  // the face mesh (optional, F): MediaPipe's full triangle mesh in white, drawn under the 3D head overlay
  if (S.showFace && v.face && S.connections?.face) {
    c.lineJoin = 'round';
    line(v.face, pairs(S.connections.face), 'rgba(255,255,255,0.18)', 3);     // a soft glow under the lines
    line(v.face, pairs(S.connections.face), 'rgba(255,255,255,0.92)', 1);
  }
  if (S.showTracking) {                                    // thin skeleton, for debugging
    if (v.pose) {
      line(v.pose, pairs(S.connections?.pose, POSE_PAIRS), 'rgba(255,255,255,0.55)', 2);
      dots(v.pose, 3.5, 'rgba(255,255,255,0.9)');
    }
    for (const hd of v.hands) {
      line(hd.lm, pairs(S.connections?.hand, HAND_PAIRS), 'rgba(255,255,255,0.8)', 2);
      dots(hd.lm, 2.6, '#ffffff');
    }
  }
  c.font = '600 14px Archivo, system-ui, sans-serif';
  for (const hd of v.hands) {                              // the gesture the app sees, under each wrist
    const word = GESTURE_WORD[hd.gesture];
    if (!word) continue;
    const x = hd.lm[0].x, y = hd.lm[0].y + 22, w = c.measureText(word).width + 14;
    c.fillStyle = 'rgba(20,33,61,0.85)'; c.beginPath(); c.roundRect(x - w / 2, y - 11, w, 20, 6); c.fill();
    c.fillStyle = '#fff'; c.textAlign = 'center'; c.fillText(word, x, y + 3);
  }
  c.globalAlpha = 1;
}

function drawPointer(tip, progress, hasTarget) {
  const c = ptrCtx;
  c.setTransform(DPR, 0, 0, DPR, 0, 0);
  c.clearRect(0, 0, W, H);
  if (!tip) return;
  c.lineWidth = 2.5; c.strokeStyle = '#ff5b1f';
  c.beginPath(); c.arc(tip.x, tip.y, 9, 0, Math.PI * 2); c.stroke();
  c.fillStyle = '#ff5b1f'; c.beginPath(); c.arc(tip.x, tip.y, 3, 0, Math.PI * 2); c.fill();
  if (hasTarget && progress > 0) {
    c.lineWidth = 4; c.lineCap = 'round';
    c.beginPath(); c.arc(tip.x, tip.y, 18, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2); c.stroke();
  }
}

// ---------------------------------------------------------------- boot

async function boot() {
  layout();
  addEventListener('resize', layout);
  try { await loadState(S.aid); }
  catch (e) { status(`Couldn't reach the server: ${e.message}. Is app.py running?`); return; }
  bindControls();
  setInterval(tickClock, 1000);
  setInterval(maybeRefreshHealth, 2000);
  setInterval(pollLive, Math.max(LIVE_MIN_MS, LIVE_POLL_MS));
  document.addEventListener('visibilitychange', () => { renderLive(); if (!document.hidden) pollLive(); });
  pulseUI = startPulse({
    getAstronaut: () => S.aid,                          // the live numbers are stored for the crew member on screen
    onChange: (bpm) => { S.pulseBpm = bpm; },
    onVitals: (v) => { S.pulseBreath = v.breathing_rate || null; },
    onRecorded: () => { S.healthDirty = true; },        // a new live reading was stored: refresh the chest numbers soon
    onStopChange: () => { refreshHealth(); },           // stopping or starting changes which numbers the engine uses
  });
  requestAnimationFrame(frame);
  await startInput();
  layout();
}

boot();
