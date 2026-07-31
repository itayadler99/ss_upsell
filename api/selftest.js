const { json } = require('../lib/offer');

// Proves from inside the running function that the Telegram alarm can actually fire.
// A monitor nobody ever tests is not a monitor. Guarded by the app secret so it is not
// a free way for anyone to message the owner.
module.exports = async (req, res) => {
  const secret = process.env.SHOPIFY_API_SECRET;
  if (!secret || req.query.key !== secret) return json(res, 404, {});

  const token = process.env.SS_ALERT_TG;
  const chat = process.env.SS_ALERT_CHAT;
  if (!token || !chat) return json(res, 200, { alert: 'disabled' });

  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chat,
      text: 'בדיקת מערכת: התראות האפסייל של SneakerStudio פעילות.',
    }),
  });
  return json(res, 200, { status: r.status, ok: r.ok });
};
