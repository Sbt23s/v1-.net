/**
 * IT_MGR is the code the HR role was seeded under. It reads as "manager" and
 * confuses people, so anywhere a raw role code is shown on screen it is
 * displayed as IT_HR instead. Only the label changes — every permission check
 * still runs against the code stored on the account.
 */
export function roleCodeLabel(code: string): string {
  if (code === "IT_MGR") return "IT_HR";
  /*
   * COMPANY_ADMIN and SUPER_ADMIN are one job under two names — a company's own
   * top administrator. They hold the same permissions and pass the same checks,
   * so showing two different labels only raised the question of which one an
   * account was. Shown under one name; the codes on the accounts are untouched.
   */
  if (code === "COMPANY_ADMIN" || code === "SUPER_ADMIN") return "SYSTEM_ADMIN";
  return code;
}

/**
 * The labels for a set of role codes, each appearing once.
 *
 * <p>Because several codes deliberately share a label — IT_MGR shows as IT_HR,
 * and COMPANY_ADMIN and SUPER_ADMIN both show as SYSTEM_ADMIN — an account
 * holding two of them rendered the same word twice wherever roles were listed,
 * which reads as a bug rather than as two roles. Mapping first and deduping
 * after means it stays correct for any pair of codes that come to share a name.
 *
 * <p>Order is preserved: the first code to produce a label decides its position.
 */
export function roleLabels(codes: readonly string[] | null | undefined): string[] {
  return [...new Set((codes ?? []).map(roleCodeLabel))];
}
