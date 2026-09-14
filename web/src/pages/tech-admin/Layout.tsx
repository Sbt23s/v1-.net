import React, { useState } from "react";
import { Navigate, Outlet, Link, useLocation, useNavigate } from "react-router-dom";
import { useTechAdminAuth } from "@/context/TechAdminAuthContext";
import { 
  LayoutDashboard, 
  Building2, 
  Settings2, 
  LogOut,
  History,
  Sun,
  Moon,
  SlidersHorizontal,
  Users,
  Calendar,
  MessageSquare,
  DollarSign,
  Clock,
  Package,
  HelpCircle,
  BarChart3,
  Plug,
  Palette,
  Shield,
  Search,
  Bell,
  Settings,
  ChevronDown,
  Menu,
  ArrowLeft,
  X,
  Command,
  Check,
  FileText, CalendarOff, Box, CheckSquare, Award, UserPlus, UserCheck, 
  CreditCard, GraduationCap, FolderGit2, Activity, Megaphone, FileQuestion, 
  Users2, CalendarDays, Bot
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

export function TechAdminLayout() {
  const { admin, loading, logout, theme, toggleTheme, companies, currentCompany, setCurrentCompany, companyModules } = useTechAdminAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [companyDropdownOpen, setCompanyDropdownOpen] = useState(false);

  const isDark = theme === "dark";

  const activeMods = companyModules[currentCompany?.companyId] || [];
  const isModEnabled = (code: string) => {
    const item = activeMods.find(m => m.code === code);
    return item ? item.enabled : false;
  };

  if (loading) {
    return (
      <div className={`min-h-screen flex items-center justify-center ${isDark ? "bg-[#0f172a] text-white" : "bg-[#0a0118] text-purple-50"}`}>
        Loading...
      </div>
    );
  }

  if (!admin) {
    return <Navigate to="/tech-admin/login" replace />;
  }

  // Spelled out because the groups are not uniform: only the MODULES entries
  // carry a badge. Left to inference, each group got its own anonymous type and
  // reading item.badge in the shared render below did not compile.
  type NavItem = {
    name: string;
    path: string;
    icon: LucideIcon;
    badge?: { label: string; active: boolean };
  };
  const navGroups: { label: string; items: NavItem[] }[] = [
    {
      label: "TECHNICAL ADMIN",
      items: [
        { name: "Dashboard", path: "/tech-admin/dashboard", icon: LayoutDashboard },
        { name: "Company Configuration", path: "/tech-admin/companies", icon: Building2 },
        { name: "Module Management", path: "/tech-admin/module-management", icon: SlidersHorizontal },
        // Roles & Permissions removed on request. The page was read-only — it
        // listed the eighteen roles and what each grants but changed nothing —
        // and a company's roles are now decided where its accounts are, on the
        // Users screen. The route stays registered, so restoring this is one
        // line if the page ever gains controls.
        { name: "Users & Administrators", path: "/tech-admin/users", icon: Users },
        // Organization removed on request. It pointed at the Companies page, so
        // it was a second door into a room this list already has an entry for.
      ]
    },
    // The MODULES group is gone from this sidebar. Its seventeen entries all
    // pointed at the same page -- /tech-admin/module-management -- which the
    // Module Management link above already opens, so the list was seventeen
    // doors into one room. The ON/OFF badges beside them repeated what that
    // page shows in full, and only there can they be changed.
    {
      label: "SYSTEM",
      items: [
        { name: "Global Login Announcement", path: "/tech-admin/global-announcements", icon: Megaphone },
        { name: "Audit Logs", path: "/tech-admin/audit-logs", icon: History },
        { name: "Branding & Appearance", path: "/tech-admin/branding", icon: Palette },
        { name: "Fresh Start (Data Reset)", path: "/admin/reset", icon: Settings2 },
      ]
    }
  ];

  const getBreadcrumbs = () => {
    const paths = location.pathname.split("/").filter(Boolean);
    return paths.map((p) => p.replace(/-/g, " ").replace(/\b\w/g, l => l.toUpperCase())).join(" / ");
  };

  return (
    <div className={`relative flex h-screen overflow-hidden ${isDark ? "text-slate-50" : "bg-transparent text-slate-800"}`}>
      
      {/* Global Cyber Background */}
      {isDark ? (
        /*
          A painted background, not a video off somebody's Downloads folder.

          The source here was "/@fs/C:/Users/balas/Downloads/...mp4" -- a path
          Vite's dev server rewrites to a file on one developer's machine. In
          production it resolved to nothing, so this decoded no video and the
          slate overlay below was doing all the work anyway. A gradient says
          the same thing, weighs nothing, and exists on every machine.
        */
        <div className="absolute inset-0 z-[-1] bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
          <div className="absolute inset-0 bg-slate-950/40 backdrop-blur-[2px]"></div>
        </div>
      ) : (
        <div className="absolute inset-0 z-[-1] bg-[url('https://images.unsplash.com/photo-1507525428034-b723cf961d3e?q=80&w=2000&auto=format&fit=crop')] bg-cover bg-center bg-no-repeat">
          <div className="absolute inset-0 bg-white/30 backdrop-blur-[2px]"></div>
        </div>
      )}

      {/* Mobile Sidebar Overlay */}
      {sidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 lg:hidden" 
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside 
        className={`fixed inset-y-0 left-0 z-50 w-64 flex flex-col transition-transform duration-300 ease-in-out lg:static lg:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        } ${isDark ? "bg-slate-900/30 backdrop-blur-xl border-r border-cyan-500/20" : "bg-white/60 backdrop-blur-xl border-r border-white/60 text-slate-800"}`}
      >
        {/* Logo Area */}
        <div className={`flex items-center justify-between h-16 px-6 border-b ${isDark ? "border-cyan-500/20" : "border-white/60"}`}>
          <div className="flex items-center gap-2">
            {/* The real mark, the same one the portal and the sign-in page use.
                The generic keyboard glyph that was here belonged to no product.
                A white plate behind it because the logo is dark artwork and the
                sidebar is not; onError hides a broken image rather than leaving
                the browser's placeholder next to the name. */}
            <div className="w-8 h-8 rounded-lg bg-white shadow-md shadow-cyan-500/20 flex items-center justify-center overflow-hidden p-0.5">
              <img
                src="https://pixoustech.com/public/assets/images/common/pixous-logo1.png"
                alt="Pixous"
                className="w-full h-full object-contain"
                onError={(e) => { (e.currentTarget as HTMLElement).style.display = "none"; }}
              />
            </div>
            <span className={`font-bold text-xl tracking-tight ${isDark ? "text-white" : "text-slate-800"}`}>PIXOUS</span>
          </div>
          <button className={`lg:hidden hover:text-cyan-500 ${isDark ? "text-slate-400" : "text-slate-500"}`} onClick={() => setSidebarOpen(false)}>
            <X className="w-5 h-5" />
          </button>
        </div>
        
        {/* Navigation */}
        <div className="flex-1 overflow-y-auto py-4 scrollbar-thin">
          <nav className="space-y-6 px-4">
            {navGroups.map((group, idx) => (
              <div key={idx} className="space-y-1">
                <h3 className={`px-2 text-xs font-bold uppercase tracking-wider mb-2 ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                  {group.label}
                </h3>
                {group.items.map((item) => {
                  const isActive = location.pathname.startsWith(item.path.split("?")[0]);
                  return (
                    <Link
                      key={item.name}
                      to={item.path}
                      onClick={() => setSidebarOpen(false)}
                      className={`flex items-center justify-between rounded-md px-3 py-2 text-sm font-medium transition-all duration-300 ${
                        isActive
                          ? isDark
                            ? "bg-cyan-900/40 text-cyan-400 border border-cyan-500/50 shadow-[0_0_10px_rgba(6,182,212,0.2)]"
                            : "bg-gradient-to-r from-cyan-400 to-blue-500 text-white shadow-md shadow-blue-500/20"
                          : isDark
                            ? "text-slate-300 hover:bg-cyan-900/20 hover:text-cyan-300 border border-transparent"
                            : "text-slate-600 hover:bg-white/60 hover:text-blue-600 border border-transparent"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <item.icon className={`h-4 w-4 ${isActive ? "" : "opacity-70"}`} />
                        {item.name}
                      </div>
                      
                      {item.badge && (
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                          item.badge.active 
                            ? "bg-emerald-500/20 text-emerald-400" 
                            : "bg-red-500/20 text-red-400"
                        }`}>
                          {item.badge.label}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            ))}
          </nav>
        </div>

        {/* User / Bottom Area */}
        <div className={`p-4 border-t ${isDark ? "border-cyan-500/20" : "border-white/60"}`}>
          <div className="flex items-center gap-3 px-2 mb-4">
            <div className={`w-9 h-9 rounded-full flex items-center justify-center font-bold shrink-0 ${isDark ? "bg-cyan-950 border border-cyan-500/50 text-cyan-400 shadow-[0_0_8px_rgba(6,182,212,0.3)]" : "bg-blue-600 text-white shadow-md shadow-blue-600/30"}`}>
              {admin.name?.charAt(0) || "A"}
            </div>
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-medium truncate ${isDark ? "text-slate-200" : "text-slate-800"}`}>{admin.name}</p>
              <p className={`text-xs truncate font-medium ${isDark ? "text-slate-400" : "text-slate-500"}`}>{admin.email || "Technical Admin"}</p>
            </div>
          </div>
          <Link 
            to="/" 
            className={`flex items-center gap-2 px-2 py-2 text-sm rounded-md transition-colors ${
              isDark ? "text-slate-300 hover:text-cyan-300 hover:bg-cyan-900/20" : "text-slate-600 hover:text-slate-900 hover:bg-white/50"
            }`}
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Platform
          </Link>
          <button 
            onClick={logout}
            className={`w-full flex items-center gap-2 px-2 py-2 text-sm rounded-md transition-colors mt-1 ${
              isDark ? "text-red-400 hover:bg-red-500/10 hover:text-red-300" : "text-red-500 hover:bg-white/50 hover:text-red-600"
            }`}
          >
            <LogOut className="w-4 h-4" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        
        {/* Header */}
        <header className={`relative z-10 h-16 flex items-center justify-between px-4 sm:px-6 border-b transition-colors ${isDark ? "bg-slate-900/30 backdrop-blur-xl border-cyan-500/20" : "bg-white/60 backdrop-blur-xl border-white/60"}`}>
          
          {/* Left: Mobile Menu & Company Dropdown */}
          <div className="flex items-center gap-4">
            <button 
              className={`lg:hidden p-2 -ml-2 rounded-md ${isDark ? "hover:bg-slate-800 text-slate-300" : "hover:bg-white/50 text-slate-600 hover:text-slate-900"}`}
              onClick={() => setSidebarOpen(true)}
            >
              <Menu className="w-5 h-5" />
            </button>
            
            <div className="relative">
              <div 
                onClick={() => setCompanyDropdownOpen(!companyDropdownOpen)}
                className={`hidden sm:flex items-center gap-2 px-3 py-1.5 border rounded-lg cursor-pointer transition ${isDark ? "border-cyan-500/30 bg-slate-900/40 backdrop-blur hover:bg-cyan-900/20" : "bg-white/70 border-white hover:border-blue-300 shadow-sm"}`}
              >
                <div className="flex flex-col">
                  <span className={`text-xs font-medium ${isDark ? "text-slate-500" : "text-slate-500"}`}>Current Company</span>
                  <div className="flex items-center gap-1.5">
                    <span className={`text-sm font-semibold ${isDark ? "text-slate-200" : "text-slate-800"}`}>{currentCompany.companyName}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-sm font-mono font-bold ${isDark ? "bg-blue-500/10 text-blue-400" : "bg-blue-100 text-blue-700"}`}>{currentCompany.companyId}</span>
                  </div>
                </div>
                <ChevronDown className={`w-4 h-4 ml-2 ${isDark ? "text-slate-400" : "text-slate-500"}`} />
              </div>

              {companyDropdownOpen && (
                <div className={`absolute left-0 mt-2 w-72 rounded-xl shadow-[0_0_20px_rgba(0,0,0,0.5)] border z-50 p-2 space-y-1 ${isDark ? "bg-slate-900/80 backdrop-blur-xl border-cyan-500/30 text-slate-200" : "bg-white/95 backdrop-blur-xl border-slate-100 shadow-xl text-slate-700"}`}>
                  <div className={`px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider border-b mb-1 ${isDark ? "border-cyan-500/20 text-slate-400" : "border-slate-200 text-slate-500"}`}>
                    Select SaaS Tenant Scope
                  </div>
                  {companies.map((comp) => (
                    <div
                      key={comp.companyId}
                      onClick={() => {
                        setCurrentCompany(comp);
                        setCompanyDropdownOpen(false);
                      }}
                      className={`p-2.5 rounded-lg cursor-pointer transition flex items-center justify-between ${
                        currentCompany.companyId === comp.companyId
                          ? (isDark ? "bg-cyan-900/40 text-cyan-400 font-bold border border-cyan-500/50 shadow-[0_0_10px_rgba(6,182,212,0.2)]" : "bg-blue-50 text-blue-700 font-bold border border-blue-200 shadow-sm")
                          : (isDark ? "hover:bg-cyan-900/20 hover:text-cyan-300 text-slate-300" : "hover:bg-slate-50 text-slate-600 hover:text-slate-900")
                      }`}
                    >
                      <div>
                        <span className="text-xs font-semibold block">{comp.companyName}</span>
                        <span className={`text-[10px] font-mono ${isDark ? "text-slate-500" : "text-slate-500"}`}>{comp.companyId} • {comp.industry}</span>
                      </div>
                      {currentCompany.companyId === comp.companyId && <Check className="w-4 h-4 text-cyan-400" />}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Center: Search */}
          <div className="hidden md:flex flex-1 max-w-md mx-4">
            <div className="relative w-full">
              <Search className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${isDark ? "text-cyan-400" : "text-slate-400"}`} />
              <input 
                type="text" 
                placeholder="Search anything... (Ctrl + K)" 
                className={`w-full pl-9 pr-4 py-2 text-sm rounded-lg border outline-none transition-colors ${
                  isDark 
                    ? "bg-slate-900/40 backdrop-blur border-cyan-500/30 text-slate-200 placeholder:text-slate-500 focus:border-cyan-400/80 focus:shadow-[0_0_10px_rgba(6,182,212,0.3)]" 
                    : "bg-white/70 backdrop-blur border-white text-slate-800 placeholder:text-slate-400 focus:bg-white focus:border-blue-300 focus:shadow-[0_0_15px_rgba(59,130,246,0.1)]"
                }`}
              />
            </div>
          </div>

          {/* Right: Actions & Profile */}
          <div className="flex items-center gap-2 sm:gap-4">
            {/* Both of these had no onClick at all — clicking them did nothing.
                The bell also wore a red dot permanently, which marked no unread
                anything; it was decoration. Until there is a notification feed
                for the control centre, the bell goes where the record of what
                happened actually is, and the dot is gone rather than lying. */}
            <button
              onClick={() => navigate("/tech-admin/audit-logs")}
              title="Activity"
              className={`p-2 rounded-full relative ${isDark ? "hover:bg-cyan-900/30 text-cyan-400/80 hover:text-cyan-300" : "hover:bg-white/60 text-slate-500 hover:text-slate-800"}`}
            >
              <Bell className="w-5 h-5" />
            </button>
            <button
              onClick={() => navigate("/tech-admin/settings")}
              title="Settings"
              className={`hidden sm:block p-2 rounded-full ${isDark ? "hover:bg-cyan-900/30 text-cyan-400/80 hover:text-cyan-300" : "hover:bg-white/60 text-slate-500 hover:text-slate-800"}`}
            >
              <Settings className="w-5 h-5" />
            </button>
            <button 
              onClick={toggleTheme}
              className={`p-2 rounded-full ${isDark ? "bg-slate-900/50 border border-cyan-500/30 hover:bg-cyan-900/30 text-amber-400 shadow-[0_0_8px_rgba(6,182,212,0.2)]" : "bg-white border-blue-200 hover:border-blue-300 text-blue-600 shadow-sm"}`}
            >
              {isDark ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>
            
            <div className={`hidden sm:flex items-center gap-3 pl-4 border-l ${isDark ? "border-cyan-500/20" : "border-slate-200"}`}>
              <div className="flex flex-col items-end">
                <span className={`text-sm font-medium ${isDark ? "text-slate-200" : "text-slate-800"}`}>Sethu Admin</span>
                <span className={`text-xs font-bold ${isDark ? "text-cyan-400" : "text-slate-500"}`}>Technical Admin</span>
              </div>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold ${isDark ? "bg-cyan-950 border border-cyan-500/50 text-cyan-400 shadow-[0_0_8px_rgba(6,182,212,0.3)]" : "bg-blue-600 text-white shadow-sm shadow-blue-500/30"}`}>
                SA
              </div>
            </div>
          </div>
        </header>

        {/* Breadcrumbs */}
        <div className={`px-4 sm:px-6 py-3 border-b text-sm ${isDark ? "border-slate-800 bg-[#0f172a]" : "border-white/50 bg-white/40 backdrop-blur-md"}`}>
          <div className={`text-slate-500 ${isDark ? "text-slate-300 font-bold" : "text-slate-600 font-semibold"}`}>
            <span className="opacity-70">Home</span>
            <span className="mx-2 opacity-50">/</span>
            <span className={isDark ? "text-slate-200 font-medium" : "text-slate-800 font-bold"}>
              {getBreadcrumbs() || "Dashboard"}
            </span>
          </div>
        </div>

        {/* Page Content */}
        <div className={`flex-1 overflow-y-auto overflow-x-hidden ${isDark ? "bg-transparent scrollbar-thin scrollbar-thumb-cyan-500/20" : "bg-transparent scrollbar-thin scrollbar-thumb-blue-200/60"}`}>
          <Outlet />
        </div>
      </main>
    </div>
  );
}
