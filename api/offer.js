const { buildOffer, json } = require('../lib/offer');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return json(res, 200, {});
  if (req.method !== 'POST') return json(res, 405, { render: false });

  try {
    const { token } = req.body || {};
    if (!token) return json(res, 400, { render: false });

    const offer = await buildOffer(token, process.env.SHOPIFY_API_SECRET);
    if (!offer) return json(res, 200, { render: false });
    return json(res, 200, { render: true, offer });
  } catch (e) {
    return json(res, 200, { render: false, error: String(e.message || e) });
  }
};
