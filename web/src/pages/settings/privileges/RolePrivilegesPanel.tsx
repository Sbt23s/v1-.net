import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { Check, Copy, Lock, Search, ShieldAlert, Undo2, Users, Info } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { apiMessage } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import {
  diffCodes, privilegesApi, SUPER_ADMIN,
  type PrivilegeOverview, type RolePrivilege
} from "@/lib/privileges";

/**
 * One role at a time: which permission codes it grants, laid out by module
 * with the actions each code unlocks as columns. Edits are staged locally and
 * saved together after a confirmation that lists exactly what changes.
 */
export function RolePrivilegesPanel({ overview }: { overview: PrivilegeOverview }) {
  const qc = useQueryClient();
  const { user, refreshUser } = useAuth();
  const [roleId, setRoleId] = useState<number | null>(overview.roles[0]?.id ?? null);
  const [roleQuery, setRoleQuery] = useState("");
  const [permQuery, setPermQuery] = useState("");
  const [moduleFilter, setModuleFilter] = useState("All");
  const [grantedOnly, setGrantedOnly] = useState(false);
  const [draft, setDraft] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [copyFrom, setCopyFrom] = useState("");
  const [pendingRoleId, setPendingRoleId] = useState<number | null>(null);

  const role: RolePrivilege | undefined = overview.roles.find((r) => r.id === roleId);

  // A fresh draft whenever the role, or what the server says it holds, changes.
  useEffect(() => {
    setDraft(new Set(role?.permissions ?? []));
  }, [role?.id, role?.permissions.join(",")]);

  const locked = new Set(role?.lockedPermissions ?? []);
  const readOnly = !overview.historyReady
    || (role?.code === SUPER_ADMIN && !overview.actorIsSuperAdmin);
  const { added, removed } = diffCodes(role?.permissions ?? [], [...draft]);
  const dirty = added.length + removed.length > 0;

  const modules = useMemo(
    () => [...new Set(overview.permissions.map((p) => p.module))],
    [overview.permissions]
  );

  const visiblePerms = overview.permissions.filter((p) => {
    if (moduleFilter !== "All" && p.module !== moduleFilter) return false;
    if (grantedOnly && !draft.has(p.code)) return false;
    const q = permQuery.trim().toLowerCase();
    return !q || `${p.code} ${p.label} ${p.description} ${p.module}`.toLowerCase().includes(q);
  });
  const grouped = modules
    .map((m) => ({ module: m, perms: visiblePerms.filter((p) => p.module === m) }))
    .filter((g) => g.perms.length > 0);

  const filteredRoles = overview.roles.filter((r) => {
    const q = roleQuery.trim().toLowerCase();
    return !q || `${r.code} ${r.name}`.toLowerCase().includes(q);
  });

  const toggle = (code: string) => {
    if (readOnly || (locked.has(code) && draft.has(code))) return;
    setDraft((prev) => {
      const next = new Set(prev);
      next.has(code) ? next.delete(code) : next.add(code);
      return next;
    });
  };

  const setModule = (module: string, on: boolean) => {
    if (readOnly) return;
    setDraft((prev) => {
      const next = new Set(prev);
      overview.permissions.filter((p) => p.module === module).forEach((p) => {
        if (on) next.add(p.code);
        else if (!locked.has(p.code)) next.delete(p.code);
      });
      return next;
    });
  };

  const applyCopy = () => {
    const source = overview.roles.find((r) => String(r.id) === copyFrom);
    if (!source || readOnly) return;
    // Locked codes survive a copy: a copy is an edit like any other.
    setDraft(new Set([...source.permissions, ...[...locked].filter((c) => draft.has(c))]));
    toast.success(`Copied ${source.permissions.length} permissions from ${source.code}. Review, then save.`);
  };

  const save = useMutation({
    mutationFn: () => privilegesApi.setRolePermissions(role!.id, [...draft]),
    onSuccess: async (res) => {
      setConfirmOpen(false);
      toast.success(res.changeId ? `Saved. ${res.summary}` : res.summary);
      await qc.invalidateQueries({ queryKey: ["privileges"] });
      // The admin's own screens change at once if they hold this role.
      if (user?.roles?.includes(role!.code)) await refreshUser();
    },
    onError: (err) => toast.error(apiMessage(err, "Could not save the role"))
  });

  const label = (code: string) => overview.permissions.find((p) => p.code === code)?.label ?? code;

  return (
    <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
      {/* Role list */}
      <Card>
        <CardContent className="space-y-3 p-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search roles" value={roleQuery}
                   onChange={(e) => setRoleQuery(e.target.value)} />
          </div>
          <div className="max-h-[560px] space-y-1 overflow-y-auto">
            {filteredRoles.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => (dirty && r.id !== roleId ? setPendingRoleId(r.id) : setRoleId(r.id))}
                className={cn(
                  "flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors",
                  r.id === roleId ? "bg-primary text-primary-foreground" : "hover:bg-muted"
                )}
              >
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{r.code}</span>
                  {r.name !== r.code && <span className="block truncate text-[11px] opacity-80">{r.name}</span>}
                </span>
                <span className="flex shrink-0 items-center gap-1 text-[11px] opacity-80">
                  {r.isAdminRole && <Lock className="h-3 w-3" />}
                  <Users className="h-3 w-3" />{r.userCount}
                </span>
              </button>
            ))}
            {filteredRoles.length === 0 && <p className="p-3 text-xs text-muted-foreground">No roles match.</p>}
          </div>
        </CardContent>
      </Card>

      {/* Matrix */}
      {role ? (
        <Card>
          <CardContent className="space-y-4 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="font-display text-lg font-semibold">{role.code}</h3>
                <p className="text-xs text-muted-foreground">
                  {role.description || role.name} · {role.userCount} active user{role.userCount === 1 ? "" : "s"} · {draft.size} of {overview.permissions.length} permissions
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Select className="h-9 w-48 text-xs" value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)}
                        disabled={readOnly} aria-label="Copy permissions from role">
                  <option value="">Copy from role…</option>
                  {overview.roles.filter((r) => r.id !== role.id).map((r) => (
                    <option key={r.id} value={r.id}>{r.code}</option>
                  ))}
                </Select>
                <Button size="sm" variant="outline" disabled={!copyFrom || readOnly} onClick={applyCopy}>
                  <Copy /> Copy
                </Button>
              </div>
            </div>

            {role.code === SUPER_ADMIN && !overview.actorIsSuperAdmin && (
              <Notice tone="warning">Only a Super Admin can change the Super Admin role. Shown read-only.</Notice>
            )}
            {role.isAdminRole && role.lockedPermissions.length > 0 && (
              <Notice tone="info">
                <Lock className="inline h-3.5 w-3.5" /> {role.lockedPermissions.join(", ")} cannot be removed from {role.code},
                so administrators always keep the screens needed to repair access.
              </Notice>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[200px] flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input className="pl-9" placeholder="Search permissions or actions" value={permQuery}
                       onChange={(e) => setPermQuery(e.target.value)} />
              </div>
              <Select className="w-44" value={moduleFilter} onChange={(e) => setModuleFilter(e.target.value)}
                      aria-label="Filter by module">
                <option value="All">All modules</option>
                {modules.map((m) => <option key={m} value={m}>{m}</option>)}
              </Select>
              <label className="flex items-center gap-2 text-xs font-medium">
                <input type="checkbox" checked={grantedOnly} onChange={(e) => setGrantedOnly(e.target.checked)} />
                Granted only
              </label>
            </div>

            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[900px] text-sm">
                <thead className="bg-muted/50 text-[11px] uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="w-20 px-3 py-2 text-left">Grant</th>
                    <th className="px-3 py-2 text-left">Permission</th>
                    {overview.actions.map((a) => (
                      <th key={a} className="px-1 py-2 text-center font-semibold">{a}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {grouped.map((g) => {
                    const all = g.perms.every((p) => draft.has(p.code));
                    return [
                      <tr key={`h-${g.module}`} className="border-t border-border bg-muted/20">
                        <td colSpan={2 + overview.actions.length} className="px-3 py-1.5">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold">{g.module}</span>
                            {!readOnly && (
                              <Button size="xs" variant="tertiary" onClick={() => setModule(g.module, !all)}>
                                {all ? "Revoke module" : "Grant whole module"}
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>,
                      ...g.perms.map((p) => {
                        const on = draft.has(p.code);
                        const changed = on !== (role.permissions.includes(p.code));
                        const isLocked = locked.has(p.code) && on;
                        return (
                          <tr key={p.code} className={cn("border-t border-border", changed && "bg-amber-50 dark:bg-amber-500/10")}>
                            <td className="px-3 py-2">
                              <button
                                type="button"
                                role="switch"
                                aria-checked={on}
                                aria-label={`${on ? "Revoke" : "Grant"} ${p.code}`}
                                disabled={readOnly || isLocked}
                                onClick={() => toggle(p.code)}
                                className={cn(
                                  "relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                                  on ? "bg-primary" : "bg-muted-foreground/30"
                                )}
                              >
                                <span className={cn("inline-block h-4 w-4 rounded-full bg-white shadow transition-transform",
                                  on ? "translate-x-4" : "translate-x-0.5")} />
                              </button>
                            </td>
                            <td className="px-3 py-2">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="font-medium">{p.label}</span>
                                <code className="text-[10px] text-muted-foreground">{p.code}</code>
                                {isLocked && <Badge variant="secondary"><Lock className="mr-1 h-3 w-3" />Locked</Badge>}
                                {p.critical && <Badge variant="warning">Critical</Badge>}
                                {!p.enforced && <Badge variant="outline">Not enforced</Badge>}
                              </div>
                              <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{p.description}</p>
                            </td>
                            {overview.actions.map((a) => (
                              <td key={a} className="px-1 py-2 text-center">
                                {p.actions.includes(a) && (
                                  <Check className={cn("mx-auto h-4 w-4", on ? "text-primary" : "text-muted-foreground/30")} />
                                )}
                              </td>
                            ))}
                          </tr>
                        );
                      })
                    ];
                  })}
                  {grouped.length === 0 && (
                    <tr><td colSpan={2 + overview.actions.length} className="p-6 text-center text-xs text-muted-foreground">
                      No permissions match these filters.
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>

            <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Ticks show which actions a permission unlocks. Saving takes effect on the server immediately for every
              user in this role; their screens update the next time they open or return to the portal.
            </p>

            {dirty && (
              <div className="sticky bottom-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 shadow-lg dark:border-amber-700 dark:bg-amber-950/60">
                <span className="text-sm">
                  <strong>{added.length + removed.length} unsaved change{added.length + removed.length === 1 ? "" : "s"}</strong>
                  {added.length > 0 && <span className="ml-2 text-emerald-700 dark:text-emerald-300">+{added.length} granted</span>}
                  {removed.length > 0 && <span className="ml-2 text-rose-700 dark:text-rose-300">−{removed.length} revoked</span>}
                </span>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setDraft(new Set(role.permissions))}>
                    <Undo2 /> Discard
                  </Button>
                  <Button size="sm" onClick={() => setConfirmOpen(true)}>Review & save</Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">Select a role.</CardContent></Card>
      )}

      <ConfirmDialog
        open={pendingRoleId !== null}
        title="Discard unsaved changes?"
        description={`Your changes to ${role?.code} have not been saved.`}
        confirmLabel="Discard and switch"
        cancelLabel="Keep editing"
        onConfirm={() => { setRoleId(pendingRoleId); setPendingRoleId(null); }}
        onCancel={() => setPendingRoleId(null)}
      />

      <ConfirmDialog
        open={confirmOpen}
        title={`Save privileges for ${role?.code}?`}
        description={`This applies at once to ${role?.userCount ?? 0} active user(s) holding this role. It is recorded in Change History and can be rolled back.`}
        detail={[
          ...added.map((c): [string, string] => ["Grant", `${label(c)} (${c})`]),
          ...removed.map((c): [string, string] => ["Revoke", `${label(c)} (${c})`])
        ]}
        confirmLabel="Save changes"
        cancelLabel="Keep editing"
        busy={save.isPending}
        onConfirm={() => save.mutate()}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}

export function Notice({ tone, children }: { tone: "info" | "warning" | "danger"; children: React.ReactNode }) {
  const cls = {
    info: "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-200",
    warning: "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200",
    danger: "border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200"
  }[tone];
  return (
    <div className={cn("flex items-start gap-2 rounded-lg border px-3 py-2 text-xs", cls)}>
      {tone !== "info" && <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />}
      <div>{children}</div>
    </div>
  );
}
