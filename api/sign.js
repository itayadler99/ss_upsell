const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { buildOffer, verify, json, alert, DISCOUNT_PCT } = require('../lib/offer');
const stock = require('../lib/stock');

const HOME_DISCOUNT_TITLE = stock.HOME_DISCOUNT_TITLE;

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return json(res, 200, {});
  if (req.method !== 'POST') return json(res, 405, {});

  try {
    const { token, referenceId, variantId, stockIds } = req.body || {};

    // The token is issued and signed by Shopify for this specific checkout.
    // Verifying it is what stops anyone from minting a discount for themselves.
    const { payload, cred } = verify(token);
    const offer = await buildOffer(payload);
    if (!offer) return json(res, 403, { error: 'not eligible' });
    if (offer.referenceId !== referenceId) {
      return json(res, 401, { error: 'reference mismatch' });
    }

    let changes;
    let summary;

    if (offer.kind === 'homestock') {
      const wanted = Array.isArray(stockIds) ? stockIds.map(String) : [];
      if (wanted.length < 1 || wanted.length > 2) return json(res, 403, { error: 'bad selection' });
      if (wanted.length === 2 && !offer.allowTwo) return json(res, 403, { error: 'two not offered' });
      if (new Set(wanted).size !== wanted.length) return json(res, 403, { error: 'duplicate pair' });

      // Only pairs this buyer was actually shown, so nobody can name a different
      // shoe and get it at the home price.
      const picked = wanted.map((id) => offer.items.find((it) => it.id === id));
      if (picked.some((p) => !p)) return json(res, 403, { error: 'pair not offered' });

      const pairs = picked.length;
      changes = picked.map((p) => ({
        type: 'add_variant',
        variantId: Number(p.variantId),
        quantity: 1,
        discount: {
          value: stock.discountFor(p.listPrice, pairs),
          valueType: 'fixed_amount',
          title: HOME_DISCOUNT_TITLE,
        },
      }));
      const total = pairs === 2 ? offer.twoPairPrice : offer.onePairPrice;
      summary =
        `🎉 ${offer.shop} מלאי בית: לקוח הוסיף להזמנה\n` +
        picked.map((p) => `${p.title} מידה ${p.variantTitle}`).join('\n') +
        `\nסה"כ ${total} ₪`;
    } else {
      // The client picks a size, but only from the variants we actually offered.
      const allowed = offer.variants.some((v) => String(v.id) === String(variantId));
      if (!allowed) return json(res, 403, { error: 'variant not offered' });

      changes = [
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
      const picked = offer.variants.find((v) => String(v.id) === String(variantId));
      summary =
        `🎉 ${offer.shop} אפסייל: לקוח לחץ הוסיפו להזמנה\n` +
        `${offer.productTitle} מידה ${picked.title}\n` +
        `${picked.price} ₪ ⟵ ${Math.round(picked.price * (100 - DISCOUNT_PCT)) / 100} ₪`;
    }

    const signed = jwt.sign(
      {
        iss: cred.key,
        jti: crypto.randomUUID(),
        iat: Math.floor(Date.now() / 1000),
        sub: referenceId,
        changes,
      },
      cred.secret
    );

    console.log(`[sign] accepted ${offer.kind} ${offer.shop}`);
    // Awaited before the response for the same reason as in api/offer.js.
    await alert(summary);
    return json(res, 200, { token: signed });
  } catch (e) {
    return json(res, 401, { error: String(e.message || e) });
  }
};
