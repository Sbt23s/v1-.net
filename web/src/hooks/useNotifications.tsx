import { createContext, useContext, type ReactNode } from "react";
import { useNotificationsInternal, type NotificationsApi } from "./useNotificationsFeed";

/**
 * One notification feed for the whole app.
 *
 * <p>The hook behind this opens a WebSocket, subscribes to the user's topic and
 * raises a toast for anything that arrives. It was mounted twice -- once in the
 * app shell, once on the Notifications page -- so opening that page gave the
 * user two connections, two thirty-second polls and two toasts for every single
 * notification.
 *
 * <p>A context rather than a hoist: the page needs the list and the mark-read
 * actions, not just the badge, so the shell has to pass the whole thing down.
 * The same shape useCalls and useGroupCall already use for the same reason.
 */
const NotificationContext = createContext<NotificationsApi | null>(null);

export function NotificationProvider(
  { userId, children }: { userId?: number; children: ReactNode }
) {
  const value = useNotificationsInternal(userId);
  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
}

/**
 * Read the shared feed.
 *
 * <p>The userId argument is accepted and ignored: every caller already passed
 * it, and the provider is the one place that now decides whose feed this is.
 * Keeping the signature means no call site had to change.
 */
export function useNotifications(_userId?: number): NotificationsApi {
  const ctx = useContext(NotificationContext);
  if (!ctx) {
    throw new Error("useNotifications must be used inside a NotificationProvider");
  }
  return ctx;
}
