const stock = require('../lib/stock');

// Render beacon.
//
// The question we could not answer for three weeks: does Shopify actually DISPLAY the
// post-purchase page, or does it only run our ShouldRender hook and then skip it?
// /api/offer proves the hook ran. It proves nothing about the customer seeing anything.
// The deployed extension bundle makes no network call when it paints, and shipping a new
// bundle needs a Shopify CLI session we do not have.
//
// So the image the screen paints is routed through here first. A hit on this endpoint can
// only come from a browser that actually rendered the offer. Beacon hits ≈ offer calls
// means the screen is shown and the offer itself is the problem. Zero hits against
// hundreds of offer calls means the page is never displayed, and no upsell app can help.
//
// Open-redirect guard: only Shopify CDN hosts are followed.
const ALLOWED = /(^|\.)shopify\.com$|(^|\.)shopifycdn\.com$|(^|\.)myshopify\.com$/i;

function decode(u) {
  try {
    const s = Buffer.from(String(u), 'base64url').toString('utf8');
    const parsed = new URL(s);
    if (parsed.protocol !== 'https:') return null;
    if (!ALLOWED.test(parsed.hostname)) return null;
    return parsed.toString();
  } catch (e) {
    return null;
  }
}

module.exports = async (req, res) => {
  const target = decode(req.query.u);
  const ref = String(req.query.ref || '');
  const shop = String(req.query.shop || '');

  // dryrun builds a synthetic purchase; its paints are mine, not a customer's.
  if (ref && !ref.startsWith('dry')) {
    try {
      await stock.logEvent({ e: 'paint', shop, ref });
    } catch (e) {
      console.log('[px] log failed', String((e && e.message) || e));
    }
  }

  if (!target) {
    res.statusCode = 404;
    return res.end('');
  }
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Location', target);
  res.statusCode = 302;
  res.end('');
};
