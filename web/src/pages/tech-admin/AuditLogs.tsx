import { PixousLoader } from "@/components/ui/pixous-loader";
import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { History, Clock, Users, Activity, Filter, Search } from "lucide-react";
import { useTechAdminAuth } from "@/context/TechAdminAuthContext";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";

// Mock data generator for company-wise usage logs based on REAL users
const generateLogsForRealUsers = (companyName: string, realUsers: any[]) => {
  if (!realUsers || realUsers.length === 0) return [];

  const modules = ["Attendance", "Chat", "Payroll", "Leave Management", "Performance Appraisals", "Core HR"];
  const actions = {
    "Attendance": ["Marked Check-in", "Marked Check-out", "Reviewed Timesheet"],
    "Chat": ["Sent a message in General", "Created a new channel", "Replied to a thread"],
    "Payroll": ["Processed monthly salary", "Downloaded Payslip", "Reviewed tax deductions"],
    "Leave Management": ["Applied for Sick Leave", "Approved Vacation Request", "Checked Leave Balance"],
    "Performance Appraisals": ["Submitted Self-Appraisal", "Reviewed Team Performance", "Set OKRs"],
    "Core HR": ["Updated Profile", "Onboarded new employee", "Downloaded Company Policy"]
  };
  
  const logs = [];
  // Generate logs randomly assigned to the REAL users
  for (let i = 1; i <= Math.min(25, realUsers.length * 4); i++) {
    const randomUser = realUsers[Math.floor(Math.random() * realUsers.length)];
    const role = randomUser.role;
    const name = randomUser.name;
    
    const module = modules[Math.floor(Math.random() * modules.length)];
    // @ts-ignore
    const actionList = actions[module];
    const action = actionList[Math.floor(Math.random() * actionList.length)];
    
    // Random duration between 5m and 4h
    const durationMins = Math.floor(Math.random() * 240) + 5;
    const hours = Math.floor(durationMins / 60);
    const mins = durationMins % 60;
    const duration = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;

    const timestamp = new Date(Date.now() - Math.floor(Math.random() * 86400000) * i);

    logs.push({
      id: i,
      name,
      role,
      module,
      action,
      duration,
      companyName,
      timestamp: timestamp.toLocaleString()});
  }
  
  // Sort by newest first
  return logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
};

export function TechAdminAuditLogs() {
  const { theme, currentCompany } = useTechAdminAuth();
  const isDark = theme === "dark";
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [roleFilter, setRoleFilter] = useState("ALL");
  /** Per-person usage: which modules, how many touches, how long. */
  const [usage, setUsage] = useState<any[]>([]);
  const [usageNote, setUsageNote] = useState("");

  useEffect(() => {
    let mounted = true;
    setLoading(true);

    /*
     * Read the audit trail from the server.
     *
     * This used to build its rows in the browser: it fetched the user list and
     * handed it to generateLogsForRealUsers(), which invented a module, an
     * action and a timestamp for each person. For companies other than Pixous
     * it did not even do that — it hard-coded "Bala Admin" and "Master Admin"
     * and read the rest out of localStorage. Every line on this page was made
     * up, and a page of invented audit records is worse than an empty one:
     * an audit log is only worth having if it is the truth.
     */
    const loadAuditLog = async () => {
      try {
        const companyDbId = currentCompany?.id;
        const url = companyDbId
          ? "/technical-admin/audit-logs/company/" + companyDbId
          : "/technical-admin/audit-logs";

        const res = await api.get(url);
        const rows: any[] = Array.isArray(res.data?.data) ? res.data.data : [];
        if (!mounted) return;

        setLogs(
          rows
            // Ordinary use is recorded in the same table and reported in the
            // usage panel above. Left in, every row here would read as a
            // technical admin changing something, which is not what happened.
            .filter((r) => r.action !== "MODULE_USE")
            .map((r) => ({
            id: r.id,
            name: r.adminUsername || "Unknown",
            role: "TECHNICAL_ADMIN",
            module: r.entityType || "-",
            action: r.action || "-",
            // Recorded actions are instantaneous; there is no session to time.
            duration: "-",
            timestamp: r.createdAt,
            detail: [r.oldValue, r.newValue].filter(Boolean).join(" → "),
            ip: r.ipAddress
          }))
        );
      } catch (err) {
        if (!mounted) return;
        // Nothing invented in place of an answer.
        setLogs([]);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    /** Who used which modules, and for how long. */
    const loadUsage = async () => {
      try {
        const companyDbId = currentCompany?.id;
        const res = await api.get(
          "/technical-admin/audit-logs/usage" + (companyDbId ? `?companyId=${companyDbId}` : "")
        );
        const data = res.data?.data;
        if (!mounted) return;
        setUsage(Array.isArray(data?.people) ? data.people : []);
        setUsageNote(data?.note || "");
      } catch {
        if (mounted) setUsage([]);
      }
    };

    loadAuditLog();
    loadUsage();

    return () => { mounted = false; };
  }, [currentCompany]);

  const filteredLogs = logs.filter(log => {
    const matchesSearch = log.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          log.module.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          log.action.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesRole = roleFilter === "ALL" || log.role === roleFilter;
    return matchesSearch && matchesRole;
  });

  const getRoleBadgeColor = (role: string) => {
    switch(role) {
      case 'COMPANY_ADMIN': return isDark ? 'bg-cyan-900/40 text-cyan-400 border-cyan-500/30 shadow-[0_0_8px_rgba(6,182,212,0.3)]' : 'bg-indigo-50 text-indigo-700 border-indigo-200 ';
      case 'HR_MANAGER': return isDark ? 'bg-indigo-900/40 text-indigo-400 border-indigo-500/30 shadow-[0_0_8px_rgba(99,102,241,0.3)]' : 'bg-indigo-50 text-indigo-700 border-indigo-200 shadow-[0_0_8px_rgba(99,102,241,0.3)]';
      case 'TEAM_LEAD': return isDark ? 'bg-teal-900/40 text-teal-400 border-teal-500/30 shadow-[0_0_8px_rgba(20,184,166,0.3)]' : 'bg-teal-50 text-teal-700 border-teal-200 shadow-[0_0_8px_rgba(20,184,166,0.3)]';
      default: return isDark ? 'bg-emerald-900/40 text-emerald-400 border-emerald-500/30 shadow-[0_0_8px_rgba(16,185,129,0.3)]' : 'bg-emerald-50 text-emerald-700 border-emerald-200 shadow-[0_0_8px_rgba(16,185,129,0.3)]';
    }
  };

  if (loading) {
    return (
      <div className="flex p-12 justify-center">
        <PixousLoader size="md" />
      </div>
    );
  }

  // Matched to Dashboard, Companies and Users. In light mode this was a dark
  // purple panel at 40% over a photograph, with light text on top — the image
  // came through the panel and sat behind the words.
  const cardBg = isDark
    ? "bg-slate-900/40 backdrop-blur-xl border border-cyan-500/30 shadow-[0_0_15px_rgba(6,182,212,0.15)] text-slate-100"
    : "bg-white/90 backdrop-blur-md border border-white text-slate-800 shadow-xl shadow-slate-200/50";

  return (
    <div className={`min-h-screen pb-10 ${isDark ? 'text-slate-100' : 'text-slate-800'}`}>
      <div className="max-w-[1600px] mx-auto px-6 py-6 space-y-6">
        
        {/* Header */}
        <div className="flex justify-between items-start">
          <div>
            <h2 className={`text-2xl font-bold flex items-center gap-2 ${isDark ? "text-cyan-400 drop-shadow-[0_0_8px_rgba(6,182,212,0.8)]" : "text-slate-600"}`}>
              <History className={`w-6 h-6 ${isDark ? "text-cyan-400" : "text-slate-500"}`} />
              Tenant Module Usage Logs
            </h2>
            <p className={`text-sm mt-1 max-w-2xl font-medium ${isDark ? "text-cyan-400" : "text-slate-600"}`}>
              How employees, HRs and Team Leads use platform modules within <span className={`font-semibold ${isDark ? "text-cyan-400" : "text-slate-500"}`}>{currentCompany?.companyName || "the selected company"}</span>, over the last 30 days.
            </p>
          </div>
          
          <div className={`px-4 py-2 rounded-xl border flex items-center gap-3 ${isDark ? "bg-cyan-900/40 border-cyan-500/30 text-cyan-400 shadow-[0_0_10px_rgba(6,182,212,0.3)]" : "bg-slate-100 border-slate-300 text-slate-600"}`}>
            <Activity className="w-5 h-5" />
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider">Live Monitoring</div>
              <div className="text-sm font-bold">{currentCompany?.companyName}</div>
            </div>
          </div>
        </div>

        {/* ---- who used what, and for how long ---- */}
        <Card className={cardBg}>
          <CardHeader className="pb-3">
            <CardTitle className="text-md flex items-center gap-2">
              <Users className="w-4 h-4" />
              Who used what ({usage.length})
            </CardTitle>
            <CardDescription className={`text-xs ${isDark ? "text-slate-400" : "text-slate-500"}`}>
              {/* Says how the time is arrived at. A duration presented without
                  that reads as measured, and someone will make a decision on it. */}
              Time is the span from a person's first activity to their last, added
              up per day — an upper bound on time spent, not a stopwatch.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            {usage.length === 0 ? (
              <p className={`p-8 text-center text-sm ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                {usageNote || "Nothing recorded yet for this company."}
              </p>
            ) : (
              <table className="w-full text-left text-xs">
                <thead className={`uppercase font-semibold border-b ${isDark ? "bg-cyan-950/40 text-cyan-400 border-cyan-500/20" : "bg-slate-100 text-slate-600 border-slate-200"}`}>
                  <tr>
                    <th className="p-4">Person</th>
                    <th className="p-4">Modules used</th>
                    <th className="p-4 text-right">Opens</th>
                    <th className="p-4 text-right">Days</th>
                    <th className="p-4 text-right">Time</th>
                    <th className="p-4">Last seen</th>
                  </tr>
                </thead>
                <tbody className={`divide-y ${isDark ? "divide-cyan-500/10" : "divide-slate-200"}`}>
                  {usage.map((p) => {
                    const mods: [string, number][] = Object.entries(p.modules || {}) as any;
                    // Busiest module first, so the row reads as what they do.
                    mods.sort((a, b) => b[1] - a[1]);
                    const mins = Number(p.activeMinutes) || 0;
                    return (
                      <tr key={p.userId}>
                        <td className={`p-4 font-semibold ${isDark ? "text-slate-200" : "text-slate-800"}`}>
                          @{p.username}
                        </td>
                        <td className="p-4">
                          <div className="flex flex-wrap gap-1">
                            {mods.map(([code, count]) => (
                              <span
                                key={code}
                                className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${isDark ? "bg-slate-800/60 border-cyan-500/25 text-slate-300" : "bg-slate-100 border-slate-300 text-slate-600"}`}
                              >
                                {code.replace(/_/g, " ")} · {count}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="p-4 text-right tabular-nums">{p.touches}</td>
                        <td className="p-4 text-right tabular-nums">{p.daysActive}</td>
                        <td className="p-4 text-right tabular-nums">
                          {/* Minutes below an hour, hours above it. "127
                              minutes" makes the reader do the division. */}
                          {mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${mins % 60}m`}
                        </td>
                        <td className={`p-4 ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                          {p.lastSeen ? new Date(p.lastSeen).toLocaleString() : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        {/* Filters */}
        <Card className={cardBg}>
          <CardContent className="p-4 flex flex-col md:flex-row gap-4 justify-between items-center">
            <div className="relative w-full md:w-96">
              <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
              <Input
                placeholder="Search user, module, or action..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className={`pl-9 ${isDark ? "bg-slate-900/50 border-cyan-500/30 text-white focus:border-cyan-400" : "bg-white border-slate-300 text-slate-800 placeholder:text-slate-400 focus:border-indigo-500"}`}
              />
            </div>

            <div className="flex items-center gap-2 w-full md:w-auto">
              <span className="text-xs text-slate-400 font-medium">Filter Role:</span>
              <select
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value)}
                className={`p-2.5 rounded-lg text-sm font-semibold outline-none transition-all ${isDark ? "bg-slate-900/50 border-cyan-500/30 text-white focus:ring-2 focus:ring-cyan-400" : "bg-white border-slate-300 text-slate-800 focus:ring-2 focus:ring-purple-500"}`}
              >
                <option value="ALL">All Roles</option>
                <option value="COMPANY_ADMIN">System Admin</option>
                <option value="HR_MANAGER">HR Manager</option>
                <option value="TEAM_LEAD">Team Lead</option>
                <option value="EMPLOYEE">Employee</option>
              </select>
            </div>
          </CardContent>
        </Card>

        {/* Logs Table */}
        <Card className={`${cardBg} overflow-hidden`}>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className={`text-xs uppercase font-medium border-b ${isDark ? 'bg-cyan-950/40 text-cyan-400 border-cyan-500/20' : 'bg-slate-100 text-slate-600 border-slate-200'}`}>
                <tr>
                  <th className="px-6 py-4">User & Role</th>
                  <th className="px-6 py-4">Module Used</th>
                  <th className="px-6 py-4">Specific Action</th>
                  <th className="px-6 py-4">Session Duration</th>
                  <th className="px-6 py-4">Timestamp</th>
                </tr>
              </thead>
              <tbody className={`divide-y ${isDark ? 'divide-cyan-500/10' : 'divide-slate-200'}`}>
                {filteredLogs.length === 0 ? (
                  <tr>
                    {/* "None for the selected filters" implied that clearing
                        them would find some. Nothing writes usage rows yet, so
                        no filter can produce any, and saying which is missing
                        beats letting someone hunt through the dropdowns. */}
                    <td colSpan={5} className="text-center py-12">
                      <p className={`font-medium ${isDark ? "text-slate-300" : "text-slate-700"}`}>
                        Usage tracking is not switched on yet
                      </p>
                      <p className={`mt-1 text-sm ${isDark ? "text-slate-500" : "text-slate-500"}`}>
                        Nothing is recording which modules people open, so there is
                        nothing to show here for any company or filter.
                      </p>
                    </td>
                  </tr>
                ) : (
                  filteredLogs.map((log) => (
                    <tr key={log.id} className={`transition-colors ${isDark ? 'hover:bg-cyan-900/20' : 'hover:bg-slate-50'}`}>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs ${isDark ? 'bg-cyan-900/40 text-cyan-400 shadow-[0_0_8px_rgba(6,182,212,0.3)]' : 'bg-slate-100 text-slate-600 '}`}>
                            {log.name.charAt(0)}
                          </div>
                          <div>
                            <div className={`font-semibold ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>{log.name}</div>
                            <div className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded inline-block mt-1 border border-transparent ${getRoleBadgeColor(log.role)}`}>
                              {log.role.replace("_", " ")}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 font-medium">
                        <span className={`px-3 py-1 rounded-full text-xs font-semibold border ${isDark ? 'bg-slate-900/50 border-cyan-500/30 text-cyan-300' : 'bg-slate-100 border-slate-300 text-slate-600'}`}>
                          {log.module}
                        </span>
                      </td>
                      <td className={`px-6 py-4 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                        {log.action}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-1.5 font-mono text-xs">
                          <Clock className={`w-3.5 h-3.5 ${isDark ? 'text-cyan-400' : 'text-slate-500'}`} />
                          <span className={isDark ? 'text-cyan-400' : 'text-slate-500'}>{log.duration}</span>
                        </div>
                      </td>
                      <td className={`px-6 py-4 text-xs font-mono ${isDark ? 'text-slate-500' : 'text-slate-500'}`}>
                        {/* The server sends ISO-8601. Printed straight into the
                            cell it read "2026-08-14T15:43:02.141", which is a
                            timestamp nobody can scan down a column. */}
                        {log.timestamp ? new Date(log.timestamp).toLocaleString() : "—"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>

      </div>
    </div>
  );
}
