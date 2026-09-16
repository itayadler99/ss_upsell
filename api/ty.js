const shops = require('../lib/shops');
const stock = require('../lib/stock');
const OUTLET = require('../lib/outlet_map.json');
const { verify, json } = require('../lib/offer');

// Home-stock offer for the thank-you page.
//
// The post-purchase screen (api/offer.js) is dead on these stores: Shopify only shows it
// when it vaulted the card itself, and 100% of orders here settle through PayPlus. See
// api/px.js for the evidence - hundreds of ShouldRender calls, zero render beacons.
//
// The thank-you page has no such dependency. It is rendered for every order regardless of
// gateway, so this is the only screen after payment that can carry the offer. What it
// cannot do is charge the saved card: there is no card. So the offer here links out to a
// fresh checkout pre-filled with the pair, at the outlet price of 299.
//
// That price is why this endpoint reads outlet_map.json rather than stock.json. stock.json
// points at the catalogue variant, which is still listed at its full price and only drops
// to 299 through a changeset discount that a plain cart permalink cannot carry. The outlet
// listing is a second product whose variant is priced 299 outright, so a permalink to it
// needs no discount code and cannot be re-priced by anything in the cart.

const MIN_SHOE_PRICE = 200;
const SHORT = { 'sneakerstation1.com': 'station', 'sneakerstudio1.com': 'studio' };

function outletFor(id, shortName) {
  const row = OUTLET.find((o) => o.id === id);
  const sh = row && row.outlet && row.outlet[shortName];
  if (!sh || !sh.variantId) return null;
  // A pair already sold is drafted by scripts/outlet_guard.js. Offering a drafted
  // variant produces a checkout that 404s, which is worse than showing nothing.
  if (String(sh.status || '').toUpperCase() !== 'ACTIVE') return null;
  return sh;
}

async function orderSizes(shopKey, orderGid) {
  const d = await shops.adminGql(
    shopKey,
    `query($id:ID!){ order(id:$id){ id lineItems(first:20){ nodes {
        quantity
        originalTotalSet { presentmentMoney { amount } }
        variant { title }
      } } } }`,
    { id: orderGid }
  );
  const o = d && d.order;
  if (!o) return [];
  const sizes = [];
  for (const li of o.lineItems.nodes) {
    const unit = Number(li.originalTotalSet.presentmentMoney.amount) / (li.quantity || 1);
    if (unit < MIN_SHOE_PRICE) continue; // socks, insurance, keychain - no foot behind them
    const t = String((li.variant && li.variant.title) || '').trim();
    if (t && !sizes.includes(t)) sizes.push(t);
  }
  return sizes;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end('');
  }

  const body = req.body || {};
  // Dry run against a real order, so the order lookup and the outlet mapping can be
  // proven before an extension bundle is shipped. Costs nothing and touches no buyer.
  const key = process.env.HOMESTOCK_WEBHOOK_KEY;
  const dry = Boolean(key && req.query.key === key && req.query.order);

  const orderGid = dry
    ? `gid://shopify/Order/${String(req.query.order).replace(/\D/g, '')}`
    : String(body.orderId || '');
  if (!/^gid:\/\/shopify\/Order\/\d+$/.test(orderGid)) {
    return json(res, 400, { render: false, error: 'bad request' });
  }

  let dest = String(req.query.shop || '');
  if (!dry) {
    const token = String(body.token || '');
    if (!token) return json(res, 400, { render: false, error: 'bad request' });
    try {
      dest = verify(token).payload.dest || '';
    } catch (e) {
      return json(res, 401, { render: false, error: 'bad token' });
    }
  }

  // The shop comes from the signed token, never from the caller, so an order id from
  // one store cannot be read through the other store's admin credentials.
  const cfg = shops.resolve(dest);
  if (!cfg) return json(res, 400, { render: false, error: 'unknown shop' });
  const shortName = SHORT[cfg.domain];

  try {
    const sizes = await orderSizes(cfg.domain, orderGid);
    if (!sizes.length) return json(res, 200, { render: false, reason: 'no shoe' });

    const sold = await stock.soldIds();

    for (const size of sizes) {
      const want = stock.parseSize(size);
      const items = [];
      for (const c of stock.candidatesForSize(cfg.domain, size, sold)) {
        const sh = outletFor(c.id, shortName);
        if (!sh) continue;
        const displaySize = stock.formatSize(c.halfUp ? c.size : want);
        items.push({
          id: c.id,
          title: c.title,
          image: sh.image,
          displaySize,
          boxSize: sh.variantTitle,
          halfUp: c.halfUp,
          price: Number(sh.price),
          compareAt: Number(sh.compareAt || 0),
          // return_to sends the buyer straight to checkout instead of parking him in
          // the cart, where the Kaching drawer would try to upsell him a second time.
          url: `https://${cfg.domain}/cart/${sh.variantId}:1?return_to=/checkout`,
        });
        if (items.length === 3) break;
      }
      if (!items.length) continue;

      // Awaited, not fired and forgotten: the serverless instance freezes the moment the
      // response is sent, which silently dropped every background write we tried before.
      if (!dry) {
        try {
          await stock.logEvent({ e: 'ty', act: 'call', shop: cfg.domain, size, n: items.length });
        } catch (err) {
          console.log('[ty] event log failed', String((err && err.message) || err));
        }
      }

      return json(res, 200, { render: true, shop: cfg.domain, boughtSize: size, items });
    }

    return json(res, 200, { render: false, reason: 'no pair in that size' });
  } catch (e) {
    console.log('[ty] failed', String((e && e.message) || e));
    return json(res, 200, { render: false, error: 'lookup failed' });
  }
};
