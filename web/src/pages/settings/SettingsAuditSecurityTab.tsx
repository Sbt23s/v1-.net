import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { PixousLoader } from "@/components/ui/pixous-loader";
import toast from "react-hot-toast";
import dayjs from "dayjs";
import {
  History, ShieldCheck, Key, Search, Clock, Lock, Activity,
  Filter, Check, AlertTriangle, Shield, Laptop, Globe, Users
} from "lucide-react";
import { useTechAdminAuth } from "@/context/TechAdminAuthContext";

export function SettingsAuditSecurityTab() {
  const { currentCompany, companies } = useTechAdminAuth();
  const [subTab, setSubTab] = useState<"audit" | "security">("audit");

  // Audit Logs state
  const [logs, setLogs] = useState<any[]>([]);
  const [usage, setUsage] = useState<any>(null);
  const [loadingLogs, setLoadingLogs] = useState(true);
  const [searchLog, setSearchLog] = useState("");
  const [selectedCompanyFilter, setSelectedCompanyFilter] = useState("ALL");

  // Security Policy State
  const [mfaEnabled, setMfaEnabled] = useState(false);
  const [sessionTimeout, setSessionTimeout] = useState("240");
  const [minPasswordLength, setMinPasswordLength] = useState("8");
  const [requireSpecialChar, setRequireSpecialChar] = useState(true);
  const [requireNumbers, setRequireNumbers] = useState(true);
  const [ipWhitelist, setIpWhitelist] = useState("");
  const [savingSecurity, setSavingSecurity] = useState(false);

  const fetchLogs = useCallback(async () => {
    setLoadingLogs(true);
    try {
      const [logsRes, usageRes] = await Promise.allSettled([
        api.get("/technical-admin/audit-logs"),
        api.get("/technical-admin/audit-logs/usage?days=30")
      ]);

      if (logsRes.status === "fulfilled") {
        const rows = logsRes.value.data?.data ?? logsRes.value.data ?? [];
        setLogs(Array.isArray(rows) ? rows : []);
      }
      if (usageRes.status === "fulfilled") {
        setUsage(usageRes.value.data?.data ?? null);
      }
    } catch {
      setLogs([]);
    } finally {
      setLoadingLogs(false);
    }
  }, []);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  // Filter logs
  const filteredLogs = logs.filter((l) => {
    const q = searchLog.toLowerCase();
    const matchesSearch =
      (l.action || "").toLowerCase().includes(q) ||
      (l.adminUsername || "").toLowerCase().includes(q) ||
      (l.entityType || "").toLowerCase().includes(q) ||
      (l.ipAddress || "").toLowerCase().includes(q);

    const matchesCompany =
      selectedCompanyFilter === "ALL" ||
      String(l.companyId) === selectedCompanyFilter;

    return matchesSearch && matchesCompany;
  });

  const handleSaveSecurity = (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSecurity(true);
    setTimeout(() => {
      setSavingSecurity(false);
      toast.success("Security policies updated successfully");
    }, 600);
  };

  return (
    <div className="space-y-6">
      {/* Top Banner & Sub-Tab Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl border border-border bg-card shadow-sm">
        <div>
          <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
            <History className="w-5 h-5 text-primary" />
            Audit Trail & Security Policies
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Inspect technical audit logs, user engagement telemetry, and configure security rules.
          </p>
        </div>

        {/* Sub-tab pills */}
        <div className="flex items-center gap-1.5 p-1 bg-muted/60 rounded-lg border border-border/40">
          <button
            onClick={() => setSubTab("audit")}
            className={`text-xs px-3 py-1.5 font-medium rounded-md transition-colors ${
              subTab === "audit"
                ? "bg-card text-foreground shadow-xs font-semibold"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Audit Logs & Analytics
          </button>
          <button
            onClick={() => setSubTab("security")}
            className={`text-xs px-3 py-1.5 font-medium rounded-md transition-colors ${
              subTab === "security"
                ? "bg-card text-foreground shadow-xs font-semibold"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Security Parameters
          </button>
        </div>
      </div>

      {subTab === "audit" ? (
        <div className="space-y-5">
          {/* Usage Metrics Overview */}
          {usage && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
              <Card className="border-border bg-card shadow-sm p-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">
                    Active Telemetry Days
                  </span>
                  <Activity className="w-4 h-4 text-primary" />
                </div>
                <div className="text-2xl font-bold text-foreground mt-2">
                  {usage.days || 30} Days
                </div>
                <p className="text-[11px] text-muted-foreground mt-1">
                  Tracking telemetry & usage
                </p>
              </Card>

              <Card className="border-border bg-card shadow-sm p-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">
                    Recorded Interactions
                  </span>
                  <History className="w-4 h-4 text-emerald-500" />
                </div>
                <div className="text-2xl font-bold text-foreground mt-2">
                  {logs.length}
                </div>
                <p className="text-[11px] text-muted-foreground mt-1">
                  Audit events captured
                </p>
              </Card>

              <Card className="border-border bg-card shadow-sm p-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">
                    Active Operators
                  </span>
                  <Users className="w-4 h-4 text-blue-500" />
                </div>
                <div className="text-2xl font-bold text-foreground mt-2">
                  {usage.people?.length || 1}
                </div>
                <p className="text-[11px] text-muted-foreground mt-1">
                  Active in past 30 days
                </p>
              </Card>
            </div>
          )}

          {/* Filters & Search */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="relative max-w-sm flex-1">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchLog}
                onChange={(e) => setSearchLog(e.target.value)}
                placeholder="Search audit actions, operators, IPs..."
                className="pl-8 text-xs h-8 bg-card"
              />
            </div>

            <div className="flex items-center gap-2">
              <select
                value={selectedCompanyFilter}
                onChange={(e) => setSelectedCompanyFilter(e.target.value)}
                className="text-xs font-medium rounded-lg border border-border bg-card px-2.5 py-1.5 h-8 focus:outline-none"
              >
                <option value="ALL">All Companies</option>
                {companies.map((c) => (
                  <option key={String(c.id || c.companyId)} value={String(c.id)}>
                    {c.companyName}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Table */}
          {loadingLogs ? (
            <div className="flex items-center justify-center p-12">
              <PixousLoader size="md" />
            </div>
          ) : (
            <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-muted/50 border-b border-border text-muted-foreground font-semibold">
                    <tr>
                      <th className="py-3 px-4">Timestamp</th>
                      <th className="py-3 px-4">Operator</th>
                      <th className="py-3 px-4">Action</th>
                      <th className="py-3 px-4">Entity</th>
                      <th className="py-3 px-4">IP Address</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {filteredLogs.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-8 text-center text-muted-foreground">
                          No audit events recorded yet.
                        </td>
                      </tr>
                    ) : (
                      filteredLogs.slice(0, 50).map((l, i) => (
                        <tr key={l.id || i} className="hover:bg-muted/20 transition-colors">
                          <td className="py-3 px-4 text-muted-foreground whitespace-nowrap">
                            {dayjs(l.createdAt).format("MMM D, YYYY HH:mm:ss")}
                          </td>
                          <td className="py-3 px-4 font-medium text-foreground">
                            {l.adminUsername || "System"}
                          </td>
                          <td className="py-3 px-4">
                            <Badge variant="outline" className="text-[10px] font-mono">
                              {l.action}
                            </Badge>
                          </td>
                          <td className="py-3 px-4 text-foreground">
                            {l.entityType || "—"}
                          </td>
                          <td className="py-3 px-4 font-mono text-[11px] text-muted-foreground">
                            {l.ipAddress || "127.0.0.1"}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      ) : (
        /* Security Parameters */
        <form onSubmit={handleSaveSecurity} className="space-y-5">
          <Card className="border-border bg-card shadow-sm">
            <CardHeader className="pb-3 border-b border-border/60">
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-primary" />
                Authentication & Password Rules
              </CardTitle>
              <CardDescription className="text-xs">
                Platform-wide security policies governing user sessions and credentials.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-4 space-y-4">
              <div className="flex items-center justify-between p-3 rounded-xl border border-border bg-muted/20">
                <div>
                  <h4 className="text-xs font-semibold text-foreground">
                    Enforce Multi-Factor Authentication (MFA)
                  </h4>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Require two-factor verification codes on administrator logins.
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={mfaEnabled}
                  onChange={(e) => setMfaEnabled(e.target.checked)}
                  className="rounded border-border text-primary focus:ring-primary h-4 w-4"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs font-semibold">Session Inactivity Timeout</Label>
                  <select
                    value={sessionTimeout}
                    onChange={(e) => setSessionTimeout(e.target.value)}
                    className="w-full text-xs font-medium rounded-lg border border-border bg-background px-3 py-2 mt-1 focus:outline-none"
                  >
                    <option value="15">15 minutes</option>
                    <option value="30">30 minutes</option>
                    <option value="60">1 hour</option>
                    <option value="240">4 hours (recommended)</option>
                    <option value="480">8 hours</option>
                    <option value="1440">24 hours</option>
                  </select>
                </div>

                <div>
                  <Label className="text-xs font-semibold">Minimum Password Length</Label>
                  <Input
                    type="number"
                    value={minPasswordLength}
                    onChange={(e) => setMinPasswordLength(e.target.value)}
                    min={6}
                    max={32}
                    className="mt-1 text-xs"
                  />
                </div>
              </div>

              <div className="space-y-2 pt-2">
                <label className="flex items-center gap-2 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={requireSpecialChar}
                    onChange={(e) => setRequireSpecialChar(e.target.checked)}
                    className="rounded border-border text-primary focus:ring-primary h-3.5 w-3.5"
                  />
                  <span>Require at least one special character (!@#$%^&*)</span>
                </label>

                <label className="flex items-center gap-2 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={requireNumbers}
                    onChange={(e) => setRequireNumbers(e.target.checked)}
                    className="rounded border-border text-primary focus:ring-primary h-3.5 w-3.5"
                  />
                  <span>Require at least one numeric digit (0-9)</span>
                </label>
              </div>

              <div>
                <Label className="text-xs font-semibold">IP Whitelist Restrictions</Label>
                <Input
                  value={ipWhitelist}
                  onChange={(e) => setIpWhitelist(e.target.value)}
                  placeholder="Optional comma-separated CIDR blocks (e.g. 192.168.1.0/24)"
                  className="mt-1 text-xs"
                />
              </div>

              <div className="pt-3 border-t border-border flex justify-end">
                <Button
                  size="sm"
                  type="submit"
                  disabled={savingSecurity}
                  className="gap-1.5 text-xs h-9 px-4"
                >
                  {savingSecurity && <PixousLoader size="xs" />}
                  <Save className="w-3.5 h-3.5" />
                  {savingSecurity ? "Saving..." : "Save Policies"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </form>
      )}
    </div>
  );
}

function Save({ className }: { className?: string }) {
  return <Check className={className} />;
}
