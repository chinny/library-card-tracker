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
  limit: number;
  /** limit - physical, or null if unavailable. */
  remaining: number | null;
  /** ISO timestamp of the read. */
  fetchedAt: string;
  error?: string;
}
