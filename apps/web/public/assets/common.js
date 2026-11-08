// Utilitaires communs au site public et à l'admin. Aucune dépendance.
export const API = '/api/v1';

export async function getJson(route) {
  const res = await fetch(`${API}${route}`);
  if (!res.ok) throw new Error(`${route} : ${res.status}`);
  return res.json();
}

const nf = new Intl.NumberFormat('fr-FR');
const money = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const dtf = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
const rtf = new Intl.RelativeTimeFormat('fr', { numeric: 'auto' });

export const fmt = {
  int: (n) => (n === null || n === undefined ? '–' : nf.format(Math.round(n))),
  km: (n) => (n === null || n === undefined ? '–' : `${nf.format(Math.round(n))} km`),
  money: (n) => (n === null || n === undefined ? '–' : money.format(n)),
  date: (ts) => (ts ? dtf.format(new Date(ts)) : '–'),
  monthYear: (ts) => (ts ? new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' }).format(new Date(ts)) : '–'),
  ago(ts) {
    if (!ts) return '–';
    const s = Math.round((ts - Date.now()) / 1000);
    const steps = [
      [60, 'second'],
      [3600, 'minute'],
      [86400, 'hour'],
      [604800, 'day'],
      [2629800, 'week'],
      [31557600, 'month'],
      [Infinity, 'year'],
    ];
    const units = { second: 1, minute: 60, hour: 3600, day: 86400, week: 604800, month: 2629800, year: 31557600 };
    const [, unit] = steps.find(([limit]) => Math.abs(s) < limit);
    return rtf.format(Math.round(s / units[unit]), unit);
  },
};

/** Crée un élément : el('td', { class: 'num' }, 'texte', autreElement). Le texte n'est jamais interprété comme du HTML. */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined) node.append(c instanceof Node ? c : String(c));
  return node;
}

/** Applique l'identité de l'entreprise (nom, slogan, logo, couleur) à l'en-tête. */
export async function applyCompany() {
  let company;
  try {
    company = await getJson('/public/company');
  } catch {
    return null;
  }
  if (/^#[0-9a-f]{6}$/i.test(company.primaryColor)) document.documentElement.style.setProperty('--brand', company.primaryColor);
  document.querySelectorAll('[data-company-name]').forEach((n) => (n.textContent = company.name));
  document.querySelectorAll('[data-company-slogan]').forEach((n) => {
    n.textContent = company.slogan;
    n.hidden = !company.slogan;
  });
  document.querySelectorAll('[data-company-logo]').forEach((img) => {
    if (company.logoUrl) {
      img.src = company.logoUrl;
      img.alt = company.name;
      img.hidden = false;
    }
  });
  const page = document.title.split('·')[0].trim();
  document.title = `${page} · ${company.name}`;
  return company;
}

export function deliveryRow(d) {
  return el(
    'tr',
    {},
    el('td', {}, fmt.date(d.endedAt ?? d.startedAt)),
    el('td', {}, d.driver.name),
    el('td', {}, el('span', { class: 'route' }, `${d.from.city ?? '?'} → ${d.to.city ?? '?'}`, el('small', {}, `${d.from.company ?? ''} → ${d.to.company ?? ''}`))),
    el('td', {}, d.cargo ?? '–', d.cargoMass ? el('small', {}, ` (${fmt.int(d.cargoMass / 1000)} t)`) : null),
    el('td', { class: 'num' }, fmt.km(d.distanceKm ?? d.plannedDistanceKm)),
    el('td', { class: 'num' }, fmt.money(d.revenue ?? d.income)),
    el('td', { class: 'num' }, d.fines.count ? `${d.fines.count} · ${fmt.money(d.fines.total)}` : '–'),
  );
}

export const DELIVERY_HEAD = ['Date', 'Chauffeur', 'Trajet', 'Cargaison', 'Distance', 'Revenu', 'Amendes'];

export function table(head, rows, emptyText) {
  if (!rows.length) return el('div', { class: 'card empty' }, emptyText);
  return el(
    'div',
    { class: 'table-wrap' },
    el('table', {}, el('thead', {}, el('tr', {}, head.map((h, i) => el('th', { class: i >= 4 && head === DELIVERY_HEAD ? 'num' : null }, h)))), el('tbody', {}, rows)),
  );
}
