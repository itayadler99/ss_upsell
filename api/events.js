const { json } = require('../lib/offer');
const stock = require('../lib/stock');

// The answer to "is anybody even seeing this screen".
//
// Reads the per-render log and reduces it to the three numbers that decide whether the
// upsell is broken or simply unpersuasive: how many times the extension called us, how
// many of those calls returned a pair, and how many buyers pressed accept. Guarded by
// the webhook key, same as the other owner-facing pages.
module.exports = async (req, res) => {
  const key = process.env.HOMESTOCK_WEBHOOK_KEY;
  if (!key || req.query.key !== key) return json(res, 404, {});

  let events;
  try {
    events = await stock.readEvents();
  } catch (e) {
    return json(res, 500, { error: String(e.message || e) });
  }

  const byShop = {};
  for (const ev of events) {
    const shop = ev.shop || 'unknown';
    const b = (byShop[shop] = byShop[shop] || {
      calls: 0,
      rendered: 0,
      blank: 0,
      signOk: 0,
      signFail: 0,
      paint: 0,
      cartView: 0,
      cartAdd: 0,
    });
    if (ev.e === 'offer') {
      b.calls++;
      ev.render ? b.rendered++ : b.blank++;
    } else if (ev.e === 'sign') {
      ev.ok ? b.signOk++ : b.signFail++;
    } else if (ev.e === 'paint') {
      b.paint++;
    } else if (ev.e === 'cart') {
      if (ev.act === 'view') b.cartView++;
      else if (ev.act === 'add') b.cartAdd++;
    }
  }

  return json(res, 200, {
    since: events.length ? events[0].t : null,
    total: events.length,
    byShop,
    recent: events.slice(-40).reverse(),
  });
};
