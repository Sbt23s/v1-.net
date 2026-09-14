import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTechAdminAuth, defaultModulesTemplate } from '@/context/TechAdminAuthContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';
import toast from 'react-hot-toast';
import {
  Layers, CheckCircle2, Users, UserSquare2, HardDrive, Activity,
  Settings, XCircle, Clock, Building2, Search, SlidersHorizontal,
  Plus, Edit2, Check, User, Shield, X, Sparkles, Filter, CheckSquare
} from 'lucide-react';

export function TechAdminDashboard() {
  const { theme, currentCompany, companies, companyModules, toggleCompanyModule, updateCompany, createCustomModule, companiesFailed, refreshCompanies } = useTechAdminAuth();
  const isDark = theme === 'dark';
  const navigate = useNavigate();

  // Search & Filter State
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearchInput, setShowSearchInput] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [showFilterMenu, setShowFilterMenu] = useState(false);

  // Modals
  const [isEnableModuleOpen, setIsEnableModuleOpen] = useState(false);
  const [isEditProfileOpen, setIsEditProfileOpen] = useState(false);
  const [newModuleName, setNewModuleName] = useState("");
  const [newModuleDesc, setNewModuleDesc] = useState("");
  const [moduleBusy, setModuleBusy] = useState(false);
  const [moduleError, setModuleError] = useState<string | null>(null);

  // Real-time user count from backend
  const [realUserCount, setRealUserCount] = useState<number | null>(0);

  const activeCompanyName = currentCompany?.companyName || "Pixous Technologies";
  const activeCompanyId = currentCompany?.companyId || "PIX-MASTER";
  const activeIndustry = currentCompany?.industry || "IT Services";
  const activeDomain = currentCompany?.domain || `${activeCompanyId.toLowerCase().replace(/[^a-z0-9]/g, "")}.pixous.com`;

  // Fetch real user count from backend
  useEffect(() => {
    const fetchUserCount = async () => {
      try {
        /*
         * Counted for the company on screen, not across the platform.
         *
         * This asked for totalElements and showed it whole, so every tenant
         * reported the same figure — 62 appeared beside Sethu Technologies
         * because 62 is how many accounts exist altogether. Switching companies
         * in the header changed the name above the number and never the number,
         * and the effect had no dependency on the company either, so it would
         * not have recounted even if it had been asking the right question.
         */
        const res = await api.get("/users?size=300");
        const payload = res.data?.data;
        const rows: any[] = Array.isArray(payload?.content)
          ? payload.content
          : Array.isArray(payload)
            ? payload
            : [];

        // "Excluding Admins" was done by subtracting one, which is right only
        // for a company with exactly one administrator. Counted properly here.
        const ADMIN_ROLES = ["COMPANY_ADMIN", "SUPER_ADMIN", "BOARD_ADMIN", "CV_ADM", "IT_ADM"];
        const isAdmin = (u: any) => {
          const roles: string[] = Array.isArray(u?.roles)
            ? u.roles.map(String)
            : u?.role
              ? [String(u.role)]
              : [];
          return roles.some((r) => ADMIN_ROLES.includes(r));
        };

        setRealUserCount(
          rows.filter((u) => u?.companyName === activeCompanyName && !isAdmin(u)).length
        );
      } catch {
        // Was `|| 32` — a number with no source, shown as though it were real.
        // Null renders as a dash, which is what "we could not count" looks like.
        setRealUserCount(null);
      }
    };
    fetchUserCount();
    
    // Re-fetch when users are updated
    const handleUpdate = () => fetchUserCount();
    window.addEventListener("hrp_users_updated", handleUpdate);
    window.addEventListener("storage", handleUpdate);
    return () => {
      window.removeEventListener("hrp_users_updated", handleUpdate);
      window.removeEventListener("storage", handleUpdate);
    };
  }, [currentCompany]);

  // Company Profile State
  const [companyProfile, setCompanyProfile] = useState({
    name: "",
    companyId: "",
    industry: "",
    validUntil: "",
    createdOn: "",
    domain: "",
    address: "",
    phone: ""
  });

  useEffect(() => {
    if (currentCompany) {
      setCompanyProfile({
        name: currentCompany.companyName || "",
        companyId: currentCompany.companyId || "",
        industry: currentCompany.industry || "",
        validUntil: currentCompany.validUntil || "08 Aug 2027",
        createdOn: currentCompany.createdOn || "01 Jan 2026",
        domain: currentCompany.domain || `${currentCompany.companyId?.toLowerCase().replace(/[^a-z0-9]/g, "")}.pixous.com`,
        address: currentCompany.address || "",
        phone: currentCompany.phone || ""
      });
    }
  }, [currentCompany]);

  const [modules, setModules] = useState<any[]>([
    { id: 1, code: 'ATTENDANCE', name: 'Attendance', description: 'Track employee attendance and work hours', category: 'Core HR', status: 'ENABLED', visibleTo: 4, lastUpdated: '08 Aug 2026' },
    { id: 2, code: 'CHAT', name: 'Chat', description: 'Internal team communication and messaging', category: 'Collaboration', status: 'ENABLED', visibleTo: 4, lastUpdated: '08 Aug 2026' },
    { id: 3, code: 'PAYROLL', name: 'Payroll', description: 'Salary processing and tax calculations', category: 'Finance', status: 'DISABLED', visibleTo: 2, lastUpdated: '15 Jul 2026' },
    { id: 4, code: 'LEAVE', name: 'Leave Management', description: 'Manage employee time off and holidays', category: 'Core HR', status: 'DISABLED', visibleTo: 4, lastUpdated: '20 Jul 2026' },
    { id: 5, code: 'ASSETS', name: 'Assets Management', description: 'Track company hardware and software assets', category: 'Operations', status: 'DISABLED', visibleTo: 3, lastUpdated: '25 Jul 2026' },
  ]);

  useEffect(() => {
    const activeTenantMods = companyModules[activeCompanyId] || [];
    if (activeTenantMods.length > 0) {
      setModules(activeTenantMods.map(tm => ({
        id: tm.id,
        code: tm.code,
        name: tm.name,
        description: tm.description,
        category: tm.category,
        status: tm.enabled ? 'ENABLED' : 'DISABLED',
        visibleTo: tm.enabled ? 4 : 0,
        lastUpdated: '08 Aug 2026'
      })));
    }
  }, [activeCompanyId, companyModules]);

  const toggleModule = async (id: number) => {
    const target = modules.find(m => m.id === id);
    if (target && target.code) {
      // Optimistic update for instant UI feedback
      setModules(prev => prev.map(m => m.id === id ? { ...m, status: m.status === 'ENABLED' ? 'DISABLED' : 'ENABLED' } : m));
      try {
        await toggleCompanyModule(activeCompanyId, target.code);
      } catch (err) {
        // Revert on failure
        setModules(prev => prev.map(m => m.id === id ? { ...m, status: m.status === 'ENABLED' ? 'DISABLED' : 'ENABLED' } : m));
        toast.error("Failed to toggle module");
      }
    }
  };

  /**
   * Create a module this tenant defines for itself.
   *
   * This used to flip a row in local state and close, which is why the button
   * appeared to work and changed nothing: no request was ever sent, and the
   * next reload showed the module untouched. The five names it offered were
   * also modules the table below already lists, so the dialog could only ever
   * duplicate a switch that was already there.
   */
  const handleEnableNewModule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (moduleBusy) return; // one module per submit
    setModuleError(null);
    setModuleBusy(true);
    try {
      await createCustomModule(activeCompanyId, newModuleName, newModuleDesc);
      setNewModuleName("");
      setNewModuleDesc("");
      setIsEnableModuleOpen(false);
    } catch (err: any) {
      setModuleError(err?.response?.data?.message || err?.message || "Could not create the module");
    } finally {
      setModuleBusy(false);
    }
  };

  const handleSaveProfile = (e: React.FormEvent) => {
    e.preventDefault();
    updateCompany(activeCompanyId, {
      companyName: companyProfile.name,
      industry: companyProfile.industry,
      domain: companyProfile.domain,
      validUntil: companyProfile.validUntil,
      address: companyProfile.address,
      phone: companyProfile.phone
    });
    toast.success("Company profile updated successfully!");
    setIsEditProfileOpen(false);
  };

  const filteredModules = modules.filter(m => {
    const matchesSearch = m.name.toLowerCase().includes(searchQuery.toLowerCase()) || m.description.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = selectedCategory === "All" || m.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  // Always use the real-time user count fetched from backend or localStorage
  const displayUserCount = realUserCount;

  /**
   * Every module the platform has: the built-in catalogue plus any custom one
   * created for a company.
   *
   * This tile read a hard-coded 22 while the module screen counted its own list
   * and showed 17 — the same question answered two different ways, with neither
   * number moving when a module was added. Counted from the catalogue itself now,
   * so the two agree and stay agreeing.
   *
   * BRANDING is left out: that row stores a company's appearance settings, not a
   * feature anybody switches on.
   */
  const customModuleCodes = new Set<string>();
  Object.values(companyModules || {}).forEach((rows: any) => {
    (Array.isArray(rows) ? rows : []).forEach((m: any) => {
      if (!m?.code) return;
      if (m.code.toUpperCase() === "BRANDING") return;
      if (defaultModulesTemplate.some((t) => t.code === m.code)) return;
      customModuleCodes.add(m.code);
    });
  });
  const totalModules = defaultModulesTemplate.length + customModuleCodes.size;

  const statCards = [
    // A dash, not 0, when the list could not be read. Showing zero tenants for
    // a failed request is the reason a reload looked like everything had been
    // wiped: the panels went blank and the tiles calmly reported nothing there.
    { title: 'Total Companies', value: companiesFailed ? '—' : (companies?.length || 0), subtitle: companiesFailed ? 'Could not load — press Retry' : 'SaaS Tenants Provisioned', icon: Building2, colorClass: isDark ? 'bg-cyan-900/40 text-cyan-400 border border-cyan-500/50 shadow-[0_0_10px_rgba(6,182,212,0.3)]' : 'bg-indigo-500/10 text-indigo-500 dark:text-indigo-400', trend: 'Active Network' },
    { title: 'Total Modules', value: String(totalModules), subtitle: 'Available System Modules', icon: Layers, colorClass: isDark ? 'bg-cyan-900/40 text-cyan-400 border border-cyan-500/50 shadow-[0_0_10px_rgba(6,182,212,0.3)]' : 'bg-purple-500/10 text-purple-500 dark:text-purple-400', trend: 'System Wide' },
    { title: 'Enabled Modules', value: modules.filter(m => m.status === 'ENABLED').length, subtitle: `Active in ${currentCompany?.companyName || 'Tenant'}`, icon: CheckCircle2, colorClass: isDark ? 'bg-cyan-900/40 text-cyan-400 border border-cyan-500/50 shadow-[0_0_10px_rgba(6,182,212,0.3)]' : 'bg-emerald-500/10 text-emerald-500 dark:text-emerald-400', trend: 'Current Tenant' },
    { title: 'Active Employees', value: displayUserCount === null ? '—' : displayUserCount, subtitle: displayUserCount === null ? 'Could not count' : 'Standard Employees', icon: UserSquare2, colorClass: isDark ? 'bg-cyan-900/40 text-cyan-400 border border-cyan-500/50 shadow-[0_0_10px_rgba(6,182,212,0.3)]' : 'bg-teal-500/10 text-teal-500 dark:text-teal-400', trend: 'Excluding Admins' },
  ];

  const roleAccessMatrix = [
    { module: 'Attendance', roles: { techAdmin: true, hrAdmin: true, teamLead: true, employee: true, accountant: false } },
    { module: 'Chat', roles: { techAdmin: true, hrAdmin: true, teamLead: true, employee: true, accountant: true } },
    { module: 'Payroll', roles: { techAdmin: true, hrAdmin: true, teamLead: false, employee: false, accountant: true } },
    { module: 'Leave Management', roles: { techAdmin: true, hrAdmin: true, teamLead: true, employee: true, accountant: false } },
    { module: 'Assets Management', roles: { techAdmin: true, hrAdmin: true, teamLead: false, employee: false, accountant: true } },
  ];

  const userVisibilitySettings = [
    { role: 'Technical Admin', scope: 'Company Wide', color: 'bg-indigo-500/10 text-indigo-500 dark:text-indigo-400 border-indigo-500/20', desc: 'Full access to all system configurations and data' },
    { role: 'HR Admin', scope: 'Company Wide', color: 'bg-indigo-500/10 text-indigo-500 dark:text-indigo-400 border-indigo-500/20', desc: 'Access to all employee records across departments' },
    { role: 'Team Lead', scope: 'Team Level', color: 'bg-teal-500/10 text-teal-500 dark:text-teal-400 border-teal-500/20', desc: 'Access restricted to direct reports and team members' },
    { role: 'Employee', scope: 'Self Only', color: 'bg-amber-500/10 text-amber-500 dark:text-amber-400 border-amber-500/20', desc: 'Access limited to own profile and records' },
    { role: 'Accountant', scope: 'Financial Data', color: 'bg-purple-500/10 text-purple-500 dark:text-purple-400 border-purple-500/20', desc: 'Access to financial records and payroll processing' },
  ];

  const recentActivity = [
    { time: '10 mins ago', user: 'Admin User', action: 'Chat module enabled', type: 'module' },
    { time: '1 hour ago', user: 'System', action: 'Automated backup completed', type: 'system' },
    { time: '3 hours ago', user: 'Admin User', action: 'Updated Payroll module permissions', type: 'permission' },
    { time: 'Yesterday', user: 'HR Manager', action: 'Added 5 new employees', type: 'user' },
  ];

  // Helper styles based on theme
  // Helper styles based on theme
  const cardBgClass = isDark ? 'bg-slate-900/40 backdrop-blur-xl border-cyan-500/30 shadow-[0_0_15px_rgba(6,182,212,0.15)] text-slate-100' : 'bg-white/90 backdrop-blur-md border-white text-slate-800 shadow-xl shadow-slate-200/50';
  const tableHeaderBgClass = isDark ? 'bg-cyan-950/40 text-cyan-400' : 'bg-slate-50/80 text-slate-600 border-b border-slate-200';
  const tableRowHoverClass = isDark ? 'hover:bg-cyan-900/20' : 'hover:bg-slate-50/50 border-b border-slate-100';
  const textMutedClass = isDark ? 'text-cyan-400 font-medium' : 'text-slate-500 font-medium';
  const textPrimaryClass = isDark ? 'text-slate-200 font-semibold' : 'text-slate-800 font-semibold';
  const borderClass = isDark ? 'border-cyan-500/20' : 'border-slate-200';

  const Toggle = ({ enabled, onClick }: { enabled: boolean; onClick: () => void }) => (
    <div
      onClick={onClick}
      className={`relative inline-flex h-6 w-11 items-center rounded-full cursor-pointer transition-colors focus:outline-none ${enabled ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'}`}
    >
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${enabled ? 'translate-x-6' : 'translate-x-1'}`} />
    </div>
  );

  return (
    <div className={`min-h-screen p-6 ${isDark ? 'bg-transparent text-slate-100' : 'bg-transparent text-slate-800'}`}>

      {/* Said out loud, with a way out of it. Without this the page after a
          failed reload was indistinguishable from a platform with no tenants —
          the tiles read zero and the company panel sat empty, and nothing on
          screen suggested trying again. */}
      {companiesFailed && (
        <div
          role="alert"
          className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-400/60 bg-amber-50 px-4 py-3 dark:border-amber-500/40 dark:bg-amber-950/30"
        >
          <div>
            <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
              Could not load your companies
            </p>
            <p className="mt-0.5 text-xs text-amber-800/90 dark:text-amber-200/80">
              You are still signed in. The figures below are incomplete until this loads.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refreshCompanies()}
            className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-amber-500"
          >
            Retry
          </button>
        </div>
      )}

      {/* 1. TOP STAT CARDS */}
      <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {statCards.map((stat, i) => (
          <Card key={i} className={`${cardBgClass} transition hover:border-indigo-500/50 cursor-pointer`}>
            <CardContent className="p-4 flex flex-col h-full justify-between">
              <div className="flex justify-between items-start mb-2">
                <div className={`p-2 rounded-lg ${stat.colorClass}`}>
                  <stat.icon className="w-5 h-5" />
                </div>
                <span className={`text-xs font-medium ${textMutedClass}`}>{stat.trend}</span>
              </div>
              <div>
                <h3 className={`text-3xl font-bold mb-1 ${isDark ? 'text-cyan-400 drop-shadow-[0_0_8px_rgba(6,182,212,0.5)]' : textPrimaryClass}`}>{stat.value}</h3>
                <p className={`text-sm font-medium ${textPrimaryClass}`}>{stat.title}</p>
                <p className={`text-xs ${textMutedClass} mt-1`}>{stat.subtitle}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Main Content Area (col-span-3) */}
        <div className="lg:col-span-3 space-y-6">
          
          {/* 2. MIDDLE SECTION - Company Module Overview */}
          <Card className={cardBgClass}>
            <CardHeader className="flex flex-col sm:flex-row items-start sm:items-center justify-between pb-4 gap-4">
              <div>
                <CardTitle>Company Module Overview</CardTitle>
                <CardDescription>Manage and configure modules for your organization</CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {showSearchInput ? (
                  <div className="relative flex items-center">
                    <Search className="w-4 h-4 absolute left-2.5 text-slate-400" />
                    <Input
                      autoFocus
                      placeholder="Search modules..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className={`pl-8 h-9 text-xs w-48 ${isDark ? "bg-slate-900 border-slate-700" : "bg-slate-50 border-slate-300"}`}
                    />
                    <button onClick={() => { setShowSearchInput(false); setSearchQuery(""); }} className="p-1 text-slate-400 hover:text-white">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <Button variant="outline" size="sm" onClick={() => setShowSearchInput(true)} className={`h-9 font-semibold ${isDark ? 'border-cyan-500/30 text-cyan-400 hover:bg-cyan-900/30 shadow-[0_0_8px_rgba(6,182,212,0.1)]' : 'border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-900 shadow-sm'}`}>
                    <Search className="w-4 h-4 mr-2" />Search
                  </Button>
                )}

                <div className="relative">
                  <Button variant="outline" size="sm" onClick={() => setShowFilterMenu(!showFilterMenu)} className={`h-9 font-semibold ${isDark ? 'border-cyan-500/30 text-cyan-400 hover:bg-cyan-900/30 shadow-[0_0_8px_rgba(6,182,212,0.1)]' : 'border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-900 shadow-sm'}`}>
                    <SlidersHorizontal className="w-4 h-4 mr-2" />Filter
                  </Button>
                  {showFilterMenu && (
                    <div className={`absolute right-0 mt-1 w-44 rounded-lg shadow-xl border z-20 p-1 text-xs ${isDark ? "bg-slate-900 border-slate-800 text-slate-200" : "bg-white border-slate-200 text-slate-800"}`}>
                      {["All", "Core HR", "Collaboration", "Finance", "Operations"].map(cat => (
                        <div
                          key={cat}
                          onClick={() => { setSelectedCategory(cat); setShowFilterMenu(false); }}
                          className={`px-3 py-2 rounded cursor-pointer flex justify-between items-center ${selectedCategory === cat ? (isDark ? "bg-indigo-600/20 text-indigo-400 font-bold" : "bg-indigo-50 text-indigo-600 font-bold") : (isDark ? "hover:bg-slate-800" : "hover:bg-slate-100")}`}
                        >
                          <span>{cat}</span>
                          {selectedCategory === cat && <Check className="w-3.5 h-3.5" />}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <Button size="sm" onClick={() => setIsEnableModuleOpen(true)} className={`h-9 font-medium ${isDark ? "bg-cyan-500 hover:bg-cyan-400 text-slate-950 border border-cyan-400 shadow-[0_0_10px_rgba(6,182,212,0.4)]" : "bg-blue-500 hover:bg-blue-600 text-white shadow-md shadow-blue-500/20"}`}>
                  <Plus className="w-4 h-4 mr-2" />Create Module
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className={`rounded-md border ${borderClass} overflow-hidden`}>
                <table className="w-full text-sm">
                  <thead className={tableHeaderBgClass}>
                    <tr className="text-left">
                      <th className="px-4 py-3 font-medium">Module Name</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                      <th className="px-4 py-3 font-medium">Visible To</th>
                      <th className="px-4 py-3 font-medium">Last Updated</th>
                      <th className="px-4 py-3 font-medium text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/10 dark:divide-slate-800">
                    {filteredModules.map((mod) => (
                      <tr key={mod.id} className={tableRowHoverClass}>
                        <td className="px-4 py-3">
                          <p className="font-medium">{mod.name}</p>
                          <p className={`text-xs ${textMutedClass}`}>{mod.description}</p>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <span className={`px-2 py-1 text-xs font-medium rounded-md border ${mod.status === 'ENABLED' ? (isDark ? 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30 shadow-[0_0_8px_rgba(6,182,212,0.2)]' : 'bg-teal-50 text-teal-700 border-teal-200 shadow-sm') : (isDark ? 'bg-slate-800/50 text-slate-500 border-slate-700' : 'bg-slate-100 text-slate-500 border-slate-200')}`}>
                              {mod.status}
                            </span>
                            <Toggle enabled={mod.status === 'ENABLED'} onClick={() => toggleModule(mod.id)} />
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex -space-x-2 overflow-hidden">
                            {[...Array(mod.visibleTo)].map((_, i) => (
                              <div key={i} className={`inline-block h-6 w-6 rounded-full ring-2 ${isDark ? 'ring-[#0f172a] bg-slate-700' : 'ring-white bg-slate-100'} flex items-center justify-center`}>
                                <User className="w-3 h-3 text-slate-400" />
                              </div>
                            ))}
                          </div>
                        </td>
                        <td className={`px-4 py-3 text-xs ${textMutedClass}`}>{mod.lastUpdated}</td>
                        <td className="px-4 py-3 text-right">
                          <Link to="/tech-admin/module-management">
                            <Button variant="ghost" size="sm" className={isDark ? "text-cyan-400 hover:bg-cyan-900/30 hover:text-cyan-300" : "text-indigo-600 hover:bg-indigo-50 hover:text-indigo-800"}>
                              <Settings className="w-4 h-4 mr-2" />Configure
                            </Button>
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className={`flex items-center justify-between mt-4 text-xs ${textMutedClass}`}>
                <span>Showing 1 to {filteredModules.length} of 22 modules</span>
                <div className="flex gap-1">
                  <Button variant="outline" size="sm" className="h-7 px-2" disabled>Prev</Button>
                  <Button variant="outline" size="sm" className="h-7 w-7 p-0 bg-primary text-primary-foreground">1</Button>
                  <Button variant="outline" size="sm" className="h-7 w-7 p-0">2</Button>
                  <Button variant="outline" size="sm" className="h-7 w-7 p-0">3</Button>
                  <Button variant="outline" size="sm" className="h-7 px-2">Next</Button>
                </div>
              </div>
            </CardContent>
          </Card>


          
        </div>

        {/* 5. RIGHT SIDEBAR PANEL */}
        <div className="lg:col-span-1 space-y-6">
          <Card className={cardBgClass}>
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2"><Building2 className="w-5 h-5" /> Company Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-3 text-sm">
                <div className="flex justify-between pb-2 border-b border-slate-800/10 dark:border-slate-800">
                  <span className={textMutedClass}>Company Name</span>
                  <span className="font-medium text-slate-200">{currentCompany?.companyName}</span>
                </div>
                <div className={`flex justify-between pb-2 border-b ${isDark ? 'border-cyan-500/20' : 'border-slate-200'}`}>
                  <span className={textMutedClass}>Company ID</span>
                  <span className={`font-medium font-mono ${isDark ? 'text-cyan-400' : 'text-blue-600'}`}>{currentCompany?.companyId}</span>
                </div>
                <div className="flex justify-between pb-2 border-b border-slate-800/10 dark:border-slate-800">
                  <span className={textMutedClass}>Industry</span>
                  <span className="font-medium">{currentCompany?.industry}</span>
                </div>
                <div className="flex justify-between pb-2 border-b border-slate-800/10 dark:border-slate-800">
                  <span className={textMutedClass}>Valid Until</span>
                  <span className="font-medium text-emerald-500 dark:text-emerald-400">{currentCompany?.validUntil || "08 Aug 2027"}</span>
                </div>
                <div className="flex justify-between pb-2 border-b border-slate-800/10 dark:border-slate-800">
                  <span className={textMutedClass}>Created On</span>
                  <span className="font-medium">{currentCompany?.createdOn || "01 Jan 2026"}</span>
                </div>
                <div className={`flex justify-between pb-2 border-b ${isDark ? 'border-cyan-500/20' : 'border-slate-200'}`}>
                  <span className={textMutedClass}>Domain</span>
                  <span className={`font-medium font-mono ${isDark ? 'text-cyan-400' : 'text-blue-600'}`}>{currentCompany?.domain || `${currentCompany?.companyId?.toLowerCase().replace(/[^a-z0-9]/g, "")}.pixous.com`}</span>
                </div>
                <div className="flex justify-between pb-2 border-b border-slate-800/10 dark:border-slate-800">
                  <span className={textMutedClass}>Address</span>
                  <span className="font-medium text-slate-300 text-right max-w-[200px] truncate" title={currentCompany?.address || "Not Configured"}>{currentCompany?.address || "Not Configured"}</span>
                </div>
                <div className="flex justify-between pb-2 border-b border-slate-800/10 dark:border-slate-800">
                  <span className={textMutedClass}>Phone</span>
                  <span className="font-medium text-slate-300">{currentCompany?.phone || "Not Configured"}</span>
                </div>
              </div>
              
              <Button onClick={() => setIsEditProfileOpen(true)} className={`w-full font-medium ${isDark ? "bg-cyan-500 hover:bg-cyan-400 text-slate-950 border border-cyan-400 shadow-[0_0_10px_rgba(6,182,212,0.4)]" : "bg-blue-500 hover:bg-blue-600 text-white shadow-md shadow-blue-500/20"}`}>
                <Edit2 className="w-4 h-4 mr-2" />Edit Company Profile
              </Button>

              {/* Storage Overview and Quick Actions removed on request.
                  Storage was not measured — it read "users × 0.35 GB / 100 GB",
                  with the same arithmetic split into Documents, Photos and
                  System. None of it came from anywhere; the files live in the
                  database and nothing counts them. Quick Actions repeated three
                  links the sidebar already carries. */}
            </CardContent>
          </Card>
        </div>

      </div>

      {/* Enable New Module Modal */}
      {isEnableModuleOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className={`w-full max-w-md rounded-2xl p-6 shadow-2xl border ${isDark ? "bg-slate-900/80 backdrop-blur-xl border-cyan-500/30 text-white" : "bg-[#13002b]/90 backdrop-blur-xl border-purple-500/30 text-purple-50"}`}>
            <div className={`flex items-center justify-between pb-4 border-b ${isDark ? "border-slate-800" : "border-purple-500/30"}`}>
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <Plus className={`w-5 h-5 ${isDark ? "text-indigo-500" : "text-purple-400"}`} /> Create a module for this company
              </h3>
              <button onClick={() => setIsEnableModuleOpen(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleEnableNewModule} className="space-y-4 pt-4">
              <div>
                <Label className={isDark ? "text-slate-300" : "text-purple-300"}>Module name</Label>
                <input
                  value={newModuleName}
                  onChange={(e) => setNewModuleName(e.target.value)}
                  disabled={moduleBusy}
                  maxLength={60}
                  autoFocus
                  placeholder="Site Visits"
                  className={`w-full mt-1.5 p-2.5 rounded-lg border text-sm ${isDark ? "bg-slate-800 border-slate-700 text-white placeholder:text-slate-500" : "bg-purple-950/50 border-purple-500/30 text-purple-100 placeholder:text-purple-400/60"}`}
                />
              </div>

              <div>
                <Label className={isDark ? "text-slate-300" : "text-purple-300"}>What it is for</Label>
                <input
                  value={newModuleDesc}
                  onChange={(e) => setNewModuleDesc(e.target.value)}
                  disabled={moduleBusy}
                  maxLength={140}
                  placeholder="Logging visits to client sites"
                  className={`w-full mt-1.5 p-2.5 rounded-lg border text-sm ${isDark ? "bg-slate-800 border-slate-700 text-white placeholder:text-slate-500" : "bg-purple-950/50 border-purple-500/30 text-purple-100 placeholder:text-purple-400/60"}`}
                />
              </div>

              {/* Created switched off — say so, rather than let someone go
                  looking for it in the navigation and find nothing. */}
              <p className={`text-xs ${isDark ? "text-slate-400" : "text-purple-300/80"}`}>
                Added to this company switched off. Turn it on in the table below when it is ready.
              </p>

              {moduleError && (
                <p className="text-xs font-medium text-rose-400">{moduleError}</p>
              )}

              <div className={`pt-4 flex justify-end gap-3 border-t ${isDark ? "border-cyan-500/20" : "border-purple-500/20"}`}>
                <Button type="button" variant="outline" onClick={() => setIsEnableModuleOpen(false)} className={`${isDark ? "text-slate-300 border-cyan-500/30 hover:bg-cyan-900/30" : "text-purple-300 border-purple-500/30 hover:bg-purple-900/30"}`}>
                  Cancel
                </Button>
                <Button type="submit" disabled={moduleBusy || !newModuleName.trim()} className={`${isDark ? "bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold border border-cyan-400 shadow-[0_0_10px_rgba(6,182,212,0.4)]" : "bg-purple-600 hover:bg-purple-500 text-white border border-purple-400 shadow-[0_0_15px_rgba(168,85,247,0.5)]"}`}>
                  {moduleBusy ? "Creating…" : "Create module"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Company Profile Modal */}
      {isEditProfileOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className={`w-full max-w-md rounded-2xl p-6 shadow-2xl border ${isDark ? "bg-slate-900/80 backdrop-blur-xl border-cyan-500/30 text-white" : "bg-[#13002b]/90 backdrop-blur-xl border-purple-500/30 text-purple-50"}`}>
            <div className={`flex items-center justify-between pb-4 border-b ${isDark ? "border-slate-800" : "border-purple-500/30"}`}>
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <Edit2 className={`w-5 h-5 ${isDark ? "text-indigo-500" : "text-purple-400"}`} /> Edit Company Profile
              </h3>
              <button onClick={() => setIsEditProfileOpen(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveProfile} className="space-y-4 pt-4">
              <div>
                <Label className={isDark ? "text-slate-300" : "text-purple-300"}>Company Name</Label>
                <Input
                  value={companyProfile.name}
                  onChange={(e) => setCompanyProfile({ ...companyProfile, name: e.target.value })}
                  className={`mt-1 ${isDark ? "bg-slate-900/50 border-cyan-500/30 text-white focus:border-cyan-400" : "bg-purple-950/50 border-purple-500/30 text-purple-100 focus:border-purple-400"}`}
                />
              </div>

              <div>
                <Label className={isDark ? "text-slate-300" : "text-purple-300"}>Industry</Label>
                <Input
                  value={companyProfile.industry}
                  onChange={(e) => setCompanyProfile({ ...companyProfile, industry: e.target.value })}
                  className={`mt-1 ${isDark ? "bg-slate-900/50 border-cyan-500/30 text-white focus:border-cyan-400" : "bg-purple-950/50 border-purple-500/30 text-purple-100 focus:border-purple-400"}`}
                />
              </div>

              <div>
                <Label className={isDark ? "text-slate-300" : "text-purple-300"}>Domain</Label>
                <Input
                  value={companyProfile.domain}
                  onChange={(e) => setCompanyProfile({ ...companyProfile, domain: e.target.value })}
                  className={`mt-1 ${isDark ? "bg-slate-800 border-slate-700 text-white" : "bg-purple-950/50 border-purple-500/30 text-purple-100 focus:border-purple-400"}`}
                />
              </div>

              <div>
                <Label className={isDark ? "text-slate-300" : "text-purple-300"}>Valid Until Date</Label>
                <Input
                  value={companyProfile.validUntil}
                  onChange={(e) => setCompanyProfile({ ...companyProfile, validUntil: e.target.value })}
                  className={`mt-1 ${isDark ? "bg-slate-800 border-slate-700 text-white" : "bg-purple-950/50 border-purple-500/30 text-purple-100 focus:border-purple-400"}`}
                />
              </div>

              <div>
                <Label className={isDark ? "text-slate-300" : "text-purple-300"}>Company Address</Label>
                <Input
                  value={companyProfile.address}
                  onChange={(e) => setCompanyProfile({ ...companyProfile, address: e.target.value })}
                  placeholder="e.g. 456 Industrial Area, Suite 10"
                  className={`mt-1 ${isDark ? "bg-slate-800 border-slate-700 text-white" : "bg-purple-950/50 border-purple-500/30 text-purple-100 placeholder-purple-400/50 focus:border-purple-400"}`}
                />
              </div>

              <div>
                <Label className={isDark ? "text-slate-300" : "text-purple-300"}>Phone Number</Label>
                <Input
                  value={companyProfile.phone}
                  onChange={(e) => setCompanyProfile({ ...companyProfile, phone: e.target.value })}
                  placeholder="e.g. +91 99999 88888"
                  className={`mt-1 ${isDark ? "bg-slate-800 border-slate-700 text-white" : "bg-purple-950/50 border-purple-500/30 text-purple-100 placeholder-purple-400/50 focus:border-purple-400"}`}
                />
              </div>

              <div className={`pt-4 flex justify-end gap-3 border-t ${isDark ? "border-cyan-500/20" : "border-purple-500/20"}`}>
                <Button type="button" variant="outline" onClick={() => setIsEditProfileOpen(false)} className={`${isDark ? "text-slate-300 border-cyan-500/30 hover:bg-cyan-900/30" : "text-purple-300 border-purple-500/30 hover:bg-purple-900/30"}`}>
                  Cancel
                </Button>
                <Button type="submit" className={`${isDark ? "bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold border border-cyan-400 shadow-[0_0_10px_rgba(6,182,212,0.4)]" : "bg-purple-600 hover:bg-purple-500 text-white border border-purple-400 shadow-[0_0_15px_rgba(168,85,247,0.5)]"}`}>
                  Save Changes
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
