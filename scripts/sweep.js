// Dry-run the live offer engine against a large slice of the real catalogue,
// so a broken price is caught here instead of on a paying customer's screen.
const jwt = require('jsonwebtoken');
const { buildOffer, verify } = require('../lib/offer');

const SECRET = process.env.SHOPIFY_API_SECRET;
const CONCURRENCY = 2;
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

function token(product, variant, price) {
  return jwt.sign(
    {
      input_data: {
        initialPurchase: {
          referenceId: 'sweep',
          lineItems: [
            {
              product: { id: String(product.id), variant: { id: String(variant.id), title: variant.title } },
              quantity: 1,
              totalPriceSet: { presentmentMoney: { amount: String(price) } },
            },
          ],
          totalPriceSet: { presentmentMoney: { amount: String(price) } },
        },
      },
    },
    SECRET
  );
}

async function main() {
  const sample = Number(process.argv[3] || 0);
  const pages = Number(process.argv[2] || 2);
  const products = [];
  for (let i = 1; i <= pages; i++) {
    for (let a = 0; a < 5; a++) {
      const r = await fetch(`https://sneakerstudio1.com/products.json?limit=250&page=${i}`, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
      const body = await r.text();
      try {
        products.push(...JSON.parse(body).products);
        break;
      } catch (e) {
        await new Promise((s) => setTimeout(s, 1500 * (a + 1)));
      }
    }
    await new Promise((s) => setTimeout(s, 1200));
  }
  if (sample && products.length > sample) {
    for (let i = products.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [products[i], products[j]] = [products[j], products[i]];
    }
    products.length = sample;
  }
  console.log('products loaded:', products.length);

  const rows = [];
  let idx = 0;
  async function worker() {
    while (idx < products.length) {
      const p = products[idx++];
      const v = (p.variants || []).find((x) => x.available) || (p.variants || [])[0];
      if (!v) continue;
      const price = Number(v.price);
      if (price < 200 || price >= 700) continue;
      try {
        await new Promise((r) => setTimeout(r, 700));
        const o = await buildOffer(verify(token(p, v, price.toFixed(2))).payload);
        rows.push({ bought: p.title, boughtPrice: price, size: v.title, o });
      } catch (e) {
        rows.push({ bought: p.title, boughtPrice: price, size: v.title, err: String(e.message || e) });
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const shown = rows.filter((r) => r.o);
  const skipped = rows.filter((r) => !r.o && !r.err);
  const errs = rows.filter((r) => r.err);
  console.log(`tested ${rows.length} | offer shown ${shown.length} | no offer ${skipped.length} | errors ${errs.length}`);

  const bad = [];
  for (const r of shown) {
    const o = r.o;
    const expect = Math.round(o.originalPrice * 0.65 * 100) / 100;
    if (Math.abs(expect - o.discountedPrice) > 0.01) bad.push(['math', r]);
    if (o.discountedPrice < 130 || o.discountedPrice > 900) bad.push(['price range', r]);
    if (o.originalPrice > r.boughtPrice * 1.6) bad.push(['upsell too expensive', r]);
    if (!o.image || !o.image.startsWith('https://')) bad.push(['image', r]);
    if (!o.variants.length) bad.push(['no variants', r]);
  }
  const sizeHit = shown.filter((r) => r.o.matchedSize).length;
  console.log('same size offered:', sizeHit, '/', shown.length);
  const prices = shown.map((r) => r.o.discountedPrice).sort((a, b) => a - b);
  console.log('deal price min/median/max:', prices[0], prices[Math.floor(prices.length / 2)], prices[prices.length - 1]);
  console.log('DEFECTS:', bad.length);
  for (const [why, r] of bad.slice(0, 25)) {
    console.log(` ${why}: bought ${r.bought} ${r.boughtPrice} -> ${r.o.productTitle} ${r.o.originalPrice} => ${r.o.discountedPrice}`);
  }
  for (const e of errs.slice(0, 5)) console.log(' ERR', e.bought, e.err);
}
main();
