import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { Search, UserMinus, UserPlus, X } from "lucide-react";
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
import { cn } from "@/lib/utils";
import {
  ADMIN_ROLES, privilegeKeys, privilegesApi, type PrivilegeOverview, type UserPrivilege
} from "@/lib/privileges";

type Mode = "add" | "remove";

/**
 * Who holds which role, with bulk add and remove. The server refuses anything
 * that would lock an admin out -- removing your own admin role, removing the
 * last active Super Admin, or a Company Admin handing out admin roles -- and
 * the reason comes back in the error toast.
 */
export function UserRolesPanel({ overview }: { overview: PrivilegeOverview }) {
  const qc = useQueryClient();
  const { user, refreshUser } = useAuth();
  const users = useQuery({ queryKey: privilegeKeys.users, queryFn: privilegesApi.users });

  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("All");
  const [status, setStatus] = useState<"active" | "disabled" | "all">("active");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [mode, setMode] = useState<Mode>("add");
  const [bulkRole, setBulkRole] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);

  const rows = useMemo(() => (users.data ?? []).filter((u) => {
    if (status === "active" && !u.enabled) return false;
    if (status === "disabled" && u.enabled) return false;
    if (roleFilter === "__none" && u.roles.length > 0) return false;
    if (roleFilter !== "All" && roleFilter !== "__none" && !u.roles.includes(roleFilter)) return false;
    const q = query.trim().toLowerCase();
    return !q || `${u.name} ${u.employeeCode ?? ""} ${u.username ?? ""}`.toLowerCase().includes(q);
  }), [users.data, status, roleFilter, query]);

  const paged = usePagedRows(rows, 25, [query, roleFilter, status]);

  const allFilteredSelected = rows.length > 0 && rows.every((u) => selected.has(u.id));
  const toggleAll = () => setSelected((prev) => {
    const next = new Set(prev);
    if (allFilteredSelected) rows.forEach((u) => next.delete(u.id));
    else rows.forEach((u) => next.add(u.id));
    return next;
  });
  const toggle = (id: number) => setSelected((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const assignable = overview.roles.filter((r) => overview.actorIsSuperAdmin || !ADMIN_ROLES.includes(r.code));
  const chosen: UserPrivilege[] = (users.data ?? []).filter((u) => selected.has(u.id));
  const affected = chosen.filter((u) => (mode === "add" ? !u.roles.includes(bulkRole) : u.roles.includes(bulkRole)));
  const selfRemovingAdmin = mode === "remove" && ADMIN_ROLES.includes(bulkRole)
    && chosen.some((u) => String(u.id) === String(user?.id));

  const apply = useMutation({
    mutationFn: () => privilegesApi.bulkUserRoles(
      [...selected], mode === "add" ? [bulkRole] : [], mode === "remove" ? [bulkRole] : []),
    onSuccess: async (res) => {
      setConfirmOpen(false);
      setSelected(new Set());
      toast.success(res.summary);
      await qc.invalidateQueries({ queryKey: ["privileges"] });
      if (chosen.some((u) => String(u.id) === String(user?.id))) await refreshUser();
    },
    onError: (err) => {
      setConfirmOpen(false);
      toast.error(apiMessage(err, "Could not change roles"), { duration: 7000 });
    }
  });

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search name, employee code or username" value={query}
                   onChange={(e) => setQuery(e.target.value)} />
          </div>
          <Select className="w-48" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} aria-label="Filter by role">
            <option value="All">All roles</option>
            <option value="__none">No role</option>
            {overview.roles.map((r) => <option key={r.id} value={r.code}>{r.code}</option>)}
          </Select>
          <Select className="w-36" value={status} onChange={(e) => setStatus(e.target.value as typeof status)} aria-label="Filter by status">
            <option value="active">Active</option>
            <option value="disabled">Disabled</option>
            <option value="all">All statuses</option>
          </Select>
        </div>

        {selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2">
            <span className="text-sm font-semibold">{selected.size} selected</span>
            <Button size="xs" variant="ghost" onClick={() => setSelected(new Set())}><X /> Clear</Button>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <Select className="h-9 w-32 text-xs" value={mode} onChange={(e) => setMode(e.target.value as Mode)} aria-label="Bulk action">
                <option value="add">Add role</option>
                <option value="remove">Remove role</option>
              </Select>
              <Select className="h-9 w-48 text-xs" value={bulkRole} onChange={(e) => setBulkRole(e.target.value)} aria-label="Role">
                <option value="">Choose role…</option>
                {assignable.map((r) => <option key={r.id} value={r.code}>{r.code}</option>)}
              </Select>
              <Button size="sm" disabled={!bulkRole || !overview.historyReady} onClick={() => setConfirmOpen(true)}>
                {mode === "add" ? <UserPlus /> : <UserMinus />} Apply
              </Button>
            </div>
          </div>
        )}

        {users.isLoading ? (
          <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
        ) : users.isError ? (
          <p className="text-sm text-destructive">{apiMessage(users.error, "Could not load users")}</p>
        ) : (
          <>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="bg-muted/50 text-[11px] uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="w-10 px-3 py-2">
                      <input type="checkbox" aria-label="Select all filtered users" checked={allFilteredSelected} onChange={toggleAll} />
                    </th>
                    <th className="px-3 py-2 text-left">Employee</th>
                    <th className="px-3 py-2 text-left">Username</th>
                    <th className="px-3 py-2 text-left">Roles</th>
                    <th className="px-3 py-2 text-left">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {paged.pageRows.map((u) => (
                    <tr key={u.id} className={cn("border-t border-border", selected.has(u.id) && "bg-primary/5")}>
                      <td className="px-3 py-2 text-center">
                        <input type="checkbox" aria-label={`Select ${u.name}`} checked={selected.has(u.id)} onChange={() => toggle(u.id)} />
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-medium">{u.name}{String(u.id) === String(user?.id) && <span className="ml-1 text-[10px] text-muted-foreground">(you)</span>}</div>
                        <div className="text-[11px] text-muted-foreground">{u.employeeCode || "—"}</div>
                      </td>
                      <td className="px-3 py-2 text-xs">{u.username || "—"}</td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {u.roles.length === 0 && <span className="text-xs text-muted-foreground">None</span>}
                          {u.roles.map((r) => (
                            <Badge key={r} variant={ADMIN_ROLES.includes(r) ? "warning" : "secondary"}>{r}</Badge>
                          ))}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant={u.enabled ? "success" : "destructive"}>{u.enabled ? "Active" : "Disabled"}</Badge>
                      </td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr><td colSpan={5} className="p-6 text-center text-xs text-muted-foreground">No users match these filters.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <TablePagination page={paged.page} totalPages={paged.totalPages} onChange={paged.setPage}
                             pageSize={paged.pageSize} onPageSizeChange={paged.setPageSize} total={paged.total} />
          </>
        )}
      </CardContent>

      <ConfirmDialog
        open={confirmOpen}
        title={`${mode === "add" ? "Add" : "Remove"} ${bulkRole} ${mode === "add" ? "to" : "from"} ${affected.length} user(s)?`}
        description={
          selfRemovingAdmin
            ? "You are included and would lose your own admin role. The server will refuse this — deselect yourself first."
            : affected.length === 0
              ? "None of the selected users would change."
              : "Takes effect immediately. Recorded in Change History and can be rolled back."
        }
        detail={affected.slice(0, 12).map((u): [string, string] => [u.name, u.roles.join(", ") || "no roles"])
          .concat(affected.length > 12 ? [["…", `and ${affected.length - 12} more`]] : [])}
        confirmLabel={mode === "add" ? "Add role" : "Remove role"}
        cancelLabel="Cancel"
        busy={apply.isPending}
        onConfirm={() => apply.mutate()}
        onCancel={() => setConfirmOpen(false)}
      />
    </Card>
  );
}
