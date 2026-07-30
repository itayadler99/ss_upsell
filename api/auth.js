const crypto = require('crypto');

const SCOPES = 'read_products,read_orders';

module.exports = async (req, res) => {
  const shop = (req.query && req.query.shop) || '';
  if (!/^[a-zA-Z0-9-]+\.myshopify\.com$/.test(shop)) {
    res.status(400).send('missing or invalid shop');
    return;
  }
  const state = crypto.randomBytes(16).toString('hex');
  const redirectUri = `https://${req.headers.host}/api/callback`;
  const url =
    `https://${shop}/admin/oauth/authorize` +
    `?client_id=${process.env.SHOPIFY_API_KEY}` +
    `&scope=${encodeURIComponent(SCOPES)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${state}`;
  res.setHeader('Set-Cookie', `ss_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);
  res.writeHead(302, { Location: url });
  res.end();
};
