/**
 * Which module each kind of notification belongs to.
 *
 * A company that has switched chat off was still being shown "Incoming Call"
 * and "new personal message" in the bell and in Recent Activity. The module
 * was off everywhere except the one place that tells you something happened,
 * which made the setting look like it had not worked.
 *
 * A type absent from this map is deliberately always shown. CELEBRATION and
 * ANNOUNCEMENT belong to no switchable module, and anything new that arrives
 * before this map learns about it should reach the person rather than vanish —
 * a notification nobody sees is the worse failure of the two.
 *
 * The trade-off has teeth: a new notification type wired up on the server will
 * appear regardless of its module until it is added here. The keys below are
 * every type the backend currently sends. When you add one there, add it here.
 */
const NOTIFICATION_MODULE: Record<string, string> = {
  CHAT: "CHAT",
  // Calls are placed from the chat screen and their notification links back to
  // it. A first pass at this map covered CHAT and missed CALL, so with chat
  // switched off the bell still filled with "Incoming Call" — the visible half
  // of the feature outliving the half that was turned off.
  CALL: "CHAT",
  LEAVE: "LEAVE",
  PERMISSION: "LEAVE",
  APPROVED: "LEAVE",
  TASK: "TASKS",
  WORK_REPORT: "REPORTS",
  HELPDESK: "HELPDESK",
  COMPLAINT: "HELPDESK",
  SAFETY: "HELPDESK",
  ASSET: "ASSETS",
  PAYROLL: "PAYROLL",
  PAYSLIP: "PAYROLL",
  CLAIM: "EXPENSES",
  CALENDAR: "CALENDAR"
};

/**
 * True when this notification's module is on for the current company.
 *
 * @param type      the notification's type, as the server sends it
 * @param hasModule the check from the auth context — the same one the sidebar
 *                  uses, so the bell and the navigation cannot disagree
 */
export function notificationAllowed(
  type: string | undefined,
  hasModule: (moduleCode: string) => boolean
): boolean {
  if (!type) return true;
  const required = NOTIFICATION_MODULE[type];
  return required ? hasModule(required) : true;
}
