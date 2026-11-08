import { getJson, applyCompany, el, table, deliveryRow, DELIVERY_HEAD } from './common.js';

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

async function load(reset) {
  if (reset) rows = [];
  const q = new URLSearchParams({ limit: PAGE });
  if (select.value) q.set('driver', select.value);
  if (rows.length) q.set('before', rows.at(-1).id);
  const page = await getJson(`/public/deliveries?${q}`);
  rows.push(...page);
  list.replaceChildren(table(DELIVERY_HEAD, rows.map(deliveryRow), 'Aucune livraison.'));
  more.hidden = page.length < PAGE;
}

select.addEventListener('change', () => {
  const url = new URL(location.href);
  if (select.value) url.searchParams.set('driver', select.value);
  else url.searchParams.delete('driver');
  history.replaceState(null, '', url);
  load(true);
});
more.addEventListener('click', () => load(false));

await load(true);
