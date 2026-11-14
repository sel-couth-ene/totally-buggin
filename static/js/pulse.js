// Live pulse sensor card: current BPM, the raw pulse wave, and what the server works out from it
// (see astro/pulse.py and astro/pulse_analysis.py). It sits at the top left. When the chest panel
// is open the same card moves into that panel (dock) and also shows the measured vitals. The
// card only appears once a sensor has been seen. "Stop reading" releases the sensor; "Start reading"
// takes it up again.

import { api } from './api.js';

const $ = (s) => document.querySelector(s);
const FAST_MS = 200, SLOW_MS = 3000;     // poll fast while a sensor is connected, slowly otherwise
const QUALITY_WORD = { good: 'Good', fair: 'Fair', weak: 'Weak' };

export function startPulse({ getAstronaut, onChange, onVitals, onRecorded, onStopChange, onLayout } = {}) {
  const card = $('#pulse'), bpmEl = $('#pulse-bpm'), statusEl = $('#pulse-status'), noteEl = $('#pulse-note');
  const canvas = $('#pulse-wave'), restartBtn = $('#pulse-restart'), toggleBtn = $('#pulse-toggle');
  const el = { rest: $('#pv-rest'), hrv: $('#pv-hrv'), br: $('#pv-br'), sig: $('#pv-sig') };
  const ctx = canvas.getContext('2d');
  let seen = false, timer = null, lastBpm = null, lastBreath = null, paused = false, samples = [];

  restartBtn.addEventListener('click', async () => {
    restartBtn.disabled = true;
    samples = []; draw();
    setStatus('Restarting the sensor…');
    try { await api.pulseReset(); } catch { restartBtn.disabled = false; }
  });

  toggleBtn.addEventListener('click', async () => {
    toggleBtn.disabled = true;
    try {
      const r = await api.pulsePause(!paused);
      paused = r.paused;
      if (paused) { samples = []; draw(); show({ paused: true }); emit(null, null); }
      else setStatus('Connecting to the sensor…');
      onStopChange?.(paused);                           // the page refreshes the health numbers now
    } catch { /* keep the old state; the next poll shows the truth */ }
    toggleBtn.disabled = false;
    clearTimeout(timer); poll();
  });

  function setStatus(text, bad = false) {
    if (statusEl.textContent !== text) statusEl.textContent = text;
    statusEl.classList.toggle('bad', bad);
  }
  const setText = (node, text) => { if (node.textContent !== text) node.textContent = text; };
  const setVital = (node, value, unit) => {
    const text = value == null ? '--' : `${Math.round(value)}`;
    if (node.dataset.v !== text) {
      node.dataset.v = text;
      node.replaceChildren(text, ...(value == null || !unit ? [] : [Object.assign(document.createElement('small'), { textContent: unit })]));
    }
  };

  function draw() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(20,33,61,0.12)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();
    if (samples.length < 2) return;
    // scale to the wave's own range so a small signal still fills the strip
    let lo = Infinity, hi = -Infinity;
    for (const v of samples) { if (v < lo) lo = v; if (v > hi) hi = v; }
    const span = Math.max(hi - lo, 40), mid = (hi + lo) / 2;
    const y = (v) => h / 2 - ((v - mid) / span) * (h - 8);
    const n = 300;                                        // fixed time axis: ~6 s
    const x0 = w * (1 - (samples.length - 1) / (n - 1));
    ctx.strokeStyle = '#d03b3b'; ctx.lineWidth = 1.8; ctx.lineJoin = 'round';
    ctx.beginPath();
    samples.forEach((v, i) => {
      const x = x0 + (i / (n - 1)) * w;
      i ? ctx.lineTo(x, y(v)) : ctx.moveTo(x, y(v));
    });
    ctx.stroke();
    const lx = w, ly = y(samples[samples.length - 1]);
    ctx.fillStyle = '#d03b3b'; ctx.beginPath(); ctx.arc(lx - 2, ly, 2.6, 0, Math.PI * 2); ctx.fill();
  }

  function emit(bpm, breath) {
    if (bpm !== lastBpm) { lastBpm = bpm; onChange?.(bpm); }
    if (breath !== lastBreath) { lastBreath = breath; onVitals?.({ breathing_rate: breath }); }
  }

  function show(d) {
    const v = d.vitals || {};
    card.classList.toggle('stopped', !!d.paused);
    toggleBtn.textContent = d.paused ? 'Start reading' : 'Stop reading';
    restartBtn.hidden = !!d.paused;
    restartBtn.disabled = !!(d.resetting || !d.connected);
    setText(bpmEl, !d.paused && d.bpm > 0 ? String(d.bpm) : '--');
    setVital(el.rest, d.paused ? null : v.resting_hr, 'bpm');
    setVital(el.hrv, d.paused ? null : v.hrv_rmssd, 'ms');
    setVital(el.br, d.paused ? null : v.breathing_rate, '/min');
    setText(el.sig, d.paused || !v.quality ? '--' : QUALITY_WORD[v.quality]);
    if (d.paused) {
      setStatus('Reading stopped. The sensor is released and live values are not being used.');
      setText(noteEl, '');
      return;
    }
    if (d.resetting) setStatus('Restarting the sensor…');
    else if (d.connecting && !d.connected) setStatus('Connecting to the sensor…');
    else if (!d.connected) setStatus('Sensor unplugged', true);
    else if (!d.receiving) setStatus('Connected, no signal yet', true);
    else if (v.analyzed && !v.quality) setStatus('No pulse found. Rest a finger on the sensor.', true);
    else if (!d.bpm) setStatus('Hold your finger on the sensor');
    else setStatus(d.simulated ? 'Live from the simulated sensor' : 'Live from the pulse sensor');
    setText(noteEl, v.resting_hr == null ? (v.resting_note || '')
      : v.breathing_rate == null ? 'Breathing rate needs about a minute of steady pulse.'
      : 'Resting heart rate and breathing rate are feeding the chest readings.');
  }

  async function poll() {
    let d = null;
    try { d = await api.pulse(getAstronaut?.()); } catch { /* server busy or restarting */ }
    if (d) paused = !!d.paused;
    if (d?.available && (d.connected || d.paused)) seen = true;
    const wasHidden = card.hidden;
    card.hidden = !seen;                                  // no sensor ever seen: keep the screen as it was
    if (wasHidden !== card.hidden) onLayout?.();
    if (seen && d) {
      samples = d.resetting || d.paused ? [] : d.samples;
      show(d);
      draw();
    }
    // only a pulse that is really being read right now drives the app; otherwise the simulated data is used
    const live = !!(d?.reading && !d.paused);
    emit(live ? d.bpm : null, live && d.vitals?.breathing_rate ? d.vitals.breathing_rate : null);
    if (d?.recorded) onRecorded?.();
    timer = setTimeout(poll, d?.connected && !d.paused ? FAST_MS : SLOW_MS);
  }

  poll();
  return {
    stop: () => clearTimeout(timer),
    /** Move the card into `slot` (the chest panel) and show the vitals. */
    dock(slot) {
      if (!slot) return this.undock();
      if (card.parentElement !== slot) slot.replaceChildren(card);
      card.classList.add('docked');
      requestAnimationFrame(() => { draw(); onLayout?.(); });
    },
    /** Put the card back at the top left. */
    undock() {
      if (!card.classList.contains('docked')) return;
      card.classList.remove('docked');
      document.body.append(card);
      requestAnimationFrame(() => { draw(); onLayout?.(); });
    },
  };
}
