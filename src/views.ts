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
  const cls = r && r.ok ? capClass(r.remaining) : 'unknown';
  const cap = r && r.ok ? `${r.physical}/${card.limit}` : '—';
  const remaining = r && r.ok && r.remaining !== null ? String(r.remaining) : '—';
  const digital = r && r.ok ? String(r.digital ?? '—') : '—';
  const holds = r && r.ok ? `${r.holds_library ?? '—'}/${r.holds_digital ?? '—'}` : '—';
  const fines = r && r.ok ? `$${r.fines_due ?? 0}` : '—';
  const updated = r ? esc(ago(r.fetched_at)) : 'never';
  const note = r && !r.ok ? `<div class="err">⚠ ${esc(r.error)}</div>` : '';
  return `
    <tr>
      <td>${esc(card.member)}</td>
      <td>${esc(card.system)}</td>
      <td><span class="pill ${cls}">${esc(cap)}</span>${note}</td>
      <td class="num">${esc(remaining)}</td>
      <td class="num">${esc(digital)}</td>
      <td class="num">${esc(holds)}</td>
      <td class="num">${esc(fines)}</td>
      <td class="muted">${updated}</td>
      <td><button class="link danger" onclick="removeCard('${esc(card.id)}')">remove</button></td>
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
        <th>Member</th><th>Library</th><th>Physical</th><th>Left</th>
        <th>Digital</th><th>Holds L/D</th><th>Fines</th><th>Updated</th><th></th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>

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
  async function addCard(ev) {
    ev.preventDefault();
    const f = ev.target; const body = Object.fromEntries(new FormData(f).entries());
    body.limit = Number(body.limit || 50);
    try { const r = await fetch('/api/cards', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); if (!r.ok) throw new Error(await r.text()); location.reload(); }
    catch (e) { msg('Add failed: ' + e.message, true); }
  }
</script>
</body>
</html>`;
}
