/**
 * Who, if anyone, is on a call right now.
 *
 * The notification toast has to know this to word a call notification
 * correctly -- "is calling you" while it is ringing, "called you" once it is
 * over -- but the toast is raised from the notification hook, and the call
 * state lives in the calling hook. Having one import the other makes a cycle:
 * the calling provider raises toasts of its own.
 *
 * So it is kept here instead: one value, written by whoever is handling the
 * call and read by whoever needs to describe it. A module-level variable
 * rather than React state on purpose -- it is read inside a toast callback
 * that fires outside of rendering, where a stale closure over state would
 * give the answer from before the call started.
 */

let liveCallerName: string | null = null;

/** Called by the calling provider whenever a call starts or ends. */
export function setLiveCaller(name: string | null) {
  liveCallerName = name && name.trim() ? name.trim() : null;
}

/** The name of the person on the current call, or null when there is none. */
export function getLiveCaller(): string | null {
  return liveCallerName;
}
