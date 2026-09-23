import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { History, KeyRound, ShieldCheck, Users } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { apiMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import { privilegeKeys, privilegesApi } from "@/lib/privileges";
import { RolePrivilegesPanel, Notice } from "@/pages/settings/privileges/RolePrivilegesPanel";
import { UserRolesPanel } from "@/pages/settings/privileges/UserRolesPanel";
import { ChangeHistoryPanel } from "@/pages/settings/privileges/ChangeHistoryPanel";

type View = "roles" | "users" | "history";

const VIEWS: { key: View; label: string; icon: typeof ShieldCheck; hint: string }[] = [
  { key: "roles", label: "Role Privileges", icon: KeyRound, hint: "What each role may do, module by module" },
  { key: "users", label: "User Roles", icon: Users, hint: "Who holds which role, with bulk changes" },
  { key: "history", label: "Change History", icon: History, hint: "Every change, with rollback" }
];

/**
 * Admin Settings -> Privileges. Edits the permission codes the backend
 * enforces on every request, so a change here is a change to what the API
 * answers -- not just to what the menu shows.
 */
export function SettingsPrivilegesTab() {
  const [view, setView] = useState<View>("roles");
  const overview = useQuery({ queryKey: privilegeKeys.overview, queryFn: privilegesApi.overview });

  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-3">
        {VIEWS.map((v) => {
          const Icon = v.icon;
          return (
            <button key={v.key} type="button" onClick={() => setView(v.key)}
                    className={cn(
                      "flex items-start gap-3 rounded-xl border p-3 text-left transition-colors",
                      view === v.key ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"
                    )}>
              <Icon className={cn("mt-0.5 h-5 w-5", view === v.key ? "text-primary" : "text-muted-foreground")} />
              <span>
                <span className="block text-sm font-semibold">{v.label}</span>
                <span className="block text-[11px] text-muted-foreground">{v.hint}</span>
              </span>
            </button>
          );
        })}
      </div>

      {overview.data && !overview.data.historyReady && (
        <Notice tone="warning">
          Read-only: database migration <code>V155__privilege_change_log.sql</code> has not been applied yet.
          Changes are disabled until it is, so that every change can be audited and rolled back.
        </Notice>
      )}

      {overview.isLoading ? (
        <Card><CardContent className="space-y-2 p-4">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
        </CardContent></Card>
      ) : overview.isError || !overview.data ? (
        <Card><CardContent className="p-6 text-sm text-destructive">
          {apiMessage(overview.error, "Could not load privileges")}
        </CardContent></Card>
      ) : view === "roles" ? (
        <RolePrivilegesPanel overview={overview.data} />
      ) : view === "users" ? (
        <UserRolesPanel overview={overview.data} />
      ) : (
        <ChangeHistoryPanel historyReady={overview.data.historyReady} />
      )}
    </div>
  );
}
