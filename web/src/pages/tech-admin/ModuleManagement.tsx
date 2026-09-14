import React, { useState, useEffect } from 'react';
import { useTechAdminAuth, defaultModulesTemplate } from '@/context/TechAdminAuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import toast from 'react-hot-toast';
import {
  ChevronRight, ChevronLeft, Save, History, Building2, CheckCircle2, XCircle, Users,
  Search, Filter, MoreHorizontal, Settings2, Download, RefreshCw, X,
  Calendar, MessageSquare, User, Bell, ChevronDown, Check,
  FileText, CalendarOff, Box, HelpCircle, BarChart3,
  CheckSquare, UserCheck, CreditCard,
  FolderGit2, Megaphone, Users2, CalendarDays, Bot, ShieldCheck,
  LayoutDashboard, SlidersHorizontal
} from 'lucide-react';

export function TechAdminModuleManagement() {
  const {
    theme,
    currentCompany,
    companyModules,
    toggleCompanyModule,
    toggleCompanyModuleRole,
    enableAllCompanyModules,
    disableAllCompanyModules,
    resetCompanyModulesDefault
  } = useTechAdminAuth();

  const isDark = theme === 'dark';

  const tenantName = currentCompany?.companyName || "Pixous Technologies";
  const tenantId = currentCompany?.companyId || "PIX-MASTER";
  const tenantIndustry = currentCompany?.industry || "IT Services";
  const tenantEmpCount = currentCompany?.employeeCount || 32;

  // Search & Filter state
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All Categories');
  const [isCategoryDropdownOpen, setIsCategoryDropdownOpen] = useState(false);

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 6; // Show 6 modules per page to enable pagination

  // A string as well as a number: custom modules are keyed by their code, since
  // they have no place in the numbered catalogue.
  const [selectedModuleId, setSelectedModuleId] = useState<number | string | null>(1);

  // The modules the portal actually has. Every entry here must correspond to a
  // route in routes/router.tsx -- a module that can be switched on but leads
  // nowhere is worse than one that is absent, because the switch says the feature
  // exists. Seven were listed that had no page at all (Performance Appraisals,
  // Recruitment & ATS, Time Tracking, Learning & Development, Employee Surveys,
  // Company Directory, OKR); they have been removed rather than left as promises.
  // Add one back only together with its page.
  /**
   * Built from defaultModulesTemplate, the same list the rest of the section
   * reads.
   *
   * This was a second hard-coded catalogue of fourteen modules kept beside the
   * template's twenty-three, so this page reported 14 total while the dashboard
   * reported 22 for the same company. Two copies of the same list will always
   * end up disagreeing; only one of them can be right, and it is the one the
   * server stores against.
   *
   * Icons and category colours stay here, keyed by code, because they are
   * presentation and have no business in the shared template.
   */
  const MODULE_ICONS: Record<string, React.ReactNode> = {
    ATTENDANCE: <Calendar className="w-5 h-5 text-purple-500" />,
    APPROVAL_CONFIG: <SlidersHorizontal className="w-5 h-5 text-indigo-500" />,
    CHAT: <MessageSquare className="w-5 h-5 text-blue-500" />,
    PAYROLL: <FileText className="w-5 h-5 text-emerald-500" />,
    LEAVE: <CalendarOff className="w-5 h-5 text-purple-500" />,
    ASSETS: <Box className="w-5 h-5 text-orange-500" />,
    HELPDESK: <HelpCircle className="w-5 h-5 text-orange-500" />,
    REPORTS: <BarChart3 className="w-5 h-5 text-red-500" />,
    TASKS: <CheckSquare className="w-5 h-5 text-blue-500" />,
    ONBOARDING: <UserCheck className="w-5 h-5 text-purple-500" />,
    EXPENSES: <CreditCard className="w-5 h-5 text-emerald-500" />,
    CALENDAR: <CalendarDays className="w-5 h-5 text-blue-500" />,
    TEAMS: <Users2 className="w-5 h-5 text-blue-500" />,
    AUDIT_LOG: <History className="w-5 h-5 text-orange-500" />,
    COMMUNITIES: <Users2 className="w-5 h-5 text-blue-500" />};

  const CATEGORY_COLOURS: Record<string, string> = {
    'Core HR': 'bg-purple-500/10 text-purple-600 dark:text-purple-400',
    Collaboration: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
    Finance: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    Operations: 'bg-orange-500/10 text-orange-600 dark:text-orange-400',
    Analytics: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
    Custom: 'bg-slate-500/10 text-slate-600 dark:text-slate-300'
  };

  const masterModulesList = defaultModulesTemplate.map((m) => ({
    id: m.id,
    code: m.code,
    name: m.name,
    icon: MODULE_ICONS[m.code] ?? <Box className="w-5 h-5 text-slate-400" />,
    description: m.description,
    category: m.category,
    categoryColor: CATEGORY_COLOURS[m.category] ?? CATEGORY_COLOURS.Custom,
    dependencies: '-'
  }));

  // Current company modules state
  const activeTenantModules = companyModules[tenantId] || [];

  /**
   * Modules this tenant has that the built-in catalogue does not know about.
   *
   * Custom modules are created against a company, so they exist only in that
   * company's own rows. Listing the catalogue alone meant a module somebody had
   * just created did not appear on the screen that manages modules, and could
   * not be switched on or off — the count said seventeen no matter how many were
   * added.
   *
   * BRANDING is excluded on purpose: that row is where the appearance settings
   * are kept, not a feature anyone navigates to. It is stored as a module row
   * because the column it needs already exists there.
   */
  const customTenantModules = activeTenantModules
    .filter((tm) => tm.code && tm.code.toUpperCase() !== "BRANDING")
    .filter((tm) => !defaultModulesTemplate.some((m) => m.code === tm.code))
    .map((tm) => ({
      id: `custom-${tm.code}`,
      code: tm.code,
      name: (tm as any).name || tm.code.replace(/_/g, " "),
      icon: MODULE_ICONS[tm.code] ?? <Box className="w-5 h-5 text-slate-400" />,
      description: (tm as any).description || "Created for this company.",
      category: "Custom",
      categoryColor: CATEGORY_COLOURS.Custom,
      dependencies: '-'
    }));

  // Merge master static properties with real-time tenant enabled states
  const allMergedModules = [...masterModulesList, ...customTenantModules].map(master => {
    const tenantMatch = activeTenantModules.find(tm => tm.code === master.code);
    return {
      ...master,
      status: tenantMatch ? tenantMatch.enabled : false,
      visibleRoles: tenantMatch?.visibleRoles || ["COMPANY_ADMIN", "CTO", "HR_MANAGER", "TEAM_LEAD", "EMPLOYEE"],
      // Carried through so the CTO switch can tell "never asked" from "turned
      // off": an untouched CTO follows the Company Admin setting.
      ctoConfigured: tenantMatch?.ctoConfigured === true
    };
  });

  // Filter modules based on search & category
  const filteredModules = allMergedModules.filter(m => {
    const matchesSearch =
      m.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      m.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
      m.code.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory =
      selectedCategory === 'All Categories' || m.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  // Pagination calculation
  const totalPages = Math.ceil(filteredModules.length / itemsPerPage) || 1;

  // Reset to page 1 if search/filter narrows list
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, selectedCategory]);

  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedModules = filteredModules.slice(startIndex, startIndex + itemsPerPage);

  const activeCount = allMergedModules.filter(m => m.status).length;
  const disabledCount = allMergedModules.length - activeCount;

  const selectedModuleObj = allMergedModules.find(m => m.id === selectedModuleId) || allMergedModules[0];

  // Quick action handlers
  const handleEnableAll = () => {
    enableAllCompanyModules(tenantId);
    toast.success(`All 22 modules enabled for ${tenantName}!`);
  };

  const handleDisableAll = () => {
    disableAllCompanyModules(tenantId);
    toast.success(`All modules disabled for ${tenantName}!`);
  };

  const handleResetDefault = () => {
    resetCompanyModulesDefault(tenantId);
    toast.success(`Module configuration reset to default for ${tenantName}!`);
  };

  const handleExportConfig = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(activeTenantModules, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `${tenantId}-module-config.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    toast.success(`Configuration for ${tenantId} exported successfully!`);
  };

  return (
    <div className={`min-h-screen pb-10 ${isDark ? 'bg-transparent text-gray-100' : 'bg-transparent text-slate-900'}`}>
      <div className="max-w-[1600px] mx-auto px-6 py-6">
        
        {/* Top Section */}
        <div className={`flex items-center text-sm font-medium mb-4 ${isDark ? 'text-gray-400' : 'text-slate-500'}`}>
          <span>Company Configuration</span>
          <ChevronRight className="w-4 h-4 mx-2" />
          <span className={isDark ? 'text-gray-100' : 'text-slate-800'}>Module Management</span>
        </div>

        <div className="flex justify-between items-start mb-8">
          <div>
            <h1 className="text-2xl font-bold mb-2">Module Management</h1>
            <p className={`max-w-3xl ${isDark ? 'text-gray-400' : 'text-slate-500'}`}>
              Enable or disable application modules for <span className={`font-semibold ${isDark ? 'text-indigo-400' : 'text-blue-600'}`}>{tenantName}</span> ({tenantId}). Control what features are available to your organization and who can access them.
            </p>
          </div>
          <div className="flex space-x-3">
            <Button variant="outline" onClick={() => toast.success("Configuration History is up to date!")} className={`gap-2 ${isDark ? 'border-cyan-500/30 text-cyan-400 hover:bg-cyan-900/30' : 'border-slate-300 text-slate-700 bg-white/50 hover:bg-slate-100'}`}>
              <History className="w-4 h-4" /> Configuration History
            </Button>
            <Button onClick={() => toast.success("Module configuration saved successfully!")} className={`${isDark ? 'bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold border border-cyan-400 shadow-[0_0_10px_rgba(6,182,212,0.4)]' : 'bg-blue-600 hover:bg-blue-700 text-white shadow-md'} gap-2`}>
              <Save className="w-4 h-4" /> Save Configuration
            </Button>
          </div>
        </div>

        {/* Tenant Banner */}
        <Card className={`mb-8 ${isDark ? 'bg-slate-900/40 backdrop-blur-xl border-cyan-500/30 shadow-[0_0_15px_rgba(6,182,212,0.15)]' : 'bg-white/90 backdrop-blur-md border-slate-200/50 shadow-sm'}`}>
          <CardContent className="p-6">
            <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6">
              <div className="flex items-center gap-4">
                <div className={`w-16 h-16 rounded-lg flex items-center justify-center flex-shrink-0 ${isDark ? 'bg-cyan-900/40 text-cyan-400 shadow-[0_0_8px_rgba(6,182,212,0.2)]' : 'bg-blue-50 text-blue-600 border border-blue-100'}`}>
                  <Building2 className="w-8 h-8" />
                </div>
                <div>
                  <div className="flex items-center gap-3 mb-1">
                    <h2 className="text-xl font-bold">{tenantName}</h2>
                    <span className="px-2 py-0.5 rounded text-xs font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                      ACTIVE
                    </span>
                  </div>
                  <div className={`flex flex-wrap items-center gap-4 text-sm ${isDark ? 'text-gray-400' : 'text-slate-500'}`}>
                    <span>Company ID: <strong className={`font-mono ${isDark ? 'text-indigo-400' : 'text-blue-600'}`}>{tenantId}</strong></span>
                    <span className={`w-1 h-1 rounded-full ${isDark ? 'bg-gray-700' : 'bg-slate-300'}`}></span>
                    <span>Industry: {tenantIndustry}</span>
                    <span className={`w-1 h-1 rounded-full ${isDark ? 'bg-gray-700' : 'bg-slate-300'}`}></span>
                    <span>Employees: {tenantEmpCount}</span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 w-full lg:w-auto">
                <div className={`p-4 rounded-xl border ${isDark ? 'bg-cyan-950/20 border-cyan-500/20' : 'bg-slate-50 border-slate-200'}`}>
                  <div className={`text-xs font-medium mb-1 ${isDark ? 'text-cyan-400' : 'text-slate-500'}`}>Total Modules</div>
                  <div className={`text-2xl font-bold ${isDark ? 'text-cyan-400' : 'text-slate-900'}`}>{allMergedModules.length}</div>
                </div>
                <div className={`p-4 rounded-xl border ${isDark ? 'bg-cyan-950/20 border-cyan-500/20' : 'bg-slate-50 border-slate-200'}`}>
                  <div className={`text-xs font-medium mb-1 ${isDark ? 'text-cyan-400' : 'text-slate-500'}`}>Enabled</div>
                  <div className={`text-2xl font-bold ${isDark ? 'text-emerald-400' : 'text-slate-900'}`}>{activeCount}</div>
                </div>
                <div className={`p-4 rounded-xl border ${isDark ? 'bg-cyan-950/20 border-cyan-500/20' : 'bg-slate-50 border-slate-200'}`}>
                  <div className={`text-xs font-medium mb-1 ${isDark ? 'text-cyan-400' : 'text-slate-500'}`}>Disabled</div>
                  <div className={`text-2xl font-bold ${isDark ? 'text-gray-400' : 'text-slate-900'}`}>{disabledCount}</div>
                </div>
                <div className={`p-4 rounded-xl border ${isDark ? 'bg-cyan-950/20 border-cyan-500/20' : 'bg-slate-50 border-slate-200'}`}>
                  <div className={`text-xs font-medium mb-1 ${isDark ? 'text-cyan-400' : 'text-slate-500'}`}>Total Users</div>
                  <div className={`text-2xl font-bold ${isDark ? 'text-cyan-400' : 'text-slate-900'}`}>{tenantEmpCount}</div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Main Workspace Layout */}
        <div className="flex flex-col lg:flex-row gap-6 items-start">
          <div className="flex-1 w-full min-w-0">
            <Card className={isDark ? 'bg-slate-900/40 backdrop-blur-xl border border-cyan-500/30 shadow-[0_0_15px_rgba(6,182,212,0.15)]' : 'bg-white/90 backdrop-blur-md border-slate-200/50 shadow-sm'}>
              <CardHeader className={`pb-4 border-b ${isDark ? 'border-cyan-500/20' : 'border-slate-100'}`}>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <CardTitle className="text-lg">Application Modules</CardTitle>
                    <p className={`text-sm mt-1 ${isDark ? 'text-gray-400' : 'text-slate-500'}`}>
                      Choose which modules to enable for {tenantName}. Disabled modules will be hidden from all non-admin users.
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="relative">
                      <Search className={`w-4 h-4 absolute left-3 top-3 ${isDark ? 'text-gray-400' : 'text-slate-400'}`} />
                      <Input 
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        placeholder="Search modules..." 
                        className={`pl-9 w-64 ${isDark ? 'bg-slate-900/50 border-cyan-500/30 text-slate-200 focus:border-cyan-400' : 'bg-white/60 border-slate-200 text-slate-900 placeholder:text-slate-400 focus:border-blue-400'}`}
                      />
                    </div>
                    <div className="relative">
                      <Button 
                        variant="outline" 
                        onClick={() => setIsCategoryDropdownOpen(!isCategoryDropdownOpen)}
                        className={`gap-2 ${isDark ? 'bg-slate-900/50 border-cyan-500/30 text-slate-200 hover:bg-cyan-900/40' : 'bg-white/60 border-slate-200 text-slate-700 hover:bg-slate-50'}`}
                      >
                        <Filter className="w-4 h-4" /> {selectedCategory} <ChevronDown className={`w-4 h-4 ml-1 font-bold ${isDark ? 'text-cyan-400' : 'text-slate-500'}`} />
                      </Button>
                      {isCategoryDropdownOpen && (
                        <div className={`absolute right-0 mt-2 w-48 rounded-lg shadow-lg border z-20 py-1 ${isDark ? 'bg-slate-900/80 backdrop-blur-xl border-cyan-500/30 text-gray-200' : 'bg-white backdrop-blur-xl border-slate-200 text-slate-700'}`}>
                          {['All Categories', 'Core HR', 'Collaboration', 'Finance', 'Operations', 'Analytics'].map((cat) => (
                            <button
                              key={cat}
                              onClick={() => {
                                setSelectedCategory(cat);
                                setIsCategoryDropdownOpen(false);
                              }}
                              className={`w-full text-left px-4 py-2 text-sm hover:bg-indigo-600/10 hover:text-indigo-400 transition flex items-center justify-between ${selectedCategory === cat ? 'font-bold text-indigo-500' : ''}`}
                            >
                              <span>{cat}</span>
                              {selectedCategory === cat && <Check className="w-4 h-4 text-indigo-500" />}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </CardHeader>

              {/* Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className={`text-xs uppercase font-medium ${isDark ? 'bg-cyan-950/40 text-cyan-400' : 'bg-slate-100/80 text-slate-600'}`}>
                    <tr>
                      <th className="px-6 py-4">Module</th>
                      <th className="px-6 py-4">Category</th>
                      <th className="px-6 py-4">Dependencies</th>
                      <th className="px-6 py-4">Status</th>
                      <th className="px-6 py-4">Visible To</th>
                      <th className="px-6 py-4">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y dark:divide-gray-800">
                    {paginatedModules.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="text-center py-12 text-gray-500">
                          No modules found matching "{searchTerm}".
                        </td>
                      </tr>
                    ) : (
                      paginatedModules.map((module) => (
                        <tr 
                          key={module.id} 
                          className={`group cursor-pointer transition-colors ${selectedModuleId === module.id ? (isDark ? 'bg-cyan-900/40 border-b border-cyan-500/50 shadow-[0_0_8px_rgba(6,182,212,0.1)]' : 'bg-blue-50/50 border-b border-blue-200 shadow-sm') : isDark ? 'hover:bg-cyan-900/20 border-b border-cyan-500/10' : 'hover:bg-slate-50 border-b border-slate-100'}`}
                          onClick={() => setSelectedModuleId(module.id)}
                        >
                          <td className="px-6 py-4">
                            <div className="flex items-start gap-3">
                              <div className={`p-2 rounded-lg flex-shrink-0 ${isDark ? 'bg-gray-800' : 'bg-white border border-slate-200 shadow-sm'}`}>
                                {module.icon}
                              </div>
                              <div>
                                <div className="font-medium text-base mb-0.5">{module.name}</div>
                                <div className={isDark ? "text-gray-400" : "text-slate-500"}>{module.description}</div>
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${module.categoryColor}`}>
                              {module.category}
                            </span>
                          </td>
                          <td className={`px-6 py-4 ${isDark ? 'text-gray-400' : 'text-slate-500'}`}>{module.dependencies}</td>
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-3">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleCompanyModule(tenantId, module.code);
                                }}
                                className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                                  module.status ? 'bg-blue-600' : 'bg-gray-200 dark:bg-gray-700'
                                }`}
                              >
                                <span
                                  className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                                    module.status ? 'translate-x-4' : 'translate-x-0'
                                  }`}
                                />
                              </button>
                              <div className="flex flex-col">
                                <span className={`font-medium ${module.status ? 'text-gray-900 dark:text-gray-100' : 'text-gray-500 dark:text-gray-400'}`}>
                                  {module.status ? 'ON' : 'OFF'}
                                </span>
                                {module.status ? (
                                  <span className="text-xs text-emerald-500">Enabled</span>
                                ) : (
                                  <span className="text-xs text-gray-400">Disabled</span>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex flex-wrap gap-1">
                              {["Admin", "CTO", "HR", "TL", "Employee"].map(roleLabel => {
                                const roleKeyMap: Record<string, string> = { Admin: "COMPANY_ADMIN", CTO: "CTO", HR: "HR_MANAGER", TL: "TEAM_LEAD", Employee: "EMPLOYEE" };
                                const roleKey = roleKeyMap[roleLabel];
                                /*
                                  An untouched CTO switch shows what the CTO
                                  actually gets, which is the module.

                                  This used to mirror the Company Admin
                                  setting, and that was wrong on any module
                                  configured for HR and Team Leaders alone:
                                  Company Admin is absent there too, so the
                                  badge read off and the CTO lost a module
                                  nobody had decided to take from them. An
                                  untouched switch is not an instruction --
                                  see matchesVisibleRoles, which this mirrors.
                                */
                                const isVisible = roleKey === "CTO"
                                  // Attendance is the CTO's whatever this says
                                  // -- see matchesVisibleRoles in AuthContext.
                                  && (module.code === "ATTENDANCE"
                                      || (!module.ctoConfigured && !module.visibleRoles.includes("CTO")))
                                  ? true
                                  : module.visibleRoles.includes(roleKey);
                                return (
                                  <span
                                    key={roleLabel}
                                    className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                      isVisible
                                        ? (isDark ? 'bg-indigo-500/20 text-indigo-300' : 'bg-indigo-100 text-indigo-700')
                                        : (isDark ? 'bg-gray-800 text-gray-600 line-through' : 'bg-gray-200 text-gray-400 line-through')
                                    }`}
                                  >
                                    {roleLabel}
                                  </span>
                                );
                              })}
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-2">
                              <Button 
                                variant="outline" 
                                size="sm"
                                className={isDark ? 'border-cyan-500/30 text-cyan-400 hover:bg-cyan-900/30' : 'border-slate-300 text-slate-700 bg-white hover:bg-slate-50'}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedModuleId(module.id);
                                }}
                              >
                                Configure
                              </Button>
                              <Button variant="ghost" size="icon" className="h-8 w-8">
                                <MoreHorizontal className="w-4 h-4 text-gray-400" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {/* REAL-TIME WORKING PAGINATION */}
              <div className={`p-4 border-t flex flex-col sm:flex-row items-center justify-between gap-4 text-sm ${isDark ? "border-cyan-500/20 text-cyan-500/70" : "border-slate-100 text-slate-500"}`}>
                <div>
                  Showing {filteredModules.length > 0 ? startIndex + 1 : 0} to {Math.min(startIndex + itemsPerPage, filteredModules.length)} of {filteredModules.length} modules
                </div>
                <div className="flex items-center gap-1.5">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={currentPage === 1}
                    onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                    className={`w-8 h-8 p-0 ${isDark ? 'border-gray-700' : ''}`}
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </Button>

                  {Array.from({ length: totalPages }, (_, i) => i + 1).map((pageNum) => (
                    <Button
                      key={pageNum}
                      variant={currentPage === pageNum ? "default" : "outline"}
                      size="sm"
                      onClick={() => setCurrentPage(pageNum)}
                      className={`w-8 h-8 p-0 font-medium ${
                        currentPage === pageNum
                          ? (isDark ? 'bg-cyan-500 text-slate-950 font-bold border-cyan-400 shadow-[0_0_10px_rgba(6,182,212,0.4)]' : 'bg-blue-600 text-white font-bold shadow-sm')
                          : isDark
                          ? 'bg-slate-900/50 border-cyan-500/30 text-gray-300 hover:bg-cyan-900/40'
                          : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      {pageNum}
                    </Button>
                  ))}

                  <Button
                    variant="outline"
                    size="sm"
                    disabled={currentPage === totalPages || totalPages === 0}
                    onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                    className={`w-8 h-8 p-0 ${isDark ? 'bg-slate-900/50 border-cyan-500/30 text-slate-200 hover:bg-cyan-900/40' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'}`}
                  >
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </Card>
          </div>

          {/* Right Configuration Drawer */}
          {selectedModuleObj && (
            <div className="w-full lg:w-96 flex-shrink-0">
              <Card className={`h-full sticky top-6 ${isDark ? 'bg-slate-900/40 backdrop-blur-xl border border-cyan-500/30 shadow-[0_0_15px_rgba(6,182,212,0.15)]' : 'bg-white/90 backdrop-blur-md border-slate-200/50 shadow-sm'}`}>
                <div className={`p-5 border-b flex justify-between items-start ${isDark ? 'border-cyan-500/20' : 'border-slate-100'}`}>
                  <div>
                    <h3 className="text-lg font-bold mb-1">Module Configuration</h3>
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`font-medium ${isDark ? 'text-cyan-400' : 'text-slate-800'}`}>{selectedModuleObj.name}</span>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold tracking-wider ${
                        selectedModuleObj.status
                          ? (isDark ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 shadow-[0_0_8px_rgba(16,185,129,0.2)]' : 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20')
                          : (isDark ? 'bg-gray-500/20 text-gray-400 border border-gray-500/30' : 'bg-slate-100 text-slate-500 border border-slate-200')
                      }`}>
                        {selectedModuleObj.status ? 'ENABLED' : 'DISABLED'}
                      </span>
                    </div>
                    <p className={`text-sm ${isDark ? 'text-cyan-500/70' : 'text-slate-500'}`}>{selectedModuleObj.description}</p>
                  </div>
                  <Button variant="ghost" size="icon" className="-mt-1 -mr-1" onClick={() => setSelectedModuleId(null)}>
                    <X className={`w-5 h-5 ${isDark ? 'text-gray-400' : 'text-slate-400 hover:text-slate-600'}`} />
                  </Button>
                </div>
                
                <div className={`flex border-b ${isDark ? 'border-cyan-500/20' : 'border-slate-100'}`}>
                  <button className={`flex-1 py-3 text-sm font-medium border-b-2 ${isDark ? 'border-cyan-400 text-cyan-400 drop-shadow-[0_0_8px_rgba(6,182,212,0.8)]' : 'border-blue-600 text-blue-600'}`}>Access Control</button>
                  <button className={`flex-1 py-3 text-sm font-medium border-b-2 border-transparent ${isDark ? 'text-slate-400 hover:text-cyan-400' : 'text-slate-500 hover:text-slate-800'}`}>Features</button>
                  <button className={`flex-1 py-3 text-sm font-medium border-b-2 border-transparent ${isDark ? 'text-slate-400 hover:text-cyan-400' : 'text-slate-500 hover:text-slate-800'}`}>Settings</button>
                </div>

                <div className="p-5 space-y-8">
                  {/* Role Visibility */}
                  <div>
                    <h4 className="font-semibold mb-1">Role Visibility</h4>
                    <p className={`text-sm mb-4 ${isDark ? 'text-gray-400' : 'text-slate-500'}`}>Select which roles can access this module for {tenantName}</p>
                    
                    <div className="space-y-4">
                      {[
                        { key: "COMPANY_ADMIN", label: "Company Admin", desc: "Company administrator full view access" },
                        { key: "CTO", label: "CTO", desc: "Chief Technology Officer executive access" },
                        { key: "HR_MANAGER", label: "HR Manager", desc: "HR management access to this module" },
                        { key: "TEAM_LEAD", label: "Team Lead", desc: "Team leads access to team records" },
                        { key: "EMPLOYEE", label: "Employee", desc: "General employee self-service access" },
                      ].map((item) => {
                        /*
                         * The CTO switch shows what the CTO can actually see,
                         * which until somebody uses it is the module.
                         *
                         * It used to mirror Company Admin, and that is wrong on
                         * any module configured for HR and Team Leaders alone:
                         * Company Admin is absent there too, so the switch read
                         * off and the CTO lost a module nobody had decided to
                         * take from them. An untouched switch is not an
                         * instruction. matchesVisibleRoles in AuthContext reads
                         * it the same way, so the switch and the behaviour
                         * agree.
                         */
                        /*
                          Attendance cannot be taken from the CTO here. The
                          company head has to be able to see who is in, and it
                          is the one reading nobody else can produce for them.
                          The switch is shown on and disabled rather than
                          hidden, so the rule is visible instead of being a
                          toggle that silently does nothing.
                        */
                        const ctoLockedOn =
                          item.key === "CTO" && selectedModuleObj.code === "ATTENDANCE";
                        const isRoleActive = ctoLockedOn
                          ? true
                          : item.key === "CTO" && !selectedModuleObj.ctoConfigured
                            && !selectedModuleObj.visibleRoles.includes("CTO")
                            ? true
                            : selectedModuleObj.visibleRoles.includes(item.key);
                        return (
                          <div key={item.key} className="flex items-center justify-between">
                            <div>
                              <div className="font-medium text-sm">{item.label}</div>
                              <div className={`text-xs ${isDark ? 'text-gray-400' : 'text-slate-500'}`}>
                                {ctoLockedOn
                                  ? "Always on — the company head has to be able to see who is in"
                                  : item.desc}
                              </div>
                            </div>
                            <button
                              type="button"
                              disabled={ctoLockedOn}
                              title={ctoLockedOn
                                ? "Attendance cannot be hidden from the CTO"
                                : undefined}
                              onClick={() => {
                                if (ctoLockedOn) return;
                                toggleCompanyModuleRole(tenantId, selectedModuleObj.code, item.key);
                              }}
                              className={`relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                                ctoLockedOn ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
                              } ${
                                isRoleActive ? (isDark ? 'bg-cyan-500 shadow-[0_0_8px_rgba(6,182,212,0.5)]' : 'bg-blue-600 shadow-sm') : (isDark ? 'bg-gray-700' : 'bg-slate-200')
                              }`}
                            >
                              <span
                                className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                                  isRoleActive ? 'translate-x-4' : 'translate-x-0'
                                }`}
                              />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </Card>
            </div>
          )}
        </div>



      </div>
    </div>
  );
}
