/**
 * How a call notification should read, given whether that call is still live.
 *
 * The backend writes one notification when a call starts, worded for that
 * moment: "SETHUBALA is calling you...". Nothing rewrites it when the call
 * ends, so the bell kept saying someone was calling long after the call was
 * over.
 *
 * The list used to decide this with a timer -- a call notification counted as
 * past once it was 45 seconds old. That is a guess about the call rather than a
 * fact, and it is wrong in the case people actually notice: a short call that
 * has already ended still reads "is calling you..." for the rest of the 45
 * seconds.
 *
 * The client already knows whether a call is live, because it is the thing
 * handling it. So the rule here is exact: the notification stays in the present
 * tense only while a call with that person is actually ringing or connected,
 * and reads in the past tense the moment it ends.
 */

export interface CallNotificationText {
  title: string;
  body: string;
}

const CALLING_SUFFIX = /\s*is calling you\.{0,3}\s*(Click to answer\.)?\s*$/i;

/** Whether this notification is about a call at all. */
export function isCallNotification(n: { type?: string; title?: string; body?: string }): boolean {
  return (
    n.type === "CALL" ||
    (n.title ?? "").toLowerCase().includes("call") ||
    (n.body ?? "").toLowerCase().includes("calling")
  );
}

/**
 * @param n              the notification as stored
 * @param liveCallerName name of the person on the call happening right now,
 *                       or null when no call is in progress
 */
export function describeCallNotification(
  n: { type?: string; title?: string; body?: string },
  liveCallerName: string | null
): CallNotificationText {
  const title = n.title ?? "";
  const body = n.body ?? "";

  if (!isCallNotification(n)) {
    return { title, body };
  }

  // The caller's name is the part of the body before "is calling you".
  const caller = body.replace(CALLING_SUFFIX, "").trim();

  const isLive =
    !!liveCallerName &&
    caller.length > 0 &&
    caller.toLowerCase() === liveCallerName.trim().toLowerCase();

  if (isLive) {
    // Ringing or connected right now: leave the wording exactly as the server
    // wrote it, which is what the incoming-call toast shows too.
    return { title, body };
  }

  return {
    title: caller ? `${caller} - voice call` : title || "Voice call",
    body: caller ? `${caller} called you` : "Called you"};
}
