// Answers one question in Itay's own WhatsApp chat: did the post-purchase screen ever
// render for a real buyer?
//
// The heartbeat metafield was cleared on 17.8 so that only a real checkout can stamp it.
// A store that took orders since then and still has no stamp is a store where Shopify
// never showed our page - most likely because every order is paid through PayPlus, which
// sends the buyer off site and so is not eligible for a post-purchase page at all.
//
// Runs once from launchd. Itay asked for WhatsApp rather than Telegram for this one.
const stock = require('../lib/stock');
const { SHOPS, resolve } = require('../lib/shops');

const ME = '972542383620';
const WINDOW_MS = 24 * 3600 * 1000;

async function ordersSince(cfg, sinceIso) {
  const r = await fetch(
    `https://${cfg.admin}/admin/api/2025-07/orders.json?status=any&limit=250` +
      `&created_at_min=${encodeURIComponent(sinceIso)}&fields=id,cancelled_at`,
    { headers: { 'X-Shopify-Access-Token': process.env[cfg.tokenEnv] } }
  );
  if (!r.ok) throw new Error(`${cfg.admin} ${r.status}`);
  return ((await r.json()).orders || []).filter((o) => !o.cancelled_at).length;
}

async function sendWhatsApp(text) {
  const r = await fetch('http://localhost:8080/api/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipient: ME, message: text }),
  });
  const body = await r.text();
  if (!r.ok) throw new Error(`bridge ${r.status} ${body}`);
  return body;
}

(async () => {
  const seen = await stock.seenMap();
  const since = new Date(Date.now() - WINDOW_MS).toISOString();
  const lines = [];
  let rendered = 0;
  let dark = 0;

  for (const domain of Object.keys(SHOPS)) {
    const cfg = resolve(domain);
    const stamp = Date.parse(seen[domain] || 0) || 0;
    const fresh = Date.now() - stamp < WINDOW_MS;
    const orders = await ordersSince(cfg, since);
    if (fresh) {
      rendered++;
      lines.push(`${cfg.name}: המסך הוצג ✅`);
    } else if (orders > 0) {
      dark++;
      lines.push(`${cfg.name}: ${orders} הזמנות ביממה, אפס הצגות ❌`);
    } else {
      lines.push(`${cfg.name}: לא היו הזמנות ביממה, אין מה למדוד`);
    }
  }

  let head;
  if (rendered && !dark) head = 'האפסייל עובד. המסך הוצג ללקוח אמיתי.';
  else if (rendered && dark) head = 'האפסייל עובד בחנות אחת בלבד.';
  else if (dark) head = 'האפסייל לא עובד. המסך לא הוצג לאף לקוח.';
  else head = 'אין עדיין תשובה - לא נכנסו הזמנות ביממה האחרונה.';

  const tail = dark
    ? '\n\nהסיבה הכי סבירה: כל התשלומים עוברים בפייפלוס, ושופיפיי לא מציגה מסך אחרי תשלום כשהלקוח עובר לאתר חיצוני. אם זה המצב, שום אפליקציית אפסייל לא תעזור - צריך לשנות סליקה.'
    : '';

  const text = `בדיקת האפסייל של מלאי הבית\n\n${head}\n\n${lines.join('\n')}${tail}`;
  console.log(text);
  console.log('bridge:', await sendWhatsApp(text));
})().catch((e) => {
  // A verdict that fails quietly is the same as no verdict, so leave a file behind.
  const fs = require('fs');
  fs.writeFileSync(
    `${process.env.HOME}/ss_upsell_verdict_FAILED.txt`,
    `${new Date().toISOString()} ${String(e.stack || e)}\n`
  );
  console.error('FAILED', e);
  process.exit(1);
});
