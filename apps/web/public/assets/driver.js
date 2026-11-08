// Page chauffeur, vue « cabine » : compteur en direct, mission, temps de
// conduite, réservoirs, mois, classement, registre des livraisons.
import { API, applyCompany, el, fmt, table, autoRefresh, initials, driverUrl, statusBadge } from './common.js';

await applyCompany();

const $ = (id) => document.getElementById(id);
const id = new URLSearchParams(location.search).get('id');
const SVG = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}, ...children) => {
  const node = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  node.append(...children);
  return node;
};

// --- Compteur de vitesse : arc de 240°, 0 à 140 km/h ---
const MAX_KMH = 140;
const START = -210; // degrés (0 = droite), sens horaire en SVG
const SWEEP = 240;
const CX = 160;
const CY = 160;
const R = 128;
const point = (deg, r) => [CX + r * Math.cos((deg * Math.PI) / 180), CY + r * Math.sin((deg * Math.PI) / 180)];
const angleOf = (kmh) => START + (Math.min(MAX_KMH, Math.max(0, kmh)) / MAX_KMH) * SWEEP;
function arc(fromDeg, toDeg, r) {
  const [x1, y1] = point(fromDeg, r);
  const [x2, y2] = point(toDeg, r);
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${toDeg - fromDeg > 180 ? 1 : 0} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

function gauge(live) {
  const speed = live.online ? live.speedKmh ?? 0 : 0;
  const limit = live.online ? live.speedLimitKmh : null;
  const over = limit && speed > limit + 2;
  const ticks = [];
  for (let v = 0; v <= MAX_KMH; v += 10) {
    const a = angleOf(v);
    const major = v % 20 === 0;
    const [x1, y1] = point(a, R + 6);
    const [x2, y2] = point(a, R + (major ? 18 : 12));
    ticks.push(svg('line', { x1, y1, x2, y2, stroke: major ? '#8190b0' : '#3b4d74', 'stroke-width': major ? 2 : 1 }));
    if (major) {
      const [tx, ty] = point(a, R - 16);
      ticks.push(svg('text', { x: tx, y: ty + 4, 'text-anchor': 'middle', fill: '#8190b0', 'font-size': 12, 'font-family': 'Share Tech Mono, monospace' }, String(v)));
    }
  }
  const parts = [
    ...ticks,
    svg('path', { d: arc(START, START + SWEEP, R), fill: 'none', stroke: '#1d3159', 'stroke-width': 10, 'stroke-linecap': 'round' }),
  ];
  if (speed > 0) {
    parts.push(svg('path', { d: arc(START, angleOf(speed), R), fill: 'none', stroke: over ? '#ff5a3c' : '#4f97ff', 'stroke-width': 10, 'stroke-linecap': 'round' }));
  }
  if (limit) {
    const a = angleOf(limit);
    const [x1, y1] = point(a, R - 8);
    const [x2, y2] = point(a, R + 20);
    parts.push(svg('line', { x1, y1, x2, y2, stroke: '#ff5a3c', 'stroke-width': 4, 'stroke-linecap': 'round' }));
  }
  parts.push(
    svg('text', { x: CX, y: CY - 30, 'text-anchor': 'middle', fill: '#8190b0', 'font-size': 12, 'letter-spacing': 3, 'font-family': 'Share Tech Mono, monospace' }, 'KM/H'),
    // Afficheur LCD : chiffres alignés à droite sur des segments « 888 » éteints.
    svg('text', { x: CX + 66, y: CY + 30, 'text-anchor': 'end', fill: '#14233f', 'font-size': 84, 'font-family': 'Share Tech Mono, monospace' }, '888'),
    svg('text', { x: CX + 66, y: CY + 30, 'text-anchor': 'end', fill: over ? '#ff5a3c' : '#4f97ff', 'font-size': 84, 'font-family': 'Share Tech Mono, monospace' }, String(speed)),
    svg(
      'text',
      { x: CX, y: CY + 62, 'text-anchor': 'middle', fill: '#ff5a3c', 'font-size': 13, 'font-family': 'Share Tech Mono, monospace' },
      limit ? `LIM ${limit}` : 'LIM –',
      svg('tspan', { fill: '#b9c4da', dx: 14 }, live.online && live.cruiseKmh ? `RÉGUL ${live.cruiseKmh}` : ''),
    ),
  );
  return svg('svg', { viewBox: '0 0 320 260', class: 'gauge', role: 'img', 'aria-label': `Vitesse ${speed} km/h${limit ? `, limite ${limit}` : ''}` }, ...parts);
}

const cells = (count, on, cls = '') => el('div', { class: `meter-bar ${cls}` }, Array.from({ length: count }, (_, i) => el('span', { class: i < on ? 'on' : '' })));
const stat = (label, value) => el('div', { class: 'stat' }, el('div', { class: 'label' }, label), el('div', { class: 'value' }, value));
const gearLabel = (g) => (g === null || g === undefined ? '–' : g < 0 ? 'R' : g === 0 ? 'N' : String(g));

function meter(label, seconds, limitS) {
  const ratio = seconds / limitS;
  const on = Math.min(24, Math.round(ratio * 24));
  return el(
    'div',
    { class: 'meter' },
    el('div', { class: 'meter-top' }, el('span', {}, label), el('b', {}, `${fmt.clock(seconds)} / ${fmt.clock(limitS)}`)),
    cells(24, on, ratio >= 1 ? 'bad' : ratio >= 0.85 ? 'warn' : ''),
  );
}

function tank(label, pct, cls = '') {
  const on = pct === null || pct === undefined ? 0 : Math.round((pct / 100) * 12);
  return el(
    'div',
    { class: 'tank-col' },
    el('div', { class: `cells ${cls}` }, Array.from({ length: 12 }, (_, i) => el('span', { class: 11 - i < on ? 'on' : '' }))),
    el('b', {}, fmt.pct(pct)),
    label,
  );
}

function mission(d) {
  const m = d.current;
  $('mission-ref').textContent = m ? `N° ${String(m.id).padStart(5, '0')}` : '';
  if (!m) {
    const last = d.recent[0];
    return [
      el('div', { class: 'mission-title muted' }, 'Pas de mission en cours'),
      last ? el('p', { class: 'mission-sub' }, `Dernière livraison : ${last.from.city} → ${last.to.city}, ${fmt.ago(last.endedAt)}.`) : null,
    ];
  }
  const left = d.live.online ? d.live.routeKm : null;
  const done = m.plannedDistanceKm && left !== null ? Math.min(100, Math.max(0, ((m.plannedDistanceKm - left) / m.plannedDistanceKm) * 100)) : null;
  return [
    el('div', { class: 'mission-title' }, m.cargo ?? 'Cargaison'),
    el('div', { class: 'mission-sub' }, [m.cargoMass ? `${fmt.int(m.cargoMass / 1000)} t` : null, m.market === 'freight_market' ? 'marché du fret' : m.market].filter(Boolean).join(' · ')),
    el(
      'div',
      { class: 'trip' },
      el('span', {}, el('b', {}, m.from.city ?? '?'), el('br'), el('small', { class: 'muted' }, m.from.company ?? '')),
      el('div', { class: 'progress' }, el('span', { style: `width:${(done ?? 0).toFixed(1)}%` })),
      el('span', { style: 'text-align:right' }, el('b', {}, m.to.city ?? '?'), el('br'), el('small', { class: 'muted' }, m.to.company ?? '')),
    ),
    el(
      'div',
      { class: 'stats-row' },
      stat('Restant', left !== null ? fmt.km(left) : '–'),
      stat('Temps (jeu)', d.live.online && d.live.routeGameMin ? fmt.duration(d.live.routeGameMin * 60) : '–'),
      stat('Prévu', fmt.km(m.plannedDistanceKm)),
      stat('Revenu', fmt.money(m.income)),
    ),
    m.fines.count ? el('p', { class: 'muted', style: 'margin:10px 0 0' }, `${m.fines.count} amende(s) sur cette mission : ${fmt.money(m.fines.total)}`) : null,
  ];
}

function render(d) {
  document.title = `${d.name} · ${document.title.split('·').pop().trim()}`;
  $('avatar').textContent = initials(d.name);
  $('name').textContent = d.name;
  $('subtitle').textContent = `Chauffeur depuis ${fmt.monthYear(d.since)} · ${d.month.rank}ᵉ du mois sur ${d.month.ranked}`;
  $('status').replaceChildren(
    el('span', { class: `dot ${d.live.online ? 'on' : ''}` }),
    d.live.online ? (d.live.paused ? 'en ligne · jeu en pause' : 'en ligne') : d.live.ts ? `hors ligne · vu ${fmt.ago(d.live.ts)}` : 'jamais connecté',
  );

  $('gauge').replaceChildren(gauge(d.live));
  $('rpm').textContent = d.live.online && d.live.rpm !== null ? fmt.int(d.live.rpm) : '–';
  $('gear').textContent = d.live.online ? gearLabel(d.live.gear) : '–';
  $('rpm-bar').replaceWith(Object.assign(cells(24, d.live.online ? Math.round(Math.min(1, (d.live.rpm ?? 0) / 2500) * 24) : 0), { id: 'rpm-bar' }));
  $('offline-note').hidden = d.live.online;
  $('offline-note').textContent = 'Le compteur s\'anime quand le chauffeur roule avec le tracker.';

  $('mission').replaceChildren(...mission(d).filter(Boolean));

  $('chrono-today').textContent = fmt.clock(d.today.drivingS);
  $('chrono-meters').replaceChildren(meter('Aujourd\'hui', d.today.drivingS, 9 * 3600), meter('Semaine', d.week.drivingS, 56 * 3600));

  $('truck').textContent = d.live.truck ?? '';
  $('tanks').replaceChildren(
    tank('GAZOLE', d.live.fuelPct),
    tank('DÉGÂTS CARGO', d.live.cargoDamagePct, 'bad'),
  );

  $('month-rank').textContent = d.month.rank ? `${d.month.rank}ᵉ / ${d.month.ranked}` : '';
  $('month').replaceChildren(
    stat('Km', fmt.int(d.month.distanceKm)),
    stat('Livraisons', fmt.int(d.month.deliveries)),
    stat('Revenu', fmt.money(d.month.revenue)),
    stat('Conduite', fmt.duration(d.month.drivingS)),
    stat('Amendes', d.month.fines.count ? `${d.month.fines.count} · ${fmt.money(d.month.fines.total)}` : '0'),
    stat('Péages', fmt.money(d.month.tolls)),
  );

  $('ranking').replaceChildren(
    ...d.ranking.slice(0, 5).map((r) =>
      el(
        'a',
        { class: `rank-row ${r.id === d.id ? 'me' : ''}`, href: driverUrl(r.id) },
        el('span', { class: 'pos' }, String(r.rank)),
        el('span', {}, r.name),
        el('span', { class: 'mono' }, fmt.km(r.km)),
      ),
    ),
  );

  $('total').replaceChildren(
    stat('Km', fmt.int(d.total.distanceKm)),
    stat('Livraisons', fmt.int(d.total.deliveries)),
    stat('Revenu', fmt.money(d.total.revenue)),
    stat('Depuis', new Intl.DateTimeFormat('fr-FR', { month: 'short', year: 'numeric' }).format(new Date(d.since))),
  );

  $('log').replaceChildren(
    table(
      ['N°', 'Date', 'Trajet', 'Cargaison', 'Km', 'Revenu', 'Amendes', 'État'],
      d.recent.map((r) =>
        el(
          'tr',
          {},
          el('td', { class: 'mono' }, String(r.id).padStart(5, '0')),
          el('td', {}, fmt.date(r.endedAt ?? r.startedAt)),
          el('td', {}, el('span', { class: 'route' }, `${r.from.city ?? '?'} → ${r.to.city ?? '?'}`, el('small', {}, `${r.from.company ?? ''} → ${r.to.company ?? ''}`))),
          el('td', {}, r.cargo ?? '–'),
          el('td', { class: 'num' }, fmt.int(r.distanceKm ?? r.plannedDistanceKm)),
          el('td', { class: 'num' }, fmt.money(r.revenue ?? r.income)),
          el('td', { class: 'num' }, r.fines.count ? fmt.money(r.fines.total) : '–'),
          el('td', {}, statusBadge(r.status)),
        ),
      ),
      'Aucune livraison pour le moment.',
      { num: [4, 5, 6] },
    ),
  );
}

async function load() {
  const res = await fetch(`${API}/public/drivers/${encodeURIComponent(id)}`);
  if (res.status === 404 || res.status === 400) {
    $('not-found').hidden = false;
    $('dashboard').hidden = true;
    return;
  }
  if (!res.ok) throw new Error(`chauffeur : ${res.status}`);
  render(await res.json());
  $('dashboard').hidden = false;
}

if (!id) $('not-found').hidden = false;
else autoRefresh(load, { statusEl: $('updated') });
