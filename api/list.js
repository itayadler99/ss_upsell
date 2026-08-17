const stock = require('../lib/stock');
const { SHOPS, adminGql } = require('../lib/shops');
const MINE = require('../lib/mine_photos.json');

// Itay's proofreading page for the home-stock list. Every pair he is selling is one
// physical shoe in his flat, so a wrong size or a wrong product page turns into a
// refund. This puts his own photo next to the exact variant the offer will add to the
// cart, and asks both stores live whether that variant is still buyable - the point is
// that nothing here is copied from stock.json alone.
function esc(s) {
  return String(s === null || s === undefined ? '' : s).replace(/[&<>"]/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
  }[c]));
}

// One admin call per store for all 31 variants, rather than 62 calls.
async function liveVariants(domain, ids) {
  const d = await adminGql(
    domain,
    `query($ids:[ID!]!){ nodes(ids:$ids){ ... on ProductVariant {
       id title price availableForSale inventoryQuantity
       product { id title handle status featuredImage { url } } } } }`,
    { ids: ids.map((v) => `gid://shopify/ProductVariant/${v}`) }
  );
  const out = {};
  for (const n of d.nodes || []) {
    if (!n) continue;
    out[n.id.split('/').pop()] = n;
  }
  return out;
}

function thumb(url) {
  if (!url) return '';
  return url + (url.includes('?') ? '&' : '?') + 'width=240';
}

function shopCell(label, sh, live, pair) {
  if (!sh || !sh.variantId) {
    return `<div class="sc bad"><b>${esc(label)}</b> - לא קיים בחנות הזו</div>`;
  }
  const v = live[String(sh.variantId)];
  const problems = [];
  if (!v) problems.push('הווריאנט לא נמצא');
  else {
    if (!v.availableForSale) problems.push('לא זמין למכירה');
    if (v.title !== sh.variantTitle) problems.push(`מידה בחנות ${esc(v.title)}`);
    if (Number(v.price) !== Number(sh.listPrice)) problems.push(`מחיר בחנות ${esc(v.price)}`);
    if (v.product.status !== 'ACTIVE') problems.push(`מוצר ${esc(v.product.status)}`);
    if (v.product.title !== pair.title) problems.push(`שם בחנות: ${esc(v.product.title)}`);
  }
  const ok = problems.length === 0;
  return (
    `<div class="sc ${ok ? 'ok' : 'bad'}"><b>${esc(label)}</b> ` +
    `<span class="mono">${esc(sh.variantTitle)}</span> · ${esc(sh.listPrice)} ₪ ` +
    (ok ? `<span class="v">זמין ✓</span>` : `<span class="x">${problems.map(esc).join(' · ')}</span>`) +
    `<div class="lnk"><a href="https://${esc(label === 'סטיישן' ? 'sneakerstation1.com' : 'sneakerstudio1.com')}/products/${esc(
      (v && v.product.handle) || pair.handle
    )}" target="_blank">לפתוח את הדף בחנות</a></div></div>`
  );
}

function page(rows, sold, counts) {
  const one = stock.ONE_PAIR_PRICE;
  const two = stock.TWO_PAIR_PRICE;
  return (
    `<!doctype html><html lang="he" dir="rtl"><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>מלאי בית - ${rows.length} זוגות</title><style>` +
    `body{font-family:-apple-system,system-ui,sans-serif;margin:0;padding:14px;background:#f4f4f5;color:#111}` +
    `h2{margin:0 0 4px;font-size:21px}p.sub{margin:0 0 8px;color:#555;font-size:14px;line-height:1.5}` +
    `.sum{background:#111;color:#fff;border-radius:10px;padding:10px 12px;font-size:14px;margin-bottom:14px}` +
    `.sum b{font-size:17px}` +
    `.row{background:#fff;border-radius:12px;padding:10px;margin-bottom:12px;box-shadow:0 1px 3px rgba(0,0,0,.1);display:flex;gap:10px}` +
    `.row.alert{border:2px solid #c62828}` +
    `.row.sold{opacity:.55}` +
    `.pics{flex:0 0 auto;display:flex;gap:6px}` +
    `.pics figure{margin:0;width:104px}` +
    `.pics img{width:104px;border-radius:8px;display:block;background:#fafafa}` +
    `.pics figcaption{font-size:11px;color:#888;text-align:center;margin-top:3px}` +
    `.info{flex:1;min-width:0}` +
    `.t{font-weight:700;font-size:15px;line-height:1.3}` +
    `.sz{display:inline-block;margin:6px 0;background:#111;color:#fff;border-radius:6px;padding:4px 10px;font-size:17px;font-weight:800}` +
    `.sc{font-size:13px;border-radius:7px;padding:6px 8px;margin-top:5px}` +
    `.sc.ok{background:#f1fbf4;border:1px solid #bfe7cd}` +
    `.sc.bad{background:#fff2f2;border:1px solid #f0b4b4}` +
    `.v{color:#1b7f3a;font-weight:700}.x{color:#c62828;font-weight:700}` +
    `.mono{font-variant-numeric:tabular-nums;font-weight:700}` +
    `.lnk{margin-top:3px}.lnk a{font-size:12px;color:#0b6bcb}` +
    `.badge{float:left;font-size:11px;color:#888}` +
    `.soldtag{background:#c62828;color:#fff;border-radius:6px;padding:3px 7px;font-size:12px;font-weight:700}` +
    `</style>` +
    `<h2>מלאי בית - ${rows.length} זוגות</h2>` +
    `<p class="sub">מימין התמונה ששלחת בוואטסאפ, לידה התמונה מהאתר - זה מה שהקונה יראה. ` +
    `המידה היא הדבר היחיד שקובע למי הזוג מוצע, ולכן בדוק אותה מול התמונה שלך.</p>` +
    `<div class="sum">מחיר: זוג <b>${one} ₪</b> · שני זוגות <b>${two} ₪</b><br>` +
    `${counts.ok} מ-${rows.length} מוזנים נכון ובזמינים בשתי החנויות` +
    (counts.alert ? ` · <span style="color:#ff8a80">${counts.alert} דורשים בדיקה</span>` : '') +
    (sold.length ? ` · ${sold.length} כבר נמכרו` : '') +
    `</div>` +
    rows.join('') +
    `<p class="sub">נבדק מול שתי החנויות עכשיו, ${new Date().toLocaleString('he-IL', {
      timeZone: 'Asia/Jerusalem',
    })}</p>`
  );
}

module.exports = async (req, res) => {
  const key = (req.query && req.query.key) || '';
  if (!key || key !== process.env.HOMESTOCK_WEBHOOK_KEY) {
    res.status(401).send('bad key');
    return;
  }

  try {
    const sold = await stock.soldIds();
    const soldSet = new Set(sold);
    const live = {};
    await Promise.all(
      Object.keys(SHOPS).map(async (domain) => {
        const ids = stock.STOCK.map((s) => s.shops[domain] && s.shops[domain].variantId).filter(
          Boolean
        );
        live[domain] = await liveVariants(domain, ids);
      })
    );

    const counts = { ok: 0, alert: 0 };
    const rows = stock.STOCK.map((p) => {
      const station = shopCell('סטיישן', p.shops['sneakerstation1.com'], live['sneakerstation1.com'], p);
      const studio = shopCell('סטודיו', p.shops['sneakerstudio1.com'], live['sneakerstudio1.com'], p);
      const bad = station.includes('sc bad') || studio.includes('sc bad');
      if (bad) counts.alert += 1;
      else counts.ok += 1;
      const mine = MINE[p.id];
      const site =
        (p.shops['sneakerstation1.com'] || p.shops['sneakerstudio1.com'] || {}).image || '';
      const isSold = soldSet.has(p.id);
      return (
        `<section class="row${bad ? ' alert' : ''}${isSold ? ' sold' : ''}">` +
        `<div class="pics">` +
        `<figure><img src="${esc(mine ? mine.mine : '')}"><figcaption>התמונה שלך${
          mine ? ' · ' + esc(mine.row) : ''
        }</figcaption></figure>` +
        `<figure><img src="${esc(thumb(site))}"><figcaption>באתר</figcaption></figure>` +
        `</div><div class="info">` +
        (isSold ? `<span class="soldtag">נמכר</span> ` : '') +
        `<div class="t">${esc(p.title)}</div>` +
        `<span class="sz">מידה ${esc(p.size)}</span>` +
        station +
        studio +
        `</div></section>`
      );
    });

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).send(page(rows, sold, counts));
  } catch (e) {
    res.status(500).send(`error: ${esc(e.message || e)}`);
  }
};
