import { Body3D } from './body3d.js';
import { Tracker } from './tracking.js';
import { GestureEngine, drawGestureOverlay } from './gestures.js';

const $ = (sel) => document.querySelector(sel);

const DWELL_FRAMES = 5;      // frames you must keep pointing at the same part before the model reacts
const MISS_FRAMES = 4;       // frames of tracking loss tolerated while pointing
const AUTO_RETURN_MS = 5000; // return to the full body this long after pointing stops

let PARTS = {};
let selected = null;
let selectedBy = null;       // 'gesture' | 'mouse'

/* ---------------- 3D body ---------------- */

const body = new Body3D($('#viewport'), {
  onPick: (id) => select(id, 'mouse'),
  // keep the zoomed part clear of the info card
  getOffset: () => (document.body.classList.contains('cam-off') ? { x: 0.14, y: 0 } : { x: 0, y: 0.16 }),
});

function select(id, source) {
  if (!PARTS[id]) return;
  selected = id;
  selectedBy = source;
  body.focus(id);
  renderInfo(id);
}

function showFullBody() {
  selected = null;
  selectedBy = null;
  body.overview();
  $('#infoEmpty').hidden = false;
  $('#infoBody').hidden = true;
}

function renderInfo(id) {
  const p = PARTS[id];
  $('#infoEmpty').hidden = true;
  $('#infoBody').hidden = false;
  $('#infoTitle').textContent = p.name;
  $('#infoRegion').textContent = p.region;
  $('#infoSummary').textContent = p.summary;
  $('#infoFunction').textContent = p.function;
  $('#infoFact').textContent = p.fact;
  const ul = $('#infoStructures');
  ul.replaceChildren(...p.structures.map((s) => Object.assign(document.createElement('li'), { textContent: s })));
}

$('#resetView').addEventListener('click', showFullBody);
$('#infoBack').addEventListener('click', showFullBody);

fetch('/api/parts')
  .then((r) => r.json())
  .then((data) => { PARTS = data; })
  .catch((e) => console.error('Could not load /api/parts', e));

/* ---------------- camera + tracking ---------------- */

const gestures = new GestureEngine();
let candidate = null;
let candidateFrames = 0;
let missFrames = 0;
let lastPointAt = 0;

const tracker = new Tracker({
  video: $('#video'),
  canvas: $('#overlay'),
  onStatus: (msg) => { $('#gateMsg').textContent = msg; },
  onFrame: handleFrame,
});

function handleFrame(f) {
  const g = gestures.update(f.pose, f.hands, f.w, f.h);
  const now = performance.now();

  handlePointing(g.point, now);
  if (g.rotate) body.dragBy(g.rotate.dx, g.rotate.dy);
  if (g.zoom) body.zoomBy(g.zoom);

  drawGestureOverlay(f.ctx, g, f.w, f.h, (id) => (PARTS[id] ? PARTS[id].name : id));

  if (f.fps !== null) $('#chipFps').textContent = `${f.fps} fps`;
  const chip = $('#chipState');
  chip.className = 'chip chip-state';
  if (g.point) {
    chip.textContent = `Pointing at ${PARTS[g.point.hit.id] ? PARTS[g.point.hit.id].name.toLowerCase() : g.point.hit.id}`;
    chip.classList.add('is-point');
  } else if (g.pointers.length) {
    chip.textContent = 'Pointing, aim at your body';
  } else if (g.pinches.length > 1) {
    chip.textContent = 'Pinch zoom';
    chip.classList.add('is-pinch');
  } else if (g.pinches.length === 1) {
    chip.textContent = 'Pinch rotate';
    chip.classList.add('is-pinch');
  } else if (f.pose) {
    chip.textContent = 'Tracking you';
  } else {
    chip.textContent = 'Step back so your body is in view';
  }
}

function handlePointing(point, now) {
  if (point) {
    const id = point.hit.id;
    lastPointAt = now;
    missFrames = 0;
    if (id === candidate) candidateFrames++;
    else { candidate = id; candidateFrames = 1; }
    if (candidateFrames >= DWELL_FRAMES && id !== selected) select(id, 'gesture');
    return;
  }

  if (++missFrames > MISS_FRAMES) { candidate = null; candidateFrames = 0; }

  const auto = $('#optAuto').checked;
  if (auto && selected && selectedBy === 'gesture' && now - lastPointAt > AUTO_RETURN_MS) {
    showFullBody();
  }
}

async function startCamera() {
  const gate = $('#camGate');
  const msg = $('#gateMsg');
  const btn = $('#startCam');
  gate.hidden = false;
  btn.disabled = true;
  try {
    await tracker.start();
    gate.hidden = true;
    $('#chips').hidden = false;
  } catch (err) {
    console.error(err);
    tracker.stop();
    $('#chips').hidden = true;
    gate.hidden = false;
    btn.disabled = false;
    btn.textContent = 'Try again';
    if (err && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) {
      msg.textContent = 'Camera access was blocked. Allow it in your browser’s address bar, then try again.';
    } else if (err && err.name === 'NotFoundError') {
      msg.textContent = 'No camera found. Connect one, or close the camera and use the model with your mouse.';
    } else {
      msg.textContent = 'Tracking could not start: ' + (err && err.message ? err.message : err);
    }
    return;
  }
  btn.disabled = false;
}

function closeCamera() {
  tracker.stop();
  gestures.reset();
  document.body.classList.add('cam-off');
  document.body.classList.remove('cam-idle');
  $('#camToggle').textContent = 'Open camera';
  $('#chips').hidden = true;
  $('#camGate').hidden = false;
  $('#gateMsg').textContent = 'The camera stays in your browser. Nothing is uploaded.';
  $('#startCam').textContent = 'Start camera';
  body.resize();
}

function openCamera() {
  document.body.classList.remove('cam-off');
  document.body.classList.add('cam-idle');
  $('#camToggle').textContent = 'Close camera';
  body.resize();
  startCamera();
}

$('#startCam').addEventListener('click', startCamera);
$('#camToggle').addEventListener('click', () => {
  if (document.body.classList.contains('cam-off')) openCamera();
  else closeCamera();
});

/* ---------------- display options ---------------- */

const bindShow = (sel, key) => {
  const el = $(sel);
  tracker.show[key] = el.checked;
  el.addEventListener('change', () => { tracker.show[key] = el.checked; });
};
bindShow('#optBody', 'body');
bindShow('#optHands', 'hands');
bindShow('#optFace', 'face');
