/**
 * Where a notification should actually take you.
 *
 * <p>Comment notifications were stored pointing at /leave/approvals, which is
 * an approver-only screen -- so an applicant told somebody had replied to them
 * was shown "Restricted" instead of the reply. New ones carry the thread's own
 * address, but the rows already written to the database carry the old one, and
 * rewriting live rows to fix a display problem is the wrong tool: the row is a
 * record of what was sent.
 *
 * <p>So the redirection happens here, at the point of use. The notification
 * table has no reference to the request, so an old comment link cannot be
 * turned into that request's thread -- but it can be sent to the comment list,
 * where the message is, rather than to a page the reader cannot open.
 *
 * <p>Everything else is returned exactly as stored.
 */
export function resolveNotificationLink(
  link?: string | null,
  title?: string | null
): string | undefined {
  if (!link) return undefined;

  const isComment = (title || "").toLowerCase().includes("comment");
  // Only the two screens the old code pointed at. Any other link on a comment
  // notification was set deliberately and is left alone.
  const stale = link === "/leave/approvals" || link === "/leave/permissions";

  return isComment && stale ? "/comments" : link;
}
