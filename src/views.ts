import type { CardConfig } from './connectors/types.js';
import type { ReadingRow } from './db.js';
import { HEAD_TAGS } from './pwa.js';

// Server-rendered dashboard. No framework / build step. User-supplied strings
// (member/system/baseUrl) are HTML-escaped to prevent stored XSS.

function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

/** Capacity color from remaining physical slots. */
function capClass(remaining: number | null): string {
  if (remaining === null) return 'unknown';
  if (remaining <= 2) return 'red';
  if (remaining <= 5) return 'amber';
  return 'green';
}

function ago(iso: string): string {
  const secs = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 90) return 'just now';
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.round(secs / 3600)}h ago`;
  return `${Math.round(secs / 86400)}d ago`;
}

function cardRow(card: CardConfig, r: ReadingRow | undefined): string {
  // Data columns hold the last successful sync even when the latest attempt
  // failed — render them whenever a success exists, and flag the failure.
  const hasData = !!r && r.last_success_at !== null;
  const cls = hasData ? capClass(r.remaining) : 'unknown';
  const cap = hasData ? `${r.physical}/${card.limit}` : '—';
  const remaining = hasData && r.remaining !== null ? String(r.remaining) : '—';
  const digital = hasData ? String(r.digital ?? '—') : '—';
  const holds = hasData ? `${r.holds_library ?? '—'}/${r.holds_digital ?? '—'}` : '—';
  const fines = hasData ? `$${r.fines_due ?? 0}` : '—';
  const updated = r ? esc(ago(r.fetched_at)) : 'never';
  const stale = r && !r.ok && hasData
    ? `<div class="muted">showing data from ${esc(ago(r.last_success_at!))}</div>` : '';
  const note = r && !r.ok ? `<div class="err">⚠ sync failed: ${esc(r.error)}</div>${stale}` : '';
  // data-v carries the machine value for header sorting (display text is formatted).
  const v = (x: number | string | null | undefined): string => (x ?? '') === '' ? '' : esc(String(x));
  return `
    <tr>
      <td data-v="${esc(card.member.toLowerCase())}">${esc(card.member)}</td>
      <td data-v="${esc(card.system.toLowerCase())}">${esc(card.system)}</td>
      <td data-v="${hasData ? v(r.physical) : ''}"><span class="pill ${cls}">${esc(cap)}</span>${note}</td>
      <td class="num" data-v="${hasData ? v(r.remaining) : ''}">${esc(remaining)}</td>
      <td class="num" data-v="${hasData ? v(r.digital) : ''}">${esc(digital)}</td>
      <td class="num" data-v="${hasData && r.holds_library !== null ? v((r.holds_library ?? 0) + (r.holds_digital ?? 0) / 1000) : ''}">${esc(holds)}</td>
      <td class="num" data-v="${hasData ? v(r.fines_due) : ''}">${esc(fines)}</td>
      <td class="muted" data-v="${r ? esc(r.fetched_at) : ''}">${updated}</td>
      <td class="actions">
        <button class="link" onclick="showBarcode('${esc(card.id)}', '${esc(card.member)} · ${esc(card.system)}')">barcode</button>
        <button class="link danger" onclick="removeCard('${esc(card.id)}')">remove</button>
      </td>
    </tr>`;
}

export function renderDashboard(cards: CardConfig[], readings: Map<string, ReadingRow>): string {
  const rows = cards.length
    ? cards.map((c) => cardRow(c, readings.get(c.id))).join('')
    : `<tr><td colspan="9" class="muted">No cards yet — add one below.</td></tr>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Library Card Tracker</title>${HEAD_TAGS}
<style>
  :root { color-scheme: light dark; }
  body { font: 15px/1.5 system-ui, sans-serif; margin: 0; padding: 1.5rem; max-width: 900px; }
  h1 { font-size: 1.4rem; margin: 0 0 .25rem; }
  .sub { color: #888; margin: 0 0 1.25rem; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: .5rem .6rem; border-bottom: 1px solid #8884; }
  th { font-size: .8rem; text-transform: uppercase; letter-spacing: .03em; color: #888; }
  th[data-s] { cursor: pointer; user-select: none; }
  th[data-s]:hover { color: #555; }
  th.asc::after { content: " ▲"; font-size: .7em; }
  th.desc::after { content: " ▼"; font-size: .7em; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  .muted { color: #999; font-size: .85rem; }
  .pill { display: inline-block; padding: .12rem .5rem; border-radius: 999px; font-weight: 600; font-variant-numeric: tabular-nums; }
  .pill.green { background: #1a7f3722; color: #1a7f37; }
  .pill.amber { background: #b4690e22; color: #b4690e; }
  .pill.red   { background: #c0282822; color: #c02828; }
  .pill.unknown { background: #8883; color: #888; }
  .err { color: #c02828; font-size: .8rem; margin-top: .2rem; }
  .bar { display: flex; gap: .5rem; align-items: center; margin: 0 0 1rem; }
  button { font: inherit; cursor: pointer; }
  button.primary { background: #2563eb; color: #fff; border: 0; border-radius: 6px; padding: .45rem .9rem; }
  button.link { background: none; border: 0; color: #2563eb; padding: 0; }
  button.link.danger { color: #c02828; }
  form.add { margin-top: 1.5rem; border-top: 1px solid #8884; padding-top: 1rem; display: grid; gap: .5rem; grid-template-columns: repeat(2, 1fr); }
  form.add h2 { grid-column: 1/-1; font-size: 1rem; margin: 0; }
  form.add input { font: inherit; padding: .4rem .5rem; border: 1px solid #8886; border-radius: 6px; background: transparent; color: inherit; }
  form.add .full { grid-column: 1/-1; }
  #msg { min-height: 1.2em; font-size: .85rem; }
  td.actions { white-space: nowrap; }
  td.actions .link + .link { margin-left: .6rem; }
  /* Barcode modal: always light — scanners need dark bars on white. */
  #bc { position: fixed; inset: 0; background: #000a; display: flex; align-items: center; justify-content: center; padding: 1rem; }
  #bc[hidden] { display: none; }
  #bc .sheet { background: #fff; color: #111; border-radius: 12px; padding: 1.25rem 1.5rem; text-align: center; max-width: 92vw; }
  #bc svg { width: 100%; max-width: 340px; height: 90px; display: block; margin: .5rem auto; }
  #bc .num { font: 600 1.05rem/1.4 ui-monospace, monospace; letter-spacing: .12em; }
  #bc .who { color: #666; font-size: .85rem; margin-bottom: .25rem; }
  #bc .hint { color: #999; font-size: .75rem; margin-top: .5rem; }
</style>
</head>
<body>
  <h1>📚 Library Card Tracker</h1>
  <p class="sub">Physical checkouts vs. limit per card. Digital loans shown for info only.</p>

  <div class="bar">
    <button class="primary" onclick="refresh()">↻ Refresh now</button>
    <span id="msg"></span>
  </div>

  <table>
    <thead>
      <tr>
        <th data-s="t">Member</th><th data-s="t">Library</th><th data-s="n">Physical</th><th data-s="n">Left</th>
        <th data-s="n">Digital</th><th data-s="n">Holds L/D</th><th data-s="n">Fines</th><th data-s="t">Updated</th><th></th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>

  <div id="bc" hidden onclick="hideBarcode()">
    <div class="sheet">
      <div class="who" id="bcWho"></div>
      <div id="bcSvg"></div>
      <div class="num" id="bcNum"></div>
      <div class="hint">tap anywhere to close</div>
    </div>
  </div>

  <form class="add" onsubmit="addCard(event)">
    <h2>Add a card</h2>
    <input name="id" placeholder="id (e.g. alex-ipl)" required />
    <input name="member" placeholder="member (e.g. Alex)" required />
    <input name="system" placeholder="library label (e.g. ipl)" required />
    <input name="limit" placeholder="limit (50)" value="50" inputmode="numeric" />
    <input class="full" name="baseUrl" placeholder="https://host.ent.sirsi.net" required />
    <input name="card" placeholder="card / barcode number" required />
    <input name="pin" type="password" placeholder="PIN" required />
    <div class="full"><button class="primary" type="submit">Add card</button></div>
  </form>

<script>
  const msg = (t, err) => { const m = document.getElementById('msg'); m.textContent = t; m.style.color = err ? '#c02828' : '#888'; };
  async function refresh() {
    msg('Refreshing… (this can take ~30s)');
    try { const r = await fetch('/api/refresh', { method: 'POST' }); if (!r.ok) throw new Error(await r.text()); location.reload(); }
    catch (e) { msg('Refresh failed: ' + e.message, true); }
  }
  async function removeCard(id) {
    if (!confirm('Remove card ' + id + '?')) return;
    try { const r = await fetch('/api/cards/' + encodeURIComponent(id), { method: 'DELETE' }); if (!r.ok) throw new Error(await r.text()); location.reload(); }
    catch (e) { msg('Remove failed: ' + e.message, true); }
  }
  // Codabar (the classic library-card symbology), rendered as SVG. Per-character
  // run-length binaries (1=bar unit, 0=space unit; wide elements pre-expanded),
  // joined by a 1-unit inter-character space, wrapped in A/B start/stop.
  const CODABAR = {
    '0':'101010011','1':'101011001','2':'101001011','3':'110010101','4':'101101001',
    '5':'110101001','6':'100101011','7':'100101101','8':'100110101','9':'110100101',
    '-':'101001101','$':'101100101',':':'1101011011','/':'1101101011','.':'1101101101',
    '+':'1011011011','A':'1011001001','B':'1001001011',
  };
  function codabarSvg(text) {
    const chars = ('A' + text + 'B').split('');
    if (chars.some((c) => !CODABAR[c])) return null;
    const bits = chars.map((c) => CODABAR[c]).join('0');
    const quiet = 10, width = bits.length + 2 * quiet;
    let rects = '', x = quiet;
    for (let i = 0; i < bits.length; ) {
      let run = 1;
      while (bits[i + run] === bits[i]) run++;
      if (bits[i] === '1') rects += '<rect x="' + x + '" y="0" width="' + run + '" height="100"/>';
      x += run; i += run;
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + width + ' 100" preserveAspectRatio="none" fill="#111">' + rects + '</svg>';
  }
  async function showBarcode(id, who) {
    try {
      const r = await fetch('/api/cards/' + encodeURIComponent(id) + '/number');
      if (!r.ok) throw new Error(await r.text());
      const { card } = await r.json();
      const svg = codabarSvg(card);
      document.getElementById('bcWho').textContent = who;
      document.getElementById('bcSvg').innerHTML = svg || '';
      document.getElementById('bcNum').textContent = card;
      document.getElementById('bc').hidden = false;
    } catch (e) { msg('Barcode failed: ' + e.message, true); }
  }
  function hideBarcode() {
    document.getElementById('bc').hidden = true;
    document.getElementById('bcSvg').innerHTML = '';
    document.getElementById('bcNum').textContent = '';
  }
  async function addCard(ev) {
    ev.preventDefault();
    const f = ev.target; const body = Object.fromEntries(new FormData(f).entries());
    body.limit = Number(body.limit || 50);
    try { const r = await fetch('/api/cards', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); if (!r.ok) throw new Error(await r.text()); location.reload(); }
    catch (e) { msg('Add failed: ' + e.message, true); }
  }
  // Column sorting: click a header to sort, click again to flip. Cells carry the
  // machine value in data-v; missing values sort last either way. The choice is
  // remembered per browser and reapplied after each reload/refresh.
  function applySort(i, dir) {
    const tbody = document.querySelector('tbody');
    const rows = Array.from(tbody.rows).filter((r) => r.cells.length > 1);
    if (!rows.length) return;
    const ths = document.querySelectorAll('th');
    ths.forEach((t) => t.classList.remove('asc', 'desc'));
    ths[i].classList.add(dir > 0 ? 'asc' : 'desc');
    const num = ths[i].dataset.s === 'n';
    rows.sort((a, b) => {
      const av = a.cells[i].dataset.v, bv = b.cells[i].dataset.v;
      if (av === '' || bv === '') return (av === '') - (bv === '');
      const c = num ? Number(av) - Number(bv) : (av < bv ? -1 : av > bv ? 1 : 0);
      return dir * c;
    });
    rows.forEach((r) => tbody.appendChild(r));
  }
  document.querySelectorAll('th[data-s]').forEach((th) => {
    th.addEventListener('click', () => {
      const dir = th.classList.contains('asc') ? -1 : 1;
      localStorage.setItem('libcard-sort', th.cellIndex + ':' + dir);
      applySort(th.cellIndex, dir);
    });
  });
  const savedSort = localStorage.getItem('libcard-sort');
  if (savedSort) {
    const [i, d] = savedSort.split(':').map(Number);
    const th = document.querySelectorAll('th')[i];
    if (th && th.dataset.s && (d === 1 || d === -1)) applySort(i, d);
  }
</script>
</body>
</html>`;
}
