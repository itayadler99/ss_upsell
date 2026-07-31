const { buildOffer, json, alert } = require('../lib/offer');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return json(res, 200, {});
  if (req.method !== 'POST') return json(res, 405, { render: false });

  try {
    const { token } = req.body || {};
    if (!token) return json(res, 400, { render: false });

    const offer = await buildOffer(token, process.env.SHOPIFY_API_SECRET);
    if (!offer) return json(res, 200, { render: false });
    json(res, 200, { render: true, offer });
    // After the response, so the buyer never waits on Telegram.
    await alert(
      `👀 SneakerStudio אפסייל: המסך הוצג ללקוח\n` +
        `${offer.productTitle} מידה ${offer.variantTitle}\n` +
        `${offer.originalPrice} ₪ ⟵ ${offer.discountedPrice} ₪\n` +
        `הזמנה ${offer.referenceId}`
    );
    return;
  } catch (e) {
    return json(res, 200, { render: false, error: String(e.message || e) });
  }
};
