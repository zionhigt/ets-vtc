import { API, applyCompany, el, fmt } from './common.js';

// La session vit dans sessionStorage : elle disparaît à la fermeture de l'onglet.
const store = {
  get: () => {
    try {
      return JSON.parse(sessionStorage.getItem('vtc-admin') ?? 'null');
    } catch {
      return null;
    }
  },
  set: (s) => {
    try {
      if (s) sessionStorage.setItem('vtc-admin', JSON.stringify(s));
      else sessionStorage.removeItem('vtc-admin');
    } catch {
      /* stockage indisponible : session limitée à la page */
    }
    memory = s;
  },
};
let memory = store.get();

const $ = (id) => document.getElementById(id);

function show(text, kind = 'ok') {
  const box = $('message');
  box.className = `notice ${kind}`;
  box.textContent = text;
  box.hidden = false;
  if (kind === 'ok') setTimeout(() => (box.hidden = true), 4000);
}

async function api(method, route, body) {
  const send = () =>
    fetch(`${API}${route}`, {
      method,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${memory?.accessToken}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  let res = await send();
  if (res.status === 401 && memory?.refreshToken) {
    const r = await fetch(`${API}/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken: memory.refreshToken }),
    });
    if (r.ok) {
      store.set(await r.json());
      res = await send();
    }
  }
  if (res.status === 401) {
    store.set(null);
    render();
    throw new Error('Session expirée, reconnecte-toi.');
  }
  const json = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const detail = json?.issues?.map((i) => `${i.path} : ${i.message}`).join(', ');
    throw new Error(detail || json?.message || `Erreur ${res.status}`);
  }
  return json;
}

/** Bouton destructif en deux temps : un premier clic arme, un second confirme. */
function confirmButton(label, onConfirm) {
  let timer;
  const btn = el('button', { class: 'danger', type: 'button' }, label);
  btn.addEventListener('click', async () => {
    if (!btn.classList.contains('confirm')) {
      btn.classList.add('confirm');
      btn.textContent = 'Confirmer ?';
      timer = setTimeout(() => {
        btn.classList.remove('confirm');
        btn.textContent = label;
      }, 4000);
      return;
    }
    clearTimeout(timer);
    btn.disabled = true;
    try {
      await onConfirm();
    } finally {
      btn.disabled = false;
    }
  });
  return btn;
}

function showToken(user, token) {
  const panel = $('token-panel');
  const copy = el('button', { type: 'button', class: 'secondary' }, 'Copier');
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(token);
      copy.textContent = 'Copié';
    } catch {
      copy.textContent = 'Copie impossible : sélectionne le texte';
    }
  });
  panel.replaceChildren(
    el(
      'div',
      { class: 'notice ok' },
      el('strong', {}, `Token personnel de ${user.displayName}`),
      el('div', {}, 'Transmets-le au chauffeur par un canal privé. Il ne sera plus affiché.'),
      el('div', { class: 'token-box' }, el('code', {}, token), copy),
    ),
  );
  panel.hidden = false;
}

const roleLabel = (r) => (r === 'admin' ? 'Administrateur' : 'Chauffeur');

/** Ligne en mode édition : nom affiché, identifiant et rôle. */
function editRow(u) {
  const self = u.id === memory.user.id;
  const name = el('input', { value: u.displayName, required: true, maxlength: '128', 'aria-label': 'Nom affiché' });
  const login = el('input', { value: u.username, required: true, pattern: '[a-z0-9._\\-]{2,64}', 'aria-label': 'Identifiant' });
  const role = el(
    'select',
    { 'aria-label': 'Rôle', disabled: self || undefined, title: self ? 'Tu ne peux pas changer ton propre rôle' : undefined },
    ['driver', 'admin'].map((r) => el('option', { value: r, selected: r === u.role || undefined }, roleLabel(r))),
  );
  const form = el('form', { id: `edit-${u.id}` });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const patch = {};
    if (name.value.trim() !== u.displayName) patch.displayName = name.value.trim();
    if (login.value.trim() !== u.username) patch.username = login.value.trim();
    if (!self && role.value !== u.role) patch.role = role.value;
    if (!Object.keys(patch).length) return loadUsers();
    try {
      const updated = await api('PATCH', `/admin/users/${u.id}`, patch);
      if (self) {
        memory.user = { ...memory.user, displayName: updated.displayName, username: updated.username };
        store.set(memory);
        $('me').textContent = updated.displayName;
      }
      show(`${updated.displayName} : modifications enregistrées.`);
      loadUsers();
    } catch (err) {
      show(err.message, 'error');
    }
  });
  for (const input of [name, login, role]) input.setAttribute('form', form.id);
  return el(
    'tr',
    {},
    el('td', {}, form, el('div', { class: 'edit-cell' }, name, login)),
    el('td', {}, role),
    el('td', {}, el('span', { class: `badge ${u.active ? 'good' : 'bad'}` }, u.active ? 'Actif' : 'Désactivé')),
    el('td', {}, fmt.date(u.createdAt)),
    el(
      'td',
      {},
      el(
        'div',
        { class: 'actions' },
        el('button', { type: 'submit', form: form.id }, 'Enregistrer'),
        el('button', { type: 'button', class: 'secondary', onclick: () => loadUsers() }, 'Annuler'),
      ),
    ),
  );
}

async function loadUsers() {
  const users = await api('GET', '/admin/users');
  const rows = users.map((u) =>
    el(
      'tr',
      {},
      el('td', {}, u.displayName, el('br'), el('small', { class: 'brand-slogan' }, u.username)),
      el('td', {}, roleLabel(u.role)),
      el('td', {}, el('span', { class: `badge ${u.active ? 'good' : 'bad'}` }, u.active ? 'Actif' : 'Désactivé')),
      el('td', {}, fmt.date(u.createdAt)),
      el(
        'td',
        {},
        el(
          'div',
          { class: 'actions' },
          el(
            'button',
            {
              type: 'button',
              class: 'secondary',
              onclick: (e) => e.target.closest('tr').replaceWith(editRow(u)),
            },
            'Modifier',
          ),
          u.id === memory.user.id
            ? el('small', { class: 'brand-slogan' }, 'toi')
            : [
                confirmButton('Nouveau token', async () => {
                  const r = await api('POST', `/admin/users/${u.id}/token`);
                  showToken(u, r.personalToken);
                  show(`L'ancien token de ${u.displayName} est révoqué.`);
                }),
                el(
                  'button',
                  {
                    type: 'button',
                    class: 'secondary',
                    onclick: async () => {
                      try {
                        await api('PATCH', `/admin/users/${u.id}`, { active: !u.active });
                        show(`${u.displayName} ${u.active ? 'désactivé' : 'réactivé'}.`);
                        loadUsers();
                      } catch (e) {
                        show(e.message, 'error');
                      }
                    },
                  },
                  u.active ? 'Désactiver' : 'Réactiver',
                ),
                confirmButton('Supprimer', async () => {
                  await api('DELETE', `/admin/users/${u.id}`);
                  show(`${u.displayName} et ses données sont supprimés.`);
                  loadUsers();
                }),
              ],
        ),
      ),
    ),
  );
  $('users').replaceChildren(
    el(
      'div',
      { class: 'table-wrap' },
      el(
        'table',
        {},
        el('thead', {}, el('tr', {}, ['Nom', 'Rôle', 'Statut', 'Créé le', 'Actions'].map((h) => el('th', {}, h)))),
        el('tbody', {}, rows),
      ),
    ),
  );
}

async function loadCompany() {
  const c = await api('GET', '/admin/company');
  const f = $('company');
  f.name.value = c.name;
  f.slogan.value = c.slogan;
  f.primaryColor.value = c.primaryColor;
  f.logoUrl.value = c.logoUrl;
  f.description.value = c.description;
}

function render() {
  const logged = Boolean(memory?.accessToken);
  $('login-view').hidden = logged;
  $('admin-view').hidden = !logged;
  $('logout').hidden = !logged;
  if (!logged) return;
  if (memory.user.role !== 'admin') {
    store.set(null);
    show("Ce compte n'est pas administrateur.", 'error');
    render();
    return;
  }
  $('me').textContent = memory.user.displayName;
  Promise.all([loadUsers(), loadCompany()]).catch((e) => show(e.message, 'error'));
}

$('login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const token = e.target.token.value.trim();
  const res = await fetch(`${API}/auth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  if (!res.ok) return show('Token invalide ou révoqué.', 'error');
  store.set(await res.json());
  e.target.reset();
  $('message').hidden = true;
  render();
});

$('logout').addEventListener('click', () => {
  store.set(null);
  render();
});

$('create').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  try {
    const r = await api('POST', '/admin/users', { username: f.username.value.trim(), displayName: f.displayName.value.trim(), role: f.role.value });
    showToken(r.user, r.personalToken);
    f.reset();
    loadUsers();
  } catch (err) {
    show(err.message, 'error');
  }
});

$('company').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  try {
    await api('PUT', '/admin/company', {
      name: f.name.value.trim(),
      slogan: f.slogan.value.trim(),
      primaryColor: f.primaryColor.value,
      logoUrl: f.logoUrl.value.trim(),
      description: f.description.value.trim(),
    });
    await applyCompany();
    show('Identité enregistrée : elle est déjà visible sur le site.');
  } catch (err) {
    show(err.message, 'error');
  }
});

$('rebuild').addEventListener('click', async (e) => {
  e.target.disabled = true;
  try {
    const r = await api('POST', '/admin/jobs/rebuild');
    show(`Livraisons recalculées (${r.processed} événements traités).`);
  } catch (err) {
    show(err.message, 'error');
  } finally {
    e.target.disabled = false;
  }
});

applyCompany();
render();
