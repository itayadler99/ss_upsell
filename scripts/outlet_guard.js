// Stops one physical pair from being sold twice.
//
// The outlet listings carry no inventory count - the admin token has no inventory scope,
// so a listing can be bought over and over. The same pair also sits on the outlet page of
// both stores and inside the post-purchase offer, which is three ways to sell a shoe that
// exists once. This closes all three: the moment a pair is bought anywhere, both outlet
// listings go to draft and the pair joins the shared sold list the offer screen reads.
//
// Polls rather than listens: a webhook would be faster, but registering one needs the app
// to be re-authorised, and a five minute window on a pair that sells a few times a month
// is not worth that. Runs from launchd every 5 minutes.
const fs = require('fs');
const path = require('path');
const stock = require('../lib/stock');
const { SHOPS, resolve } = require('../lib/shops');

const MAP = require('../lib/outlet_map.json');
const ME = '972542383620';
const LOOKBACK_HOURS = 6;
const STATE = path.join(process.env.HOME, '.ss_outlet_guard.json');

const variantIndex = new Map();
for (const pair of MAP) {
  for (const [shop, o] of Object.entries(pair.outlet)) variantIndex.set(String(o.variantId), { pair, shop });
}

async function recentOrders(cfg, sinceIso) {
  const r = await fetch(
    `https://${cfg.admin}/admin/api/2025-07/orders.json?status=any&limit=250` +
      `&created_at_min=${encodeURIComponent(sinceIso)}&fields=id,name,created_at,cancelled_at,line_items,customer,shipping_address`,
    { headers: { 'X-Shopify-Access-Token': process.env[cfg.tokenEnv] } }
  );
  if (!r.ok) throw new Error(`${cfg.admin} ${r.status}`);
  return ((await r.json()).orders || []).filter((o) => !o.cancelled_at);
}

async function draft(shopDomain, productId) {
  const cfg = resolve(shopDomain);
  const r = await fetch(`https://${cfg.admin}/admin/api/2024-01/products/${productId}.json`, {
    method: 'PUT',
    headers: { 'X-Shopify-Access-Token': process.env[cfg.tokenEnv], 'Content-Type': 'application/json' },
    // Status only. A partial `variants` array here would delete every variant not listed.
    body: JSON.stringify({ product: { id: productId, status: 'draft' } }),
  });
  if (!r.ok) throw new Error(`draft ${shopDomain} ${productId} ${r.status} ${await r.text()}`);
}

async function tell(text) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch('http://localhost:8080/api/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipient: ME, message: text }),
      });
      if (r.ok) return true;
    } catch (e) {
      /* bridge may not be up yet */
    }
    await new Promise((s) => setTimeout(s, 10000 * (attempt + 1)));
  }
  return false;
}

(async () => {
  const since = new Date(Date.now() - LOOKBACK_HOURS * 3600 * 1000).toISOString();
  const already = new Set(await stock.soldIds());
  const handled = new Set(
    fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')).handled || [] : []
  );

  const found = [];
  for (const domain of Object.keys(SHOPS)) {
    const cfg = resolve(domain);
    for (const order of await recentOrders(cfg, since)) {
      for (const li of order.line_items || []) {
        const hit = variantIndex.get(String(li.variant_id));
        if (!hit) continue;
        const tag = `${domain}:${order.id}:${li.variant_id}`;
        if (handled.has(tag)) continue;
        found.push({ ...hit, order, li, domain, tag, cfg });
      }
    }
  }

  if (!found.length) {
    console.log('no outlet sales in the last', LOOKBACK_HOURS, 'hours');
    return;
  }

  const lines = [];
  for (const f of found) {
    // Both stores, always - including the one that just sold it, because the listing has
    // no stock count and would otherwise keep taking orders for a shoe that is gone.
    for (const [shop, o] of Object.entries(f.pair.outlet)) {
      try {
        await draft(shop, o.productId);
      } catch (e) {
        console.error('draft failed', shop, o.productId, String(e.message || e));
      }
    }
    if (!already.has(f.pair.id)) {
      await stock.markSold([
        {
          id: f.pair.id,
          title: f.pair.title,
          size: f.pair.size,
          shop: f.domain,
          order: f.order.name,
          soldAt: new Date().toISOString(),
          via: 'outlet',
        },
      ]);
      already.add(f.pair.id);
    }
    const addr = f.order.shipping_address || {};
    lines.push(
      `${f.pair.title} מידה ${f.li.variant_title || f.pair.size}\n` +
        `${f.cfg.name} הזמנה ${f.order.name}\n` +
        `${[addr.first_name, addr.last_name].filter(Boolean).join(' ')} · ${addr.phone || ''}\n` +
        `${[addr.address1, addr.city].filter(Boolean).join(', ')}`
    );
    handled.add(f.tag);
  }

  fs.writeFileSync(STATE, JSON.stringify({ handled: [...handled].slice(-500) }));
  const text = `נמכר זוג מהבית - צריך לשלוח\n\n${lines.join('\n\n')}`;
  console.log(text);
  console.log('whatsapp:', await tell(text));
})().catch((e) => {
  fs.appendFileSync(
    `${process.env.HOME}/ss_outlet_guard_FAILED.txt`,
    `${new Date().toISOString()} ${String(e.stack || e)}\n`
  );
  console.error('FAILED', e);
  process.exit(1);
});
