import { getJson, applyCompany, el, fmt, table, deliveryRow, DELIVERY_HEAD } from './common.js';

const company = await applyCompany();
if (company?.description) document.getElementById('description').textContent = company.description;

const [stats, recent, drivers] = await Promise.all([
  getJson('/public/stats'),
  getJson('/public/deliveries?limit=10'),
  getJson('/public/drivers'),
]);

const kpi = (label, value) => el('div', { class: 'kpi' }, el('div', { class: 'label' }, label), el('div', { class: 'value' }, value));
document.getElementById('kpis').append(
  kpi('Livraisons', fmt.int(stats.deliveries)),
  kpi('Kilomètres parcourus', fmt.km(stats.distanceKm)),
  kpi("Kilomètres aujourd'hui", fmt.km(stats.distanceTodayKm)),
  kpi("Chiffre d'affaires", fmt.money(stats.revenue)),
  kpi('Chauffeurs', fmt.int(stats.drivers)),
  kpi('En mission', fmt.int(stats.driversOnJob)),
);

document.getElementById('recent').append(
  table(DELIVERY_HEAD, recent.map(deliveryRow), 'Aucune livraison pour le moment.'),
);

document.getElementById('drivers').append(
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
