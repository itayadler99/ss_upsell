const { buildOffer, json, alert } = require('../lib/offer');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return json(res, 200, {});
  if (req.method !== 'POST') return json(res, 405, { render: false });

  try {
    const { token } = req.body || {};
    if (!token) return json(res, 400, { render: false });

    const offer = await buildOffer(token, process.env.SHOPIFY_API_SECRET);
    if (!offer) {
      console.log('[offer] render=false');
      return json(res, 200, { render: false });
    }
    console.log(`[offer] render=true ${offer.productTitle} ${offer.variantTitle} ${offer.discountedPrice}`);
    // Awaited before the response on purpose: once the response is sent the serverless
    // instance freezes and any pending request is aborted, which silently killed every
    // alert on 2.8. Costs the buyer a few hundred ms.
    await alert(
      `👀 SneakerStudio אפסייל: המסך הוצג ללקוח\n` +
        `${offer.productTitle} מידה ${offer.variantTitle}\n` +
        `${offer.originalPrice} ₪ ⟵ ${offer.discountedPrice} ₪`
    );
    return json(res, 200, { render: true, offer });
  } catch (e) {
    return json(res, 200, { render: false, error: String(e.message || e) });
  }
};
