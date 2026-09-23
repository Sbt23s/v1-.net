import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import dayjs from "dayjs";
import { ChevronDown, ChevronRight, RotateCcw, Search } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { usePagedRows, TablePagination } from "@/components/ui/table-pagination";
import { apiMessage } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { privilegeKeys, privilegesApi, type ChangeLogEntry } from "@/lib/privileges";

const TYPE_LABEL: Record<ChangeLogEntry["changeType"], string> = {
  ROLE_PERMISSIONS: "Role privileges",
  USER_ROLES: "User roles",
  CONFIG: "Configuration"
};

function pretty(json?: string | null) {
  if (!json) return "—";
  try { return JSON.stringify(JSON.parse(json), null, 2); } catch { return json; }
}

/**
 * Every privilege and configuration change, newest first. Rollback restores
 * the "before" -- the server refuses when something newer has changed the
 * same target since, so an undo can never quietly discard a later edit.
 */
export function ChangeHistoryPanel({ historyReady }: { historyReady: boolean }) {
  const qc = useQueryClient();
  const { refreshUser } = useAuth();
  const history = useQuery({ queryKey: privilegeKeys.history, queryFn: privilegesApi.history, enabled: historyReady });
  const [query, setQuery] = useState("");
  const [type, setType] = useState("All");
  const [open, setOpen] = useState<number | null>(null);
  const [target, setTarget] = useState<ChangeLogEntry | null>(null);

  const rows = useMemo(() => (history.data ?? []).filter((e) => {
    if (type !== "All" && e.changeType !== type) return false;
    const q = query.trim().toLowerCase();
    return !q || `${e.summary ?? ""} ${e.targetLabel ?? ""} ${e.actorName ?? ""}`.toLowerCase().includes(q);
  }), [history.data, type, query]);
  const paged = usePagedRows(rows, 25, [type, query]);

  const rollback = useMutation({
    mutationFn: (id: number) => privilegesApi.rollback(id),
    onSuccess: async (res) => {
      setTarget(null);
      toast.success(res.summary);
      await qc.invalidateQueries({ queryKey: ["privileges"] });
      await qc.invalidateQueries({ queryKey: ["settings"] });
      await refreshUser();
    },
    onError: (err) => {
      setTarget(null);
      toast.error(apiMessage(err, "Could not roll back"), { duration: 7000 });
    }
  });

  if (!historyReady) {
    return <Card><CardContent className="p-6 text-sm text-muted-foreground">
      Change history becomes available once database migration V155 is applied.
    </CardContent></Card>;
  }

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search changes, targets or who made them" value={query}
                   onChange={(e) => setQuery(e.target.value)} />
          </div>
          <Select className="w-48" value={type} onChange={(e) => setType(e.target.value)} aria-label="Filter by type">
            <option value="All">All changes</option>
            {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </div>

        {history.isLoading ? (
          <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
        ) : history.isError ? (
          <p className="text-sm text-destructive">{apiMessage(history.error, "Could not load history")}</p>
        ) : rows.length === 0 ? (
          <p className="p-6 text-center text-xs text-muted-foreground">No changes recorded yet.</p>
        ) : (
          <div className="space-y-2">
            {paged.pageRows.map((e) => (
              <div key={e.id} className="rounded-lg border border-border">
                <div className="flex flex-wrap items-center gap-3 px-3 py-2">
                  <button type="button" onClick={() => setOpen(open === e.id ? null : e.id)}
                          aria-label={open === e.id ? "Hide details" : "Show details"} className="text-muted-foreground">
                    {open === e.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </button>
                  <span className="text-xs text-muted-foreground">#{e.id}</span>
                  <Badge variant="secondary">{TYPE_LABEL[e.changeType] ?? e.changeType}</Badge>
                  <span className="min-w-0 flex-1 text-sm">{e.summary}</span>
                  <span className="text-[11px] text-muted-foreground">
                    {e.actorName || "unknown"} · {dayjs(e.createdAt).format("DD MMM YYYY, h:mm A")}
                  </span>
                  {e.rolledBack ? (
                    <Badge variant="outline">Rolled back</Badge>
                  ) : (
                    <Button size="xs" variant="outline" onClick={() => setTarget(e)}>
                      <RotateCcw /> Roll back
                    </Button>
                  )}
                </div>
                {open === e.id && (
                  <div className="grid gap-2 border-t border-border p-3 md:grid-cols-2">
                    <div>
                      <p className="mb-1 text-[11px] font-bold uppercase text-muted-foreground">Before</p>
                      <pre className="max-h-64 overflow-auto rounded bg-muted/50 p-2 text-[11px]">{pretty(e.beforeJson)}</pre>
                    </div>
                    <div>
                      <p className="mb-1 text-[11px] font-bold uppercase text-muted-foreground">After</p>
                      <pre className="max-h-64 overflow-auto rounded bg-muted/50 p-2 text-[11px]">{pretty(e.afterJson)}</pre>
                    </div>
                  </div>
                )}
              </div>
            ))}
            <TablePagination page={paged.page} totalPages={paged.totalPages} onChange={paged.setPage}
                             pageSize={paged.pageSize} onPageSizeChange={paged.setPageSize} total={paged.total} />
          </div>
        )}
      </CardContent>

      <ConfirmDialog
        open={target !== null}
        title={`Roll back change #${target?.id}?`}
        description="Restores exactly what was there before this change. The rollback is itself recorded, and is refused if something newer has changed the same thing since."
        detail={target ? [["Change", target.summary ?? ""], ["Made by", target.actorName ?? "unknown"]] : []}
        confirmLabel="Roll back"
        cancelLabel="Cancel"
        busy={rollback.isPending}
        onConfirm={() => target && rollback.mutate(target.id)}
        onCancel={() => setTarget(null)}
      />
    </Card>
  );
}
