import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Client } from "@stomp/stompjs";
import SockJS from "sockjs-client";
import { tokenStore } from "@/lib/api";

const BASE = import.meta.env.VITE_API_URL || "";

/** One employee the run could not calculate, and why. */
export interface PayrollFailure {
  userId: number;
  name: string;
  employeeCode: string;
  reason: string;
}

export interface PayrollProgress {
  runId?: number;
  done: number;
  total: number;
  failed: number;
  /** Whose payslip was just finished — the name under the counter. */
  current?: string;
  finished: boolean;
  failures?: PayrollFailure[];
}

/**
 * Watches a payroll run as it happens.
 *
 * <p>Generating thirty payslips takes long enough that a request which returns
 * only at the end looks like a page that has hung. The server announces each
 * one on `/topic/payroll`, and this turns that into a counter.
 *
 * <p>The frames carry counts and, at the end, the names that failed — no
 * salary figures. Anybody who can watch a run can already see the payroll
 * table, and a count is not worth a second authorisation model.
 *
 * <p>Nothing here is load-bearing. If the socket cannot connect the run still
 * completes and the request still returns its result; what is lost is the
 * counting, not the payroll. So there is no error state to show.
 */
export function usePayrollProgress(enabled: boolean = true) {
  const qc = useQueryClient();
  const [progress, setProgress] = useState<PayrollProgress | null>(null);

  useEffect(() => {
    if (!enabled || !tokenStore.access) return;

    const client = new Client({
      webSocketFactory: () => new SockJS(`${BASE}/ws`),
      connectHeaders: { Authorization: `Bearer ${tokenStore.access}` },
      reconnectDelay: 5000,
      onStompError: () => {},
      onWebSocketError: () => {},
      onConnect: () => {
        client.subscribe("/topic/payroll", (msg) => {
          try {
            const body = JSON.parse(msg.body) as PayrollProgress;
            setProgress(body);
            // The run has written payslips, so anything showing them is stale.
            if (body.finished) {
              qc.invalidateQueries({ queryKey: ["payroll"] });
              qc.invalidateQueries({ queryKey: ["payslips"] });
            }
          } catch {
            // A frame we cannot read is a frame we ignore. The run is not ours
            // to interrupt over a parse error.
          }
        });
      },
    });

    client.activate();
    return () => { client.deactivate().catch(() => {}); };
  }, [enabled, qc]);

  return { progress, reset: () => setProgress(null) };
}
