const crypto = require('crypto');

// Shopify signs every OAuth redirect with the app secret. Rejecting a bad hmac
// is what stops a stranger from driving this endpoint with a shop they control.
function validHmac(query, secret) {
  const { hmac, signature, ...rest } = query;
  const message = Object.keys(rest)
    .sort()
    .map((k) => `${k}=${Array.isArray(rest[k]) ? rest[k].join(',') : rest[k]}`)
    .join('&');
  const digest = crypto.createHmac('sha256', secret).update(message).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(String(hmac || '')));
  } catch (e) {
    return false;
  }
}

module.exports = async (req, res) => {
  const q = req.query || {};
  const secret = process.env.SHOPIFY_API_SECRET;

  if (!validHmac(q, secret)) {
    res.status(401).send('bad hmac');
    return;
  }
  if (!/^[a-zA-Z0-9-]+\.myshopify\.com$/.test(q.shop || '')) {
    res.status(400).send('bad shop');
    return;
  }

  const r = await fetch(`https://${q.shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.SHOPIFY_API_KEY,
      client_secret: secret,
      code: q.code,
    }),
  });
  if (!r.ok) {
    res.status(502).send('token exchange failed');
    return;
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.status(200).send(
    '<!doctype html><html lang="he" dir="rtl"><meta charset="utf-8">' +
      '<body style="font-family:system-ui;text-align:center;padding:60px">' +
      '<h2>האפליקציה הותקנה</h2>' +
      '<p>אפשר לסגור את החלון הזה.</p></body></html>'
  );
};
