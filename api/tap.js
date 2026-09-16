const stock = require('../lib/stock');

// Beacon for every home-stock surface: the cart drawer, the thank-you block, and the
// post-purchase screen.
//
// Corrected 16.9: post-purchase is not limited to Shopify Payments. Zipify's own doc
// (help.zipify.com/en/articles/4684879) says any direct credit-card processor whose fields
// sit inside Shopify checkout is supported, and only offsite redirect providers are not.
// PayPlus ships both - "Native Credit Card Form" is direct and eligible, "Payment Gateway"
// redirects and is not. About 60% of orders on these stores use the direct one.
//
// api/px.js measured paints by routing the offer image through us, which cannot tell
// "screen never shown" apart from "checkout CSP blocked a third-party image". The
// post-purchase extension now calls this endpoint from its own render instead.
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
  const src = req.query.src === 'ty' ? 'ty' : req.query.src === 'pp' ? 'pp' : 'cart';

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
