const { buildOffer, verify, json, alert, shopOf } = require('../lib/offer');
const stock = require('../lib/stock');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return json(res, 200, {});
  if (req.method !== 'POST') return json(res, 405, { render: false });

  try {
    const { token } = req.body || {};
    if (!token) return json(res, 400, { render: false });

    const payload = verify(token).payload;
    // Stamped whatever the answer is: reaching this line proves the store still runs
    // our extension, which is the thing no API can be asked about.
    try {
      await stock.touchSeen(shopOf(payload));
    } catch (e) {
      console.log(`[offer] heartbeat failed ${e.message}`);
    }

    const offer = await buildOffer(payload);
    const ref =
      (payload.input_data &&
        payload.input_data.initialPurchase &&
        payload.input_data.initialPurchase.referenceId) ||
      null;
    // Recorded before the response so a buyer who is shown nothing is counted too -
    // that row is the difference between "the offer was declined" and "the offer was
    // never on screen", which no order can tell us afterwards.
    try {
      await stock.logEvent({
        e: 'offer',
        shop: shopOf(payload),
        ref,
        render: Boolean(offer),
        kind: offer ? offer.kind : null,
        n: offer && offer.items ? offer.items.length : 0,
      });
    } catch (e) {
      console.log('[offer] event log failed', String(e.message || e));
    }
    if (!offer) {
      console.log('[offer] render=false');
      return json(res, 200, { render: false });
    }

    const shown =
      offer.kind === 'homestock'
        ? `${offer.items[0].title} מידה ${offer.items[0].displaySize}${offer.items[0].halfUp ? ' (חצי מידה מעל)' : ''}` +
          ` · ${offer.items.length} זוגות זמינים · ${offer.onePairPrice} ₪`
        : `${offer.productTitle} מידה ${offer.variantTitle} · ${offer.originalPrice} ₪ ⟵ ${offer.discountedPrice} ₪`;

    console.log(`[offer] render=true ${offer.kind} ${offer.shop} ${shown}`);
    // Awaited before the response on purpose: once the response is sent the serverless
    // instance freezes and any pending request is aborted, which silently killed every
    // alert on 2.8. Costs the buyer a few hundred ms.
    await alert(
      `👀 ${offer.shop} ${offer.kind === 'homestock' ? 'מלאי בית' : 'אפסייל'}: המסך הוצג\n${shown}`
    );
    return json(res, 200, { render: true, offer });
  } catch (e) {
    return json(res, 200, { render: false, error: String(e.message || e) });
  }
};
