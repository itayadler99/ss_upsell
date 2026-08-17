const { json } = require('../lib/offer');
const { SHOPS, adminGql } = require('../lib/shops');

// Proves from inside the running function that the two things that fail silently
// really work: the Telegram alarm, and each store's admin token. A monitor nobody
// ever tests is not a monitor. Guarded by the webhook key so it is not a free way
// to message the owner.
module.exports = async (req, res) => {
  const key = process.env.HOMESTOCK_WEBHOOK_KEY;
  if (!key || req.query.key !== key) return json(res, 404, {});

  const admin = {};
  for (const domain of Object.keys(SHOPS)) {
    try {
      const d = await adminGql(domain, '{ shop { name myshopifyDomain } }');
      admin[domain] = d.shop.myshopifyDomain;
    } catch (e) {
      admin[domain] = `FAIL ${String(e.message || e).slice(0, 120)}`;
    }
  }

  const token = process.env.SS_ALERT_TG;
  const chat = process.env.SS_ALERT_CHAT;
  if (!token || !chat) return json(res, 200, { admin, alert: 'disabled' });

  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chat,
      text: 'בדיקת מערכת: התראות מלאי הבית פעילות.',
    }),
  });
  return json(res, 200, { admin, alert: r.status });
};
