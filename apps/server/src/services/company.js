// Identité de l'entreprise : définie par l'admin, modifiable à tout instant,
// affichée uniquement sur le site.
import { audit } from './users.js';

export const COMPANY_DEFAULTS = {
  name: 'Ma VTC',
  slogan: '',
  description: '',
  primaryColor: '#2563eb',
  logoUrl: '',
};

export async function getCompany(db) {
  const rows = await db.all('SELECT setting_key, setting_value FROM company_settings');
  const company = { ...COMPANY_DEFAULTS };
  for (const r of rows) if (r.setting_key in company) company[r.setting_key] = r.setting_value ?? '';
  return company;
}

export async function updateCompany(db, patch, actorId) {
  for (const [key, value] of Object.entries(patch)) {
    const updated = await db.run('UPDATE company_settings SET setting_value = ? WHERE setting_key = ?', [value, key]);
    if (!updated.changes) await db.insertIgnore('company_settings', ['setting_key', 'setting_value'], [[key, value]]);
  }
  await audit(db, actorId, 'company.update', 'company', patch);
  return getCompany(db);
}
