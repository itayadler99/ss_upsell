const stock = require('../lib/stock');
const { alert } = require('../lib/offer');
const { resolve, adminGql } = require('../lib/shops');

// Shopify signs webhooks with the secret of the app that registered them, and these
// are registered by each store's own custom app - not by this one. So instead of
// trusting the payload we only take the order id from it, guard the endpoint with a
// shared key in the URL, and then read the order back from the Admin API ourselves.
const ORDER_QUERY = `
query($id: ID!) {
  order(id: $id) {
    id
    name
    createdAt
    phone
    email
    customer { firstName lastName phone }
    shippingAddress { name address1 address2 city zip phone }
    lineItems(first: 20) {
      nodes { title quantity variant { id title } }
    }
  }
}`;

function line(v) {
  return v === null || v === undefined || v === '' ? null : String(v);
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');

  // Shopify retries anything that is not a 2xx, so the handler answers 200 on
  // problems it cannot fix and logs loudly instead of building a retry storm.
  const key = (req.query && req.query.key) || '';
  if (!key || key !== process.env.HOMESTOCK_WEBHOOK_KEY) {
    return res.status(401).send(JSON.stringify({ error: 'bad key' }));
  }

  try {
    const shopHeader = req.headers['x-shopify-shop-domain'] || (req.query && req.query.shop);
    const cfg = resolve(shopHeader);
    if (!cfg) {
      console.log('[webhook] unknown shop', shopHeader);
      return res.status(200).send(JSON.stringify({ ok: false, reason: 'unknown shop' }));
    }

    const body = req.body || {};
    const orderId = String(body.admin_graphql_api_id || body.id || '').replace(/\D/g, '');
    if (!orderId) {
      console.log('[webhook] no order id');
      return res.status(200).send(JSON.stringify({ ok: false, reason: 'no id' }));
    }

    const data = await adminGql(cfg.domain, ORDER_QUERY, {
      id: `gid://shopify/Order/${orderId}`,
    });
    const order = data.order;
    if (!order) {
      console.log('[webhook] order not found', cfg.domain, orderId);
      return res.status(200).send(JSON.stringify({ ok: false, reason: 'not found' }));
    }

    const hits = [];
    for (const li of order.lineItems.nodes) {
      if (!li.variant) continue;
      const item = stock.byVariantId(cfg.domain, li.variant.id);
      if (item) hits.push({ item, li });
    }
    if (!hits.length) {
      return res.status(200).send(JSON.stringify({ ok: true, homestock: 0 }));
    }

    // Append-only, so orders/create and orders/updated firing for the same order
    // cannot alert twice - only ids that were not already on the list come back.
    const { added } = await stock.markSold(
      hits.map((h) => ({
        id: h.item.id,
        title: h.item.title,
        size: h.item.size,
        shop: cfg.domain,
        order: order.name,
        soldAt: new Date().toISOString(),
      }))
    );
    if (!added.length) {
      return res.status(200).send(JSON.stringify({ ok: true, homestock: hits.length, added: 0 }));
    }

    const a = order.shippingAddress || {};
    const cust = order.customer || {};
    const who = line(a.name) || `${cust.firstName || ''} ${cust.lastName || ''}`.trim() || '-';
    const phone = line(a.phone) || line(cust.phone) || line(order.phone) || '-';
    const where = [a.address1, a.address2, a.city, a.zip].filter(Boolean).join(', ') || '-';

    await alert(
      `📦 למשלוח ידני מהבית - ${cfg.name}\n` +
        added.map((x) => `• ${x.title} מידה ${x.size}`).join('\n') +
        `\n\nהזמנה ${order.name}\n${who}\n${where}\n${phone}\n${order.email || ''}` +
        `\n\nרשימת מה שנשאר לשלוח: https://ss-upsell.vercel.app/api/pending?key=${key}`
    );

    console.log(`[webhook] ${cfg.domain} ${order.name} sold ${added.map((x) => x.id).join(',')}`);
    return res.status(200).send(JSON.stringify({ ok: true, added: added.length }));
  } catch (e) {
    // A silent failure here means Itay never learns he has a pair to post.
    console.log('[webhook] FAILED', String(e.message || e));
    await alert(`🚨 מלאי בית: הוובהוק נכשל - ${String(e.message || e)}`);
    return res.status(200).send(JSON.stringify({ ok: false, error: String(e.message || e) }));
  }
};
