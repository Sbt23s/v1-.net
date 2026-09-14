import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Client } from "@stomp/stompjs";
import SockJS from "sockjs-client";
import { tokenStore } from "@/lib/api";

const BASE = import.meta.env.VITE_API_URL || "";

/**
 * Keeps attendance figures moving on their own.
 *
 * <p>The dashboard read today's attendance once, when the page loaded, and then
 * never again — somebody arriving at nine did not show up until whoever was
 * watching happened to reload. The server now announces each punch on
 * `/topic/attendance`, and this turns that announcement into a refresh of
 * whichever attendance figures the screen is showing.
 *
 * <p>The frame itself carries nothing worth reading beyond "something changed":
 * each screen re-reads its own numbers through the ordinary endpoints, so nobody
 * is sent attendance for employees they have no business seeing.
 *
 * <p>Nothing here is load-bearing. If the socket cannot connect — a proxy that
 * blocks upgrades, a laptop that just woke — the queries keep their own refetch
 * interval and the page stays correct, only less immediate. So this deliberately
 * has no error state to show and nothing to tell the user about.
 */
export function useAttendanceLive(enabled: boolean = true) {
  const qc = useQueryClient();

  useEffect(() => {
    // No token means no authenticated socket. Waiting is right: the effect re-runs
    // once one exists, rather than opening a connection that will be rejected.
    if (!enabled || !tokenStore.access) return;

    const client = new Client({
      webSocketFactory: () => new SockJS(`${BASE}/ws`),
      connectHeaders: { Authorization: `Bearer ${tokenStore.access}` },
      reconnectDelay: 5000,
      // Silent on purpose. A broker that is absent is an ordinary state here, not
      // an error the user needs to hear about.
      onStompError: () => {},
      onWebSocketError: () => {},
      onConnect: () => {
        client.subscribe("/topic/attendance", () => {
          // Every view built from a punch, not just the dashboard: the day's
          // breakdown, the team's attendance table, an employee's own card, and
          // the joinee and probation tiles that sit in the same payload.
          qc.invalidateQueries({ queryKey: ["dashboard"] });
          qc.invalidateQueries({ queryKey: ["attendance"] });
          qc.invalidateQueries({ queryKey: ["team-attendance-range"] });
          // Listed separately because it has to be. React Query matches keys by
          // prefix on the array, and "attendance-insights" is a different first
          // element from "attendance" -- so the line above does not reach it,
          // however much it looks as though it should. The insights panel is
          // derived from the very punches this announcement is about (late
          // arrivals, missing punch-outs), so leaving it stale meant the numbers
          // beside it moved while it did not.
          qc.invalidateQueries({ queryKey: ["attendance-insights"] });
        });
      }
    });

    client.activate();
    return () => {
      // deactivate() rejects if activation is still in flight, which happens on a
      // fast unmount in development. Nothing to recover from — the client is being
      // thrown away either way.
      client.deactivate().catch(() => {});
    };
  }, [enabled, qc]);
}
