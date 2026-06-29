import type { Browser } from 'playwright';
import type { AccountStatus, CardConfig, Credentials } from './types.js';

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

    // Open the patron dashboard via the "My Account" link.
    await page.getByRole('link', { name: 'My Account' }).first().click({ timeout: 15_000 });
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(3_000);

    // Parse the status panel: "Checkouts Digital: N Library: N Holds Digital: N
    // Library: N Fines Total due: $N.NN"
    const flat = ((await page.locator('body').innerText().catch(() => '')) || '').replace(/\s+/g, ' ');
    const physical = num(flat, /Checkouts\s+Digital:\s*\d+\s+Library:\s*(\d+)/i);
    const digital = num(flat, /Checkouts\s+Digital:\s*(\d+)/i);
    const holdsDigital = num(flat, /Holds\s+Digital:\s*(\d+)/i);
    const holdsLibrary = num(flat, /Holds\s+Digital:\s*\d+\s+Library:\s*(\d+)/i);
    const finesM = flat.match(/Total due:\s*\$?([\d.]+)/i);
    const finesDue = finesM && finesM[1] !== undefined ? Number(finesM[1]) : null;

    if (physical === null && digital === null) {
      return { ...base, error: 'could not parse account panel' };
    }

    return {
      ...base,
      ok: true,
      physical,
      digital,
      holdsLibrary,
      holdsDigital,
      finesDue,
      remaining: physical === null ? null : card.limit - physical,
    };
  } catch (e) {
    // Never include credentials in the error.
    return { ...base, error: (e as Error).message };
  } finally {
    await ctx.close();
  }
}
