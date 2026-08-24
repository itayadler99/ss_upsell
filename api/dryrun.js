const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { buildOffer, json } = require('../lib/offer');
const stock = require('../lib/stock');

// Runs the whole server side of the offer against a made-up purchase, from inside the
// deployed function where the app secrets actually live.
//
// Until now the only way to learn what a buyer is shown was for a buyer to buy: the JWT
// is signed by Shopify, so nothing outside this function can build a payload that
// verify() accepts, and Vercel keeps no runtime logs to read afterwards. That left the
// most basic question - does a size-44 shopper get a pair, and does the accept button
// produce a valid changeset - unanswerable except by waiting. This answers it in a
// request. It only reads: no discount is created, no pair is marked sold, no alert is
// sent, and the heartbeat is not stamped, so it cannot be mistaken for a real render.
module.exports = async (req, res) => {
  const key = process.env.HOMESTOCK_WEBHOOK_KEY;
  if (!key || req.query.key !== key) return json(res, 404, {});

  const shop = String(req.query.shop || 'sneakerstation1.com');
  const size = String(req.query.size || '44');
  const price = Number(req.query.price || 469);

  const payload = {
    input_data: {
      shop: { domain: shop },
      initialPurchase: {
        referenceId: `dryrun-${crypto.randomUUID()}`,
        lineItems: [
          {
            quantity: 1,
            totalPriceSet: { presentmentMoney: { amount: String(price) } },
            product: { id: 1, variant: { title: size } },
          },
        ],
      },
    },
  };

  try {
    const offer = await buildOffer(payload);
    if (!offer) return json(res, 200, { shop, size, render: false });

    // The accept path, short of handing the changeset to Shopify: if this signs, the
    // button works and any failure is on Shopify's side of the fence, not ours.
    let accept = null;
    if (offer.kind === 'homestock') {
      const picked = offer.items.slice(0, 1);
      const changes = picked.map((p) => ({
        type: 'add_variant',
        variantId: Number(p.variantId),
        quantity: 1,
        discount: {
          value: stock.discountFor(p.listPrice, 1),
          valueType: 'fixed_amount',
          title: stock.HOME_DISCOUNT_TITLE,
        },
      }));
      const secret = process.env.SHOPIFY_API_SECRET || process.env.SHOPIFY_API_SECRET_STATION;
      const signed = secret
        ? jwt.sign({ iss: 'dryrun', jti: crypto.randomUUID(), sub: offer.referenceId, changes }, secret)
        : null;
      accept = { changes, signable: Boolean(signed) };
    }

    return json(res, 200, {
      shop,
      size,
      render: true,
      kind: offer.kind,
      price: offer.onePairPrice,
      twoPairPrice: offer.twoPairPrice,
      allowTwo: offer.allowTwo,
      items: (offer.items || []).map((i) => ({
        title: i.title,
        shown: i.displaySize,
        box: i.boxSize,
        variantId: i.variantId,
        listPrice: i.listPrice,
        halfUp: i.halfUp,
        image: Boolean(i.image),
      })),
      accept,
    });
  } catch (e) {
    return json(res, 500, { error: String(e.message || e) });
  }
};
