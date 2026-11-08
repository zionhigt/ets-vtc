// Accueil « dispatch » : chiffres du mois, chauffeurs en route en direct,
// classement, dernières livraisons, chauffeurs.
import { getJson, applyCompany, el, fmt, table, deliveryRow, DELIVERY_HEAD, autoRefresh, initials, driverUrl } from './common.js';

await applyCompany();

const $ = (id) => document.getElementById(id);
const kpi = (label, value, sub, subClass) =>
  el('div', { class: 'kpi' }, el('div', { class: 'label' }, label), el('div', { class: 'value' }, value), sub ? el('div', { class: `sub ${subClass ?? ''}` }, sub) : null);

function changeLabel(pct) {
  if (pct === null || pct === undefined) return ['premier mois de données', ''];
  const sign = pct > 0 ? '+' : '';
  return [`${sign}${fmt.pct(pct)} vs mois dernier, même période`, pct >= 0 ? 'up' : 'down'];
}

function roadItem(d) {
  const live = d.live ?? {};
  const planned = d.plannedDistanceKm;
  const left = live.routeKm;
  const done = planned && left !== null && left !== undefined ? Math.min(100, Math.max(0, ((planned - left) / planned) * 100)) : null;
  let side;
  if (!live.online) side = el('div', { class: 'road-side muted' }, 'hors ligne', el('small', {}, fmt.ago(live.ts)));
  else if (live.paused || !live.speedKmh) side = el('div', { class: 'road-side', style: 'color:var(--good)' }, 'ARRÊT', el('small', {}, left !== null && left !== undefined ? `${fmt.km(left)} restants` : ''));
  else side = el('div', { class: 'road-side' }, `${live.speedKmh} km/h`, el('small', {}, left !== null && left !== undefined ? `${fmt.km(left)} restants` : ''));
  return el(
    'a',
    { class: 'road-item', href: driverUrl(d.driver.id) },
    el('span', { class: 'avatar' }, initials(d.driver.name)),
    el(
      'div',
      {},
      el('div', {}, el('span', { class: 'road-name' }, d.driver.name), ' ', el('span', { class: 'road-trip' }, `${d.from.city ?? '?'} → ${d.to.city ?? '?'}`)),
      el('div', { class: 'road-trip' }, `${d.cargo ?? ''}${d.income ? ` · ${fmt.money(d.income)}` : ''}`),
      done === null ? null : el('div', { class: `progress ${live.paused || !live.speedKmh ? 'teal' : ''}` }, el('span', { style: `width:${done.toFixed(1)}%` })),
    ),
    side,
  );
}

async function render() {
  const [stats, onRoad, recent, drivers] = await Promise.all([
    getJson('/public/stats'),
    getJson('/public/on-road'),
    getJson('/public/deliveries?limit=8'),
    getJson('/public/drivers'),
  ]);
  const month = new Intl.DateTimeFormat('fr-FR', { month: 'long' }).format(new Date());
  const [changeText, changeClass] = changeLabel(stats.month.distanceChangePct);

  $('kpis').replaceChildren(
    kpi(`Km · ${month}`, fmt.int(stats.month.distanceKm), changeText, changeClass),
    kpi('Livraisons du mois', fmt.int(stats.month.deliveries), `${fmt.int(stats.month.deliveriesToday)} aujourd'hui · ${fmt.int(stats.deliveries)} au total`),
    kpi("Chiffre d'affaires du mois", fmt.money(stats.month.revenue), `${fmt.money(stats.revenue)} au total`),
    kpi(
      'Chauffeurs en ligne',
      el('span', {}, fmt.int(stats.driversOnline), el('small', {}, ` / ${fmt.int(stats.drivers)}`)),
      `${fmt.int(stats.driversOnJob)} en mission · ${fmt.km(stats.distanceTodayKm)} aujourd'hui`,
    ),
  );

  $('road-count').textContent = onRoad.length ? `· ${onRoad.length}` : '';
  $('on-road').replaceChildren(...(onRoad.length ? onRoad.map(roadItem) : [el('div', { class: 'empty' }, 'Personne en mission pour le moment.')]));

  const ranked = [...drivers].sort((a, b) => b.monthKm - a.monthKm || a.name.localeCompare(b.name, 'fr'));
  $('ranking').replaceChildren(
    ...ranked.slice(0, 8).map((d, i) =>
      el(
        'a',
        { class: 'rank-row', href: driverUrl(d.id) },
        el('span', { class: 'pos' }, String(i + 1)),
        el('span', {}, el('span', { class: `dot ${d.online ? 'on' : ''}`, title: d.online ? 'en ligne' : 'hors ligne' }), d.name),
        el('span', { class: 'mono' }, fmt.km(d.monthKm)),
      ),
    ),
  );
  if (!ranked.length) $('ranking').replaceChildren(el('div', { class: 'empty' }, 'Aucun chauffeur.'));

  $('recent').replaceChildren(table(DELIVERY_HEAD, recent.map(deliveryRow), 'Aucune livraison pour le moment.'));

  $('drivers').replaceChildren(
    table(
      ['Chauffeur', 'Km du mois', 'Km au total', 'Livraisons', 'Revenu', 'Dernière livraison'],
      drivers.map((d) =>
        el(
          'tr',
          {},
          el('td', {}, el('span', { class: `dot ${d.online ? 'on' : ''}` }), el('a', { href: driverUrl(d.id) }, d.name), el('br'), el('small', {}, `chauffeur depuis ${fmt.monthYear(d.since)}`)),
          el('td', { class: 'num' }, fmt.km(d.monthKm)),
          el('td', { class: 'num' }, fmt.km(d.distanceKm)),
          el('td', { class: 'num' }, fmt.int(d.deliveries)),
          el('td', { class: 'num' }, fmt.money(d.revenue)),
          el('td', {}, fmt.ago(d.lastDeliveryAt)),
        ),
      ),
      'Aucun chauffeur pour le moment.',
      { num: [1, 2, 3, 4] },
    ),
  );
}

autoRefresh(render, { statusEl: $('updated') });
