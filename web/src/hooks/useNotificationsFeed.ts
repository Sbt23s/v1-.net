import { useEffect, useRef } from "react";
import React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Client } from "@stomp/stompjs";
import SockJS from "sockjs-client";
import toast from "react-hot-toast";
import { describeCallNotification } from "@/lib/callNotifications";
import { getLiveCaller } from "@/lib/liveCall";
import { api, tokenStore } from "@/lib/api";
import { resolveNotificationLink } from "@/lib/notificationLink";
import { notificationAllowed } from "@/lib/notificationModules";
import { useAuth } from "@/context/AuthContext";
import type { ApiEnvelope, AppNotification, PageEnvelope } from "@/types";

const BASE = import.meta.env.VITE_API_URL || "";

// Three invented notifications used to be returned whenever this request failed
// or came back empty, so the bell showed unread items that did not exist and an
// empty inbox was indistinguishable from a broken one. The error is passed to
// the caller now; an empty page is returned as the empty page it is.
async function fetchFeed(): Promise<PageEnvelope<AppNotification>> {
  const res = await api.get<PageEnvelope<AppNotification>>("/notifications?size=20");
  if (!res.data) throw new Error("Notifications returned no data");
  return res.data;
}

async function fetchUnreadCount(): Promise<number> {
  // This returned 2 on any failure, so the bell wore an unread badge for two
  // notifications that were never there. The caller already falls back to 0 when
  // there is no answer, which is the right thing to show when we do not know.
  const res = await api.get<ApiEnvelope<{ count: number }>>("/notifications/unread-count");
  const count = res.data?.data?.count;
  if (count === undefined) throw new Error("Unread count returned no data");
  return count;
}

/** Icon shown on the toast for each notification type. */
function toastIcon(type?: string): string {
  switch (type) {
    case "CHAT": return "💬";
    case "LEAVE": return "🗓";
    case "PERMISSION": return "⏰";
    case "TASK": return "✅";
    case "HELPDESK": return "🎫";
    case "CELEBRATION": return "🎉";
    case "ASSET": return "📦";
    case "PAYSLIP": return "💰";
    case "ANNOUNCEMENT": return "📢";
    case "CALENDAR": return "📅";
    default: return "🔔";
  }
}

/**
 * The feed, the socket and the toasts -- one copy of each.
 *
 * <p>Not exported. This ran as a plain hook mounted in two places at once --
 * the app shell and the Notifications page -- and each mount opened its own
 * SockJS connection, subscribed to the same topic and raised its own toast, so
 * a single notification arrived on screen twice while the page was open, and
 * both copies polled the feed every thirty seconds.
 *
 * <p>{@link NotificationProvider} runs this exactly once and hands the result
 * down, so both consumers read one connection. See useNotifications.tsx.
 */
export function useNotificationsInternal(userId?: number) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { hasModule } = useAuth();

  // Poll as well as listen: the feed is the source of truth, so toasts still
  // appear even if the WebSocket can't connect (proxy, sleep/resume, etc.).
  const feed = useQuery({
    queryKey: ["notifications"],
    queryFn: fetchFeed,
    refetchInterval: 30_000,
    refetchOnWindowFocus: false
  });
  const unread = useQuery({
    queryKey: ["notifications", "unread"],
    queryFn: fetchUnreadCount,
    refetchInterval: 30_000,
    refetchOnWindowFocus: false
  });

  // Rich, clickable toast for any notification. `id` keeps a notification from
  // being toasted twice when both the socket and the poll see it.
  const showToast = (n: AppNotification) => {
    // The list is filtered further down, but a toast arrives on its own from
    // the WebSocket and would otherwise pop up for a module that is off.
    if (!notificationAllowed(n.type, hasModule)) return;

    /*
      A call notification is worded for the moment it is read, not the moment
      it was written. The server writes "X is calling you" when the call
      starts and never rewrites it, so a call that rang out or was already
      finished popped up a toast inviting somebody to answer it. Present
      tense only while a call with that person is genuinely live.
    */
    const { title, body } = describeCallNotification(n, getLiveCaller());

    if (typeof Notification !== "undefined" && Notification.permission === "granted" && document.visibilityState === "hidden") {
      try {
        const notif = new Notification(title, {
          body: body || "",
          icon: "/pixous-logo.png",
          tag: `notif-${n.id}`
        });
        notif.onclick = () => {
          window.focus();
          const to = resolveNotificationLink(n.link, n.title);
          if (to) navigate(to);
          notif.close();
        };
      } catch (e) {}
    }

    toast.custom(
      (t) =>
        React.createElement(
          "div",
          {
            onClick: () => {
              toast.dismiss(t.id);
              const to = resolveNotificationLink(n.link, n.title);
              if (to) navigate(to);
            },
            className:
              "flex w-80 items-start gap-3 rounded-lg border border-border bg-popover p-3 shadow-lg transition-opacity relative group"
              + (n.link ? " cursor-pointer" : ""),
            style: { opacity: t.visible ? 1 : 0 }
          },
          React.createElement(
            "span",
            { className: "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-base" },
            toastIcon(n.type)
          ),
          React.createElement(
            "div",
            { className: "min-w-0 flex-1 pr-6" },
            React.createElement("div", { className: "text-sm font-semibold text-foreground" }, title),
            body
              ? React.createElement("div", { className: "line-clamp-2 text-xs text-muted-foreground" }, body)
              : null
          ),
          React.createElement(
            "button",
            {
              onClick: (e: any) => { e.stopPropagation(); toast.dismiss(t.id); },
              className: "absolute right-2 top-2 rounded p-1 text-muted-foreground opacity-60 transition-all hover:bg-muted hover:opacity-100 hover:text-foreground"
            },
            React.createElement(
              "svg",
              {
                xmlns: "http://www.w3.org/2000/svg",
                width: "14",
                height: "14",
                viewBox: "0 0 24 24",
                fill: "none",
                stroke: "currentColor",
                strokeWidth: "2",
                strokeLinecap: "round",
                strokeLinejoin: "round"
              },
              React.createElement("path", { d: "M18 6 6 18" }),
              React.createElement("path", { d: "m6 6 12 12" })
            )
          )
        ),
      { id: `n-${n.id}`, duration: 5000 }
    );
  };

  // How many unread notifications get toasted when the app first loads.
  const LOGIN_TOAST_LIMIT = 3;

  // Ids already toasted, so the socket and the poll never double-toast.
  const seenIds = useRef<Set<number>>(new Set());
  const firstLoadDone = useRef(false);

  const toastOnce = (n: AppNotification) => {
    if (seenIds.current.has(n.id)) return;
    seenIds.current.add(n.id);
    showToast(n);
  };

  useEffect(() => {
    const items = feed.data?.content;
    if (!items) return;

    // On login / first load, surface what the user missed: toast the most
    // recent unread ones (capped), with a count for the rest.
    if (!firstLoadDone.current) {
      firstLoadDone.current = true;
      const unreadItems = items.filter((n) => !n.read);
      items.forEach((n) => { if (n.read) seenIds.current.add(n.id); });

      unreadItems.slice(0, LOGIN_TOAST_LIMIT).reverse().forEach(toastOnce);
      const rest = unreadItems.length - LOGIN_TOAST_LIMIT;
      if (rest > 0) {
        unreadItems.slice(LOGIN_TOAST_LIMIT).forEach((n) => seenIds.current.add(n.id));
        toast.custom(
          (t) =>
            React.createElement(
              "div",
              {
                className: "flex items-center gap-2 rounded-lg bg-[hsl(222_47%_11%)] px-4 py-3 text-sm text-[hsl(210_40%_98%)] shadow-lg transition-opacity relative group",
                style: { opacity: t.visible ? 1 : 0 }
              },
              React.createElement("span", { className: "text-base" }, "🔔"),
              React.createElement("span", { className: "font-medium pr-6" }, `+${rest} more unread notification${rest === 1 ? "" : "s"}`),
              /*
               * Close all, because dismissing a stack one X at a time is the
               * complaint this answers. toast.dismiss() with no id closes every
               * open toast; it only hides them, so nothing is marked read and
               * the bell keeps its count -- dismissing a popup is not the same
               * as having read the notification.
               */
              React.createElement(
                "button",
                {
                  onClick: (e: any) => { e.stopPropagation(); toast.dismiss(); },
                  className: "ml-1 mr-5 shrink-0 rounded border border-white/25 px-2 py-0.5 text-xs font-medium text-[hsl(210_40%_98%)] transition-colors hover:bg-white/20"
                },
                "Close all"
              ),
              React.createElement(
                "button",
                {
                  onClick: (e: any) => { e.stopPropagation(); toast.dismiss(t.id); },
                  className: "absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-[hsl(210_40%_98%)] opacity-60 transition-all hover:bg-white/20 hover:opacity-100"
                },
                React.createElement(
                  "svg",
                  {
                    xmlns: "http://www.w3.org/2000/svg",
                    width: "14",
                    height: "14",
                    viewBox: "0 0 24 24",
                    fill: "none",
                    stroke: "currentColor",
                    strokeWidth: "2",
                    strokeLinecap: "round",
                    strokeLinejoin: "round"
                  },
                  React.createElement("path", { d: "M18 6 6 18" }),
                  React.createElement("path", { d: "m6 6 12 12" })
                )
              )
            ),
          { id: "n-more-unread", duration: 5000 }
        );
      }
      return;
    }

    // Afterwards: toast anything new, oldest first.
    [...items].reverse().forEach(toastOnce);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feed.data]);

  // Live push. The frame already carries the notification, so toast straight
  // from it — no waiting on a refetch — then refresh the bell/feed counts.
  useEffect(() => {
    if (!userId || !tokenStore.access) return;

    const client = new Client({
      webSocketFactory: () => new SockJS(`${BASE}/ws`),
      connectHeaders: { Authorization: `Bearer ${tokenStore.access}` },
      reconnectDelay: 5000,
      onConnect: () => {
        /*
          What a notification means for the rest of the screen.

          A push already reached the browser -- the toast proves it -- but only
          the notification feed was refreshed, so a person watching their leave
          or WFH list still waited for its own poll to notice a decision that
          had already been made. Mapping the notification's type to the queries
          it affects makes those lists genuinely live rather than merely
          frequent, and costs one refetch of data already on screen.

          Unknown types refresh nothing extra: a type this does not recognise
          is not a reason to refetch the whole application.
        */
        const AFFECTED: Record<string, string[]> = {
          WFH: ["wfh", "attendance", "dashboard"],
          LEAVE: ["leave", "permissions", "dashboard"],
          /*
            PERMISSION was missing, and the omission was invisible.

            The backend sends type "PERMISSION" for a permission request and its
            decision. LEAVE above already lists "permissions" among the queries
            it refreshes, which made the map look complete -- but a PERMISSION
            frame matched no key at all, so the toast appeared and the list
            behind it did not move.

            It matters most now that a request addressed to HR reaches the whole
            desk: one of them approves, the others are notified, and their
            screens went on showing it as pending until somebody reloaded.
          */
          PERMISSION: ["permissions", "attendance", "dashboard"],
          COMPLAINT: ["complaints"],
          TICKET: ["tickets"],
          HELPDESK: ["tickets"],
          TASK: ["tasks"],
          ASSET: ["assets"],
          EXPENSE: ["claims"],
          PAYROLL: ["payroll", "payslips"],
          /*
            Three the backend has always sent and this map never listed, so the
            toast appeared and the page behind it did not move. An appreciation
            letter is the worst of them: the person it was written for was told
            about it and then had to reload to find it.

            CELEBRATION refreshes the dashboard rather than a list of its own --
            the birthdays card is part of it, and the year view reads the same
            query key.
          */
          APPRECIATION: ["appreciation", "dashboard"],
          DISCIPLINE: ["discipline"],
          CELEBRATION: ["dashboard"],
        };

        const onFrame = (body: string) => {
          let kind: string | undefined;
          try {
            const n = JSON.parse(body) as AppNotification;
            if (n && typeof n.id === "number") toastOnce(n);
            kind = n?.type?.toUpperCase();
          } catch {
            /* malformed frame — the feed refresh below still picks it up */
          }
          qc.invalidateQueries({ queryKey: ["notifications"] });
          for (const key of AFFECTED[kind ?? ""] ?? []) {
            qc.invalidateQueries({ queryKey: [key] });
          }
        };

        client.subscribe(`/topic/notifications/${userId}`, (msg) => onFrame(msg.body));
        client.subscribe("/user/queue/notifications", (msg) => onFrame(msg.body));
      }
    });

    client.activate();
    return () => {
      client.deactivate();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, qc]);

  async function markAllRead() {
    await api.post("/notifications/mark-all-read");
    qc.invalidateQueries({ queryKey: ["notifications"] });
  }

  async function markRead(id: number) {
    await api.post(`/notifications/${id}/read`);
    qc.invalidateQueries({ queryKey: ["notifications"] });
  }

  /**
   * Empty the list.
   *
   * Distinct from marking everything read, which the page already offered and
   * which leaves a hundred rows to scroll past. This deletes them — read and
   * unread alike, because a Clear All that keeps the unread ones is not what
   * the button says.
   */
  async function clearAll() {
    await api.delete("/notifications");
    qc.invalidateQueries({ queryKey: ["notifications"] });
  }

  // Filtering here rather than at each screen, so the bell, its count, the
  // notifications page and the dashboard feed cannot disagree about what
  // exists. A count of nine over an empty list is its own bug.
  const visible = (feed.data?.content ?? []).filter((n) =>
    notificationAllowed(n.type, hasModule)
  ).map((n) => ({
    ...n,
    title: n.title ? n.title.replace(/\bCEO\b/g, "CTO").replace(/CEO -/g, "CTO -").replace(/CEO ·/g, "CTO ·") : n.title,
    body: n.body ? n.body.replace(/\bCEO\b/g, "CTO") : n.body,
    message: (n.message || n.body) ? (n.message || n.body)?.replace(/\bCEO\b/g, "CTO") : (n.message || n.body)
  }));

  return {
    notifications: visible,
    // Recomputed from the visible list rather than taken from the server's
    // total, which still counts notifications belonging to switched-off
    // modules and would leave the badge permanently unclearable.
    unreadCount: visible.filter((n) => !n.read).length,
    loading: feed.isLoading,
    // Exposed so a screen can tell "you have no notifications" apart from "we
    // could not find out". Both used to look identical.
    failed: feed.isError,
    retry: () => feed.refetch(),
    markAllRead,
    markRead,
    clearAll
  };
}

export type NotificationsApi = ReturnType<typeof useNotificationsInternal>;
