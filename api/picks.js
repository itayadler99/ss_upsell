const stock = require('../lib/stock');
const ROWS = require('../lib/picks_data.json');

// Itay's photos of the pairs at home are ambiguous: the catalog holds several
// near-identical colourways per model, so guessing costs a wrong product page.
// This page shows every candidate the search found and lets him pick the right
// one plus the size, and stores the answers where a redeploy cannot lose them.
function esc(s) {
  return String(s === null || s === undefined ? '' : s).replace(/[&<>"]/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
  }[c]));
}

function page(picks, key) {
  const rows = ROWS.map((r) => {
    const saved = picks[r.key] || {};
    const chosen = saved.productId || '';
    const size = saved.size || '';

    const cards = r.options
      .map((o) => {
        const on = chosen === o.id;
        const both = o.studioId ? 'שתי החנויות' : 'סטיישן בלבד';
        return (
          `<label class="opt${on ? ' on' : ''}">` +
          `<input type="radio" name="p_${esc(r.key)}" value="${esc(o.id)}"${on ? ' checked' : ''}>` +
          `<img src="${esc(o.img)}" loading="lazy">` +
          `<span class="ot">${esc(o.title)}</span>` +
          `<span class="om">${esc(o.price)} ₪ · ${both}</span>` +
          `</label>`
        );
      })
      .join('');

    const none = chosen === 'none';
    return (
      `<section class="row">` +
      `<div class="head"><span class="n">${esc(r.key)}</span>` +
      `<input class="size" name="s_${esc(r.key)}" value="${esc(size)}" placeholder="מידה" inputmode="decimal">` +
      (r.note ? `<span class="note">${esc(r.note)}</span>` : '') +
      `</div>` +
      `<div class="body"><a class="zoom" href="${r.mine}" target="_blank">` +
      `<img class="mine" src="${r.mine}"><span>הגדל</span></a>` +
      `<div class="opts">${cards}` +
      `<label class="opt none${none ? ' on' : ''}">` +
      `<input type="radio" name="p_${esc(r.key)}" value="none"${none ? ' checked' : ''}>` +
      `<span class="ot">אף אחד מאלה</span>` +
      `<span class="om">אכתוב לך את הדגם</span></label>` +
      `</div></div></section>`
    );
  }).join('');

  return (
    `<!doctype html><html lang="he" dir="rtl"><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>מלאי בית - בחירת דגמים</title><style>` +
    `body{font-family:-apple-system,system-ui,sans-serif;margin:0;padding:14px 14px 110px;background:#f4f4f5;color:#111}` +
    `h2{margin:0 0 2px;font-size:20px}p.sub{margin:0 0 16px;color:#666;font-size:14px}` +
    `.row{background:#fff;border-radius:12px;padding:12px;margin-bottom:14px;box-shadow:0 1px 3px rgba(0,0,0,.1)}` +
    `.head{display:flex;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap}` +
    `.n{font-size:22px;font-weight:800;color:#bbb}` +
    `input.size{width:96px;padding:9px;font-size:17px;border:2px solid #111;border-radius:8px;text-align:center}` +
    `.note{background:#fff8e1;border:1px solid #efd489;border-radius:6px;padding:5px 8px;font-size:13px}` +
    `.body{display:flex;gap:10px;align-items:flex-start}` +
    `a.zoom{flex:0 0 auto;position:sticky;top:8px;text-decoration:none;text-align:center;display:block}` +
    `a.zoom span{display:block;font-size:12px;color:#0b6bcb;margin-top:3px}` +
    `img.mine{width:118px;border-radius:10px;display:block}` +
    `.opts{flex:1;display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:6px}` +
    `.opt{border:2px solid #e6e6e6;border-radius:10px;padding:6px;cursor:pointer;display:block;background:#fff}` +
    `.opt.on,.opt:has(input:checked){border-color:#111;background:#eafff0}` +
    `.opt input{margin:0 0 4px}` +
    `.opt img{width:100%;border-radius:6px;background:#fafafa;display:block}` +
    `.ot{display:block;font-size:12px;font-weight:700;margin-top:4px;line-height:1.25}` +
    `.om{display:block;font-size:11px;color:#777}` +
    `.opt.none{display:flex;flex-direction:column;justify-content:center;text-align:center;min-height:96px}` +
    `.bar{position:fixed;inset:auto 0 0 0;background:#111;padding:12px 14px;display:flex;gap:12px;align-items:center}` +
    `.bar button{flex:1;padding:14px;font-size:17px;font-weight:700;border:0;border-radius:10px;background:#37d67a;color:#08320f}` +
    `.bar span{color:#fff;font-size:13px}` +
    `</style>` +
    `<h2>מלאי בית - 18 זוגות חדשים</h2>` +
    `<p class="sub">בכל שורה: התמונה ששלחת, ולידה כל הדגמים הדומים באתר. תסמן את הנכון ותכתוב מידה.</p>` +
    `<form method="post" action="/api/picks?key=${encodeURIComponent(key)}">` +
    rows +
    `<div class="bar"><span>${Object.keys(picks).length}/18 נשמרו</span><button>שמור</button></div>` +
    `</form>`
  );
}

module.exports = async (req, res) => {
  const key = (req.query && req.query.key) || '';
  if (!key || key !== process.env.HOMESTOCK_WEBHOOK_KEY) {
    res.status(401).send('bad key');
    return;
  }

  try {
    if (req.method === 'POST') {
      const body = req.body || {};
      const picks = await stock.readPicks();
      for (const r of ROWS) {
        const pid = body[`p_${r.key}`];
        const size = String(body[`s_${r.key}`] || '').trim();
        if (!pid && !size) continue;
        const opt = r.options.find((o) => o.id === pid);
        picks[r.key] = {
          productId: pid || null,
          title: opt ? opt.title : pid === 'none' ? 'אף אחד מאלה' : null,
          handle: opt ? opt.handle : null,
          studioId: opt ? opt.studioId : null,
          size,
          at: new Date().toISOString(),
        };
      }
      await stock.writePicks(picks);
      res.setHeader('Location', `/api/picks?key=${encodeURIComponent(key)}`);
      res.status(303).send('');
      return;
    }

    const picks = await stock.readPicks();
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).send(page(picks, key));
  } catch (e) {
    res.status(500).send(`error: ${esc(e.message || e)}`);
  }
};
