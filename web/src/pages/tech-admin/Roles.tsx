import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AlertCircle, Search, ShieldCheck, ShieldAlert } from "lucide-react";
import { useTechAdminAuth } from "@/context/TechAdminAuthContext";

interface PermissionView {
  id: number;
  code: string;
  name: string;
}

interface RoleView {
  id: number;
  code: string;
  name: string;
  description?: string | null;
  industry?: string | null;
  permissionCount: number;
  permissions: PermissionView[];
}

/**
 * Roles and what each one grants.
 *
 * This route used to render the Module Management page, which is why it looked
 * empty — it was showing the wrong screen entirely. It now reads the role
 * catalogue from /technical-admin/roles.
 *
 * Read-only for the moment. Editing a role's permissions changes who can do what
 * across every company at once, so it is worth building deliberately rather than
 * bolting on; the page says so rather than offering controls that do nothing.
 */
export function TechAdminRoles() {
  const { theme } = useTechAdminAuth();
  const isDark = theme === "dark";

  const [roles, setRoles] = useState<RoleView[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [openRole, setOpenRole] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get("/technical-admin/roles");
      const payload = res.data?.data ?? res.data ?? [];
      setRoles(Array.isArray(payload) ? payload : []);
      setFailed(false);
    } catch {
      // An empty table after a failed load reads as "there are no roles".
      setRoles([]);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * The four roles a company actually staffs.
   *
   * The platform carries eighteen, most of them industry variants of these four
   * — IT_MGR and CV_SUP are both team leads, IT_HR and CV_HR are both HR. Listed
   * flat they read as eighteen separate things to configure when there are four,
   * and the variants are assigned by the industry a company is in rather than
   * chosen here.
   *
   * Searching still reaches all eighteen: the variants are real and someone
   * chasing a specific permission needs to find them. This narrows the resting
   * view, it does not hide anything.
   */
  const CORE_ROLES = ["COMPANY_ADMIN", "SUPER_ADMIN", "HR_MANAGER", "TEAM_LEAD", "EMPLOYEE"];

  const [showAll, setShowAll] = useState(false);

  const term = query.trim().toLowerCase();
  const visible = term
    ? roles.filter(
        (r) =>
          r.code.toLowerCase().includes(term) ||
          r.name.toLowerCase().includes(term) ||
          r.permissions.some((p) => p.code.toLowerCase().includes(term)),
      )
    : showAll
      ? roles
      : roles.filter((r) => CORE_ROLES.includes(r.code.toUpperCase()));

  const hiddenCount = roles.length - roles.filter((r) => CORE_ROLES.includes(r.code.toUpperCase())).length;

  const granting = roles.filter((r) => r.permissionCount > 0).length;
  const empty = roles.filter((r) => r.permissionCount === 0).length;

  return (
    <div className="space-y-6 max-w-[1600px] mx-auto px-4 py-4">
      <div>
        <h1 className={`text-2xl font-bold ${isDark ? "text-slate-100" : "text-slate-900"}`}>
          Roles &amp; Permissions
        </h1>
        <p className={`text-sm mt-1 ${isDark ? "text-slate-400" : "text-slate-500"}`}>
          Every role on the platform and what it allows. Permissions are checked on the server.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">Roles</p>
            <p className="text-2xl font-bold mt-1">{roles.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">Granting access</p>
            <p className="text-2xl font-bold mt-1 text-emerald-500">{granting}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">Granting nothing</p>
            <p className={`text-2xl font-bold mt-1 ${empty > 0 ? "text-amber-500" : ""}`}>{empty}</p>
          </CardContent>
        </Card>
      </div>

      <div className="relative max-w-sm">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search a role or a permission…"
          className="pl-9"
        />
      </div>

      {/* Says what is not on screen and offers it, rather than quietly
          shortening the list. Hidden and absent look identical otherwise. */}
      {!term && hiddenCount > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span>
            Showing the {CORE_ROLES.length} roles a company staffs.
            {" "}
            {hiddenCount} industry variant{hiddenCount === 1 ? "" : "s"} hidden.
          </span>
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="font-semibold text-primary underline-offset-2 hover:underline"
          >
            {showAll ? "Show fewer" : "Show all"}
          </button>
        </div>
      )}

      {failed ? (
        <Card className="border-red-500/20 bg-red-500/5">
          <CardContent className="p-10 text-center">
            <AlertCircle className="w-8 h-8 mx-auto mb-3 text-red-400" />
            <p className="font-semibold text-red-400">Couldn't load the roles</p>
            <p className="mt-1 text-sm text-slate-400">
              Nothing has changed — this list simply has not been read yet.
            </p>
            <Button variant="outline" className="mt-4" onClick={load}>
              Try again
            </Button>
          </CardContent>
        </Card>
      ) : loading ? (
        <div className="space-y-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-20 rounded-xl animate-pulse bg-slate-500/10" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center text-slate-400">
            No role matches “{query}”.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {visible.map((role) => {
            const isOpen = openRole === role.id;
            const grantsNothing = role.permissionCount === 0;
            return (
              <Card key={role.id}>
                <CardHeader
                  className="cursor-pointer"
                  onClick={() => setOpenRole(isOpen ? null : role.id)}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3 min-w-0">
                      {grantsNothing ? (
                        <ShieldAlert className="w-5 h-5 mt-0.5 shrink-0 text-amber-500" />
                      ) : (
                        <ShieldCheck className="w-5 h-5 mt-0.5 shrink-0 text-emerald-500" />
                      )}
                      <div className="min-w-0">
                        <CardTitle className="text-base">{role.name}</CardTitle>
                        <CardDescription className="font-mono text-xs mt-0.5">
                          {role.code}
                          {role.industry && role.industry !== "BOTH" ? ` · ${role.industry}` : ""}
                        </CardDescription>
                        {role.description && (
                          <p className="text-xs text-slate-400 mt-1">{role.description}</p>
                        )}
                      </div>
                    </div>
                    <span
                      className={`shrink-0 text-xs font-bold px-2.5 py-1 rounded-full ${
                        grantsNothing
                          ? "bg-amber-500/15 text-amber-500"
                          : "bg-emerald-500/15 text-emerald-500"
                      }`}
                    >
                      {role.permissionCount} permission{role.permissionCount === 1 ? "" : "s"}
                    </span>
                  </div>
                </CardHeader>

                {isOpen && (
                  <CardContent className="pt-0">
                    {grantsNothing ? (
                      <p className="text-sm text-amber-500">
                        This role grants nothing. Anyone holding it can only reach their own
                        self-service screens.
                      </p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {role.permissions.map((p) => (
                          <span
                            key={p.id}
                            title={p.name}
                            className="text-xs font-mono px-2 py-1 rounded bg-slate-500/10"
                          >
                            {p.code}
                          </span>
                        ))}
                      </div>
                    )}
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <p className="text-xs text-slate-500">
        Read-only. Changing what a role grants affects every company at once, so it is not edited
        from here yet.
      </p>
    </div>
  );
}
