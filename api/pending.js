const stock = require('../lib/stock');

// A Telegram message can be missed or swiped away. This page is the list that
// stays: every pair sold out of the flat, and whether it has been posted yet.
function esc(s) {
  return String(s === null || s === undefined ? '' : s).replace(/[&<>"]/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
  }[c]));
}

function when(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')} ${String(
    d.getHours()
  ).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

module.exports = async (req, res) => {
  const key = (req.query && req.query.key) || '';
  if (!key || key !== process.env.HOMESTOCK_WEBHOOK_KEY) {
    res.status(401).send('bad key');
    return;
  }

  try {
    if (req.method === 'POST') {
      const id = (req.query && req.query.ship) || (req.body && req.body.ship);
      if (id) await stock.markShipped(String(id));
      res.setHeader('Location', `/api/pending?key=${encodeURIComponent(key)}`);
      res.status(303).send('');
      return;
    }

    const records = await stock.soldRecords();
    const open = records.filter((r) => !r.shippedAt);
    const done = records.filter((r) => r.shippedAt);
    const left = stock.STOCK.length - records.length;

    const row = (r, isOpen) =>
      `<tr><td>${esc(r.title)}</td><td class="c">${esc(r.size)}</td>` +
      `<td>${esc(r.order || '')}</td><td>${esc(r.shop || '')}</td>` +
      `<td class="c">${when(r.soldAt)}</td>` +
      (isOpen
        ? `<td><form method="post" action="/api/pending?key=${encodeURIComponent(key)}&ship=${encodeURIComponent(
            r.id
          )}"><button>נשלח ✓</button></form></td>`
        : `<td class="c">${when(r.shippedAt)}</td>`) +
      `</tr>`;

    const html =
      `<!doctype html><html lang="he" dir="rtl"><meta charset="utf-8">` +
      `<meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<title>מלאי בית - למשלוח</title><style>` +
      `body{font-family:-apple-system,system-ui,sans-serif;margin:0;padding:18px;background:#f6f6f7;color:#111}` +
      `h2{margin:0 0 4px}p.sub{margin:0 0 18px;color:#666;font-size:14px}` +
      `table{width:100%;border-collapse:collapse;background:#fff;border-radius:10px;overflow:hidden;margin-bottom:26px}` +
      `th,td{padding:10px 8px;font-size:14px;text-align:right;border-bottom:1px solid #eee}` +
      `th{background:#111;color:#fff;font-weight:600}td.c{text-align:center}` +
      `button{padding:7px 12px;border:0;border-radius:7px;background:#111;color:#fff;font-size:13px}` +
      `.empty{padding:16px;background:#fff;border-radius:10px;color:#666;font-size:14px;margin-bottom:26px}` +
      `</style><body>` +
      `<h2>נעליים מהבית</h2>` +
      `<p class="sub">${open.length} ממתינות למשלוח · ${done.length} נשלחו · ${left} עוד לא נמכרו</p>` +
      (open.length
        ? `<table><tr><th>דגם</th><th>מידה</th><th>הזמנה</th><th>חנות</th><th>נמכר</th><th></th></tr>` +
          open.map((r) => row(r, true)).join('') +
          `</table>`
        : `<div class="empty">אין מה לשלוח כרגע.</div>`) +
      (done.length
        ? `<table><tr><th>נשלח</th><th>מידה</th><th>הזמנה</th><th>חנות</th><th>נמכר</th><th>נשלח ב</th></tr>` +
          done.map((r) => row(r, false)).join('') +
          `</table>`
        : '') +
      `</body></html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(html);
  } catch (e) {
    res.status(500).send(`error: ${esc(e.message || e)}`);
  }
};
