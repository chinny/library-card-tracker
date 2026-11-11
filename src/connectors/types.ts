/** Static config for one library card. No secrets here. */
export interface CardConfig {
  /** Opaque id used for env/credential lookup and metric labels (never the barcode). */
  id: string;
  /** Display label for the cardholder. */
  member: string;
  /** Library/system label (e.g. "library-a"). */
  system: string;
  /** SirsiDynix Enterprise base URL, e.g. https://example-a.ent.sirsi.net */
  baseUrl: string;
  /** Physical checkout cap for this card. */
  limit: number;
}

/** Card credentials — sensitive. Decrypted in memory only, never logged/persisted in plaintext. */
export interface Credentials {
  card: string;
  pin: string;
}

/** One checkout needing attention. Titles are display-only; never put in metrics. */
export interface ProblemItem {
  kind: 'overdue' | 'lost';
  title: string;
  /** Due date as the catalog shows it (e.g. "10/28/26"); overdue items only. */
  due: string | null;
  /** Replacement charge in dollars; lost items only. */
  amount: number | null;
}

/** Result of reading one account. `ok=false` carries `error` instead of counts. */
export interface AccountStatus {
  cardId: string;
  member: string;
  system: string;
  ok: boolean;
  /** Physical (library) checkouts — the capacity metric. */
  physical: number | null;
  /** Digital loans — informational, not capped here. */
  digital: number | null;
  holdsLibrary: number | null;
  holdsDigital: number | null;
  finesDue: number | null;
  /** Overdue checkouts, or null if the checkouts list didn't load. */
  overdue: number | null;
  /** Items billed as lost, or null if the fines list didn't load. */
  lost: number | null;
  /** The overdue/lost items themselves (empty when none or unknown). */
  problems: ProblemItem[];
  limit: number;
  /** limit - physical, or null if unavailable. */
  remaining: number | null;
  /** ISO timestamp of the read. */
  fetchedAt: string;
  error?: string;
}
