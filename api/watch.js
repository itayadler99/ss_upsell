const { json, alert, DISCOUNT_PCT } = require('../lib/offer');

// Money-side audit of the upsell, run by Vercel Cron once a day.
//
// The live alerts in api/offer.js and api/sign.js say what happened on the screen. This
// says what happened in the till: it reads finished orders and checks that every second
// pair really was charged at 65% of list. It ran on a laptop first and went silent the
// moment the machine slept, which is the exact failure a monitor exists to prevent.
//
// Deliberately stateless and deliberately quiet: it only speaks when a price is wrong,
// so a repeat message on an overlapping window is a repeat of a real problem.
const SHOP = 'pavzxa-eh.myshopify.com';
const DISCOUNT_TITLE = 'הנחת זוג שני';
const WINDOW_HOURS = 25;

function upsellLines(order) {
  const out = [];
  for (const li of order.line_items || []) {
    for (const d of li.discount_allocations || []) {
      const title = (d.discount_application || {}).title || '';
      if (title.includes(DISCOUNT_TITLE)) out.push([li, Number(d.amount || 0)]);
    }
  }
  return out;
}

module.exports = async (req, res) => {
  // Vercel Cron sends this header. Without the check the endpoint would publish the
  // store's daily order count to anyone who guessed the path.
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.authorization !== `Bearer ${cronSecret}`) {
    return json(res, 404, {});
  }

  const token = process.env.SHOP_ADMIN_TOKEN;
  if (!token) return json(res, 500, { error: 'no admin token' });

  const since = new Date(Date.now() - WINDOW_HOURS * 3600 * 1000).toISOString();
  const url =
    `https://${SHOP}/admin/api/2025-07/orders.json?status=any&limit=100` +
    `&created_at_min=${encodeURIComponent(since)}` +
    `&fields=id,name,created_at,total_price,line_items,cancelled_at`;
  const r = await fetch(url, { headers: { 'X-Shopify-Access-Token': token } });
  if (!r.ok) {
    await alert(`🔴 בדיקת האפסייל נכשלה: שופיפיי החזיר ${r.status}. לבדוק את הטוקן.`);
    return json(res, 502, { error: r.status });
  }
  const { orders } = await r.json();

  let accepted = 0;
  const bad = [];
  for (const o of orders) {
    if (o.cancelled_at) continue;
    for (const [li, discount] of upsellLines(o)) {
      accepted++;
      const listed = Number(li.price) * Number(li.quantity);
      const paid = listed - discount;
      const expect = Math.round((listed * (100 - DISCOUNT_PCT)) / 100 * 100) / 100;
      if (Math.abs(paid - expect) > 1) {
        bad.push(
          `${o.name}: ${li.title} מידה ${li.variant_title || '?'} - ` +
            `שולם ${paid.toFixed(2)} ₪ במקום ${expect.toFixed(2)} ₪`
        );
      }
    }
  }

  if (bad.length) {
    await alert(`🔴 אפסייל במחיר לא צפוי:\n${bad.join('\n')}\nלבדוק מיד.`);
  }
  return json(res, 200, { orders: orders.length, accepted, mismatches: bad.length });
};
