const jwt = require('jsonwebtoken');

const SHOP = 'sneakerstudio1.com';
// Only single-pair orders get the offer. A single pair is 459-518 ILS
// (shoe + optional socks 39 + shipping insurance 20). The 2-pair bundle is 799.
const MAX_CART_VALUE = 700;
const DISCOUNT_PCT = 35;
// Line items below this price are add-ons (socks, keychain, shipping insurance),
// not shoes. Used so an order of 1 pair + socks still counts as a single pair.
const MIN_SHOE_PRICE = 200;
// A shoe priced outside 200-900 ILS means the catalogue read went wrong (wrong
// units, a bundle, a data-entry slip). Show nothing rather than a wrong price.
const MAX_SHOE_PRICE = 900;

async function recommend(productId) {
  const url = `https://${SHOP}/recommendations/products.json?product_id=${productId}&limit=10&intent=related`;
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

// Returns the offer this buyer is entitled to, or null. Both /api/offer and
// /api/sign call this, so the variant the customer accepts is always one we
// actually offered - the client cannot smuggle in a different product.
async function buildOffer(token, secret) {
  const payload = jwt.verify(token, secret);
  const purchase = payload.input_data.initialPurchase;

  const total = Number(purchase.totalPriceSet.presentmentMoney.amount);
  if (total >= MAX_CART_VALUE) return null;

  const shoes = purchase.lineItems.filter(
    (li) => Number(li.totalPriceSet.presentmentMoney.amount) / (li.quantity || 1) >= MIN_SHOE_PRICE
  );
  if (shoes.length !== 1 || shoes[0].quantity !== 1) return null;

  const size = boughtSize(shoes[0]);
  const boughtId = String(shoes[0].product.id).replace(/\D/g, '');
  const owned = new Set(purchase.lineItems.map((li) => String(li.product.id).replace(/\D/g, '')));

  const recs = await recommend(boughtId);
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

function json(res, status, body) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.status(status).send(JSON.stringify(body));
}

module.exports = { buildOffer, json, DISCOUNT_PCT };
