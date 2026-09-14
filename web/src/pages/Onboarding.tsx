import { PixousLoader } from "@/components/ui/pixous-loader";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import {
  Search, ClipboardList, CheckCircle2, Circle, PlayCircle, UserCheck
} from "lucide-react";
import toast from "react-hot-toast";
import { api, apiMessage } from "@/lib/api";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import type {
  ApiEnvelope, PageEnvelope, UserSummary, OnboardingChecklistResponse
} from "@/types";
import dayjs from "dayjs";

export default function OnboardingPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission("USER_MANAGE");
  const [q, setQ] = useState("");
  /*
    The box updates as you type; the request waits until you stop.

    q is part of the query key below, so every keystroke was a new key and a
    new call to /users -- six requests to type a name, five of them answers
    nobody reads.
  */
  const dq = useDebouncedValue(q);
  const [selected, setSelected] = useState<UserSummary | null>(null);

  const directory = useQuery({
    queryKey: ["onboarding-employees", dq],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const params = new URLSearchParams({ page: "0", size: "50" });
      if (dq) params.set("q", dq);
      const res = await api.get<ApiEnvelope<PageEnvelope<UserSummary>>>(
        `/users?${params.toString()}`
      );
      return res.data.data;
    }
  });

  // Onboarding covers off-boarded employees — the ones we want to (re)onboard.
  const onboardableUsers = directory.data?.content.filter(u => u.profileStatus === "OFFBOARDED") ?? [];

  return (
    <div>
      <PageHeader
        title="Onboarding"
        subtitle="New-joiner checklists — start an induction, then track and complete each step."
      />

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        {/* Employee picker */}
        <Card>
          <CardContent className="p-3">
            <div className="relative mb-3">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search employees…"
                className="pl-9 pr-9"
              />
              {/* The debounce means a quiet quarter-second between the last
                  keystroke and the new rows; this says the wait is deliberate. */}
              {(directory.isFetching || q !== dq) && (
                <span className="absolute right-3 top-1/2 -translate-y-1/2">
                  <PixousLoader size="xs" />
                </span>
              )}
            </div>

            <div className="max-h-[65vh] space-y-1 overflow-y-auto">
              {directory.isLoading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))
              ) : onboardableUsers.length === 0 ? (
                <p className="px-2 py-6 text-center text-sm text-muted-foreground">
                  No employees found.
                </p>
              ) : (
                onboardableUsers.map((u) => (
                  <button
                    key={u.id}
                    onClick={() => setSelected(u)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-colors",
                      selected?.id === u.id ? "bg-primary/10" : "hover:bg-muted"
                    )}
                  >
                    <Avatar name={u.name} src={u.photoPath} />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{u.name}</div>
                      <div className="code-chip truncate text-[11px] text-muted-foreground">
                        {u.employeeCode}
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        {/* Detail */}
        <div>
          {selected ? (
            <OnboardingDetail user={selected} canManage={canManage} />
          ) : (
            <EmptyState
              icon={ClipboardList}
              title="Select an employee"
              description="Pick someone from the list to view or start their onboarding checklist."
            />
          )}
        </div>
      </div>
    </div>
  );
}

function OnboardingDetail({
  user,
  canManage
}: {
  user: UserSummary;
  canManage: boolean;
}) {
  const queryClient = useQueryClient();

  const checklist = useQuery({
    queryKey: ["onboarding", user.id],
    retry: false,
    queryFn: async () =>
      (await api.get<ApiEnvelope<OnboardingChecklistResponse>>(`/onboarding/${user.id}`))
        .data.data
  });

  const startMutation = useMutation({
    mutationFn: async () => {
      await api.post(`/onboarding/${user.id}/start`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["onboarding", user.id] });
      toast.success("Onboarding started");
    },
    onError: (err) => toast.error(apiMessage(err, "Could not start onboarding"))
  });

  const completeMutation = useMutation({
    mutationFn: async (taskId: number) => {
      await api.post(`/onboarding/${user.id}/tasks/${taskId}/complete`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["onboarding", user.id] });
      toast.success("Task completed");
    },
    onError: (err) => toast.error(apiMessage(err, "Could not update task"))
  });

  const data = checklist.data;
  const { done, total, pct } = useMemo(() => {
    const tasks = data?.tasks ?? [];
    const d = tasks.filter((t) => t.isCompleted).length;
    const t = tasks.length;
    return { done: d, total: t, pct: t === 0 ? 0 : Math.round((d / t) * 100) };
  }, [data]);

  if (checklist.isLoading) {
    return (
      <Card>
        <CardContent className="space-y-3 p-5">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-2 w-full" />
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  // No checklist yet (backend returns an error when none exists).
  if (checklist.isError || !data) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-accent/20">
            <UserCheck className="h-6 w-6 text-primary" />
          </div>
          <h2 className="font-display text-lg font-semibold">
            No onboarding checklist for {user.name}
          </h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Start the induction to generate the standard checklist of joining tasks.
          </p>
          {canManage && (
            <Button
              className="mt-5"
              onClick={() => startMutation.mutate()}
              disabled={startMutation.isPending}
            >
              {startMutation.isPending ? (
                <PixousLoader size="xs" />
              ) : (
                <PlayCircle className="h-4 w-4" />
              )}
              Start onboarding
            </Button>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-display text-lg font-semibold">{user.name}</h2>
              <Badge variant={data.status === "COMPLETED" ? "default" : "secondary"}>
                {data.status}
              </Badge>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Started {data.startedAt ? dayjs(data.startedAt).format("DD MMM YYYY") : "—"}
              {data.completedAt && ` · Completed ${dayjs(data.completedAt).format("DD MMM YYYY")}`}
            </p>
          </div>
          <div className="text-right">
            <div className="font-display text-2xl font-bold text-primary">{pct}%</div>
            <div className="text-xs text-muted-foreground">{done} of {total} done</div>
          </div>
        </div>

        {/* Progress bar */}
        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>

        {/* Tasks */}
        <div className="mt-5 space-y-2">
          {data.tasks.length === 0 ? (
            <p className="text-sm text-muted-foreground">No tasks on this checklist.</p>
          ) : (
            data.tasks.map((task) => (
              <div
                key={task.id}
                className={cn(
                  "flex items-start gap-3 rounded-lg border p-3",
                  task.isCompleted && "bg-muted/40"
                )}
              >
                {task.isCompleted ? (
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-600" />
                ) : (
                  <Circle className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
                )}
                <div className="min-w-0 flex-1">
                  <div className={cn("text-sm font-medium", task.isCompleted && "text-muted-foreground line-through")}>
                    {task.taskName}
                  </div>
                  {task.description && (
                    <div className="text-xs text-muted-foreground">{task.description}</div>
                  )}
                  {task.isCompleted && task.completedAt && (
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      Completed {dayjs(task.completedAt).format("DD MMM, h:mm A")}
                    </div>
                  )}
                </div>
                {!task.isCompleted && canManage && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => completeMutation.mutate(task.id)}
                    disabled={completeMutation.isPending}
                  >
                    Mark done
                  </Button>
                )}
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}
