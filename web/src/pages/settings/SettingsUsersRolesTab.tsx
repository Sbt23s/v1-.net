import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogHeader } from "@/components/ui/dialog";
import { PixousLoader } from "@/components/ui/pixous-loader";
import toast from "react-hot-toast";
import {
  Users, ShieldCheck, Key, Search, Plus, Filter,
  Shield, Check, AlertCircle, ChevronDown, ChevronUp, Eye, EyeOff, Edit2
} from "lucide-react";
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

export function SettingsUsersRolesTab() {
  const { currentCompany, companies } = useTechAdminAuth();
  const [subTab, setSubTab] = useState<"users" | "roles">("users");

  // Users state
  const [users, setUsers] = useState<any[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [searchUser, setSearchUser] = useState("");
  const [selectedRoleFilter, setSelectedRoleFilter] = useState("All");

  // Create Admin Modal
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [formName, setFormName] = useState("");
  const [formEmail, setFormEmail] = useState("");
  const [formUsername, setFormUsername] = useState("");
  const [formPassword, setFormPassword] = useState("admin123");
  const [formCompanyId, setFormCompanyId] = useState(
    String(currentCompany?.companyId || currentCompany?.id || "PIX-MASTER")
  );

  // Reset Password Modal
  const [resetTarget, setResetTarget] = useState<any | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [resetting, setResetting] = useState(false);

  // Roles state
  const [roles, setRoles] = useState<RoleView[]>([]);
  const [loadingRoles, setLoadingRoles] = useState(false);
  const [rolesQuery, setRolesQuery] = useState("");
  const [expandedRoleId, setExpandedRoleId] = useState<number | null>(null);

  const fetchUsers = useCallback(async () => {
    setLoadingUsers(true);
    try {
      const res = await api.get("/users?size=300");
      const payload = res.data?.data;
      const rows = Array.isArray(payload?.content)
        ? payload.content
        : Array.isArray(payload)
          ? payload
          : [];
      setUsers(rows);
    } catch {
      setUsers([]);
    } finally {
      setLoadingUsers(false);
    }
  }, []);

  const fetchRoles = useCallback(async () => {
    setLoadingRoles(true);
    try {
      const res = await api.get("/technical-admin/roles");
      const payload = res.data?.data ?? res.data ?? [];
      setRoles(Array.isArray(payload) ? payload : []);
    } catch {
      setRoles([]);
    } finally {
      setLoadingRoles(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  useEffect(() => {
    if (subTab === "roles" && roles.length === 0) {
      fetchRoles();
    }
  }, [subTab, roles.length, fetchRoles]);

  // Create admin account
  const handleCreateAdmin = async () => {
    if (!formUsername.trim() || !formName.trim() || !formEmail.trim()) {
      toast.error("Name, username, and email are required");
      return;
    }
    setCreating(true);
    try {
      await api.post("/auth/employees", {
        fullName: formName.trim(),
        username: formUsername.trim(),
        email: formEmail.trim(),
        password: formPassword || "admin123",
        roleCode: "COMPANY_ADMIN",
        companyId: formCompanyId
      });
      toast.success("Administrator account created");
      setIsCreateOpen(false);
      setFormName("");
      setFormUsername("");
      setFormEmail("");
      fetchUsers();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || err?.message || "Failed to create administrator");
    } finally {
      setCreating(false);
    }
  };

  // Reset password
  const handleConfirmReset = async () => {
    if (!resetTarget || !resetPassword.trim()) {
      toast.error("Please provide a new password");
      return;
    }
    setResetting(true);
    try {
      await api.put(`/users/${resetTarget.id}`, {
        password: resetPassword.trim()
      });
      toast.success(`Password updated for ${resetTarget.username}`);
      setResetTarget(null);
      setResetPassword("");
    } catch (err: any) {
      toast.error(err?.response?.data?.message || err?.message || "Failed to reset password");
    } finally {
      setResetting(false);
    }
  };

  const filteredUsers = users.filter((u) => {
    const q = searchUser.toLowerCase();
    const matchesSearch =
      (u.fullName || u.name || "").toLowerCase().includes(q) ||
      (u.username || "").toLowerCase().includes(q) ||
      (u.email || "").toLowerCase().includes(q);

    const rolesArr: string[] = Array.isArray(u.roles) ? u.roles : [u.role || ""];
    const matchesRole =
      selectedRoleFilter === "All" ||
      (selectedRoleFilter === "Admins" &&
        rolesArr.some((r) => r.includes("ADMIN") || r.includes("HR"))) ||
      rolesArr.includes(selectedRoleFilter);

    return matchesSearch && matchesRole;
  });

  const filteredRoles = roles.filter((r) => {
    const q = rolesQuery.toLowerCase();
    return (
      r.name.toLowerCase().includes(q) ||
      r.code.toLowerCase().includes(q) ||
      (r.description || "").toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-6">
      {/* Top Banner & Sub-Tab Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl border border-border bg-card shadow-sm">
        <div>
          <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
            <Users className="w-5 h-5 text-primary" />
            Users, Administrators & System Roles
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Manage administrative user accounts and inspect system-wide role permissions.
          </p>
        </div>

        {/* Tab Switcher */}
        <div className="flex items-center gap-1.5 p-1 bg-muted/60 rounded-lg border border-border/40">
          <button
            onClick={() => setSubTab("users")}
            className={`text-xs px-3 py-1.5 font-medium rounded-md transition-colors ${
              subTab === "users"
                ? "bg-card text-foreground shadow-xs font-semibold"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            User Accounts ({users.length})
          </button>
          <button
            onClick={() => setSubTab("roles")}
            className={`text-xs px-3 py-1.5 font-medium rounded-md transition-colors ${
              subTab === "roles"
                ? "bg-card text-foreground shadow-xs font-semibold"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Roles & Permissions
          </button>
        </div>
      </div>

      {subTab === "users" ? (
        <div className="space-y-4">
          {/* Controls */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2 flex-1 max-w-sm">
              <div className="relative w-full">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={searchUser}
                  onChange={(e) => setSearchUser(e.target.value)}
                  placeholder="Search by name, username, email..."
                  className="pl-8 text-xs h-8 bg-card"
                />
              </div>

              <select
                value={selectedRoleFilter}
                onChange={(e) => setSelectedRoleFilter(e.target.value)}
                className="text-xs font-medium rounded-lg border border-border bg-card px-2.5 py-1.5 h-8 focus:outline-none"
              >
                <option value="All">All Roles</option>
                <option value="Admins">Admins & HR</option>
                <option value="SUPER_ADMIN">System Admin</option>
                <option value="COMPANY_ADMIN">Company Admin</option>
                <option value="EMPLOYEE">Employee</option>
              </select>
            </div>

            <Button
              size="sm"
              onClick={() => setIsCreateOpen(true)}
              className="gap-1.5 text-xs h-8"
            >
              <Plus className="w-3.5 h-3.5" />
              Create Administrator
            </Button>
          </div>

          {/* Users Table */}
          {loadingUsers ? (
            <div className="flex items-center justify-center p-12">
              <PixousLoader size="md" />
            </div>
          ) : (
            <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-muted/50 border-b border-border text-muted-foreground font-semibold">
                    <tr>
                      <th className="py-3 px-4">User</th>
                      <th className="py-3 px-4">Username</th>
                      <th className="py-3 px-4">Company</th>
                      <th className="py-3 px-4">Roles</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {filteredUsers.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-8 text-center text-muted-foreground">
                          No user accounts match the current filter.
                        </td>
                      </tr>
                    ) : (
                      filteredUsers.slice(0, 50).map((u) => {
                        const rolesArr: string[] = Array.isArray(u.roles)
                          ? u.roles
                          : [u.role || "EMPLOYEE"];

                        return (
                          <tr key={u.id} className="hover:bg-muted/20 transition-colors">
                            <td className="py-3 px-4 font-medium text-foreground">
                              <div>{u.fullName || u.name || "Unnamed"}</div>
                              <div className="text-[11px] text-muted-foreground font-normal">
                                {u.email || "No email"}
                              </div>
                            </td>
                            <td className="py-3 px-4 font-mono text-[11px] text-foreground">
                              {u.username}
                            </td>
                            <td className="py-3 px-4 text-muted-foreground">
                              {u.companyName || u.companyId || "Pixous"}
                            </td>
                            <td className="py-3 px-4">
                              <div className="flex flex-wrap gap-1">
                                {rolesArr.map((r) => (
                                  <Badge
                                    key={r}
                                    variant="outline"
                                    className="text-[10px] px-1.5 py-0"
                                  >
                                    {r.replace(/_/g, " ")}
                                  </Badge>
                                ))}
                              </div>
                            </td>
                            <td className="py-3 px-4">
                              <Badge
                                variant={
                                  u.status === "OFFBOARDED" || u.enabled === false
                                    ? "secondary"
                                    : "default"
                                }
                                className="text-[10px] px-1.5 py-0 capitalize"
                              >
                                {u.status || (u.enabled === false ? "Disabled" : "Active")}
                              </Badge>
                            </td>
                            <td className="py-3 px-4 text-right">
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  setResetTarget(u);
                                  setResetPassword("Pixous123#");
                                }}
                                className="text-xs h-7 text-primary hover:text-primary/80 gap-1 px-2"
                              >
                                <Key className="w-3 h-3" />
                                Reset PW
                              </Button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      ) : (
        /* Roles Catalogue */
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="relative max-w-sm flex-1">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={rolesQuery}
                onChange={(e) => setRolesQuery(e.target.value)}
                placeholder="Search system roles..."
                className="pl-8 text-xs h-8 bg-card"
              />
            </div>
            <span className="text-xs text-muted-foreground">
              {filteredRoles.length} Platform Roles Defined
            </span>
          </div>

          {loadingRoles ? (
            <div className="flex items-center justify-center p-12">
              <PixousLoader size="md" />
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
              {filteredRoles.map((r) => {
                const isExpanded = expandedRoleId === r.id;

                return (
                  <Card key={r.id} className="border-border bg-card shadow-sm">
                    <CardContent className="p-4 space-y-3">
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="flex items-center gap-2">
                            <h4 className="text-sm font-bold text-foreground">{r.name}</h4>
                            <Badge variant="outline" className="text-[10px] font-mono">
                              {r.code}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">
                            {r.description || "System authority role."}
                          </p>
                        </div>
                        <Badge variant="secondary" className="text-[11px] shrink-0">
                          {r.permissionCount || r.permissions?.length || 0} Permissions
                        </Badge>
                      </div>

                      {/* Expandable permissions */}
                      <div className="pt-2 border-t border-border/50">
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedRoleId(isExpanded ? null : r.id)
                          }
                          className="flex items-center justify-between w-full text-xs font-medium text-muted-foreground hover:text-foreground"
                        >
                          <span>View Granted Permissions</span>
                          {isExpanded ? (
                            <ChevronUp className="w-3.5 h-3.5" />
                          ) : (
                            <ChevronDown className="w-3.5 h-3.5" />
                          )}
                        </button>

                        {isExpanded && (
                          <div className="flex flex-wrap gap-1.5 mt-3 pt-2 border-t border-border/40">
                            {r.permissions?.length > 0 ? (
                              r.permissions.map((p) => (
                                <Badge
                                  key={p.code}
                                  variant="secondary"
                                  className="text-[10px] font-mono px-2 py-0.5"
                                  title={p.name}
                                >
                                  {p.code}
                                </Badge>
                              ))
                            ) : (
                              <span className="text-xs text-muted-foreground">
                                No permissions bound directly.
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Create Administrator Dialog */}
      <Dialog open={isCreateOpen} onClose={() => setIsCreateOpen(false)} className="max-w-md">
          <DialogHeader
            title="Provision Administrator"
            description="Create an administrative user account with Company Admin permissions."
          />

          <div className="space-y-4 my-5">
            <div>
              <Label className="text-xs font-semibold">Full Name *</Label>
              <Input
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="e.g. John Doe"
                className="mt-1 text-xs"
              />
            </div>

            <div>
              <Label className="text-xs font-semibold">Username *</Label>
              <Input
                value={formUsername}
                onChange={(e) => setFormUsername(e.target.value)}
                placeholder="e.g. john_admin"
                className="mt-1 text-xs"
              />
            </div>

            <div>
              <Label className="text-xs font-semibold">Email *</Label>
              <Input
                type="email"
                value={formEmail}
                onChange={(e) => setFormEmail(e.target.value)}
                placeholder="john@company.com"
                className="mt-1 text-xs"
              />
            </div>

            <div>
              <Label className="text-xs font-semibold">Temporary Password</Label>
              <Input
                value={formPassword}
                onChange={(e) => setFormPassword(e.target.value)}
                placeholder="admin123"
                className="mt-1 text-xs"
              />
            </div>

            <div>
              <Label className="text-xs font-semibold">Assign Tenant Company</Label>
              <select
                value={formCompanyId}
                onChange={(e) => setFormCompanyId(e.target.value)}
                className="w-full text-xs font-medium rounded-lg border border-border bg-background px-3 py-2 mt-1 focus:outline-none"
              >
                {companies.map((c) => (
                  <option key={String(c.id || c.companyId)} value={String(c.companyId || c.id)}>
                    {c.companyName} ({c.companyId})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsCreateOpen(false)}
              disabled={creating}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleCreateAdmin}
              disabled={creating}
              className="gap-1.5"
            >
              {creating && <PixousLoader size="xs" />}
              {creating ? "Creating..." : "Create Admin"}
            </Button>
          </div>
      </Dialog>

      {/* Reset Password Dialog */}
      <Dialog open={Boolean(resetTarget)} onClose={() => setResetTarget(null)} className="max-w-md">
          <DialogHeader
            title="Reset Password"
            description={`Set a new password for account ${resetTarget?.username ?? ""}.`}
          />

          <div className="space-y-4 my-5">
            <div>
              <Label className="text-xs font-semibold">New Password</Label>
              <Input
                value={resetPassword}
                onChange={(e) => setResetPassword(e.target.value)}
                placeholder="Enter new password..."
                className="mt-1 text-xs"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setResetTarget(null)}
              disabled={resetting}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleConfirmReset}
              disabled={resetting}
              className="gap-1.5"
            >
              {resetting && <PixousLoader size="xs" />}
              {resetting ? "Updating..." : "Update Password"}
            </Button>
          </div>
      </Dialog>
    </div>
  );
}
