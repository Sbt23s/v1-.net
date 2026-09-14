/**
 * The company head's account is stored under the name "CEO".
 *
 * The company calls the post CTO, so every screen that shows a person's name
 * has to say CTO. That rewrite had been written out separately in the sidebar,
 * the dashboard, the notification feed and the approver lists -- four
 * implementations of one rule, which is why the audit log, written later,
 * showed "CEO" while the sidebar beside it showed "CTO".
 *
 * One rule, in one place.
 *
 * The real fix is the stored name: renaming that record in Employees would
 * correct every screen at once, web and mobile, with no code involved. This
 * keeps the display honest until someone does.
 */

/** The account this applies to. */
const HEAD_CODE = "PIX-E100";

/** Names that are really the job title, not a person's name. */
const PLACEHOLDER = /^(ceo|cto)$/i;

/**
 * The name to show for a person.
 *
 * Matched on the employee code first, because that identifies the account
 * whatever the record happens to be called. A name that merely contains "CEO"
 * is only rewritten for that account, so an unrelated employee whose name
 * contains those letters is left alone.
 *
 * @param name         the stored name
 * @param employeeCode the person's employee code, when the caller has it
 */
export function displayPersonName(
  name?: string | null,
  employeeCode?: string | null
): string | null | undefined {
  if (!name) return name;

  const isHead = (employeeCode ?? "").toUpperCase() === HEAD_CODE;
  if (!isHead) return name;

  const trimmed = name.trim();
  if (PLACEHOLDER.test(trimmed)) return "CTO";

  // A real name that carries the old title alongside it -- "CEO - Elamaran"
  // -- keeps the name and corrects the title.
  return trimmed.replace(/\bCEO\b/g, "CTO");
}

/**
 * Whether this account is the company head.
 *
 * <p>The literal "PIX-E100" appears in fifteen files, half of them upper-casing
 * the code first and half not — so a code stored as "pix-e100" is the CTO on
 * some screens and an ordinary employee on others. One expression, used
 * everywhere, cannot disagree with itself.
 *
 * <p>An employee code rather than a role because that is what identifies them:
 * there is no CTO role in this schema.
 */
export function isCompanyHead(employeeCode?: string | null): boolean {
  return (employeeCode ?? "").trim().toUpperCase() === HEAD_CODE;
}

/**
 * The three accounts that run the platform rather than work at the company:
 * the super administrator, the system administrator and the company head.
 *
 * <p>They hold logins so the portal can be configured and approvals can reach
 * a top, but they have no shift and no team, and they are not an audience —
 * a read receipt is about whether the people a message was for have seen it.
 *
 * <p>Mirrors common/PlatformAccounts on the server, which is where the same
 * three codes are named for the Java-side checks.
 */
const PLATFORM_CODES = new Set(["PIX-E100", "ADM0001", "SADM001"]);

export function isPlatformAccount(employeeCode?: string | null): boolean {
  return PLATFORM_CODES.has((employeeCode ?? "").trim().toUpperCase());
}
