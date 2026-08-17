// Proves the post-purchase extension is actually live on a store without needing
// admin UI access: an order carrying our discount title can only exist if that
// store's Post-purchase page is pointed at our app.
const { SHOPS, resolve } = require('../lib/shops');

const TITLES = ['הנחת זוג שני', 'מלאי בית'];
const SINCE = process.argv[2] || '2026-06-01T00:00:00Z';

(async () => {
  for (const domain of Object.keys(SHOPS)) {
    const cfg = resolve(domain);
    const token = process.env[cfg.tokenEnv];
    let url =
      `https://${cfg.admin}/admin/api/2025-07/orders.json?status=any&limit=250` +
      `&created_at_min=${encodeURIComponent(SINCE)}` +
      `&fields=id,name,created_at,line_items`;
    let scanned = 0;
    const hits = [];
    while (url) {
      const r = await fetch(url, { headers: { 'X-Shopify-Access-Token': token } });
      if (!r.ok) {
        console.log(domain, 'HTTP', r.status);
        break;
      }
      const { orders } = await r.json();
      for (const o of orders) {
        scanned++;
        for (const li of o.line_items || []) {
          for (const da of li.discount_allocations || []) {
            const t = ((da.discount_application || {}).title) || '';
            if (TITLES.some((x) => t.includes(x))) {
              hits.push(`${o.name} ${o.created_at.slice(0, 10)} ${li.title} · ${t} · -${da.amount}`);
            }
          }
        }
      }
      const link = r.headers.get('link') || '';
      const next = link.match(/<([^>]+)>;\s*rel="next"/);
      url = next ? next[1] : null;
    }
    console.log(`== ${cfg.name} (${cfg.admin}): ${scanned} orders since ${SINCE.slice(0, 10)}, ${hits.length} upsell hits`);
    hits.slice(0, 20).forEach((h) => console.log('   ' + h));
  }
})();
