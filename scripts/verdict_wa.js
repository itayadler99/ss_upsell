// Answers one question in Itay's own WhatsApp chat: of the buyers who paid yesterday,
// how many were actually shown a pair from home?
//
// The first version of this script could only say yes/no - the heartbeat metafield is
// throttled to one stamp every six hours, so one render and forty renders read the same.
// That is a measure of our own output, not of the customer. Since 24.8 every call the
// extension makes appends a row to homestock/events, so the verdict is now a ratio:
// orders taken, screens rendered, offers shown, offers accepted. A screen count far
// below the order count is Shopify skipping the post-purchase page; a full screen count
// with no accepts is a buyer saying no, which is a different problem with a different fix.
//
// Runs once a day from launchd. Itay asked for WhatsApp rather than Telegram for this one.
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

// The bridge is a local process; on a machine that just woke up it can be seconds behind
// this script. A verdict lost to a connection refused is a verdict Itay never reads, and
// this job already failed silently that way on 24.8.
async function sendWhatsApp(text) {
  let last;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const r = await fetch('http://localhost:8080/api/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipient: ME, message: text }),
      });
      const body = await r.text();
      if (r.ok) return body;
      last = new Error(`bridge ${r.status} ${body}`);
    } catch (e) {
      last = e;
    }
    await new Promise((s) => setTimeout(s, 15000 * (attempt + 1)));
  }
  throw last;
}

(async () => {
  const cutoff = Date.now() - WINDOW_MS;
  const since = new Date(cutoff).toISOString();
  const events = (await stock.readEvents()).filter((e) => Date.parse(e.t) >= cutoff);
  const seen = await stock.seenMap();

  const lines = [];
  let totalOrders = 0;
  let totalShown = 0;
  let totalAccepted = 0;

  for (const domain of Object.keys(SHOPS)) {
    const cfg = resolve(domain);
    const mine = events.filter((e) => e.shop === domain);
    const calls = mine.filter((e) => e.e === 'offer');
    const shown = calls.filter((e) => e.render).length;
    const accepted = mine.filter((e) => e.e === 'sign' && e.ok).length;
    const failed = mine.filter((e) => e.e === 'sign' && !e.ok).length;
    const orders = await ordersSince(cfg, since);

    totalOrders += orders;
    totalShown += shown;
    totalAccepted += accepted;

    if (!orders) {
      lines.push(`${cfg.name}: לא היו הזמנות ביממה`);
      continue;
    }
    let line = `${cfg.name}: ${orders} הזמנות, ${shown} ראו זוג`;
    if (calls.length > shown) line += ` (${calls.length - shown} מסכים בלי זוג מתאים)`;
    if (accepted) line += `, ${accepted} הוסיפו לעגלה 🎉`;
    if (failed) line += `, ${failed} ניסו והמערכת סירבה ❌`;
    lines.push(line);
  }

  // The old metafield still matters as a floor: an events log can be empty because the
  // screen never ran, or because the log write failed. A fresh heartbeat separates them.
  const anyHeartbeat = Object.keys(SHOPS).some(
    (d) => Date.now() - (Date.parse(seen[d] || 0) || 0) < WINDOW_MS
  );

  let head;
  if (totalAccepted) head = `האפסייל מכר. ${totalAccepted} זוגות נוספו להזמנות.`;
  else if (!totalOrders) head = 'אין מה למדוד - לא נכנסו הזמנות ביממה.';
  else if (totalShown) head = `המסך הוצג ל-${totalShown} מתוך ${totalOrders} קונים. אף אחד לא הוסיף.`;
  else if (anyHeartbeat) head = 'המסך רץ אבל לא הציג זוג לאף קונה.';
  else head = `אף קונה לא ראה את המסך. ${totalOrders} הזמנות, אפס הצגות.`;

  const text = `בדיקת האפסייל של מלאי הבית\n\n${head}\n\n${lines.join('\n')}`;
  console.log(text);
  console.log('bridge:', await sendWhatsApp(text));
})().catch((e) => {
  // A verdict that fails quietly is the same as no verdict, so leave a file behind.
  const fs = require('fs');
  fs.appendFileSync(
    `${process.env.HOME}/ss_upsell_verdict_FAILED.txt`,
    `${new Date().toISOString()} ${String(e.stack || e)}\n`
  );
  console.error('FAILED', e);
  process.exit(1);
});
