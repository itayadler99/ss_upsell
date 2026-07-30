const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { buildOffer, json, DISCOUNT_PCT } = require('../lib/offer');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return json(res, 200, {});
  if (req.method !== 'POST') return json(res, 405, {});

  try {
    const { token, referenceId, variantId } = req.body || {};
    const secret = process.env.SHOPIFY_API_SECRET;

    // The token is issued and signed by Shopify for this specific checkout.
    // Verifying it is what stops anyone from minting a discount for themselves.
    const offer = await buildOffer(token, secret);
    if (!offer) return json(res, 403, { error: 'not eligible' });
    if (offer.referenceId !== referenceId) {
      return json(res, 401, { error: 'reference mismatch' });
    }
    // The client picks a size, but only from the variants we actually offered.
    const allowed = offer.variants.some((v) => String(v.id) === String(variantId));
    if (!allowed) return json(res, 403, { error: 'variant not offered' });

    const changes = [
      {
        type: 'add_variant',
        variantId: Number(variantId),
        quantity: 1,
        discount: {
          value: DISCOUNT_PCT,
          valueType: 'percentage',
          title: `הנחת זוג שני ${DISCOUNT_PCT}%`,
        },
      },
    ];

    const signed = jwt.sign(
      {
        iss: process.env.SHOPIFY_API_KEY,
        jti: crypto.randomUUID(),
        iat: Math.floor(Date.now() / 1000),
        sub: referenceId,
        changes,
      },
      secret
    );

    return json(res, 200, { token: signed });
  } catch (e) {
    return json(res, 401, { error: String(e.message || e) });
  }
};
