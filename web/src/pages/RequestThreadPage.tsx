import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, CalendarDays, Clock, User as UserIcon, FileText } from "lucide-react";
import dayjs from "dayjs";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RequestThread } from "@/components/RequestThread";
import { ErrorState } from "@/components/ErrorState";
import { PixousPanelLoader } from "@/components/ui/pixous-loader";
import type { ApiEnvelope } from "@/types";

interface RequestSummary {
  type: string;
  id: number;
  reference: string;
  employeeName: string | null;
  employeeCode: string | null;
  requestedToName: string | null;
  status: string | null;
  detail: string | null;
  fromDate: string | null;
  toDate: string | null;
  reason: string | null;
  createdAt: string | null;
}

/** The status colours the rest of the portal uses, so a badge means the same thing here. */
function statusTone(status?: string | null) {
  switch ((status || "").toUpperCase()) {
    case "APPROVED": return "success" as const;
    case "REJECTED": return "destructive" as const;
    case "CANCELLED": return "secondary" as const;
    default: return "warning" as const;
  }
}

/**
 * One conversation, on its own page.
 *
 * <p>A comment notification used to send both sides to /leave/approvals --
 * an approver-only screen. So when an approver replied, the applicant was
 * shown "Restricted" instead of the message written to them. Half of these
 * notifications were a dead end.
 *
 * <p>This page is addressed by the request itself, so it opens for whoever is
 * allowed to read that request: the person who raised it, the person it was
 * sent to, and HR. It leads with what the request is -- the kind, whose it is,
 * the dates, where it has got to -- because arriving at a bare conversation
 * with no idea which request it belongs to is only half a link.
 */
export default function RequestThreadPage() {
  const { type = "", id = "" } = useParams();
  const navigate = useNavigate();
  const requestId = Number(id);
  const kind = type.toUpperCase() === "PERMISSION" ? "PERMISSION" : "LEAVE";

  const summary = useQuery({
    queryKey: ["request-summary", kind, requestId],
    enabled: Number.isFinite(requestId) && requestId > 0,
    retry: false,
    queryFn: async () =>
      (await api.get<ApiEnvelope<RequestSummary>>(
        `/requests/${kind.toLowerCase()}/${requestId}/summary`)).data.data
  });

  const s = summary.data;
  const label = kind === "LEAVE" ? "Leave request" : "Permission request";

  return (
    <div className="space-y-4">
      <PageHeader
        title={label}
        subtitle="The full conversation, and the request it belongs to."
        actions={
          <Button variant="secondary" size="sm" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
        }
      />

      {summary.isLoading ? (
        <PixousPanelLoader label="Opening this request…" />
      ) : summary.isError ? (
        <ErrorState
          title="This request could not be opened"
          description="It may have been withdrawn, or it may not be yours to read."
          onRetry={() => summary.refetch()}
        />
      ) : s ? (
        <>
          <Card>
            <CardContent className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    {/* Where this came from, said plainly -- it is the thing
                        the notification could not tell you. */}
                    <Badge className="uppercase tracking-wide">{label}</Badge>
                    <span className="font-mono text-xs text-muted-foreground">{s.reference}</span>
                    {s.status && <Badge variant={statusTone(s.status)}>{s.status}</Badge>}
                  </div>
                  <h2 className="mt-2 font-display text-xl font-bold text-foreground">
                    {s.employeeName || "—"}
                    {s.employeeCode && (
                      <span className="ml-2 font-mono text-sm font-normal text-muted-foreground">
                        {s.employeeCode}
                      </span>
                    )}
                  </h2>
                </div>
              </div>

              <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Field icon={FileText} label={kind === "LEAVE" ? "Leave type" : "Hours"}>
                  {s.detail || "—"}
                </Field>
                <Field icon={CalendarDays} label="Dates">
                  {s.fromDate
                    ? s.fromDate === s.toDate
                      ? dayjs(s.fromDate).format("DD MMM YYYY")
                      : `${dayjs(s.fromDate).format("DD MMM")} – ${dayjs(s.toDate).format("DD MMM YYYY")}`
                    : "—"}
                </Field>
                <Field icon={UserIcon} label="Sent to">{s.requestedToName || "—"}</Field>
                <Field icon={Clock} label="Applied on">
                  {s.createdAt ? dayjs(s.createdAt).format("DD MMM YYYY, h:mm A") : "—"}
                </Field>
              </dl>

              {s.reason && (
                <div className="mt-4 rounded-[10px] border border-border bg-muted/40 p-3">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Reason given
                  </div>
                  <p className="mt-1 text-sm text-foreground">{s.reason}</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-5">
              <h3 className="mb-3 font-display font-semibold text-foreground">Conversation</h3>
              {/* The existing thread, unchanged: it already shows who wrote
                  each comment and when, and it already knows how to post. */}
              <RequestThread type={kind as "LEAVE" | "PERMISSION"} requestId={requestId} />
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}

function Field({
  icon: Icon, label, children
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3.5 w-3.5" /> {label}
      </dt>
      <dd className="mt-1 text-sm font-medium text-foreground">{children}</dd>
    </div>
  );
}
