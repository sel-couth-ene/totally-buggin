// DOM rendering for the HUD: region list, region panel, suggestions, modals.

import { trendChart, fmtMET, fmtValue, deviceName, DAY } from './trend.js';
import { drawPreview, livePreview } from './pets3d.js';

export const $ = (s, root = document) => root.querySelector(s);
const h = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (k === 'html') n.innerHTML = v;
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) n.append(kid.nodeType ? kid : document.createTextNode(kid));
  return n;
};
export { h };

export const REGION_ORDER = ['head', 'neck', 'chest', 'abdomen', 'arms', 'legs'];
export const REGION_NAME = { head: 'Head', neck: 'Neck', chest: 'Chest', abdomen: 'Abdomen', arms: 'Arms', legs: 'Legs' };
export const PART_FOR_REGION = { head: 'head', neck: 'neck', chest: 'chest', abdomen: 'abdomen', arms: 'left_arm', legs: 'left_leg' };
export const STATUS_WORD = { good: 'On track', warning: 'Watch', serious: 'Act now', critical: 'Urgent', nodata: 'No data' };
const RANK = { nodata: -1, good: 0, warning: 1, serious: 2, critical: 3 };
const ICON = {
  good: '<svg viewBox="0 0 10 10"><path d="M1.5 5.2 4 7.6 8.5 2.6" stroke="#fff" stroke-width="1.8" fill="none"/></svg>',
  warning: '<svg viewBox="0 0 10 10"><rect x="4.1" y="1.6" width="1.8" height="4.4" rx=".9"/><circle cx="5" cy="8" r="1"/></svg>',
  serious: '<svg viewBox="0 0 10 10"><rect x="4.1" y="1.6" width="1.8" height="4.4" rx=".9"/><circle cx="5" cy="8" r="1"/></svg>',
  critical: '<svg viewBox="0 0 10 10"><path d="M2.3 2.3l5.4 5.4M7.7 2.3 2.3 7.7" stroke="#fff" stroke-width="1.8"/></svg>',
  nodata: '',
};

export function chip(status, word) {
  return h('span', { class: `chip ${status}`, html: `<i>${ICON[status] || ''}</i>${word || STATUS_WORD[status] || status}` });
}

export function renderRail(health, selectedRegion, onSelect) {
  const list = $('#region-list');
  list.replaceChildren(...REGION_ORDER.map((rid) => {
    const r = health.regions[rid];
    const label = r.flags ? `${STATUS_WORD[r.status]}, ${r.flags} flagged` : STATUS_WORD[r.status];
    return h('li', {}, h('button', {
      class: `region ${r.status}`, 'data-dwell': true, 'aria-current': rid === selectedRegion ? 'true' : null,   // outlined in its status colour
      'aria-label': `${REGION_NAME[rid]}: ${label}`, onclick: () => onSelect(rid),
    }, h('span', {}, REGION_NAME[rid]), chip(r.status)));
  }));
}

function ago(nowMet, met) {
  if (met == null) return '';
  const d = nowMet - met;
  if (d < 3600) return `${Math.max(1, Math.round(d / 60))} min ago`;
  if (d < DAY) return `${Math.round(d / 3600)} h ago`;
  const days = Math.round(d / DAY);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

function metricBlock(m, nowMet) {
  const stale = m.measured_met != null && nowMet - m.measured_met > 3 * DAY && !['rhealth', 'ultrasound', 'model'].includes(m.device);
  const live = m.device === 'pulse_sensor';          // streaming now, so "x min ago" would only mislead
  const src = m.measured_met == null ? 'No reading yet' : live ? 'Pulse sensor, live' :
    `${deviceName(m.device)}, ${m.measured_met < 0 ? fmtMET(m.measured_met) : ago(nowMet, m.measured_met)}`;
  const valueParts = typeof m.value === 'number'
    ? [fmtValue(m.value, '', m.decimals), m.unit ? h('small', {}, m.unit) : null]
    : [m.value ?? '—'];
  const chart = trendChart(m);
  // plain words up top; the technical name and exact numbers in small print, for the medical officer
  return h('div', { class: 'metric' },
    h('div', { class: 'metric-head' },
      h('span', { class: 'metric-label' }, m.name || m.label),
      h('span', { class: 'metric-value' }, ...valueParts),
      chip(m.status)),
    h('p', { class: 'metric-explain' }, m.explain),
    chart,
    h('div', { class: 'metric-tech' },
      m.detail ? h('p', {}, h('b', {}, 'For the medical officer: '), m.detail) : null,
      h('p', { class: stale ? 'stale' : null }, stale ? `${src}. Next reading at the next wear session.` : src),
      m.source_note ? h('p', {}, `Data: ${m.source_note}`) : null,
      h('p', {}, m.how)));
}

export function renderPanel(region, health, recs, { onClose, onStart, onSelectRegion, expanded, onExpand }) {
  const panel = $('#panel');
  const scroll = panel.scrollTop;
  const metrics = [...region.metrics].sort((a, b) => RANK[b.status] - RANK[a.status]);
  const flagged = metrics.filter((m) => RANK[m.status] >= 1);
  const rest = metrics.filter((m) => RANK[m.status] < 1);
  const showAll = expanded || flagged.length === 0;
  const shown = showAll ? metrics : flagged;
  const regionRecs = recs.filter((r) => r.region === region.id);
  panel.replaceChildren(...[
    h('header', {},
      h('h2', {}, region.title),
      h('button', { class: 'btn quiet', 'data-dwell': true, onclick: onClose, 'aria-label': 'Close region details' }, 'Close'),
      chip(region.status, region.flags ? `${STATUS_WORD[region.status]}: ${region.flags} need${region.flags === 1 ? 's' : ''} attention` : null)),
    h('p', { class: 'about' }, region.about),
    // the live pulse card moves in here while the chest is open (see main.js)
    region.id === 'chest' ? h('div', { id: 'pulse-slot' }) : null,
    regionRecs.length ? h('div', { class: 'section' }, h('h3', {}, 'Do this'),
      ...regionRecs.map((r) => recCard(r, onStart, onSelectRegion, false))) : null,
    h('div', { class: 'section' }, h('h3', {}, 'Your readings'), ...shown.map((m) => metricBlock(m, health.now_met)),
      !showAll && rest.length ? h('button', { class: 'btn quiet more', 'data-dwell': true, onclick: onExpand },
        `Show ${rest.length} more that are fine`) : null),
    h('div', { class: 'section' }, h('h3', {}, 'In space'), h('ul', {}, ...region.space.map((s) => h('li', {}, s)))),
    h('div', { class: 'section' }, h('h3', {}, 'Every day'), h('p', {}, region.act)),
  ].filter(Boolean));
  panel.hidden = false;
  panel.scrollTop = scroll;
}

// opts.details: show the "Details" toggle (bottom tray); opts.open: details currently shown
export function recCard(r, onStart, onSelectRegion, showRegionLink = true, opts = {}) {
  const { details = false, open = false, onToggle, exercise } = opts;
  const toggle = details ? h('button', {
    class: 'btn quiet rec-more', 'data-dwell': true, 'aria-expanded': open ? 'true' : 'false',
    onclick: () => onToggle?.(r.id),
  }, open ? 'Hide details' : 'Details') : null;
  const tech = open && r.detail ? h('p', { class: 'rec-tech' }, h('b', {}, 'For the medical officer: '), r.detail) : null;
  if (r.kind === 'consult' || r.kind === 'action') {
    return h('div', { class: `rec card ${r.kind}${open ? ' open' : ''}` },
      h('h3', {}, r.title),
      h('div', { class: 'rec-actions' }, toggle,
        showRegionLink ? h('button', { class: 'btn', 'data-dwell': true, onclick: () => onSelectRegion(r.region) }, 'See details') : null),
      h('p', {}, r.note ? `${r.reason} ${r.note}` : r.reason), tech);
  }
  const extra = open && exercise ? h('div', { class: 'rec-detail' },
    h('p', {}, h('b', {}, 'How: '), exercise.how),
    h('p', {}, h('b', {}, 'Why: '), exercise.why), tech) : null;
  return h('div', { class: `rec card${r.done ? ' done' : ''}${open ? ' open' : ''}` },
    h('h3', {}, r.title),
    h('div', { class: 'rec-actions' }, toggle,
      h('button', { class: `btn ${r.done ? 'quiet' : 'go'}`, 'data-dwell': true, onclick: () => onStart(r) },
        r.done ? 'Do it again' : `Start, ${r.points} points`)),
    h('p', {}, r.done ? 'Done. Points come back in a few hours.' : r.reason),
    extra);
}

// Bottom tray of suggested actions. Collapsed to one button by default; expand to see the cards.
export function renderRecs(recs, onStart, onSelectRegion, hidden, tray = {}) {
  const { open = false, onToggleTray, detailOpen = new Set(), onToggleDetail, exercises = {}, fresh = false } = tray;
  const root = $('#recs');
  const todo = recs.filter((r) => !r.done);
  root.hidden = hidden || !todo.length;
  if (root.hidden) { root.replaceChildren(); return; }
  const n = todo.length;
  const worst = todo.some((r) => r.status === 'critical' || r.status === 'serious') ? 'serious' : 'warning';
  const bar = h('button', {
    class: `btn rec-tray ${worst}${fresh && !open ? ' fresh' : ''}`, 'data-dwell': true,
    'aria-expanded': open ? 'true' : 'false', 'aria-controls': 'rec-list', onclick: onToggleTray,
  }, h('span', { class: 'chev', 'aria-hidden': 'true' }, open ? '▾' : '▴'),
  open ? 'Hide' : `${n} thing${n === 1 ? '' : 's'} to do`,
  !open && fresh ? h('span', { class: 'new-dot' }, 'New') : null);
  const list = open ? h('div', { id: 'rec-list', class: 'rec-list' },
    ...todo.slice(0, 4).map((r) => recCard(r, onStart, onSelectRegion, true, {
      details: true, open: detailOpen.has(r.id), onToggle: onToggleDetail, exercise: exercises[r.exercise],
    }))) : null;
  root.replaceChildren(...[list, bar].filter(Boolean));
}

/** Brief message above the bottom tray. kind: '' (default), 'quiet' (routine data sync) or
 *  'alert <status>' (a region got worse; tappable when onClick is given, and stays a little longer). */
export function toast(html, { kind = '', onClick = null, label = null } = {}) {
  const tappable = typeof onClick === 'function';
  const t = h(tappable ? 'button' : 'div', {
    class: `toast${kind ? ` ${kind}` : ''}`, html, type: tappable ? 'button' : null,
    'data-dwell': tappable || null, 'aria-label': label,
    onclick: tappable ? () => { t.remove(); onClick(); } : null,
  });
  $('#toasts').append(t);
  setTimeout(() => t.remove(), tappable ? 6300 : 3300);
}

// ---------------------------------------------------------------- modals

export function openModal(title, body, { onClose, lead } = {}) {
  const root = $('#modal-root');
  const close = () => { root.replaceChildren(); onClose?.(); document.removeEventListener('keydown', esc); };
  const esc = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', esc);
  const modal = h('div', { class: 'modal card', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('header', {}, h('h2', {}, title), h('button', { class: 'btn quiet', 'data-dwell': true, onclick: close }, 'Close')),
    lead ? h('p', { class: 'lead' }, lead) : null, body);
  const back = h('div', { class: 'modal-back', onclick: (e) => { if (e.target === back) close(); } }, modal);
  root.replaceChildren(back);
  modal.querySelector('button:not([data-close])')?.focus();
  return { close, modal };
}

const TABS = [['pet', 'Companions'], ['outfit', 'Outfits'], ['toy', 'Toys'], ['snack', 'Snacks']];

export function shopBody(game, catalog, tab, actions) {
  const owned = (id, item) => (item.type === 'pet' ? game.pets.some((p) => p.species === id)
    : item.type === 'snack' ? false : game.inventory[item.type].includes(id));
  const grid = h('div', { class: 'shop-grid' }, ...Object.entries(catalog).filter(([, it]) => it.type === tab).map(([id, it]) => {
    const cv = h('canvas', { 'aria-hidden': 'true' });
    requestAnimationFrame(() => drawPreview(cv, id, it.type));
    const have = owned(id, it);
    const count = it.type === 'snack' ? game.inventory.snack[id] || 0 : 0;
    const short = it.price > game.points;
    return h('div', { class: 'item' }, cv, h('span', { class: 'name' }, it.name),
      h('span', { class: 'price' }, it.price ? `${it.price} points` : 'Free', count ? `, you have ${count}` : ''),
      it.blurb ? h('span', { class: 'price' }, it.blurb) : null,
      h('button', { class: `btn ${have ? 'quiet' : 'go'}`, 'data-dwell': true, disabled: have || short,
        onclick: () => actions.buy(id) }, have ? 'Owned' : short ? `Need ${it.price - game.points} more` : 'Buy'));
  }));
  const tabs = h('div', { class: 'tabs', role: 'group', 'aria-label': 'Shop sections' },
    ...TABS.map(([k, label]) => h('button', { class: 'btn quiet', 'data-dwell': true, 'aria-pressed': k === tab ? 'true' : 'false',
      onclick: () => actions.tab(k) }, label)));
  const pets = h('div', { class: 'owned' }, h('h3', {}, 'Your companions'), ...game.pets.map((p) => {
    const cv = h('canvas', { 'aria-hidden': 'true' });
    requestAnimationFrame(() => livePreview(cv, p, actions.pets));        // shows its mood, outfit and chewing live
    const opts = [];
    for (const o of game.inventory.outfit) opts.push(h('button', { class: `btn ${p.outfit === o ? '' : 'quiet'}`, 'data-dwell': true,
      onclick: () => actions.equip(p.uid, p.outfit === o ? null : o, 'outfit') }, p.outfit === o ? `Take off ${catalog[o].name.toLowerCase()}` : `Wear ${catalog[o].name.toLowerCase()}`));
    for (const o of game.inventory.toy) opts.push(h('button', { class: `btn ${p.toy === o ? '' : 'quiet'}`, 'data-dwell': true,
      onclick: () => actions.equip(p.uid, p.toy === o ? null : o, 'toy') }, p.toy === o ? `Put away ${catalog[o].name.toLowerCase()}` : `Give ${catalog[o].name.toLowerCase()}`));
    for (const [s, n] of Object.entries(game.inventory.snack)) if (n > 0) opts.push(h('button', { class: 'btn quiet', 'data-dwell': true,
      onclick: () => actions.feed(p.uid, s) }, `Feed ${catalog[s].name.toLowerCase()} (${n})`));
    return h('div', { class: 'pet-row' }, cv, h('div', {},
      h('b', {}, p.name), ` the ${catalog[p.species].name.toLowerCase()}, happiness ${Math.round(p.happiness)} of 100`,
      h('div', { class: 'opts' }, ...(opts.length ? opts : [h('span', { class: 'price' }, 'Buy outfits, toys or snacks to share.')]))));
  }));
  const wallet = h('p', { class: 'lead' }, `You have ${game.points} points. Earn more by doing the suggested exercises, `
    + 'checking in once a day and petting your companions.');
  return h('div', {}, wallet, tabs, grid, pets);
}

export function checkinBody(onSave, today = null) {
  const sel = { mood: today?.mood ?? null, stress: today?.stress ?? null };   // reopening shows today's answers
  const group = (key, labels) => h('div', { class: 'choices', role: 'group' }, ...labels.map((label, i) => {
    const b = h('button', { class: 'choice', 'data-dwell': true, 'aria-pressed': sel[key] === i + 1 ? 'true' : 'false', onclick: () => {
      sel[key] = i + 1;
      b.parentElement.querySelectorAll('.choice').forEach((x) => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
    } }, h('b', {}, String(i + 1)), label);
    return b;
  }));
  const note = h('textarea', { id: 'checkin-note', placeholder: 'Anything else? Headache, nausea, trouble sleeping, medication taken…' });
  return h('div', {},
    h('h3', {}, 'How is your mood?'), group('mood', ['Very low', 'Low', 'Okay', 'Good', 'Great']),
    h('h3', {}, 'How stressed do you feel?'), group('stress', ['Calm', 'A little', 'Some', 'Quite', 'Very']),
    h('label', { for: 'checkin-note' }, h('h3', {}, 'Notes for the medical officer (optional)')), note,
    h('div', { style: 'display:flex;justify-content:flex-end;margin-top:12px' },
      h('button', { class: 'btn go', 'data-dwell': true, onclick: () => onSave({ ...sel, note: note.value.trim() || null }) },
        today ? 'Update today\'s check-in' : 'Save check-in')));
}

export function devicesBody(devices, feed, nowMet, scale) {
  const kindText = { live: 'Live, real sensor on USB', environment: 'Automatic, cabin sensors (real NASA data)', session: 'Automatic, in wear sessions', wearable: 'Automatic, all day', exam: 'Manual exam',
    log: 'Automatic, each workout', manual: 'Entered in this app', support: 'Reads data only' };
  const rows = devices.map((d) => h('tr', {},
    h('td', {}, h('b', {}, d.name), h('br'), h('span', { class: 'price' }, d.collects)),
    h('td', {}, kindText[d.kind] || d.kind, d.session_active === true ? h('div', { class: 'price' }, 'Session running now')
      : d.session_active === false ? h('div', { class: 'price' }, 'No session running') : null),
    h('td', {}, d.sync_every ? `Every ${fmtDur(d.sync_every)} of mission time (${fmtDur(d.sync_every / scale)} real)` : d.kind === 'live' ? 'Streams live while reading' : 'When entered'),
    h('td', {}, d.last_data_met != null ? fmtMET(d.last_data_met) : '—')));
  return h('div', {},
    h('table', { class: 'devices' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Device'), h('th', {}, 'How it measures'), h('th', {}, 'Batch interval'), h('th', {}, 'Latest reading'))),
      h('tbody', {}, ...rows)),
    h('div', { class: 'section' }, h('h3', {}, 'Batches fetched by this page'),
      feed.length ? h('ul', { class: 'feed' }, ...feed.slice(0, 30).map((f) =>
        h('li', {}, h('time', {}, fmtMET(f.met).replace('Day ', 'D')), h('span', {}, f.text))))
        : h('p', {}, 'No batches yet. The first arrive within a minute.')));
}

function fmtDur(s) {
  if (s < 90) return `${Math.round(s)} s`;
  if (s < 5400) return `${Math.round(s / 60)} min`;
  return `${Math.round(s / 3600)} h`;
}
