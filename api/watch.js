const { json, alert, DISCOUNT_PCT } = require('../lib/offer');
const { SHOPS, resolve } = require('../lib/shops');
const stock = require('../lib/stock');

const HOME_DISCOUNT_TITLE = stock.HOME_DISCOUNT_TITLE;

// Money-side audit of the upsell, run by Vercel Cron once a day.
//
// The live alerts in api/offer.js and api/sign.js say what happened on the screen. This
// says what happened in the till: it reads finished orders on both stores and checks
// that every accepted upsell really was charged what the screen promised - 65% of list
// for the catalogue offer, the flat home price for the pairs from Itay's home. It ran on a
// laptop first and went silent the moment the machine slept, which is the exact failure
// a monitor exists to prevent.
//
// Deliberately quiet: it only speaks when something is wrong, so a repeat message on an
// overlapping window is a repeat of a real problem.
const SECOND_PAIR_TITLE = 'הנחת זוג שני';
const WINDOW_HOURS = 25;
// A store that keeps taking orders but has not rendered the offer for two days has
// almost certainly had its Post-purchase page switched away from our app. That setting
// lives in the admin UI and no API can read it back, so this is the only way to see it.
const DARK_MS = 48 * 3600 * 1000;

async function ordersSince(cfg, sinceIso, fields) {
  const r = await fetch(
    `https://${cfg.admin}/admin/api/2025-07/orders.json?status=any&limit=250` +
      `&created_at_min=${encodeURIComponent(sinceIso)}&fields=${fields}`,
    { headers: { 'X-Shopify-Access-Token': process.env[cfg.tokenEnv] } }
  );
  if (!r.ok) throw new Error(`${cfg.admin} ${r.status}`);
  return (await r.json()).orders || [];
}

// Every line the upsell touched, tagged by which offer paid for it.
function upsellLines(order) {
  const out = [];
  for (const li of order.line_items || []) {
    for (const d of li.discount_allocations || []) {
      const title = ((d.discount_application || {}).title) || '';
      const kind = title.includes(HOME_DISCOUNT_TITLE)
        ? 'homestock'
        : title.includes(SECOND_PAIR_TITLE)
        ? 'second'
        : null;
      if (kind) out.push({ kind, li, discount: Number(d.amount || 0) });
    }
  }
  return out;
}

// Home-stock lines are priced per order, not per line: ONE_PAIR_PRICE for one, TWO_PAIR_PRICE for two.
function checkOrder(order, name) {
  const lines = upsellLines(order);
  if (!lines.length) return { accepted: 0, bad: [] };
  const bad = [];

  for (const { kind, li, discount } of lines.filter((x) => x.kind === 'second')) {
    const listed = Number(li.price) * Number(li.quantity);
    const paid = listed - discount;
    const expect = Math.round(((listed * (100 - DISCOUNT_PCT)) / 100) * 100) / 100;
    if (Math.abs(paid - expect) > 1) {
      bad.push(
        `${name} ${order.name}: ${li.title} מידה ${li.variant_title || '?'} - ` +
          `שולם ${paid.toFixed(2)} ₪ במקום ${expect.toFixed(2)} ₪`
      );
    }
  }

  const home = lines.filter((x) => x.kind === 'homestock');
  if (home.length) {
    const paid = home.reduce(
      (sum, { li, discount }) => sum + Number(li.price) * Number(li.quantity) - discount,
      0
    );
    const expect = home.length === 2 ? stock.TWO_PAIR_PRICE : stock.ONE_PAIR_PRICE;
    if (home.length > 2 || Math.abs(paid - expect) > 1) {
      bad.push(
        `${name} ${order.name}: מלאי בית ${home.length} זוגות - ` +
          `שולם ${paid.toFixed(2)} ₪ במקום ${expect} ₪`
      );
    }
  }

  return { accepted: lines.length, bad };
}

async function darkShops() {
  let seen = {};
  try {
    seen = await stock.seenMap();
  } catch (e) {
    return [];
  }
  const out = [];
  const since = new Date(Date.now() - DARK_MS).toISOString();
  for (const domain of Object.keys(SHOPS)) {
    const cfg = resolve(domain);
    const last = Date.parse(seen[domain] || 0) || 0;
    if (Date.now() - last < DARK_MS) continue;
    try {
      const recent = await ordersSince(cfg, since, 'id');
      if (recent.length) out.push(`${cfg.name}: הזמנות נכנסות אבל 0 הצגות ב-48 שעות`);
    } catch (e) {
      // Covered by the token failure alert below.
    }
  }
  return out;
}

module.exports = async (req, res) => {
  // Vercel Cron sends this header. Without the check the endpoint would publish the
  // store's daily order count to anyone who guessed the path.
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.authorization !== `Bearer ${cronSecret}`) {
    return json(res, 404, {});
  }

  const since = new Date(Date.now() - WINDOW_HOURS * 3600 * 1000).toISOString();
  const fields = 'id,name,created_at,total_price,line_items,cancelled_at';
  let scanned = 0;
  let accepted = 0;
  const bad = [];

  for (const domain of Object.keys(SHOPS)) {
    const cfg = resolve(domain);
    let orders;
    try {
      orders = await ordersSince(cfg, since, fields);
    } catch (e) {
      await alert(`🔴 בדיקת האפסייל נכשלה ב-${cfg.name}: ${String(e.message || e)}. לבדוק את הטוקן.`);
      continue;
    }
    for (const o of orders) {
      if (o.cancelled_at) continue;
      scanned++;
      const r = checkOrder(o, cfg.name);
      accepted += r.accepted;
      bad.push(...r.bad);
    }
  }

  if (bad.length) {
    await alert(`🔴 אפסייל במחיר לא צפוי:\n${bad.join('\n')}\nלבדוק מיד.`);
  }

  const dark = await darkShops();
  if (dark.length) {
    await alert(
      '🔴 המסך של האפסייל הפסיק להופיע:\n' +
        dark.join('\n') +
        '\nלבדוק בשופיפיי: Settings ⟶ Checkout ⟶ Post-purchase page.'
    );
  }

  return json(res, 200, { orders: scanned, accepted, mismatches: bad.length, dark });
};
