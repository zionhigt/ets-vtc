import { getJson, applyCompany, el, fmt, table, deliveryRow, DELIVERY_HEAD, autoRefresh } from './common.js';

const company = await applyCompany();
if (company?.description) document.getElementById('description').textContent = company.description;

const kpi = (label, value) => el('div', { class: 'kpi' }, el('div', { class: 'label' }, label), el('div', { class: 'value' }, value));

async function render() {
  const [stats, onRoad, recent, drivers] = await Promise.all([
    getJson('/public/stats'),
    getJson('/public/on-road'),
    getJson('/public/deliveries?limit=10'),
    getJson('/public/drivers'),
  ]);

  document.getElementById('kpis').replaceChildren(
    kpi('Livraisons', fmt.int(stats.deliveries)),
    kpi('Kilomètres parcourus', fmt.km(stats.distanceKm)),
    kpi("Kilomètres aujourd'hui", fmt.km(stats.distanceTodayKm)),
    kpi("Chiffre d'affaires", fmt.money(stats.revenue)),
    kpi('Chauffeurs', fmt.int(stats.drivers)),
    kpi('En mission', fmt.int(stats.driversOnJob)),
  );

  document.getElementById('on-road').replaceChildren(
    table(
      ['Chauffeur', 'Trajet', 'Cargaison', 'Distance prévue', 'Revenu prévu', 'Partie'],
      onRoad.map((d) =>
        el(
          'tr',
          {},
          el('td', {}, d.driver.name),
          el('td', {}, el('span', { class: 'route' }, `${d.from.city ?? '?'} → ${d.to.city ?? '?'}`, el('small', {}, `${d.from.company ?? ''} → ${d.to.company ?? ''}`))),
          el('td', {}, d.cargo ?? '–'),
          el('td', { class: 'num' }, fmt.km(d.plannedDistanceKm)),
          el('td', { class: 'num' }, fmt.money(d.income)),
          el('td', {}, fmt.ago(d.startedAt)),
        ),
      ),
      'Personne en mission pour le moment.',
    ),
  );

  document.getElementById('recent').replaceChildren(table(DELIVERY_HEAD, recent.map(deliveryRow), 'Aucune livraison pour le moment.'));

  document.getElementById('drivers').replaceChildren(
    table(
      ['Chauffeur', 'Livraisons', 'Kilomètres', 'Revenu', 'Dernière livraison'],
      drivers.map((d) =>
        el(
          'tr',
          {},
          el('td', {}, el('a', { href: `/livraisons?driver=${d.id}` }, d.name), el('br'), el('small', { class: 'brand-slogan' }, `chauffeur depuis ${fmt.monthYear(d.since)}`)),
          el('td', { class: 'num' }, fmt.int(d.deliveries)),
          el('td', { class: 'num' }, fmt.km(d.distanceKm)),
          el('td', { class: 'num' }, fmt.money(d.revenue)),
          el('td', {}, fmt.ago(d.lastDeliveryAt)),
        ),
      ),
      'Aucun chauffeur pour le moment.',
    ),
  );
}

autoRefresh(render, { everyMs: 15_000, statusEl: document.getElementById('updated') });
