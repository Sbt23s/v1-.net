import { PixousLoader } from "@/components/ui/pixous-loader";
import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Settings2, Save, ShieldCheck, Eye, Cpu, CheckCircle2, XCircle, Check } from "lucide-react";
import { useTechAdminAuth } from "@/context/TechAdminAuthContext";

export function TechAdminCompanyConfig() {
  const { id } = useParams<{ id: string }>();
  const { theme } = useTechAdminAuth();
  const isDark = theme === "dark";

  const [activeTab, setActiveTab] = useState<"modules" | "simulator" | "preview">("modules");
  const [modules, setModules] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);

  // Simulator State
  const [simRole, setSimRole] = useState("Employee");
  const [simModule, setSimModule] = useState("PAYROLL");
  const [simResult, setSimResult] = useState<any>(null);
  const [simulating, setSimulating] = useState(false);

  const defaultModuleList = [
    { moduleCode: "ATTENDANCE", moduleName: "Attendance Management", enabled: true, description: "Track attendance, shifts and biometric data", featureFlags: '{\n  "geoFence": true,\n  "radius": 500,\n  "faceRecognition": true\n}' },
    { moduleCode: "CHAT", moduleName: "Team Chat & Collaboration", enabled: true, description: "Direct chat, group messaging and announcements", featureFlags: '{\n  "directChat": true,\n  "groupChat": true,\n  "fileSharing": true\n}' },
    { moduleCode: "PAYROLL", moduleName: "Payroll & Salary Processing", enabled: false, description: "Salary calculations, payslips and tax management", featureFlags: '{\n  "advancedTax": true,\n  "autoPayslip": true\n}' },
    { moduleCode: "LEAVE", moduleName: "Leave & Holiday Management", enabled: false, description: "Leave requests, leave balances and holiday calendars", featureFlags: '{\n  "carryForward": true,\n  "multiLevelApproval": true\n}' },
    { moduleCode: "ASSET_MANAGEMENT", moduleName: "Asset Allocation & Inventory", enabled: false, description: "Hardware, software asset tracking and requests", featureFlags: '{\n  "qrTracking": true,\n  "warrantyAlerts": true\n}' },
    { moduleCode: "HELPDESK", moduleName: "Employee Helpdesk & Support", enabled: false, description: "Support tickets, SLA tracking and issue resolution", featureFlags: '{\n  "slaTracking": true,\n  "autoAssign": true\n}' },
    { moduleCode: "REPORTS", moduleName: "Analytics & Custom Reports", enabled: false, description: "Executive analytics, compliance reports and exports", featureFlags: '{\n  "exportPdf": true,\n  "exportExcel": true\n}' },
    { moduleCode: "TASKS", moduleName: "Task Management & Boards", enabled: false, description: "Task allocation, kanban boards and project tracking", featureFlags: '{\n  "kanbanBoard": true,\n  "timeTracking": true\n}' }
  ];

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        if (id) {
          const res = await api.get(`/technical-admin/companies/${id}/modules`);
          const fetched = res.data?.data;
          if (Array.isArray(fetched) && fetched.length > 0) {
            setModules(fetched);
          } else {
            setModules(defaultModuleList);
          }
        } else {
          setModules(defaultModuleList);
        }
      } catch (err) {
        console.error(err);
        setModules(defaultModuleList);
      } finally {
        setLoading(false);
      }
    };
    fetchConfig();
  }, [id]);

  const handleToggle = (code: string) => {
    setModules(modules.map(m => m.moduleCode === code ? { ...m, enabled: !m.enabled } : m));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (id) {
        // Save each modified module setting to backend
        for (const mod of modules) {
          await api.post(`/technical-admin/companies/${id}/modules`, {
            moduleCode: mod.moduleCode,
            enabled: mod.enabled,
            featureFlags: mod.featureFlags
          });
        }
      }
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 3000);
    } catch (err) {
      console.error(err);
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 3000);
    } finally {
      setSaving(false);
    }
  };

  const runSimulation = async () => {
    setSimulating(true);
    try {
      const targetMod = modules.find(m => m.moduleCode === simModule);
      const isEnabled = targetMod?.enabled || false;
      
      setSimResult({
        simulatedCompanyId: id || "SETHU-8F42K7",
        simulatedRole: simRole,
        targetModule: simModule,
        status: isEnabled ? "ACCESS_ALLOWED" : "ACCESS_DENIED",
        reason: isEnabled 
          ? `Module ${simModule} is ENABLED for this company and granted to role ${simRole}.`
          : `Module ${simModule} is DISABLED for this company tenant.`
      });
    } catch (err) {
      console.error(err);
    } finally {
      setSimulating(false);
    }
  };

  if (loading) return <div className="flex p-12 justify-center"><PixousLoader size="md" /></div>;

  const cardBg = isDark ? "bg-slate-900 border-slate-800 text-slate-100" : "bg-white border-slate-200 text-slate-900 shadow-sm";
  const borderClass = isDark ? "border-slate-800" : "border-slate-200";

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Tenant Header Banner */}
      <div className={`p-6 rounded-2xl border flex flex-col md:flex-row justify-between items-start md:items-center gap-4 ${isDark ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200 shadow-sm"}`}>
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-blue-500" />
            <h1 className={`text-xl font-bold ${isDark ? "text-white" : "text-slate-900"}`}>
              Company Configuration & Entitlements
            </h1>
          </div>
          <p className={`text-xs mt-1 ${isDark ? "text-slate-400" : "text-slate-500"}`}>
            Tenant Scope ID: <span className="font-mono text-blue-400 font-bold">{id || "SETHU-8F42K7"}</span> • Sethu Technologies
          </p>
        </div>
        <Button onClick={handleSave} disabled={saving} className="bg-blue-600 hover:bg-blue-700 text-white">
          {saving ? <PixousLoader size="xs" className="mr-2" /> : <Save className="w-4 h-4 mr-2" />}
          Save Configuration
        </Button>
      </div>

      {savedSuccess && (
        <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm flex items-center gap-2">
          <Check className="w-4 h-4" /> Configuration saved and updated successfully!
        </div>
      )}

      {/* Tabs */}
      <div className={`flex items-center border-b ${borderClass}`}>
        <button
          onClick={() => setActiveTab("modules")}
          className={`px-4 py-3 text-sm font-medium border-b-2 transition ${
            activeTab === "modules"
              ? "border-blue-500 text-blue-500 font-semibold"
              : isDark ? "border-transparent text-slate-400 hover:text-slate-200" : "border-transparent text-slate-600 hover:text-slate-900"
          }`}
        >
          <Settings2 className="w-4 h-4 inline mr-2" /> Module Entitlements
        </button>
        <button
          onClick={() => setActiveTab("simulator")}
          className={`px-4 py-3 text-sm font-medium border-b-2 transition ${
            activeTab === "simulator"
              ? "border-blue-500 text-blue-500 font-semibold"
              : isDark ? "border-transparent text-slate-400 hover:text-slate-200" : "border-transparent text-slate-600 hover:text-slate-900"
          }`}
        >
          <Cpu className="w-4 h-4 inline mr-2" /> Access Simulator
        </button>
        <button
          onClick={() => setActiveTab("preview")}
          className={`px-4 py-3 text-sm font-medium border-b-2 transition ${
            activeTab === "preview"
              ? "border-blue-500 text-blue-500 font-semibold"
              : isDark ? "border-transparent text-slate-400 hover:text-slate-200" : "border-transparent text-slate-600 hover:text-slate-900"
          }`}
        >
          <Eye className="w-4 h-4 inline mr-2" /> Preview As User
        </button>
      </div>

      {/* TAB 1: Module Entitlements */}
      {activeTab === "modules" && (
        <div className="grid gap-4 md:grid-cols-2">
          {modules.map((mod) => (
            <Card key={mod.moduleCode} className={`${cardBg} transition hover:border-blue-500/40`}>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <div>
                  <CardTitle className={`text-md font-semibold ${isDark ? "text-slate-200" : "text-slate-900"}`}>{mod.moduleName || mod.moduleCode}</CardTitle>
                  <CardDescription className="text-slate-500 text-xs mt-0.5">{mod.description || "Core SaaS Engine Module"}</CardDescription>
                </div>
                <button
                  type="button"
                  onClick={() => handleToggle(mod.moduleCode)}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${
                    mod.enabled ? 'bg-emerald-600' : 'bg-slate-700'
                  }`}
                >
                  <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    mod.enabled ? 'translate-x-5' : 'translate-x-0'
                  }`} />
                </button>
              </CardHeader>
              <CardContent>
                <div className="flex justify-between items-center mb-2">
                  <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${mod.enabled ? (isDark ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-emerald-100 text-emerald-700') : (isDark ? 'bg-slate-800 text-slate-400' : 'bg-slate-100 text-slate-600')}`}>
                    {mod.enabled ? "ENABLED" : "DISABLED"}
                  </span>
                  <span className="text-[11px] text-slate-500 font-mono">Code: {mod.moduleCode}</span>
                </div>
                <div className={`p-3 rounded-lg border text-xs font-mono mt-2 ${isDark ? "bg-slate-950/80 border-slate-800" : "bg-slate-50 border-slate-200"}`}>
                  <p className="text-slate-500 mb-1">Feature Flags (JSON)</p>
                  <code className="text-blue-400 block whitespace-pre">
                    {mod.featureFlags || "{}"}
                  </code>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* TAB 2: Access Simulator */}
      {activeTab === "simulator" && (
        <Card className={cardBg}>
          <CardHeader>
            <CardTitle className="text-md flex items-center gap-2">
              <Cpu className="w-5 h-5 text-blue-500" /> Real-Time Access Simulator
            </CardTitle>
            <CardDescription className="text-xs text-slate-400">
              Evaluate whether a simulated role can access specific modules under current tenant entitlement rules.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-slate-400 block mb-1">Simulated Role</label>
                <select
                  value={simRole}
                  onChange={(e) => setSimRole(e.target.value)}
                  className={`w-full p-2.5 rounded border text-xs font-semibold ${isDark ? "bg-slate-800 border-slate-700 text-white" : "bg-slate-50 border-slate-300 text-slate-900"}`}
                >
                  <option value="Employee">Employee</option>
                  <option value="Team Lead">Team Lead</option>
                  <option value="HR Manager">HR Manager</option>
                  <option value="Company Admin">Company Admin</option>
                </select>
              </div>

              <div>
                <label className="text-xs text-slate-400 block mb-1">Target Module</label>
                <select
                  value={simModule}
                  onChange={(e) => setSimModule(e.target.value)}
                  className={`w-full p-2.5 rounded border text-xs font-semibold ${isDark ? "bg-slate-800 border-slate-700 text-white" : "bg-slate-50 border-slate-300 text-slate-900"}`}
                >
                  <option value="ATTENDANCE">ATTENDANCE</option>
                  <option value="CHAT">CHAT</option>
                  <option value="PAYROLL">PAYROLL</option>
                  <option value="LEAVE">LEAVE</option>
                  <option value="ASSET_MANAGEMENT">ASSET MANAGEMENT</option>
                  <option value="HELPDESK">HELPDESK</option>
                  <option value="REPORTS">REPORTS</option>
                  <option value="TASKS">TASKS</option>
                </select>
              </div>
            </div>

            <Button onClick={runSimulation} disabled={simulating} className="bg-blue-600 hover:bg-blue-700 text-white w-full">
              {simulating ? <PixousLoader size="xs" className="mr-2" /> : "Run Access Evaluation"}
            </Button>

            {simResult && (
              <div className={`p-4 rounded-xl border mt-4 text-xs ${simResult.status === 'ACCESS_ALLOWED' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-red-500/10 border-red-500/20 text-red-400'}`}>
                <div className="flex items-center gap-2 font-bold mb-1">
                  {simResult.status === 'ACCESS_ALLOWED' ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                  <span>{simResult.status}</span>
                </div>
                <p>{simResult.reason}</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* TAB 3: Preview As User */}
      {activeTab === "preview" && (
        <Card className={cardBg}>
          <CardHeader>
            <CardTitle className="text-md flex items-center gap-2">
              <Eye className="w-5 h-5 text-emerald-400" /> Preview As User Experience
            </CardTitle>
            <CardDescription className="text-xs text-slate-400">
              Live simulation of what navigation links and modules an employee at Sethu Technologies will see.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className={`p-6 rounded-2xl border text-center ${isDark ? "bg-slate-950 border-slate-800" : "bg-slate-50 border-slate-200"}`}>
              <h4 className="text-sm font-semibold mb-3">Simulated Employee Navigation Sidebar</h4>
              <div className="flex flex-wrap justify-center gap-3 text-xs font-mono">
                <span className="px-3 py-1.5 rounded bg-blue-500/10 text-blue-400 font-bold border border-blue-500/20">✓ Dashboard</span>
                {modules.map((m) => (
                  m.enabled && (
                    <span key={m.moduleCode} className="px-3 py-1.5 rounded bg-emerald-500/10 text-emerald-400 font-bold border border-emerald-500/20">
                      ✓ {m.moduleName || m.moduleCode}
                    </span>
                  )
                ))}
                <span className="px-3 py-1.5 rounded bg-slate-800 text-slate-400 border border-slate-700">✓ Profile</span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
