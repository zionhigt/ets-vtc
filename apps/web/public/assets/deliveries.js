import { getJson, applyCompany, el, table, deliveryRow, DELIVERY_HEAD, autoRefresh } from './common.js';

const PAGE = 25;
const params = new URLSearchParams(location.search);
const select = document.getElementById('driver');
const list = document.getElementById('list');
const more = document.getElementById('more');
let rows = [];

applyCompany();

const drivers = await getJson('/public/drivers');
for (const d of drivers) select.append(el('option', { value: d.id }, d.name));
select.value = params.get('driver') ?? '';

function query(before) {
  const q = new URLSearchParams({ limit: PAGE });
  if (select.value) q.set('driver', select.value);
  if (before) q.set('before', before);
  return `/public/deliveries?${q}`;
}

function show() {
  list.replaceChildren(table(DELIVERY_HEAD, rows.map(deliveryRow), 'Aucune livraison.'));
}

async function loadMore() {
  const page = await getJson(query(rows.at(-1)?.id));
  rows.push(...page);
  show();
  more.hidden = page.length < PAGE;
}

/** Rafraîchissement : ajoute en tête les livraisons arrivées depuis, sans perdre les pages chargées. */
async function refreshTop() {
  const page = await getJson(query());
  const known = new Set(rows.map((r) => r.id));
  const fresh = page.filter((r) => !known.has(r.id));
  if (!rows.length) more.hidden = page.length < PAGE;
  if (fresh.length || !rows.length) {
    rows = [...fresh, ...rows];
    show();
  }
}

select.addEventListener('change', () => {
  const url = new URL(location.href);
  if (select.value) url.searchParams.set('driver', select.value);
  else url.searchParams.delete('driver');
  history.replaceState(null, '', url);
  rows = [];
  refreshTop();
});
more.addEventListener('click', () => loadMore());

autoRefresh(refreshTop, { statusEl: document.getElementById('updated') });
