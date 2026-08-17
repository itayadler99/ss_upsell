// Liquidation of the pairs sitting at Itay's home. One physical pair per entry,
// so the sold list has to be shared between both stores - selling the same shoe
// twice is the one failure mode that costs a refund and a customer.
const STOCK = require('./stock.json');

// Both storefronts read and write the same metafield on the SneakerStation shop.
// Station holds it because its admin token is the one proven to write shop
// metafields; Studio just points at the same record.
const STATE_SHOP = 'j001wn-ec.myshopify.com';
const NAMESPACE = 'homestock';
const KEY = 'sold';

const ONE_PAIR_PRICE = 249;
const TWO_PAIR_PRICE = 419;
// Title on the discount line. api/sign.js writes it, api/watch.js audits by it, so it
// lives here rather than in either of them.
const HOME_DISCOUNT_TITLE = 'מלאי בית - מחיר חד פעמי';

function adminToken() {
  return process.env.HOMESTOCK_ADMIN_TOKEN;
}

async function gql(query, variables) {
  const r = await fetch(`https://${STATE_SHOP}/admin/api/2025-01/graphql.json`, {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': adminToken(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables: variables || {} }),
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error(`admin ${r.status}`);
  const body = await r.json();
  if (body.errors) throw new Error(JSON.stringify(body.errors));
  return body.data;
}

// Returns the ids already sold. On any failure it throws rather than returning
// an empty list, because "we could not check" must not read as "nothing sold".
async function soldIds() {
  const d = await gql(
    `query($ns:String!,$k:String!){ shop { metafield(namespace:$ns,key:$k){ value } } }`,
    { ns: NAMESPACE, k: KEY }
  );
  const raw = d.shop.metafield && d.shop.metafield.value;
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed.map((x) => (typeof x === 'string' ? x : x.id)) : [];
}

// Append-only. Reads first so a concurrent sale on the other store is not lost.
async function markSold(entries) {
  const d = await gql(
    `query($ns:String!,$k:String!){ shop { id metafield(namespace:$ns,key:$k){ value } } }`,
    { ns: NAMESPACE, k: KEY }
  );
  let list = [];
  try {
    list = JSON.parse((d.shop.metafield && d.shop.metafield.value) || '[]');
  } catch (e) {
    list = [];
  }
  const have = new Set(list.map((x) => (typeof x === 'string' ? x : x.id)));
  const added = entries.filter((e) => !have.has(e.id));
  if (!added.length) return { added: [], total: list.length };
  const next = list.concat(added);
  const r = await gql(
    `mutation($m:[MetafieldsSetInput!]!){ metafieldsSet(metafields:$m){ userErrors{ message } } }`,
    {
      m: [
        {
          ownerId: d.shop.id,
          namespace: NAMESPACE,
          key: KEY,
          type: 'json',
          value: JSON.stringify(next),
        },
      ],
    }
  );
  const errs = r.metafieldsSet.userErrors;
  if (errs && errs.length) throw new Error(errs.map((e) => e.message).join('; '));
  return { added, total: next.length };
}

// Full sold records (id, title, size, shop, order, soldAt, shippedAt), not just ids.
async function soldRecords() {
  const d = await gql(
    `query($ns:String!,$k:String!){ shop { metafield(namespace:$ns,key:$k){ value } } }`,
    { ns: NAMESPACE, k: KEY }
  );
  const raw = (d.shop.metafield && d.shop.metafield.value) || '[]';
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed.filter((x) => x && typeof x === 'object') : [];
}

async function markShipped(id) {
  const d = await gql(
    `query($ns:String!,$k:String!){ shop { id metafield(namespace:$ns,key:$k){ value } } }`,
    { ns: NAMESPACE, k: KEY }
  );
  let list = [];
  try {
    list = JSON.parse((d.shop.metafield && d.shop.metafield.value) || '[]');
  } catch (e) {
    list = [];
  }
  let touched = false;
  const next = list.map((x) => {
    if (x && x.id === id && !x.shippedAt) {
      touched = true;
      return { ...x, shippedAt: new Date().toISOString() };
    }
    return x;
  });
  if (!touched) return false;
  const r = await gql(
    `mutation($m:[MetafieldsSetInput!]!){ metafieldsSet(metafields:$m){ userErrors{ message } } }`,
    {
      m: [
        {
          ownerId: d.shop.id,
          namespace: NAMESPACE,
          key: KEY,
          type: 'json',
          value: JSON.stringify(next),
        },
      ],
    }
  );
  const errs = r.metafieldsSet.userErrors;
  if (errs && errs.length) throw new Error(errs.map((e) => e.message).join('; '));
  return true;
}

// Liveness heartbeat, one timestamp per storefront.
//
// The post-purchase slot is chosen in the store admin UI and there is no API to read
// it back. If that radio ever flips to None the offer simply stops appearing and
// nothing errors out - the exact silent failure that has to be visible. So every
// render stamps the shop here, and api/watch.js shouts when a shop takes orders but
// has not stamped in two days. Written at most once every 6 hours so the buyer does
// not pay for it.
const SEEN_KEY = 'seen';
const SEEN_STALE_MS = 6 * 3600 * 1000;

async function seenMap() {
  const d = await gql(
    `query($ns:String!,$k:String!){ shop { metafield(namespace:$ns,key:$k){ value } } }`,
    { ns: NAMESPACE, k: SEEN_KEY }
  );
  try {
    return JSON.parse((d.shop.metafield && d.shop.metafield.value) || '{}');
  } catch (e) {
    return {};
  }
}

async function touchSeen(shopDomain) {
  const d = await gql(
    `query($ns:String!,$k:String!){ shop { id metafield(namespace:$ns,key:$k){ value } } }`,
    { ns: NAMESPACE, k: SEEN_KEY }
  );
  let map = {};
  try {
    map = JSON.parse((d.shop.metafield && d.shop.metafield.value) || '{}');
  } catch (e) {
    map = {};
  }
  const prev = Date.parse(map[shopDomain] || 0) || 0;
  if (Date.now() - prev < SEEN_STALE_MS) return false;
  map[shopDomain] = new Date().toISOString();
  await gql(
    `mutation($m:[MetafieldsSetInput!]!){ metafieldsSet(metafields:$m){ userErrors{ message } } }`,
    {
      m: [
        {
          ownerId: d.shop.id,
          namespace: NAMESPACE,
          key: SEEN_KEY,
          type: 'json',
          value: JSON.stringify(map),
        },
      ],
    }
  );
  return true;
}

// Model and size confirmations for pairs not in stock.json yet. Stored next to the
// sold list so the answers survive a redeploy.
const PICKS_KEY = 'picks';

async function readPicks() {
  const d = await gql(
    `query($ns:String!,$k:String!){ shop { metafield(namespace:$ns,key:$k){ value } } }`,
    { ns: NAMESPACE, k: PICKS_KEY }
  );
  try {
    return JSON.parse((d.shop.metafield && d.shop.metafield.value) || '{}');
  } catch (e) {
    return {};
  }
}

async function writePicks(picks) {
  const d = await gql(`query{ shop { id } }`, {});
  const r = await gql(
    `mutation($m:[MetafieldsSetInput!]!){ metafieldsSet(metafields:$m){ userErrors{ message } } }`,
    {
      m: [
        {
          ownerId: d.shop.id,
          namespace: NAMESPACE,
          key: PICKS_KEY,
          type: 'json',
          value: JSON.stringify(picks),
        },
      ],
    }
  );
  const errs = r.metafieldsSet.userErrors;
  if (errs && errs.length) throw new Error(errs.map((e) => e.message).join('; '));
}

function parseSize(title) {
  const t = String(title || '').trim();
  // Adidas ships thirds: "37 1/3", "44 2/3". Everything else is plain or .5.
  const frac = t.match(/^(\d{2})\s+(\d)\/(\d)$/);
  if (frac) return Number(frac[1]) + Number(frac[2]) / Number(frac[3]);
  const n = parseFloat(t.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function byVariantId(shopDomain, variantId) {
  const id = String(variantId).replace(/\D/g, '');
  return STOCK.find((s) => {
    const sh = s.shops[shopDomain];
    return sh && String(sh.variantId) === id;
  });
}

// Matches on size only - the model the buyer just bought is irrelevant. An exact
// size wins; half a size up is offered too because a shoe half a size large is
// wearable and half a size small is not.
function candidatesForSize(shopDomain, boughtSizeTitle, sold) {
  const want = parseSize(boughtSizeTitle);
  if (want === null) return [];
  const soldSet = new Set(sold);
  return STOCK.filter((s) => {
    if (soldSet.has(s.id)) return false;
    const sh = s.shops[shopDomain];
    if (!sh || !sh.variantId) return false;
    const d = s.size - want;
    return Math.abs(d) < 0.2 || (d > 0.2 && d <= 0.6);
  })
    .map((s) => ({ ...s, halfUp: s.size - want > 0.2 }))
    .sort((a, b) => Number(a.halfUp) - Number(b.halfUp) || a.size - b.size);
}

// The changeset needs a per-unit discount, not a target price, so the amount off
// is derived from the same list price shown on screen.
function discountFor(listPrice, pairs) {
  const target = pairs === 2 ? TWO_PAIR_PRICE / 2 : ONE_PAIR_PRICE;
  return Math.round((Number(listPrice) - target) * 100) / 100;
}

module.exports = {
  STOCK,
  ONE_PAIR_PRICE,
  TWO_PAIR_PRICE,
  HOME_DISCOUNT_TITLE,
  soldIds,
  soldRecords,
  markSold,
  markShipped,
  seenMap,
  touchSeen,
  readPicks,
  writePicks,
  parseSize,
  byVariantId,
  candidatesForSize,
  discountFor,
};
