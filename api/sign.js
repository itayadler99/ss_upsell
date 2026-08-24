const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { buildOffer, verify, json, alert, DISCOUNT_PCT } = require('../lib/offer');
const stock = require('../lib/stock');

const HOME_DISCOUNT_TITLE = stock.HOME_DISCOUNT_TITLE;

// Every outcome of the accept button, success or refusal, so a buyer who pressed it
// and got an error is not indistinguishable from a buyer who never pressed it.
async function logSign(fields) {
  try {
    await stock.logEvent({ e: 'sign', ...fields });
  } catch (e) {
    console.log('[sign] event log failed', String(e.message || e));
  }
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return json(res, 200, {});
  if (req.method !== 'POST') return json(res, 405, {});

  const ref = (req.body || {}).referenceId || null;
  try {
    const { token, referenceId, variantId, stockIds } = req.body || {};

    // The token is issued and signed by Shopify for this specific checkout.
    // Verifying it is what stops anyone from minting a discount for themselves.
    const { payload, cred } = verify(token);
    const offer = await buildOffer(payload);
    if (!offer) {
      await logSign({ ref, ok: false, err: 'not eligible' });
      return json(res, 403, { error: 'not eligible' });
    }
    if (offer.referenceId !== referenceId) {
      await logSign({ ref, shop: offer.shop, ok: false, err: 'reference mismatch' });
      return json(res, 401, { error: 'reference mismatch' });
    }

    let changes;
    let summary;

    if (offer.kind === 'homestock') {
      const wanted = Array.isArray(stockIds) ? stockIds.map(String) : [];
      if (wanted.length < 1 || wanted.length > 2) {
        await logSign({ ref, shop: offer.shop, ok: false, err: 'bad selection' });
        return json(res, 403, { error: 'bad selection' });
      }
      if (wanted.length === 2 && !offer.allowTwo) {
        await logSign({ ref, shop: offer.shop, ok: false, err: 'two not offered' });
        return json(res, 403, { error: 'two not offered' });
      }
      if (new Set(wanted).size !== wanted.length) {
        await logSign({ ref, shop: offer.shop, ok: false, err: 'duplicate pair' });
        return json(res, 403, { error: 'duplicate pair' });
      }

      // Only pairs this buyer was actually shown, so nobody can name a different
      // shoe and get it at the home price.
      const picked = wanted.map((id) => offer.items.find((it) => it.id === id));
      if (picked.some((p) => !p)) {
        await logSign({ ref, shop: offer.shop, ok: false, err: 'pair not offered' });
        return json(res, 403, { error: 'pair not offered' });
      }

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
        // The size on the box, not the rounded one the buyer saw, because this is the
        // message Itay ships from.
        picked.map((p) => `${p.title} מידה ${p.boxSize || p.variantTitle}`).join('\n') +
        `\nסה"כ ${total} ₪`;
    } else {
      // The client picks a size, but only from the variants we actually offered.
      const allowed = offer.variants.some((v) => String(v.id) === String(variantId));
      if (!allowed) {
        await logSign({ ref, shop: offer.shop, ok: false, err: 'variant not offered' });
        return json(res, 403, { error: 'variant not offered' });
      }

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
    await logSign({ ref, shop: offer.shop, ok: true, kind: offer.kind });
    // Awaited before the response for the same reason as in api/offer.js.
    await alert(summary);
    return json(res, 200, { token: signed });
  } catch (e) {
    await logSign({ ref, ok: false, err: String(e.message || e).slice(0, 120) });
    return json(res, 401, { error: String(e.message || e) });
  }
};
