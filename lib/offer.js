const jwt = require('jsonwebtoken');
const stock = require('./stock');

const SHOPS = {
  'j001wn-ec.myshopify.com': { domain: 'sneakerstation1.com', name: 'SneakerStation' },
  'sneakerstation1.com': { domain: 'sneakerstation1.com', name: 'SneakerStation' },
  'pavzxa-eh.myshopify.com': { domain: 'sneakerstudio1.com', name: 'SNEAKERSTUDIO' },
  'sneakerstudio1.com': { domain: 'sneakerstudio1.com', name: 'SNEAKERSTUDIO' },
};
const DEFAULT_SHOP = 'sneakerstudio1.com';

const DISCOUNT_PCT = 35;
// Line items below this price are add-ons (socks, keychain, shipping insurance),
// not shoes. Used so an order of 1 pair + socks still counts as a single pair.
const MIN_SHOE_PRICE = 200;
// A shoe priced outside 200-900 ILS means the catalogue read went wrong (wrong
// units, a bundle, a data-entry slip). Show nothing rather than a wrong price.
const MAX_SHOE_PRICE = 900;

async function recommend(shopDomain, productId) {
  const url = `https://${shopDomain}/recommendations/products.json?product_id=${productId}&limit=10&intent=related`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(url, {
      headers: {
        Accept: 'application/json',
        // Without a browser UA the storefront bot-blocks us with a 503.
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
      },
    });
    if (!r.ok) return null;
    const body = await r.text();
    try {
      return JSON.parse(body).products || [];
    } catch (e) {
      // Storefront answers 200 with "local_rate_limited" under burst load.
      await new Promise((s) => setTimeout(s, 800 * (attempt + 1)));
    }
  }
  return null;
}

// This endpoint returns prices in agorot (45900 = 459 ILS), unlike products.json.
function toIls(cents) {
  return Math.round(Number(cents)) / 100;
}

function img(src) {
  if (!src) return null;
  return src.startsWith('//') ? `https:${src}` : src;
}

function boughtSize(lineItem) {
  const v = (lineItem.product && lineItem.product.variant) || lineItem.variant || {};
  return String(v.title || '').trim();
}

function shopOf(payload) {
  const raw =
    (payload.input_data && payload.input_data.shop && payload.input_data.shop.domain) ||
    payload.dest ||
    '';
  const key = String(raw).replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  return (SHOPS[key] || SHOPS[DEFAULT_SHOP]).domain;
}

// The pairs at Itay's home. Matched on size alone, priced flat, and shipped by
// hand - so this offer takes priority over the catalogue upsell whenever the
// buyer's size happens to be one he is holding.
async function homeStockOffer(shopDomain, purchase, size) {
  let sold;
  try {
    sold = await stock.soldIds();
  } catch (e) {
    // Cannot prove a pair is still available -> do not offer it.
    console.log('[homestock] state read failed', String(e.message || e));
    return null;
  }

  const cands = stock.candidatesForSize(shopDomain, size, sold);
  if (!cands.length) return null;

  // The buyer sees the size he asked for, not the site's notation. On an exact match
  // that is his own number; on a half-up pair it is the plain half size. Never thirds.
  //
  // displaySize is also what goes out as variantTitle, because the extension already
  // running in both stores renders that field and the Shopify CLI session needed to
  // ship a new bundle is not something this service should depend on. The real size on
  // the box travels separately as boxSize, which is what api/sign.js tells Itay to post.
  const want = stock.parseSize(size);
  const items = cands.slice(0, 4).map((c) => {
    const sh = c.shops[shopDomain];
    const displaySize = stock.formatSize(c.halfUp ? c.size : want);
    return {
      id: c.id,
      title: c.title,
      handle: c.handle,
      image: img(sh.image),
      variantId: sh.variantId,
      variantTitle: displaySize,
      displaySize,
      boxSize: sh.variantTitle,
      listPrice: sh.listPrice,
      size: c.size,
      halfUp: c.halfUp,
    };
  });

  return {
    kind: 'homestock',
    shop: shopDomain,
    referenceId: purchase.referenceId,
    boughtSize: size,
    items,
    onePairPrice: stock.ONE_PAIR_PRICE,
    twoPairPrice: stock.TWO_PAIR_PRICE,
    allowTwo: items.length >= 2,
  };
}

// One app per store: Studio's app and Station's app have different secrets, so a
// token has to be tried against both. Whichever one verifies is also the one that
// must sign the changeset back, otherwise Shopify rejects it.
function credentials() {
  return [
    { key: process.env.SHOPIFY_API_KEY, secret: process.env.SHOPIFY_API_SECRET },
    { key: process.env.SHOPIFY_API_KEY_STATION, secret: process.env.SHOPIFY_API_SECRET_STATION },
  ].filter((c) => c.key && c.secret);
}

function verify(token) {
  const creds = credentials();
  if (!creds.length) throw new Error('no app credentials configured');
  let last;
  for (const cred of creds) {
    try {
      return { payload: jwt.verify(token, cred.secret), cred };
    } catch (e) {
      last = e;
    }
  }
  throw last;
}

// Returns the offer this buyer is entitled to, or null. Both /api/offer and
// /api/sign call this, so the variant the customer accepts is always one we
// actually offered - the client cannot smuggle in a different product.
async function buildOffer(payload) {
  const purchase = payload.input_data.initialPurchase;
  const shopDomain = shopOf(payload);

  // Every order gets the screen - Itay's decision. Cart size and cart value do not
  // disqualify a buyer: a man who just bought two pairs is the likeliest person to
  // take a third at 299. The only thing still required is a shoe to read a size off.
  const shoes = purchase.lineItems.filter(
    (li) => Number(li.totalPriceSet.presentmentMoney.amount) / (li.quantity || 1) >= MIN_SHOE_PRICE
  );
  if (!shoes.length) return null;

  const size = boughtSize(shoes[0]);
  const boughtId = String(shoes[0].product.id).replace(/\D/g, '');
  const owned = new Set(purchase.lineItems.map((li) => String(li.product.id).replace(/\D/g, '')));

  // A multi-pair order can carry several sizes (a 36 and a 44 in the same cart). Any
  // one of them is a real foot in the household, so all of them are worth checking.
  for (const sz of [...new Set(shoes.map(boughtSize).filter(Boolean))]) {
    const home = await homeStockOffer(shopDomain, purchase, sz);
    if (home) return home;
  }

  const recs = await recommend(shopDomain, boughtId);
  if (!recs || !recs.length) return null;

  for (const p of recs) {
    if (owned.has(String(p.id))) continue;

    const variants = (p.variants || [])
      .filter((v) => v.available && toIls(v.price) >= MIN_SHOE_PRICE && toIls(v.price) <= MAX_SHOE_PRICE)
      .map((v) => ({ id: v.id, title: String(v.title || '').trim(), price: toIls(v.price) }));
    if (!variants.length) continue;

    // Same size the buyer just picked, so the offer is wearable without guessing.
    const match = variants.find((v) => v.title === size);
    const chosen = match || variants[0];

    return {
      kind: 'second',
      shop: shopDomain,
      referenceId: purchase.referenceId,
      variantId: chosen.id,
      variants,
      matchedSize: Boolean(match),
      boughtSize: size,
      productTitle: p.title,
      variantTitle: chosen.title,
      image: img((p.images && p.images[0]) || p.featured_image),
      originalPrice: chosen.price,
      discountedPrice: Math.round(chosen.price * (100 - DISCOUNT_PCT)) / 100,
      discountPct: DISCOUNT_PCT,
    };
  }
  return null;
}

// An order alone cannot tell us whether the offer screen ever rendered - a buyer who
// declined and a buyer who never saw it look identical afterwards. So the server says
// so at the moment it happens. Set SS_ALERT_TG/SS_ALERT_CHAT to switch it on; unset
// them once the feature is proven and it goes silent again.
async function alert(text) {
  const token = process.env.SS_ALERT_TG;
  const chat = process.env.SS_ALERT_CHAT;
  if (!token || !chat) return;
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(3000),
    });
    // A notifier that fails quietly is worse than none, so the outcome is always logged.
    console.log('[alert]', r.status, r.ok ? 'sent' : await r.text());
  } catch (e) {
    console.log('[alert] failed', String(e.message || e));
  }
}

function json(res, status, body) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.status(status).send(JSON.stringify(body));
}

module.exports = { buildOffer, verify, json, alert, shopOf, DISCOUNT_PCT, SHOPS };
