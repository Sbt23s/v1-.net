import type { UserSummary } from "@/types";

/**
 * The printable login-credentials sheet.
 *
 * Kept out of the page component because it is a document rather than UI: it
 * has its own layout rules, it is the thing that decides who appears on the
 * sheet, and both of those are worth being able to read without scrolling
 * past a thousand lines of employee table.
 *
 * Rendered as a print document and handed to the browser rather than built
 * with a PDF library. A library would add a few hundred kilobytes to the
 * bundle for one button, and the browser's own print-to-PDF already produces
 * a better result: real page breaks, a table header that repeats on every
 * page, and the operator chooses where the file goes.
 *
 * # On putting passwords on a page
 *
 * This sheet exists so somebody handing out logins has something to hand out,
 * so it has to carry the passwords -- a credentials sheet without credentials
 * is of no use. That makes the file itself sensitive in a way the rest of the
 * portal is not: it is a single page that can sign in as anybody on it. Two
 * things follow, and both are deliberate:
 *
 * Only ACTIVE profiles appear. Somebody who has been offboarded still has a
 * row in the table and a password in the vault, and a sheet left on a desk is
 * the last place a leaver's working login should be.
 *
 * The warning at the top is not decoration. Whoever picks this page up needs
 * to know what it is before they read down it.
 */

const ESCAPES: Record<string, string> = {
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
};

/** Employee names and codes are user-supplied, so they are escaped, not trusted. */
function esc(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

export interface CredentialsSheetInput {
  people: UserSummary[];
  /** Resolves a designation id to its title, for accounts with no title set. */
  designationTitle: (id?: number) => string;
  generatedAt: string;
}

/** Everyone currently working here, in employee-code order. */
export function activeOnly(people: UserSummary[]): UserSummary[] {
  return people
    .filter((u) => (u.profileStatus ?? "").toUpperCase() === "ACTIVE")
    .sort((a, b) =>
      (a.employeeCode ?? "").localeCompare(b.employeeCode ?? "") ||
      (a.name ?? "").localeCompare(b.name ?? ""));
}

export function buildCredentialsSheet(
  { people, designationTitle, generatedAt }: CredentialsSheetInput
): string {
  const rows = people.map((u, i) => `
    <tr>
      <td class="n">${i + 1}</td>
      <td>${esc(u.employeeCode)}</td>
      <td>${esc(u.name)}</td>
      <td>${esc(u.designationTitle || designationTitle(u.designationId) || "—")}</td>
      <td class="mono">${esc(u.username || "— not set —")}</td>
      <td class="mono">${u.password
        ? esc(u.password)
        : '<span class="none">not recorded</span>'}</td>
    </tr>`).join("");

  // Accounts whose password was set before a readable copy was kept cannot be
  // printed, and saying nothing would make the sheet look simply wrong.
  const missing = people.filter((u) => !u.password).length;
  const missingNote = missing === 0 ? "" :
    ` ${missing} account${missing === 1 ? "" : "s"} ${missing === 1 ? "has" : "have"} no recorded`
    + ` password — those were set before passwords were kept in readable form, so use`
    + ` Reset Login to set a new one.`;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Employee Login Credentials — Pixous Technologies</title>
<style>
  @page { size: A4; margin: 14mm 12mm; }
  * { box-sizing: border-box; }
  body { font: 11px/1.45 "Segoe UI", Arial, sans-serif; color: #111827; margin: 0; }
  h1 { font-size: 17px; margin: 0 0 2px; color: #0f172a; }
  .sub { font-size: 10.5px; color: #4b5563; margin-bottom: 10px; }
  .warn { border: 1px solid #b91c1c; background: #fef2f2; color: #7f1d1d;
          padding: 7px 9px; font-size: 10px; margin-bottom: 12px; border-radius: 4px; }
  table { width: 100%; border-collapse: collapse; }
  thead { display: table-header-group; }   /* header repeats on every page */
  tr { page-break-inside: avoid; }
  th, td { border: 1px solid #d1d5db; padding: 5px 6px; text-align: left; vertical-align: top; }
  th { background: #0f172a; color: #fff; font-size: 10px;
       text-transform: uppercase; letter-spacing: .04em; }
  tbody tr:nth-child(even) td { background: #f9fafb; }
  td.n { text-align: right; width: 26px; color: #6b7280; }
  .mono { font-family: Consolas, "Courier New", monospace; font-size: 10.5px; }
  .none { color: #9ca3af; font-style: italic; }
  .foot { margin-top: 10px; font-size: 9.5px; color: #6b7280; }
</style></head><body>
  <h1>Employee Login Credentials</h1>
  <div class="sub">Pixous Technologies · ${people.length} active
    employee${people.length === 1 ? "" : "s"} · generated ${esc(generatedAt)}</div>
  <div class="warn"><strong>Confidential.</strong> This sheet contains working passwords.
    Give it only to the person who needs it and destroy it once the logins have been
    handed out. Anyone holding this page can sign in as any employee listed on it.</div>
  <table>
    <thead><tr>
      <th></th><th>Employee ID</th><th>Name</th>
      <th>Designation</th><th>Username</th><th>Password</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="foot">Offboarded employees are deliberately excluded.${missingNote}</div>
</body></html>`;
}
