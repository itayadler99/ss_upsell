const crypto = require('crypto');

const SCOPES = 'read_products,read_orders';

module.exports = async (req, res) => {
  const shop = (req.query && req.query.shop) || '';
  if (!/^[a-zA-Z0-9-]+\.myshopify\.com$/.test(shop)) {
    res.status(400).send('missing or invalid shop');
    return;
  }
  // Station has its own app: the Studio app belongs to another organisation and
  // its grant screen refuses to load for a store outside it.
  const STATION = 'j001wn-ec.myshopify.com';
  const clientId =
    shop === STATION && process.env.SHOPIFY_API_KEY_STATION
      ? process.env.SHOPIFY_API_KEY_STATION
      : process.env.SHOPIFY_API_KEY;

  const state = crypto.randomBytes(16).toString('hex');
  const redirectUri = `https://${req.headers.host}/api/callback`;
  const url =
    `https://${shop}/admin/oauth/authorize` +
    `?client_id=${clientId}` +
    `&scope=${encodeURIComponent(SCOPES)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${state}`;
  res.setHeader('Set-Cookie', `ss_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);
  res.writeHead(302, { Location: url });
  res.end();
};
