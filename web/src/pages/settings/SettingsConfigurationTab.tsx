import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import type { AxiosError } from "axios";
import { RotateCcw, Save, Undo2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { apiMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import { privilegeKeys, privilegesApi, type ConfigItem } from "@/lib/privileges";
import { Notice } from "@/pages/settings/privileges/RolePrivilegesPanel";

/** The same checks the server makes, so a bad value is flagged before Save. */
function validate(item: ConfigItem, value: string): string | null {
  const v = value.trim();
  switch (item.type) {
    case "Boolean": return v === "true" || v === "false" ? null : "Must be on or off";
    case "Time": return /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? null : "Use 24-hour time, e.g. 09:30";
    case "Integer":
    case "Decimal": {
      if (v === "" || Number.isNaN(Number(v))) return "Must be a number";
      if (item.type === "Integer" && !Number.isInteger(Number(v))) return "Must be a whole number";
      const n = Number(v);
      if ((item.min != null && n < item.min) || (item.max != null && n > item.max)) {
        return `Between ${item.min} and ${item.max}`;
      }
      return null;
    }
  }
}

/**
 * Settings the modules actually read -- task and work-report reminder
 * schedules, chat retention, claim KM rates. Every value is validated on both
 * sides, recorded in Change History and can be rolled back from there.
 */
export function SettingsConfigurationTab() {
  const qc = useQueryClient();
  const config = useQuery({ queryKey: privilegeKeys.config, queryFn: privilegesApi.configuration });
  const overview = useQuery({ queryKey: privilegeKeys.overview, queryFn: privilegesApi.overview });
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    if (config.data) setDraft(Object.fromEntries(config.data.map((c) => [c.key, c.value])));
  }, [config.data]);

  const items = config.data ?? [];
  const groups = useMemo(() => [...new Set(items.map((i) => i.group))], [items]);
  const changed = items.filter((i) => (draft[i.key] ?? i.value) !== i.value);
  const errors = Object.fromEntries(items
    .map((i) => [i.key, validate(i, draft[i.key] ?? i.value)] as const)
    .filter(([, e]) => e)) as Record<string, string>;
  const hasErrors = changed.some((i) => errors[i.key]);
  const ready = overview.data?.historyReady ?? false;

  const save = useMutation({
    mutationFn: () => privilegesApi.saveConfiguration(
      Object.fromEntries(changed.map((i) => [i.key, draft[i.key].trim()]))),
    onSuccess: async (res) => {
      setConfirmOpen(false);
      setServerErrors({});
      toast.success(res.summary);
      await qc.invalidateQueries({ queryKey: ["privileges"] });
      // The claim form reads the KM rates through this query.
      await qc.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (err) => {
      setConfirmOpen(false);
      const fields = (err as AxiosError<{ errors?: Record<string, string> }>)?.response?.data?.errors;
      if (fields && typeof fields === "object") setServerErrors(fields);
      toast.error(apiMessage(err, "Could not save configuration"));
    }
  });

  if (config.isLoading) {
    return <Card><CardContent className="space-y-2 p-4">
      {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
    </CardContent></Card>;
  }
  if (config.isError) {
    return <Card><CardContent className="p-6 text-sm text-destructive">
      {apiMessage(config.error, "Could not load configuration")}
    </CardContent></Card>;
  }

  const set = (key: string, value: string) => setDraft((d) => ({ ...d, [key]: value }));

  return (
    <div className="space-y-4">
      {!ready && (
        <Notice tone="warning">
          Read-only until database migration <code>V155__privilege_change_log.sql</code> is applied.
        </Notice>
      )}

      {groups.map((g) => (
        <Card key={g}>
          <CardContent className="p-4">
            <h3 className="mb-3 font-display text-base font-semibold">{g}</h3>
            <div className="divide-y divide-border">
              {items.filter((i) => i.group === g).map((i) => {
                const value = draft[i.key] ?? i.value;
                const err = (value !== i.value && errors[i.key]) || serverErrors[i.key];
                return (
                  <div key={i.key} className={cn("grid gap-2 py-3 sm:grid-cols-[1fr_240px] sm:items-center",
                    value !== i.value && "rounded-md bg-amber-50/60 px-2 dark:bg-amber-500/10")}>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">{i.label}</span>
                        {!i.stored && <Badge variant="outline">Default</Badge>}
                      </div>
                      <p className="text-[11px] text-muted-foreground">{i.description}</p>
                      <code className="text-[10px] text-muted-foreground">{i.key}</code>
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        {i.type === "Boolean" ? (
                          <button type="button" role="switch" aria-checked={value === "true"} aria-label={i.label}
                                  disabled={!ready} onClick={() => set(i.key, value === "true" ? "false" : "true")}
                                  className={cn("relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-60",
                                    value === "true" ? "bg-primary" : "bg-muted-foreground/30")}>
                            <span className={cn("inline-block h-5 w-5 rounded-full bg-white shadow transition-transform",
                              value === "true" ? "translate-x-5" : "translate-x-0.5")} />
                          </button>
                        ) : (
                          <Input
                            type={i.type === "Time" ? "time" : "number"}
                            step={i.type === "Decimal" ? "0.01" : "1"}
                            min={i.min ?? undefined} max={i.max ?? undefined}
                            value={value} disabled={!ready} aria-label={i.label}
                            onChange={(e) => set(i.key, e.target.value)}
                            className={cn(err && "border-destructive")}
                          />
                        )}
                        {value !== i.defaultValue && ready && (
                          <Button size="xs" variant="ghost" title={`Reset to default (${i.defaultValue})`}
                                  onClick={() => set(i.key, i.defaultValue)}>
                            <RotateCcw />
                          </Button>
                        )}
                      </div>
                      {err && <p className="mt-1 text-[11px] text-destructive">{err}</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      ))}

      {changed.length > 0 && (
        <div className="sticky bottom-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 shadow-lg dark:border-amber-700 dark:bg-amber-950/60">
          <span className="text-sm font-semibold">{changed.length} unsaved change{changed.length === 1 ? "" : "s"}</span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => { setDraft(Object.fromEntries(items.map((c) => [c.key, c.value]))); setServerErrors({}); }}>
              <Undo2 /> Discard
            </Button>
            <Button size="sm" disabled={hasErrors || !ready} onClick={() => setConfirmOpen(true)}>
              <Save /> Review & save
            </Button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title="Save configuration?"
        description="Takes effect immediately. Recorded in Privileges → Change History, where it can be rolled back."
        detail={changed.map((i): [string, string] => [i.label, `${i.value} → ${draft[i.key].trim()}`])}
        confirmLabel="Save"
        cancelLabel="Keep editing"
        busy={save.isPending}
        onConfirm={() => save.mutate()}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
