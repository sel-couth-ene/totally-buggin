// Small single-series trend line for the region panel, with the person's own
// usual range (or the lab reference range for blood) drawn as a band.

const NS = 'http://www.w3.org/2000/svg';
const el = (name, attrs = {}) => {
  const n = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
};

export const DAY = 86400;

export function fmtMET(met, withTime = true) {
  if (met == null) return '';
  if (met < 0) {
    const d = Math.ceil(-met / DAY);
    return d === 1 ? 'the day before launch' : `${d} days before launch`;
  }
  const day = Math.floor(met / DAY);
  const h = Math.floor((met % DAY) / 3600), m = Math.floor((met % 3600) / 60);
  return withTime ? `Day ${day}, ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}` : `Day ${day}`;
}

export function fmtValue(v, unit, decimals = 1) {
  if (v == null) return '—';
  if (typeof v === 'string') return v;
  const num = v.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  if (!unit) return num;
  return unit.startsWith('/') || unit === '%' || unit === '°C' ? `${num}${unit}` : `${num} ${unit}`;
}

const DEVICE_NAMES = {
  biomonitor: 'Bio-Monitor', actiwatch: 'Actiwatch', thermomini: 'Thermo-Mini', tempus: 'Tempus Pro',
  rhealth: 'rHEALTH One', ultrasound: 'Ultrasound', exercise: 'Exercise log', crew_app: 'Check-in', model: 'Model',
  dosimeter: 'Radiation dosimeter', cabin_env: 'Cabin sensors', pulse_sensor: 'Pulse sensor (live)',
};
export const deviceName = (id) => DEVICE_NAMES[id] || id;

// Each chart's y range is remembered between live updates and only ever widens, so a new point
// extends the line without the axis jumping. Cleared when the page switches crew member.
const SCALES = new Map();
export function resetTrendScales() { SCALES.clear(); }

/** metric: an item from /api/health. Returns an element (or null if nothing to plot). */
export function trendChart(metric, { width = 300, height = 64 } = {}) {
  const pts = (metric.series || []).filter((p) => typeof p.v === 'number');
  if (pts.length < 2) return null;
  const pad = { l: 4, r: 10, t: 8, b: 16 };
  const xs = pts.map((p) => p.t), ys = pts.map((p) => p.v);
  let band = null, bandLabel = '';
  if (metric.lab_range && metric.lab_range[0] != null && metric.lab_range[1] != null) {
    band = metric.lab_range; bandLabel = 'Lab reference range';
  } else if (metric.baseline && metric.baseline.n > 0) {
    const { mean, sd } = metric.baseline;
    band = [mean - 2 * sd, mean + 2 * sd]; bandLabel = 'Your usual pre-flight range';
  }
  let lo = Math.min(...ys, ...(band || [])), hi = Math.max(...ys, ...(band || []));
  if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
  const padY = (hi - lo) * 0.12; lo -= padY; hi += padY;
  const prev = SCALES.get(metric.id);
  if (prev) { lo = Math.min(lo, prev.lo); hi = Math.max(hi, prev.hi); }
  SCALES.set(metric.id, { lo, hi });
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const X = (t) => pad.l + ((t - x0) / Math.max(x1 - x0, 1)) * (width - pad.l - pad.r);
  const Y = (v) => pad.t + (1 - (v - lo) / (hi - lo)) * (height - pad.t - pad.b);

  const wrap = document.createElement('div');
  wrap.className = 'trend';
  const svg = el('svg', { viewBox: `0 0 ${width} ${height}`, width: '100%', height, role: 'img',
    'aria-label': `${metric.label} trend, ${pts.length} readings` });
  if (band) {
    svg.append(el('rect', { x: pad.l, y: Y(band[1]), width: width - pad.l - pad.r,
      height: Math.max(1, Y(band[0]) - Y(band[1])), class: 'trend-band', rx: 3 }));
  }
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.t).toFixed(1)},${Y(p.v).toFixed(1)}`).join('');
  svg.append(el('path', { d, class: 'trend-line' }));
  const last = pts[pts.length - 1];
  svg.append(el('circle', { cx: X(last.t), cy: Y(last.v), r: 4, class: 'trend-last' }));
  const lab = (x, text, anchor) => { const t = el('text', { x, y: height - 3, class: 'trend-axis', 'text-anchor': anchor }); t.textContent = text; return t; };
  svg.append(lab(pad.l, fmtMET(x0, false), 'start'), lab(width - pad.r, fmtMET(x1, false), 'end'));
  const cross = el('line', { class: 'trend-cross', y1: pad.t, y2: height - pad.b, visibility: 'hidden' });
  const dot = el('circle', { r: 4, class: 'trend-hover', visibility: 'hidden' });
  svg.append(cross, dot);
  const tip = document.createElement('div');
  tip.className = 'trend-tip'; tip.hidden = true;
  wrap.append(svg, tip);
  if (band) {
    const key = document.createElement('div');
    key.className = 'trend-key';
    key.innerHTML = `<span class="swatch"></span>${bandLabel}`;
    wrap.append(key);
  }
  // hover: nearest point
  const hit = el('rect', { x: 0, y: 0, width, height, fill: 'transparent' });
  svg.append(hit);
  hit.addEventListener('pointermove', (e) => {
    const r = svg.getBoundingClientRect();
    const sx = ((e.clientX - r.left) / r.width) * width;
    let best = pts[0];
    for (const p of pts) if (Math.abs(X(p.t) - sx) < Math.abs(X(best.t) - sx)) best = p;
    const cx = X(best.t), cy = Y(best.v);
    cross.setAttribute('x1', cx); cross.setAttribute('x2', cx); cross.setAttribute('visibility', 'visible');
    dot.setAttribute('cx', cx); dot.setAttribute('cy', cy); dot.setAttribute('visibility', 'visible');
    tip.hidden = false;
    tip.textContent = `${fmtMET(best.t)}: ${fmtValue(best.v, metric.unit, metric.decimals)} (${deviceName(best.src)})`;
    tip.style.left = `${Math.min(Math.max((cx / width) * 100, 18), 82)}%`;
  });
  hit.addEventListener('pointerleave', () => {
    cross.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); tip.hidden = true;
  });
  return wrap;
}
