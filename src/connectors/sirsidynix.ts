import type { Browser, Page } from 'playwright';
import type { AccountStatus, CardConfig, Credentials, ProblemItem } from './types.js';

// SirsiDynix Enterprise patron-account connector. The flow is identical across
// Enterprise instances, so this is parameterized entirely by `card.baseUrl`.
//
// Validated against Enterprise v5.2.1.6: a real browser is required (raw fetch is
// bot-blocked), login is card# + PIN with no 2FA, and the account dashboard exposes
// a structured status panel (Checkouts / Holds / Fines).

const ENTERPRISE_CLIENT_PATH = '/client/en_US/default/';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/** Only send credentials to https hosts on the known Enterprise path shape. */
function assertSafeBaseUrl(baseUrl: string): URL {
  const u = new URL(baseUrl);
  if (u.protocol !== 'https:') {
    throw new Error(`refusing non-https baseUrl for credentials: ${u.protocol}`);
  }
  return u;
}

// The physical-checkout count, and the marker that the account panel has rendered.
const PANEL_RE = /Checkouts\s+Digital:\s*\d+\s+Library:\s*(\d+)/i;
// The panel fills in left to right, so "Total due" landing means Holds/Fines are
// settled too. Best-effort only: an account can legitimately render without it.
const PANEL_COMPLETE_RE = /Checkouts\s+Digital:.*Holds\s+Digital:.*Total due:/i;
const PANEL_SETTLE_MS = 5_000;

// Lists on the same account page, loaded by XHR after the status panel.
// Overdue checkouts carry a red "Items Overdue:" icon in their alert cell; lost
// items are not checkouts any more but bills with reason "Lost materials"
// (usually followed by a separate "Fee for processing" bill for the same title).
const CHECKOUT_ROWS = '#myCheckouts_checkoutslistnonmobile_table tr.checkoutsLine';
const FINE_ROWS = '[id^="finesTable_personal"] .tbody .tr';
const LIST_WAIT_MS = 10_000;

/** Structural DOM element type for evaluateAll callbacks (tsconfig has no DOM lib). */
interface El {
  textContent: string | null;
  getAttribute(name: string): string | null;
  querySelector(sel: string): El | null;
}

const clean = (s: string): string => s.replace(/\s+/g, ' ').trim();

export interface Problems {
  overdue: number | null;
  lost: number | null;
  problems: ProblemItem[];
}

/**
 * Read overdue checkouts and lost-item bills from an open account page. A list
 * is only waited on when the status panel says it should exist (checkouts > 0,
 * fines > 0); if it never shows up its count is null (unknown), not 0.
 */
export async function readProblems(
  page: Page,
  physical: number,
  finesDue: number | null,
): Promise<Problems> {
  const ready = (sel: string, expected: boolean): Promise<boolean> =>
    expected
      ? page.locator(sel).first().waitFor({ state: 'attached', timeout: LIST_WAIT_MS }).then(() => true, () => false)
      : Promise.resolve(true);
  const [checkoutsReady, finesReady] = await Promise.all([
    ready(CHECKOUT_ROWS, physical > 0),
    ready(FINE_ROWS, (finesDue ?? 0) > 0),
  ]);

  // Callbacks run in the page: keep them free of named inner functions (tsx/esbuild
  // wraps those in a __name() helper that doesn't exist there) and normalize in Node.
  const overdueRows = checkoutsReady
    ? await page.locator(CHECKOUT_ROWS).evaluateAll((rows: El[]) =>
        rows
          .filter((tr) => {
            const img = tr.querySelector('td.checkoutsAlert img');
            return !!img && (/overdue/i.test(img.getAttribute('alt') ?? '') || /red!/.test(img.getAttribute('src') ?? ''));
          })
          .map((tr) => ({
            title: tr.querySelector('td.checkoutsBookInfo a')?.textContent ?? '',
            due: tr.querySelector('td.checkoutsDueDate')?.textContent ?? '',
          })),
      )
    : null;

  const lostRows = finesReady
    ? await page.locator(FINE_ROWS).evaluateAll((rows: El[]) =>
        rows
          .filter((tr) => /\blost\b/i.test(tr.querySelector('.medCol')?.textContent ?? ''))
          .map((tr) => ({
            title: tr.querySelector('.detailTitle a')?.textContent ?? '',
            amount: tr.querySelector('.moneyCol')?.textContent ?? '',
          })),
      )
    : null;

  const problems: ProblemItem[] = [
    ...(overdueRows ?? []).map((r) => ({
      kind: 'overdue' as const, title: clean(r.title) || 'Untitled', due: clean(r.due) || null, amount: null,
    })),
    ...(lostRows ?? []).map((r) => {
      const m = clean(r.amount).match(/[\d.]+/);
      return { kind: 'lost' as const, title: clean(r.title) || 'Untitled', due: null, amount: m ? Number(m[0]) : null };
    }),
  ];
  return { overdue: overdueRows?.length ?? null, lost: lostRows?.length ?? null, problems };
}

function num(flat: string, re: RegExp): number | null {
  const m = flat.match(re);
  return m && m[1] !== undefined ? Number(m[1]) : null;
}

export async function fetchAccount(
  browser: Browser,
  card: CardConfig,
  creds: Credentials,
): Promise<AccountStatus> {
  const fetchedAt = new Date().toISOString();
  const base: AccountStatus = {
    cardId: card.id,
    member: card.member,
    system: card.system,
    ok: false,
    physical: null,
    digital: null,
    holdsLibrary: null,
    holdsDigital: null,
    finesDue: null,
    overdue: null,
    lost: null,
    problems: [],
    limit: card.limit,
    remaining: null,
    fetchedAt,
  };

  let origin: string;
  try {
    origin = assertSafeBaseUrl(card.baseUrl).origin;
  } catch (e) {
    return { ...base, error: (e as Error).message };
  }

  const ctx = await browser.newContext({ userAgent: UA });
  const page = await ctx.newPage();
  try {
    // Home → open the login modal (top-nav "Log In" is a link, not a button).
    await page.goto(origin + ENTERPRISE_CLIENT_PATH, {
      waitUntil: 'domcontentloaded',
      timeout: 45_000,
    });
    await page.getByRole('link', { name: 'Log In' }).first().click({ timeout: 10_000 });

    await page.locator('#j_username').first().waitFor({ state: 'visible', timeout: 15_000 });
    await page.locator('#j_username').first().fill(creds.card);
    await page.locator('#j_password').first().fill(creds.pin);

    const submit = page.locator('#submit_0').first();
    await Promise.all([
      page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {}),
      (async () => {
        if (await submit.isVisible().catch(() => false)) await submit.click();
        else await page.locator('#j_password').first().press('Enter');
      })(),
    ]);
    await page.waitForTimeout(2_500);

    const afterLogin = (await page.locator('body').innerText().catch(() => '')) || '';
    if (/invalid|not\s*recognized|incorrect|try again|does not match/i.test(afterLogin)) {
      return { ...base, error: 'login failed (credentials rejected)' };
    }

    // Open the patron dashboard via the "My Account" link. This is an in-page hash
    // navigation that loads the panel by XHR -- it starts no page load, so
    // waitForLoadState('networkidle') returns immediately and proves nothing. Wait
    // for the panel text itself, or we parse the still-rendered home page.
    await page.getByRole('link', { name: 'My Account' }).first().click({ timeout: 15_000 });
    // A locator re-resolves on every poll, so it survives the navigation the click
    // triggers; waitForFunction dies on it with "execution context was destroyed".
    const panelReady = await page
      .locator('body')
      .filter({ hasText: PANEL_RE })
      .first()
      .waitFor({ state: 'attached', timeout: 30_000 })
      .then(() => true)
      .catch(() => false);

    // Holds and fines trail the checkout counts; give them a bounded moment to land
    // rather than reporting nulls for a panel that was simply read too early.
    if (panelReady) {
      await page
        .locator('body')
        .filter({ hasText: PANEL_COMPLETE_RE })
        .first()
        .waitFor({ state: 'attached', timeout: PANEL_SETTLE_MS })
        .catch(() => {});
    }

    // Parse the status panel: "Checkouts Digital: N Library: N Holds Digital: N
    // Library: N Fines Total due: $N.NN"
    const flat = ((await page.locator('body').innerText().catch(() => '')) || '').replace(/\s+/g, ' ');
    const physical = num(flat, PANEL_RE);
    const digital = num(flat, /Checkouts\s+Digital:\s*(\d+)/i);
    const holdsDigital = num(flat, /Holds\s+Digital:\s*(\d+)/i);
    const holdsLibrary = num(flat, /Holds\s+Digital:\s*\d+\s+Library:\s*(\d+)/i);
    const finesM = flat.match(/Total due:\s*\$?([\d.]+)/i);
    const finesDue = finesM && finesM[1] !== undefined ? Number(finesM[1]) : null;

    // `physical` is the number the whole dashboard exists to show, so a page that
    // parsed only the digital half is a partial render, not a success -- reporting
    // ok with physical=null silently publishes a wrong "0 of 50".
    if (physical === null) {
      const seen = /Checkouts\s+Digital:/i.test(flat) ? 'panel present but no Library count' : 'panel absent';
      return {
        ...base,
        error: `could not parse account panel (${seen}; panelReady=${panelReady}; url=${page.url()})`,
      };
    }

    // Best-effort: a list that fails to load leaves its count unknown (null)
    // rather than failing the capacity read.
    const problems = await readProblems(page, physical, finesDue).catch(
      (): Problems => ({ overdue: null, lost: null, problems: [] }),
    );

    return {
      ...base,
      ...problems,
      ok: true,
      physical,
      digital,
      holdsLibrary,
      holdsDigital,
      finesDue,
      remaining: card.limit - physical,
    };
  } catch (e) {
    // Never include credentials in the error.
    return { ...base, error: (e as Error).message };
  } finally {
    await ctx.close();
  }
}
