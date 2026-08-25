// Admin credentials per store. Both stores sell the same physical pairs, so both
// have to be able to look an order up and to write the shared sold list.
const SHOPS = {
  'sneakerstation1.com': {
    admin: 'j001wn-ec.myshopify.com',
    name: 'SneakerStation',
    tokenEnv: 'HOMESTOCK_ADMIN_TOKEN',
  },
  'sneakerstudio1.com': {
    admin: 'pavzxa-eh.myshopify.com',
    name: 'SNEAKERSTUDIO',
    tokenEnv: 'HOMESTOCK_ADMIN_TOKEN_STUDIO',
  },
};

// Short names used as keys in outlet_map.json.
const ALIASES = { station: 'sneakerstation1.com', studio: 'sneakerstudio1.com' };

// Accepts the public domain, the myshopify one (what webhooks send), or the short alias.
function resolve(raw) {
  const key = String(raw || '')
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .toLowerCase();
  const key2 = ALIASES[key] || key;
  for (const [domain, cfg] of Object.entries(SHOPS)) {
    if (key2 === domain || key2 === cfg.admin) return { domain, ...cfg };
  }
  return null;
}

async function adminGql(shopKey, query, variables) {
  const cfg = resolve(shopKey);
  if (!cfg) throw new Error(`unknown shop ${shopKey}`);
  const token = process.env[cfg.tokenEnv];
  if (!token) throw new Error(`missing ${cfg.tokenEnv}`);
  const r = await fetch(`https://${cfg.admin}/admin/api/2025-01/graphql.json`, {
    method: 'POST',
    headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: variables || {} }),
    signal: AbortSignal.timeout(9000),
  });
  if (!r.ok) throw new Error(`admin ${cfg.admin} ${r.status}`);
  const body = await r.json();
  if (body.errors) throw new Error(JSON.stringify(body.errors));
  return body.data;
}

module.exports = { SHOPS, resolve, adminGql };
