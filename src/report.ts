import type { AccountStatus } from './connectors/types.js';

/** One-line capacity summary for the CLI. Never prints credentials. */
export function printRow(s: AccountStatus): void {
  if (!s.ok) {
    console.log(`✗ ${s.member.padEnd(12)} ${s.system.padEnd(12)} ERROR: ${s.error}`);
    return;
  }
  const cap = `${s.physical}/${s.limit}`;
  const flag = s.remaining !== null && s.remaining <= 5 ? '⚠️ ' : '   ';
  console.log(
    `✓ ${s.member.padEnd(12)} ${s.system.padEnd(12)} ${flag}physical ${cap.padEnd(7)} ` +
      `(remaining ${s.remaining})  digital ${s.digital}  holds ${s.holdsLibrary}/${s.holdsDigital}  fines $${s.finesDue}`,
  );
}
