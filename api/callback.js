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

// Studio and Station each have their own app, so the redirect can be signed with
// either secret. The one that validates is the one the token exchange must use.
function credFor(query) {
  const pairs = [
    { key: process.env.SHOPIFY_API_KEY, secret: process.env.SHOPIFY_API_SECRET },
    { key: process.env.SHOPIFY_API_KEY_STATION, secret: process.env.SHOPIFY_API_SECRET_STATION },
  ].filter((c) => c.key && c.secret);
  return pairs.find((c) => validHmac(query, c.secret)) || null;
}

module.exports = async (req, res) => {
  const q = req.query || {};
  const cred = credFor(q);

  if (!cred) {
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
      client_id: cred.key,
      client_secret: cred.secret,
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
