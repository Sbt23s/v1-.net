import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { MessageSquare, Search, FilterX } from "lucide-react";
import dayjs from "dayjs";
import { api } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { PixousPanelLoader } from "@/components/ui/pixous-loader";
import { usePagedRows, TablePagination } from "@/components/ui/table-pagination";
import type { ApiEnvelope } from "@/types";

interface InboxComment {
  id: number;
  requestType: string;
  requestId: number;
  reference: string;
  authorName: string | null;
  authorCode: string | null;
  message: string;
  attachmentUrl: string | null;
  employeeName: string | null;
  status: string | null;
  fromDate: string | null;
  toDate: string | null;
  createdAt: string | null;
}

function statusTone(status?: string | null) {
  switch ((status || "").toUpperCase()) {
    case "APPROVED": return "success" as const;
    case "REJECTED": return "destructive" as const;
    case "CANCELLED": return "secondary" as const;
    default: return "warning" as const;
  }
}

/**
 * Every comment written to you, wherever it came from.
 *
 * <p>A comment notification tells you something was said and takes you to the
 * one request it was about. This is the other half: all of them in one place,
 * so a notification dismissed or missed is not a message lost.
 *
 * <p>Each entry carries its own context -- which request, whose, and who wrote
 * it -- because in a single list there is no surrounding page to say so.
 * Clicking one opens that request's full thread.
 */
export function CommentsInbox() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<"ALL" | "LEAVE" | "PERMISSION">("ALL");

  const inbox = useQuery({
    queryKey: ["comments", "inbox"],
    queryFn: async () =>
      (await api.get<ApiEnvelope<InboxComment[]>>("/requests/comments/inbox")).data.data ?? []
  });

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (inbox.data ?? []).filter((c) => {
      if (kind !== "ALL" && c.requestType !== kind) return false;
      if (!needle) return true;
      const hay = c.message + " " + (c.authorName ?? "") + " "
        + (c.employeeName ?? "") + " " + c.reference;
      return hay.toLowerCase().includes(needle);
    });
  }, [inbox.data, q, kind]);

  const paged = usePagedRows(rows, 15, [q, kind, inbox.data]);

  const counts = useMemo(() => {
    const all = inbox.data ?? [];
    return {
      ALL: all.length,
      LEAVE: all.filter((c) => c.requestType === "LEAVE").length,
      PERMISSION: all.filter((c) => c.requestType === "PERMISSION").length
    };
  }, [inbox.data]);

  const filtered = q.trim().length > 0 || kind !== "ALL";
  const clear = () => { setQ(""); setKind("ALL"); };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card/60 p-2.5 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[15rem] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="h-[38px] w-full border-transparent bg-muted/40 pl-9 focus-visible:border-input focus-visible:bg-background"
              placeholder="Search the message, who wrote it, or the reference..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Search comments"
            />
          </div>

          {/* Where it came from -- the question this page exists to answer. */}
          <div className="flex gap-1 rounded-lg border border-border bg-muted/40 p-1">
            {([["ALL", "All"], ["LEAVE", "Leave"], ["PERMISSION", "Permission"]] as const).map(
              ([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  className={
                    "rounded-md px-3 py-1.5 text-xs font-semibold transition-colors " +
                    (kind === k
                      ? "bg-card text-primary shadow-sm"
                      : "text-muted-foreground hover:text-foreground")
                  }
                >
                  {label} ({counts[k]})
                </button>
              )
            )}
          </div>

          {filtered && (
            <button
              type="button"
              onClick={clear}
              className="inline-flex h-[38px] items-center gap-1.5 rounded-lg px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <FilterX className="h-3.5 w-3.5" /> Clear
            </button>
          )}
        </div>
      </div>

      {inbox.isLoading ? (
        <PixousPanelLoader label="Loading your comments..." />
      ) : inbox.isError ? (
        <ErrorState title="Your comments could not be loaded" onRetry={() => inbox.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={MessageSquare}
          title={filtered ? "No comments match those filters" : "No comments yet"}
          description={
            filtered
              ? "Try a different search, or clear the filters."
              : "When somebody comments on one of your requests, it will appear here."
          }
          actionLabel={filtered ? "Clear filters" : undefined}
          onAction={filtered ? clear : undefined}
        />
      ) : (
        <>
          <div className="space-y-2.5">
            {paged.pageRows.map((c) => (
              <Card
                key={c.requestType + "-" + c.id}
                className="cursor-pointer transition-colors hover:border-primary/40 hover:bg-muted/40"
                onClick={() =>
                  navigate("/requests/" + c.requestType.toLowerCase() + "/" + c.requestId + "/thread")
                }
              >
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <Avatar name={c.authorName || "?"} className="h-9 w-9 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-foreground">
                          {c.authorName || "Someone"}
                        </span>
                        {/* Where it came from, on every row. */}
                        <Badge variant="secondary" className="uppercase tracking-wide">
                          {c.requestType === "LEAVE" ? "Leave" : "Permission"}
                        </Badge>
                        <span className="font-mono text-[11px] text-muted-foreground">
                          {c.reference}
                        </span>
                        {c.status && <Badge variant={statusTone(c.status)}>{c.status}</Badge>}
                        <span className="ml-auto text-[11px] text-muted-foreground">
                          {c.createdAt ? dayjs(c.createdAt).format("DD MMM YYYY, h:mm A") : ""}
                        </span>
                      </div>

                      {/* The whole comment, not a preview: the notification
                          already gave them the first ninety characters. */}
                      <p className="mt-1.5 whitespace-pre-wrap text-sm text-foreground">
                        {c.message}
                      </p>

                      <div className="mt-2 text-[11px] text-muted-foreground">
                        On {c.employeeName || "-"} &middot; request {c.reference}
                        {c.fromDate
                          ? " · " + (c.fromDate === c.toDate
                            ? dayjs(c.fromDate).format("DD MMM YYYY")
                            : dayjs(c.fromDate).format("DD MMM") + " - "
                              + dayjs(c.toDate).format("DD MMM YYYY"))
                          : ""}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
          <TablePagination
            page={paged.page}
            totalPages={paged.totalPages}
            onChange={paged.setPage}
            pageSize={paged.pageSize}
            onPageSizeChange={paged.setPageSize}
            total={paged.total}
          />
        </>
      )}
    </div>
  );
}
