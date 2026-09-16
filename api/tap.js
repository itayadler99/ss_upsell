const stock = require('../lib/stock');

// Beacon for the in-cart home-stock offer.
//
// The post-purchase screen is not displayed on these stores - Shopify only vaults a card
// for Shopify Payments, and 100% of orders here go through PayPlus. See api/px.js for the
// evidence. The replacement offer lives inside the Kaching cart drawer, which is ours to
// paint, so this endpoint is the only place that can tell us whether a customer saw it.
//
// act=view  the card was painted, once per cart signature per session
// act=add   the customer added the pair
//
// Called cross-origin from the storefront, so CORS is open on GET. It writes nothing the
// caller controls beyond a size and a variant id, both echoed back only into our own log.
const ALLOWED_ACTS = new Set(['view', 'add', 'fail']);

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end('');
  }

  const act = String(req.query.act || '');
  const shop = String(req.query.shop || '').slice(0, 64);
  const size = String(req.query.size || '').slice(0, 16);
  const vid = String(req.query.vid || '').slice(0, 24);
  const n = Number(req.query.n) || 0;
  // Which surface the tap came from. Absent means the cart drawer, the only caller until
  // the thank-you block shipped; without it the two screens would be indistinguishable in
  // the log and neither could be judged on its own.
  const src = req.query.src === 'ty' ? 'ty' : 'cart';

  if (ALLOWED_ACTS.has(act) && shop) {
    try {
      await stock.logEvent({ e: src, act, shop, size, vid, n });
    } catch (e) {
      console.log('[tap] log failed', String((e && e.message) || e));
    }
  }

  res.statusCode = 204;
  res.end('');
};
