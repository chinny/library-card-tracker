import type { CardConfig } from './connectors/types.js';
import type { ReadingRow } from './db.js';
import { HEAD_TAGS } from './pwa.js';

// Server-rendered dashboard. No framework / build step. User-supplied strings
// (member/system/baseUrl) are HTML-escaped to prevent stored XSS, and never
// interpolated into inline JS — actions read them back from data-* attributes.

function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

/** Capacity status from remaining physical slots. */
function capClass(remaining: number | null): string {
  if (remaining === null) return 'unknown';
  if (remaining <= 2) return 'bad';
  if (remaining <= 5) return 'warn';
  return 'ok';
}

function ago(iso: string): string {
  const secs = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 90) return 'just now';
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.round(secs / 3600)}h ago`;
  return `${Math.round(secs / 86400)}d ago`;
}

const money = (n: number | null | undefined): string => `$${(n ?? 0).toFixed(2)}`;

// Inline icons (24px grid, stroke-based) so there are no asset requests.
const icon = (paths: string): string =>
  `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const I = {
  refresh: icon('<path d="M21 12a9 9 0 1 1-2.64-6.36L21 8"/><path d="M21 3v5h-5"/>'),
  plus: icon('<path d="M12 5v14M5 12h14"/>'),
  barcode: icon('<path d="M4 5v14M8 5v14M11 5v14M15 5v14M18 5v14M21 5v14"/>'),
  trash: icon('<path d="M3 6h18"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>'),
  close: icon('<path d="M18 6 6 18M6 6l12 12"/>'),
  alert: icon('<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>'),
  books: icon('<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>'),
};

function cardRow(card: CardConfig, r: ReadingRow | undefined): string {
  // Data columns hold the last successful sync even when the latest attempt
  // failed — render them whenever a success exists, and flag the failure.
  const hasData = !!r && r.last_success_at !== null;
  const cls = hasData ? capClass(r.remaining) : 'unknown';
  const pct = hasData && r.physical !== null && card.limit > 0
    ? Math.min(100, Math.round((r.physical / card.limit) * 100)) : 0;
  const physical = hasData && r.physical !== null ? String(r.physical) : '—';
  const remaining = hasData && r.remaining !== null ? String(r.remaining) : '—';
  const digital = hasData ? String(r.digital ?? '—') : '—';
  const holds = hasData ? `${r.holds_library ?? '—'} / ${r.holds_digital ?? '—'}` : '—';
  const fines = hasData ? money(r.fines_due) : '—';
  const finesCls = hasData && (r.fines_due ?? 0) > 0 ? ' due' : '';
  const updated = r ? esc(ago(r.fetched_at)) : 'never';
  const note = r && !r.ok
    ? `<div class="note" title="${esc(r.error)}">${I.alert}<span>Sync failed${hasData ? ` · showing ${esc(ago(r.last_success_at!))}` : ''} — ${esc(r.error)}</span></div>`
    : '';
  // data-v carries the machine value for header sorting (display text is formatted).
  const v = (x: number | string | null | undefined): string => (x ?? '') === '' ? '' : esc(String(x));
  const who = `${esc(card.member)} · ${esc(card.system)}`;
  return `
      <tr class="s-${cls}">
        <td class="c-member" data-v="${esc(card.member.toLowerCase())}">${esc(card.member)}</td>
        <td class="c-system" data-v="${esc(card.system.toLowerCase())}"><span class="chip">${esc(card.system)}</span></td>
        <td class="c-meter" data-v="${hasData ? v(r.physical) : ''}">
          <div class="meter-row">
            <div class="meter" role="meter" aria-label="Physical checkouts" aria-valuemin="0" aria-valuemax="${card.limit}" aria-valuenow="${hasData ? v(r.physical) : 0}"><span style="width:${pct}%"></span></div>
            <span class="meter-val"><b>${physical}</b> / ${card.limit}</span>
          </div>${note}
        </td>
        <td class="c-left num" data-v="${hasData ? v(r.remaining) : ''}"><span class="left"><b>${esc(remaining)}</b><small>left</small></span></td>
        <td class="c-dig num" data-label="Digital" data-v="${hasData ? v(r.digital) : ''}">${esc(digital)}</td>
        <td class="c-holds num" data-label="Holds L/D" data-v="${hasData && r.holds_library !== null ? v((r.holds_library ?? 0) + (r.holds_digital ?? 0) / 1000) : ''}">${esc(holds)}</td>
        <td class="c-fines num${finesCls}" data-label="Fines" data-v="${hasData ? v(r.fines_due) : ''}">${esc(fines)}</td>
        <td class="c-upd muted" data-v="${r ? esc(r.fetched_at) : ''}">${updated}</td>
        <td class="c-act">
          <button class="btn ghost sm" data-act="barcode" data-id="${esc(card.id)}" data-who="${who}" title="Show barcode" aria-label="Show barcode for ${who}">${I.barcode}<span>Barcode</span></button>
          <button class="btn ghost sm danger" data-act="remove" data-id="${esc(card.id)}" data-who="${who}" title="Remove card" aria-label="Remove ${who}">${I.trash}<span class="sr">Remove</span></button>
        </td>
      </tr>`;
}

interface Summary {
  best: { who: string; left: number } | null;
  free: number | null;
  physical: number | null;
  digital: number;
  holds: number;
  fines: number;
  withData: number;
  lastUpdated: string | null;
}

function summarize(cards: CardConfig[], readings: Map<string, ReadingRow>): Summary {
  const s: Summary = { best: null, free: null, physical: null, digital: 0, holds: 0, fines: 0, withData: 0, lastUpdated: null };
  for (const c of cards) {
    const r = readings.get(c.id);
    if (!r) continue;
    if (!s.lastUpdated || r.fetched_at > s.lastUpdated) s.lastUpdated = r.fetched_at;
    if (r.last_success_at === null) continue;
    s.withData++;
    if (r.remaining !== null) {
      s.free = (s.free ?? 0) + r.remaining;
      if (!s.best || r.remaining > s.best.left) s.best = { who: `${c.member} · ${c.system}`, left: r.remaining };
    }
    if (r.physical !== null) s.physical = (s.physical ?? 0) + r.physical;
    s.digital += r.digital ?? 0;
    s.holds += (r.holds_library ?? 0) + (r.holds_digital ?? 0);
    s.fines += r.fines_due ?? 0;
  }
  return s;
}

function stats(s: Summary, cardCount: number): string {
  const dash = '—';
  const n = s.withData || cardCount;
  return `
  <section class="stats" aria-label="Summary">
    <div class="stat feature">
      <div class="stat-label">Most room</div>
      <div class="stat-value">${s.best ? `${s.best.left}<small> left</small>` : dash}</div>
      <div class="stat-sub">${s.best ? esc(s.best.who) : 'no data yet'}</div>
    </div>
    <div class="stat">
      <div class="stat-label">Free slots</div>
      <div class="stat-value">${s.free ?? dash}</div>
      <div class="stat-sub">across ${n} card${n === 1 ? '' : 's'}</div>
    </div>
    <div class="stat">
      <div class="stat-label">Checked out</div>
      <div class="stat-value">${s.physical ?? dash}</div>
      <div class="stat-sub">+ ${s.digital} digital</div>
    </div>
    <div class="stat">
      <div class="stat-label">Holds</div>
      <div class="stat-value">${s.withData ? s.holds : dash}</div>
      <div class="stat-sub${s.fines > 0 ? ' due' : ''}">${money(s.fines)} in fines</div>
    </div>
  </section>`;
}

export function renderDashboard(
  cards: CardConfig[],
  readings: Map<string, ReadingRow>,
  opts: { autoRefresh?: boolean } = {},
): string {
  const sum = summarize(cards, readings);
  const sub = cards.length
    ? `${cards.length} card${cards.length === 1 ? '' : 's'} · updated ${sum.lastUpdated ? esc(ago(sum.lastUpdated)) : 'never'}`
    : 'No cards yet';

  const list = cards.length
    ? `${stats(sum, cards.length)}
  <section class="list">
    <div class="list-head">
      <h2>Cards</h2>
      <label class="sort-m">
        <span class="sr">Sort by</span>
        <select id="sortSel" aria-label="Sort cards">
          <option value="" hidden>Custom sort</option>
          <option value="3:-1">Most room</option>
          <option value="0:1">Member</option>
          <option value="1:1">Library</option>
          <option value="7:-1">Recently updated</option>
        </select>
      </label>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th data-s="t" scope="col">Member</th><th data-s="t" scope="col">Library</th>
            <th data-s="n" scope="col">Physical</th><th data-s="n" scope="col" class="num">Left</th>
            <th data-s="n" scope="col" class="num">Digital</th><th data-s="n" scope="col" class="num">Holds L/D</th>
            <th data-s="n" scope="col" class="num">Fines</th><th data-s="t" scope="col">Updated</th>
            <th scope="col"><span class="sr">Actions</span></th>
          </tr>
        </thead>
        <tbody>${cards.map((c) => cardRow(c, readings.get(c.id))).join('')}
        </tbody>
      </table>
    </div>
  </section>`
    : `
  <section class="empty">
    <div class="empty-ico">${I.books}</div>
    <h2>No cards yet</h2>
    <p>Add a library card to start tracking how much room it has.</p>
    <button class="btn primary" data-act="add">${I.plus}<span>Add card</span></button>
  </section>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="color-scheme" content="light dark" />
<title>Library Card Tracker</title>${HEAD_TAGS}
<style>
  :root {
    --bg: #f6f7f9; --surface: #ffffff; --surface-2: #f1f3f6; --border: #e3e6eb; --border-strong: #cfd4dc;
    --text: #14161a; --muted: #6b7280; --faint: #9aa1ac;
    --accent: #4f46e5; --accent-hover: #4338ca; --accent-fg: #ffffff; --accent-soft: #eef0ff;
    --ok: #15803d; --ok-soft: #e7f6ec; --warn: #b45309; --warn-soft: #fdf3e2; --bad: #c81e1e; --bad-soft: #fdeaea;
    --track: #e8ebf0; --shadow: 0 1px 2px rgb(16 24 40 / .05), 0 1px 3px rgb(16 24 40 / .06);
    --radius: 14px;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0c0d10; --surface: #15171c; --surface-2: #1b1e24; --border: #262a32; --border-strong: #353a44;
      --text: #eef0f3; --muted: #9ca3af; --faint: #6b7280;
      --accent: #8b8cf8; --accent-hover: #a5a6fb; --accent-fg: #0c0d10; --accent-soft: #23234a;
      --ok: #4ade80; --ok-soft: #12291b; --warn: #fbbf24; --warn-soft: #2d2410; --bad: #f87171; --bad-soft: #321616;
      --track: #262a32; --shadow: 0 1px 2px rgb(0 0 0 / .4);
    }
  }
  *, *::before, *::after { box-sizing: border-box; }
  html { -webkit-text-size-adjust: 100%; }
  body {
    margin: 0; background: var(--bg); color: var(--text);
    font: 15px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .wrap { max-width: 1080px; margin: 0 auto; padding: max(20px, env(safe-area-inset-top)) 16px 48px; }
  .num, .stat-value, .meter-val, .left b { font-variant-numeric: tabular-nums; }
  .muted { color: var(--muted); }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  .ico { width: 18px; height: 18px; flex: none; }

  /* ── Header ── */
  .top { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 20px; }
  .brand { display: flex; align-items: center; gap: 12px; min-width: 0; }
  .brand img { width: 40px; height: 40px; border-radius: 10px; }
  h1 { font-size: 1.3rem; line-height: 1.2; margin: 0; letter-spacing: -.01em; }
  .sub { margin: 2px 0 0; color: var(--muted); font-size: .875rem; }
  .top-actions { display: flex; gap: 8px; }

  /* ── Buttons ── */
  .btn {
    display: inline-flex; align-items: center; justify-content: center; gap: 6px;
    font: inherit; font-weight: 550; font-size: .9rem; line-height: 1; cursor: pointer;
    height: 38px; padding: 0 14px; border-radius: 10px; border: 1px solid transparent;
    transition: background .15s, border-color .15s, color .15s, opacity .15s;
  }
  .btn:focus-visible, select:focus-visible, input:focus-visible, th[data-s]:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .btn.primary { background: var(--accent); color: var(--accent-fg); }
  .btn.primary:hover:not(:disabled) { background: var(--accent-hover); }
  .btn.secondary { background: var(--surface); color: var(--text); border-color: var(--border-strong); box-shadow: var(--shadow); }
  .btn.secondary:hover { background: var(--surface-2); }
  .btn.ghost { background: transparent; color: var(--muted); }
  .btn.ghost:hover { background: var(--surface-2); color: var(--text); }
  .btn.ghost.danger:hover { background: var(--bad-soft); color: var(--bad); }
  .btn.sm { height: 32px; padding: 0 8px; border-radius: 8px; font-size: .85rem; }
  .btn:disabled { opacity: .6; cursor: default; }
  .btn.busy .ico { animation: spin 1s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* ── Refresh progress ── */
  .progress { display: flex; align-items: center; gap: 12px; margin: -6px 0 18px; font-size: .85rem; color: var(--muted); }
  .progress[hidden] { display: none; }
  .progress .bar { flex: 1; max-width: 260px; height: 4px; border-radius: 4px; background: var(--track); overflow: hidden; }
  .progress .bar span { display: block; height: 100%; width: 0; background: var(--accent); border-radius: 4px; transition: width .4s ease; }
  .progress .bar.indet span { width: 35%; animation: indet 1.2s ease-in-out infinite; }
  @keyframes indet { from { transform: translateX(-100%); } to { transform: translateX(300%); } }

  /* ── Stats ── */
  .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 24px; }
  .stat { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 14px 16px; box-shadow: var(--shadow); min-width: 0; }
  .stat.feature { background: var(--accent-soft); border-color: transparent; }
  .stat-label { font-size: .75rem; font-weight: 600; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); }
  .stat.feature .stat-label { color: var(--accent); }
  .stat-value { font-size: 1.75rem; font-weight: 650; line-height: 1.15; margin-top: 6px; letter-spacing: -.02em; }
  .stat-value small { font-size: .9rem; font-weight: 500; color: var(--muted); letter-spacing: 0; }
  .stat-sub { font-size: .8rem; color: var(--muted); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .due { color: var(--warn) !important; }

  /* ── List ── */
  .list-head { display: flex; align-items: center; justify-content: space-between; margin: 0 0 10px; }
  h2 { font-size: 1rem; margin: 0; }
  .sort-m { display: none; }
  select {
    font: inherit; font-size: .85rem; color: var(--text); background: var(--surface);
    border: 1px solid var(--border-strong); border-radius: 8px; height: 32px; padding: 0 8px;
  }
  .table-wrap { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); box-shadow: var(--shadow); overflow: hidden; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: 12px 14px; border-bottom: 1px solid var(--border); vertical-align: middle; }
  tbody tr:last-child td { border-bottom: 0; }
  tbody tr:hover td { background: var(--surface-2); }
  th { font-size: .72rem; font-weight: 600; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); background: var(--surface-2); white-space: nowrap; }
  th.num, td.num { text-align: right; }
  th[data-s] { cursor: pointer; user-select: none; }
  th[data-s]:hover { color: var(--text); }
  th.asc::after { content: "↑"; margin-left: 4px; color: var(--accent); }
  th.desc::after { content: "↓"; margin-left: 4px; color: var(--accent); }
  .c-member { font-weight: 600; }
  .chip { display: inline-block; font-size: .78rem; font-weight: 550; padding: 2px 8px; border-radius: 6px; background: var(--surface-2); border: 1px solid var(--border); color: var(--muted); }
  .c-meter { min-width: 190px; }
  .meter-row { display: flex; align-items: center; gap: 10px; }
  .meter { flex: 1; height: 8px; border-radius: 8px; background: var(--track); overflow: hidden; min-width: 80px; }
  .meter span { display: block; height: 100%; border-radius: 8px; background: var(--c, var(--faint)); }
  .meter-val { font-size: .85rem; color: var(--muted); white-space: nowrap; }
  .meter-val b { color: var(--text); font-weight: 600; }
  .left { display: inline-flex; align-items: baseline; justify-content: center; min-width: 2.5em; padding: 3px 9px; border-radius: 999px; background: var(--cs, var(--surface-2)); color: var(--c, var(--muted)); }
  .left b { font-weight: 650; }
  .left small { display: none; }
  tr.s-ok { --c: var(--ok); --cs: var(--ok-soft); }
  tr.s-warn { --c: var(--warn); --cs: var(--warn-soft); }
  tr.s-bad { --c: var(--bad); --cs: var(--bad-soft); }
  .note { display: flex; gap: 6px; align-items: flex-start; margin-top: 6px; font-size: .78rem; color: var(--bad); max-width: 340px; }
  .note .ico { width: 14px; height: 14px; margin-top: 2px; }
  .note span { overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
  .c-upd { white-space: nowrap; font-size: .85rem; }
  .c-act { white-space: nowrap; text-align: right; }
  .c-act .btn span:not(.sr) { display: none; }
  .foot { color: var(--faint); font-size: .8rem; margin: 16px 2px 0; }

  /* ── Empty state ── */
  .empty { text-align: center; background: var(--surface); border: 1px dashed var(--border-strong); border-radius: var(--radius); padding: 48px 20px; }
  .empty-ico { display: inline-grid; place-items: center; width: 52px; height: 52px; border-radius: 14px; background: var(--accent-soft); color: var(--accent); margin-bottom: 12px; }
  .empty-ico .ico { width: 26px; height: 26px; }
  .empty p { color: var(--muted); margin: 6px 0 18px; }

  /* ── Phones: rows become tiles ── */
  @media (max-width: 719px) {
    .top-actions { width: 100%; }
    .top-actions .btn { flex: 1; }
    .stats { grid-template-columns: 1fr 1fr; gap: 10px; }
    .stat-value { font-size: 1.5rem; }
    .sort-m { display: block; }
    .table-wrap { background: none; border: 0; box-shadow: none; overflow: visible; }
    table, tbody { display: block; }
    thead { display: none; }
    tbody { display: grid; gap: 10px; }
    tbody tr {
      display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); column-gap: 12px;
      grid-template-areas: "member member left" "system system left" "meter meter meter" "dig holds fines" "upd act act";
      background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 14px 16px 10px; box-shadow: var(--shadow);
      border-left: 4px solid var(--c, var(--border-strong));
    }
    tbody tr:hover td { background: none; }
    td { padding: 0; border: 0; text-align: left !important; }
    .c-member { grid-area: member; font-size: 1.05rem; }
    .c-system { grid-area: system; margin-top: 2px; }
    .c-left { grid-area: left; justify-self: end; align-self: start; }
    .left { flex-direction: column; align-items: flex-end; background: none; padding: 0; border-radius: 0; }
    .left b { font-size: 1.75rem; line-height: 1; }
    .left small { display: block; font-size: .72rem; font-weight: 600; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); margin-top: 2px; }
    .c-meter { grid-area: meter; margin: 14px 0 12px; min-width: 0; }
    .note { max-width: none; }
    .c-dig { grid-area: dig; } .c-holds { grid-area: holds; } .c-fines { grid-area: fines; }
    td[data-label] { font-weight: 600; }
    td[data-label]::before { content: attr(data-label); display: block; font-size: .7rem; font-weight: 600; text-transform: uppercase; letter-spacing: .05em; color: var(--muted); }
    .c-upd { grid-area: upd; align-self: center; margin-top: 10px; font-size: .8rem; }
    .c-upd::before { content: "Updated "; }
    .c-act { grid-area: act; justify-self: end; margin-top: 8px; }
    .c-act .btn span:not(.sr) { display: inline; }
  }

  /* ── Dialogs ── */
  dialog { border: 0; padding: 0; color: var(--text); background: var(--surface); border-radius: 18px; box-shadow: 0 20px 50px rgb(0 0 0 / .25); width: min(520px, calc(100vw - 32px)); max-height: calc(100dvh - 32px); }
  dialog::backdrop { background: rgb(10 12 16 / .55); backdrop-filter: blur(3px); }
  dialog[open] { animation: pop .16s ease-out; }
  @keyframes pop { from { opacity: 0; transform: translateY(8px) scale(.98); } }
  .dlg-head { display: flex; align-items: center; justify-content: space-between; padding: 18px 20px 4px; }
  .dlg-head h2 { font-size: 1.1rem; }
  .dlg-body { padding: 12px 20px 20px; }
  .fields { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  .field { display: grid; gap: 5px; min-width: 0; }
  .field.full { grid-column: 1 / -1; }
  .field label { font-size: .8rem; font-weight: 600; }
  .field .hint { font-size: .75rem; color: var(--muted); }
  .field input {
    font: inherit; color: var(--text); background: var(--surface); width: 100%;
    height: 40px; padding: 0 12px; border: 1px solid var(--border-strong); border-radius: 10px;
  }
  .field input:focus { border-color: var(--accent); }
  .form-err { color: var(--bad); font-size: .85rem; min-height: 1.2em; margin: 12px 0 0; }
  .dlg-foot { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
  @media (max-width: 479px) { .fields { grid-template-columns: 1fr; } }

  /* Barcode sheet: always light — scanners need dark bars on white. */
  dialog.bc { background: #fff; color: #111; text-align: center; width: min(440px, calc(100vw - 24px)); cursor: pointer; }
  dialog.bc .dlg-body { padding: 22px 20px 18px; }
  dialog.bc .who { color: #555; font-weight: 600; }
  dialog.bc svg { width: 100%; height: 110px; display: block; margin: 14px auto 10px; }
  dialog.bc .num { font: 600 1.15rem/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .14em; }
  dialog.bc .hint { color: #999; font-size: .75rem; margin-top: 12px; }

  /* ── Toast ── */
  .toast {
    position: fixed; left: 50%; bottom: max(20px, env(safe-area-inset-bottom)); transform: translate(-50%, 20px);
    background: var(--text); color: var(--bg); padding: 10px 16px; border-radius: 10px; font-size: .875rem;
    box-shadow: 0 8px 24px rgb(0 0 0 / .2); opacity: 0; pointer-events: none; transition: opacity .2s, transform .2s;
    max-width: calc(100vw - 32px);
  }
  .toast.show { opacity: 1; transform: translate(-50%, 0); }
  .toast.err { background: var(--bad); color: #fff; }

  @media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; } }
</style>
</head>
<body>
<main class="wrap">
  <header class="top">
    <div class="brand">
      <img src="/icons/icon.svg" alt="" />
      <div>
        <h1>Library Card Tracker</h1>
        <p class="sub">${sub}</p>
      </div>
    </div>
    <div class="top-actions">
      <button class="btn secondary" data-act="add">${I.plus}<span>Add card</span></button>
      <button id="refreshBtn" class="btn primary">${I.refresh}<span>Refresh</span></button>
    </div>
  </header>

  <div id="progress" class="progress" hidden role="status">
    <div class="bar indet"><span></span></div>
    <span id="progressText">Refreshing…</span>
  </div>
${list}
  <p class="foot">Physical checkouts count against each card's limit. Digital loans are shown for info only.</p>
</main>

<dialog id="addDlg" aria-labelledby="addTitle">
  <div class="dlg-head">
    <h2 id="addTitle">Add a card</h2>
    <button class="btn ghost sm" data-act="close" aria-label="Close">${I.close}</button>
  </div>
  <form id="addForm" class="dlg-body" autocomplete="off">
    <div class="fields">
      <div class="field"><label for="f-member">Member</label><input id="f-member" name="member" placeholder="Alex" required /></div>
      <div class="field"><label for="f-system">Library</label><input id="f-system" name="system" placeholder="ipl" required /></div>
      <div class="field full"><label for="f-baseUrl">Catalog URL</label><input id="f-baseUrl" name="baseUrl" type="url" placeholder="https://host.ent.sirsi.net" required /><span class="hint">SirsiDynix Enterprise base URL (https)</span></div>
      <div class="field"><label for="f-card">Card number</label><input id="f-card" name="card" inputmode="numeric" required /></div>
      <div class="field"><label for="f-pin">PIN</label><input id="f-pin" name="pin" type="password" required /></div>
      <div class="field"><label for="f-id">Card ID</label><input id="f-id" name="id" placeholder="alex-ipl" required /><span class="hint">Short unique label, used in metrics</span></div>
      <div class="field"><label for="f-limit">Checkout limit</label><input id="f-limit" name="limit" value="50" inputmode="numeric" /></div>
    </div>
    <p class="form-err" id="addErr" role="alert"></p>
    <div class="dlg-foot">
      <button type="button" class="btn secondary" data-act="close">Cancel</button>
      <button type="submit" class="btn primary" id="addSubmit">Add card</button>
    </div>
  </form>
</dialog>

<dialog id="bcDlg" class="bc" aria-label="Library card barcode">
  <div class="dlg-body">
    <div class="who" id="bcWho"></div>
    <div id="bcSvg"></div>
    <div class="num" id="bcNum"></div>
    <div class="hint">Tap anywhere to close</div>
  </div>
</dialog>

<div id="toast" class="toast" role="status" aria-live="polite"></div>

<script>
  // Server-decided: true when any card's data is older than LIBCARD_STALE_HOURS.
  const AUTO_REFRESH = ${opts.autoRefresh === true};
  const $ = (id) => document.getElementById(id);
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  };
  let toastTimer = null;
  function msg(t, err) {
    const el = $('toast');
    el.textContent = t; el.classList.toggle('err', !!err); el.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), err ? 6000 : 3500);
  }

  // ── Refresh with progress ──
  // The button disables while a run is in flight; /api/refresh/status is polled
  // for per-card progress. Runs we didn't start (scheduler, another tab) are
  // tracked the same way and the page reloads when they finish.
  const refreshBtn = $('refreshBtn');
  let pollTimer = null;
  function setBusy(b) {
    refreshBtn.disabled = b; refreshBtn.classList.toggle('busy', b);
    refreshBtn.querySelector('span').textContent = b ? 'Refreshing…' : 'Refresh';
    $('progress').hidden = !b;
    if (!b) showProgress(null);
  }
  function showProgress(s) {
    const bar = document.querySelector('#progress .bar');
    const known = s && s.total > 0;
    bar.classList.toggle('indet', !known);
    bar.firstElementChild.style.width = known ? Math.round((s.done / s.total) * 100) + '%' : '';
    $('progressText').textContent = known
      ? 'Card ' + Math.min(s.done + 1, s.total) + ' of ' + s.total + (s.current ? ' — ' + s.current : '') + '…'
      : 'Refreshing… this can take ~30s';
  }
  function pollProgress(reloadWhenDone) {
    if (pollTimer) return;
    pollTimer = setInterval(async () => {
      try {
        const r = await fetch('/api/refresh/status');
        if (!r.ok) return;
        const s = await r.json();
        if (s.running) showProgress(s);
        else if (reloadWhenDone) location.reload();
      } catch {} // transient poll errors: keep trying, the POST handles failure
    }, 1500);
  }
  async function refresh() {
    if (refreshBtn.disabled) return;
    setBusy(true);
    pollProgress(false); // POST resolution drives the reload
    try { const r = await fetch('/api/refresh', { method: 'POST' }); if (!r.ok) throw new Error(await r.text()); location.reload(); }
    catch (e) { clearInterval(pollTimer); pollTimer = null; setBusy(false); msg('Refresh failed: ' + e.message, true); }
  }
  refreshBtn.addEventListener('click', refresh);
  // On load: attach to an already-running refresh, else auto-refresh stale data.
  (async () => {
    try {
      const r = await fetch('/api/refresh/status');
      const s = r.ok ? await r.json() : null;
      if (s && s.running) { setBusy(true); showProgress(s); pollProgress(true); return; }
    } catch {}
    if (AUTO_REFRESH) refresh();
  })();

  // ── Actions (event delegation; ids/labels come from data-* attributes) ──
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'add') openAdd();
    else if (act === 'close') b.closest('dialog').close();
    else if (act === 'barcode') showBarcode(b.dataset.id, b.dataset.who);
    else if (act === 'remove') removeCard(b.dataset.id, b.dataset.who);
  });
  async function removeCard(id, who) {
    if (!confirm('Remove ' + who + '?')) return;
    try { const r = await fetch('/api/cards/' + encodeURIComponent(id), { method: 'DELETE' }); if (!r.ok) throw new Error(await r.text()); location.reload(); }
    catch (e) { msg('Remove failed: ' + e.message, true); }
  }

  // ── Add card dialog ──
  const addDlg = $('addDlg'), addForm = $('addForm'), idInput = $('f-id');
  let idTouched = false;
  function openAdd() { addForm.reset(); idTouched = false; $('addErr').textContent = ''; $('addSubmit').disabled = false; addDlg.showModal(); }
  // Suggest the card id from member + library until the user edits it.
  idInput.addEventListener('input', () => { idTouched = true; });
  ['f-member', 'f-system'].forEach((f) => $(f).addEventListener('input', () => {
    if (idTouched) return;
    idInput.value = [$('f-member').value, $('f-system').value].join('-').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }));
  addDlg.addEventListener('click', (e) => { if (e.target === addDlg) addDlg.close(); }); // backdrop
  addForm.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const body = Object.fromEntries(new FormData(addForm).entries());
    body.limit = Number(body.limit || 50);
    const btn = $('addSubmit'); btn.disabled = true; $('addErr').textContent = '';
    try {
      const r = await fetch('/api/cards', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error(await r.text());
      location.reload();
    } catch (e) { $('addErr').textContent = 'Couldn’t add card: ' + e.message; btn.disabled = false; }
  });

  // ── Barcode ──
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
  const bcDlg = $('bcDlg');
  async function showBarcode(id, who) {
    try {
      const r = await fetch('/api/cards/' + encodeURIComponent(id) + '/number');
      if (!r.ok) throw new Error(await r.text());
      const { card } = await r.json();
      $('bcWho').textContent = who;
      $('bcSvg').innerHTML = codabarSvg(card) || '';
      $('bcNum').textContent = card;
      bcDlg.showModal();
    } catch (e) { msg('Barcode failed: ' + e.message, true); }
  }
  bcDlg.addEventListener('click', () => bcDlg.close());
  bcDlg.addEventListener('close', () => { $('bcSvg').innerHTML = ''; $('bcNum').textContent = ''; });

  // ── Sorting ──
  // Click a header (or pick from the phone dropdown) to sort; click again to
  // flip. Cells carry the machine value in data-v; missing values sort last
  // either way. The choice is remembered per browser and reapplied on reload.
  const sortSel = $('sortSel');
  function applySort(i, dir) {
    const tbody = document.querySelector('tbody');
    if (!tbody) return;
    const rows = Array.from(tbody.rows);
    const ths = document.querySelectorAll('th');
    ths.forEach((t) => { t.classList.remove('asc', 'desc'); t.removeAttribute('aria-sort'); });
    ths[i].classList.add(dir > 0 ? 'asc' : 'desc');
    ths[i].setAttribute('aria-sort', dir > 0 ? 'ascending' : 'descending');
    if (sortSel) sortSel.value = sortSel.querySelector('option[value="' + i + ':' + dir + '"]') ? i + ':' + dir : '';
    const num = ths[i].dataset.s === 'n';
    rows.sort((a, b) => {
      const av = a.cells[i].dataset.v, bv = b.cells[i].dataset.v;
      if (av === '' || bv === '') return (av === '') - (bv === '');
      const c = num ? Number(av) - Number(bv) : (av < bv ? -1 : av > bv ? 1 : 0);
      return dir * c;
    });
    rows.forEach((r) => tbody.appendChild(r));
  }
  function sortBy(i, dir) { store.set('libcard-sort', i + ':' + dir); applySort(i, dir); }
  document.querySelectorAll('th[data-s]').forEach((th) => {
    th.tabIndex = 0;
    const go = () => sortBy(th.cellIndex, th.classList.contains('asc') ? -1 : 1);
    th.addEventListener('click', go);
    th.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
  });
  if (sortSel) sortSel.addEventListener('change', () => {
    if (!sortSel.value) return;
    const [i, d] = sortSel.value.split(':').map(Number);
    sortBy(i, d);
  });
  const savedSort = store.get('libcard-sort');
  if (savedSort) {
    const [i, d] = savedSort.split(':').map(Number);
    const th = document.querySelectorAll('th')[i];
    if (th && th.dataset.s && (d === 1 || d === -1)) applySort(i, d);
  } else if (sortSel) sortSel.value = '0:1'; // server order is member, library

</script>
</body>
</html>`;
}
