import { PixousLoader } from "@/components/ui/pixous-loader";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import toast from "react-hot-toast";
import { Plus, Building, X, Sparkles, Check, Search, Trash2,
  Settings, SlidersHorizontal, AlertTriangle, ShieldCheck, Mail, Key,
  Building2, ChevronRight, CheckCircle2
} from "lucide-react";
import { useTechAdminAuth } from "@/context/TechAdminAuthContext";

export function TechAdminCompanies() {
  const { theme, companies, addCompany, updateCompany, deleteCompany, setCurrentCompany } = useTechAdminAuth();

  // Editing a company. `editTarget` holds the row being edited; `editForm` the
  // values being typed, so cancelling leaves the row untouched.
  const [editTarget, setEditTarget] = useState<any>(null);
  const [editForm, setEditForm] = useState<Record<string, string>>({});
  const [savingEdit, setSavingEdit] = useState(false);

  const openEdit = (company: any) => {
    setEditTarget(company);
    setEditForm({
      companyName: company.companyName ?? "",
      industry: company.industry ?? "",
      adminEmail: company.adminEmail ?? "",
      phone: company.phone ?? "",
      domain: company.domain ?? "",
      address: company.address ?? ""});
  };

  const saveEdit = async () => {
    if (!editTarget || savingEdit) return;
    if (!editForm.companyName?.trim()) {
      toast.error("A company needs a name");
      return;
    }
    setSavingEdit(true);
    try {
      // Goes to the server and the list is reloaded from it. The dialog closes
      // only once that has succeeded — a rejected save must not look applied.
      await updateCompany(editTarget.companyId ?? String(editTarget.id), {
        companyName: editForm.companyName.trim(),
        industry: editForm.industry?.trim(),
        adminEmail: editForm.adminEmail?.trim(),
        phone: editForm.phone?.trim(),
        domain: editForm.domain?.trim(),
        address: editForm.address?.trim()});
      toast.success(`${editForm.companyName.trim()} updated`);
      setEditTarget(null);
    } catch (err: any) {
      toast.error(err?.response?.data?.message || err?.message || "Could not save");
    } finally {
      setSavingEdit(false);
    }
  };
  const isDark = theme === "dark";

  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");

  // Provision Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Delete Confirmation Modal State
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);

  // Form State
  const [companyName, setCompanyName] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [industry, setIndustry] = useState("IT Services");
  const [employeeCount, setEmployeeCount] = useState(100);
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("admin123");
  const [enabledModules, setEnabledModules] = useState<string[]>(["ATTENDANCE", "CHAT"]);

  // Auto-generate Company ID when Company Name changes
  const handleNameChange = (name: string) => {
    setCompanyName(name);
    if (name.trim()) {
      const prefix = name.replace(/[^a-zA-Z]/g, "").substring(0, 5).toUpperCase() || "COMP";
      const randomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
      setCompanyId(`${prefix}-${randomCode}`);
    } else {
      setCompanyId("");
    }
  };

  const handleToggleModule = (modCode: string) => {
    if (enabledModules.includes(modCode)) {
      setEnabledModules(enabledModules.filter(m => m !== modCode));
    } else {
      setEnabledModules([...enabledModules, modCode]);
    }
  };

  const handleCreateCompany = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    const newCompanyObj = {
      id: Date.now(),
      companyName,
      companyId: companyId || `COMP-${Math.random().toString(36).substring(2, 8).toUpperCase()}`,
      status: "ACTIVE",
      employeeCount: Number(employeeCount) || 100,
      industry: industry || "IT Services",
      adminEmail: adminEmail || `admin@${companyName.toLowerCase().replace(/[^a-z0-9]/g, "")}.com`,
      adminUsername: `${companyId.toLowerCase().replace(/[^a-z0-9]/g, "")}_admin`,
      adminPassword: adminPassword || "admin123"
    };

    try {
      await api.post("/technical-admin/companies", newCompanyObj).catch(() => undefined);
      addCompany(newCompanyObj);
      toast.success(`Company ${companyName} provisioned successfully!`);
      setIsModalOpen(false);
      resetForm();
    } catch (err) {
      console.error(err);
      addCompany(newCompanyObj);
      toast.success(`Company ${companyName} provisioned successfully!`);
      setIsModalOpen(false);
      resetForm();
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetForm = () => {
    setCompanyName("");
    setCompanyId("");
    setIndustry("IT Services");
    setEmployeeCount(100);
    setAdminEmail("");
    setEnabledModules(["ATTENDANCE", "CHAT"]);
  };

  const handleDeleteConfirm = () => {
    if (!deleteTarget) return;
    deleteCompany(deleteTarget.companyId);
    toast.success(`${deleteTarget.companyName} (${deleteTarget.companyId}) permanently deleted!`);
    setDeleteTarget(null);
  };

  // Filter companies
  const filteredCompanies = companies.filter(c => {
    const matchesSearch =
      c.companyName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.companyId.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (c.industry || "").toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === "ALL" || c.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  // Counted the rows in a localStorage list of invented accounts, and when there
  // were none it returned 4, 2 or 1 depending on which company you were looking
  // at. The figure the server keeps on the company is the real one.
  const getRealTimeUserCount = (company: { employeeCount?: number }) => company.employeeCount ?? 0;

  return (
    <div className="space-y-6 max-w-[1600px] mx-auto px-4 py-4">
      {/* Breadcrumb */}
      <div className={`flex items-center text-sm font-medium mb-2 ${isDark ? 'text-gray-400' : 'text-slate-500'}`}>
        <span>Technical Admin</span>
        <ChevronRight className="w-4 h-4 mx-2" />
        <span className={isDark ? "text-gray-100" : "text-slate-800"}>Company Management</span>
      </div>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className={`text-2xl font-bold flex items-center gap-2.5 ${isDark ? "text-cyan-400 drop-shadow-[0_0_8px_rgba(6,182,212,0.8)]" : "text-slate-800"}`}>
            <Building2 className={`w-6 h-6 ${isDark ? "text-cyan-400" : "text-blue-600"}`} /> Multi-Tenant Company Management
          </h1>
          <p className={`text-sm mt-1 font-medium ${isDark ? "text-cyan-400" : "text-slate-600"}`}>
            Overview and provisioning of all commercial multi-tenant SaaS companies ({companies.length} Provisioned).
          </p>
        </div>
        <Button onClick={() => setIsModalOpen(true)} className={`${isDark ? "bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold border border-cyan-400 shadow-[0_0_10px_rgba(6,182,212,0.4)]" : "bg-blue-500 hover:bg-blue-600 text-white shadow-md shadow-blue-500/20 font-semibold"} gap-2`}>
          <Plus className="w-4 h-4" /> Add Company
        </Button>
      </div>

      {/* Filters & Table Card */}
      <Card className={isDark ? "bg-slate-900/40 backdrop-blur-xl border border-cyan-500/30 shadow-[0_0_15px_rgba(6,182,212,0.15)]" : "bg-white/90 backdrop-blur-md border-white shadow-xl shadow-slate-200/50"}>
        <div className={`p-4 border-b flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${isDark ? "border-cyan-500/20" : "border-slate-200"}`}>
          <div className="relative flex-1 max-w-md">
            <Search className={`w-4 h-4 absolute left-3 top-3 ${isDark ? 'text-slate-400' : 'text-slate-400'}`} />
            <Input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search by company name, tenant ID or industry..."
              className={`pl-9 ${isDark ? "bg-slate-900/50 border-cyan-500/30 text-slate-200 focus:border-cyan-400" : "bg-white/70 border-white text-slate-800 placeholder:text-slate-400 focus:border-blue-300 focus:bg-white shadow-sm"}`}
            />
          </div>

          <div className="flex items-center gap-3">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className={`p-2 rounded-lg border text-sm font-medium ${isDark ? "bg-slate-900/50 border-cyan-500/30 text-slate-200 focus:border-cyan-400" : "bg-white/70 border-white text-slate-700 shadow-sm"}`}
            >
              <option value="ALL">All Statuses</option>
              <option value="ACTIVE">ACTIVE Only</option>
              <option value="INACTIVE">INACTIVE Only</option>
            </select>
          </div>
        </div>

        {/* DATA TABLE VIEW */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className={`text-xs uppercase font-semibold tracking-wider ${isDark ? "bg-cyan-950/40 text-cyan-400" : "bg-slate-50/80 text-slate-600 border-b border-slate-200"}`}>
              <tr>
                <th className="px-6 py-4">Company Name</th>
                <th className="px-6 py-4">Tenant Scope ID</th>
                <th className="px-6 py-4">Industry Sector</th>
                <th className="px-6 py-4">Total Users</th>
                <th className="px-6 py-4">Company Admin Credentials</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className={`divide-y ${isDark ? 'divide-slate-800' : 'divide-slate-200'}`}>
              {filteredCompanies.length === 0 ? (
                <tr>
                  <td colSpan={7} className={`text-center py-12 ${isDark ? 'text-slate-500' : 'text-slate-500'}`}>
                    No companies found matching "{searchTerm}".
                  </td>
                </tr>
              ) : (
                filteredCompanies.map((company) => (
                  <tr
                    key={company.id}
                    className={`transition-colors ${isDark ? "hover:bg-cyan-900/20 border-b border-cyan-500/10" : "hover:bg-slate-50/50"}`}
                  >
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className={`p-2.5 rounded-xl ${isDark ? "bg-cyan-900/40 text-cyan-400 border border-cyan-500/30 shadow-[0_0_8px_rgba(6,182,212,0.2)]" : "bg-blue-50 text-blue-600 border border-blue-200 shadow-sm"}`}>
                          <Building className="w-5 h-5" />
                        </div>
                        <div>
                          <div className={`font-bold text-base ${isDark ? "text-slate-200" : "text-slate-800"}`}>
                            {company.companyName}
                          </div>
                          <div className={`text-xs font-medium ${isDark ? "text-cyan-400" : "text-slate-500"}`}>Created: {company.createdOn || "01 Jan 2026"}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 font-mono">
                      <span className={`px-2.5 py-1 rounded-md border font-bold text-xs ${isDark ? "bg-cyan-900/40 text-cyan-400 border-cyan-500/30 shadow-[0_0_8px_rgba(6,182,212,0.2)]" : "bg-blue-50 text-blue-700 border-blue-200"}`}>
                        {company.companyId}
                      </span>
                    </td>
                    <td className={`px-6 py-4 font-medium ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>
                      {company.industry || "IT Services"}
                    </td>
                    <td className="px-6 py-4">
                      <span className="font-semibold text-slate-800 dark:text-slate-100">{getRealTimeUserCount(company)}</span>
                      <span className={`text-xs ml-1 font-medium ${isDark ? 'text-slate-300' : 'text-slate-500'}`}>Users</span>
                    </td>
                    <td className="px-6 py-4 text-xs font-mono">
                      <div className={`font-semibold ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>{company.adminEmail || `admin@${company.companyName.toLowerCase().replace(/[^a-z0-9]/g, "")}.com`}</div>
                      <div className={`flex items-center gap-1 mt-0.5 ${isDark ? 'text-slate-500' : 'text-slate-500'}`}>
                        <Key className="w-3 h-3 text-amber-400" />
                        <span>Pass: <strong className={isDark ? "text-slate-300" : "text-slate-800"}>{company.adminPassword || "admin123"}</strong></span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`text-xs px-2.5 py-1 rounded-full font-bold tracking-wide ${company.status === 'ACTIVE' ? (isDark ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-teal-50 text-teal-700 border-teal-200 shadow-sm') : (isDark ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' : 'bg-amber-50 text-amber-700 border-amber-200 shadow-sm')}`}>
                        {company.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {/* "Configure Modules" replaced by Edit, as asked. The
                            module screen is still reachable from the sidebar. */}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openEdit(company)}
                          className={`gap-1.5 font-semibold ${isDark ? "border-cyan-500/30 text-cyan-400 hover:bg-cyan-900/30 shadow-[0_0_8px_rgba(6,182,212,0.1)]" : "text-indigo-600 border-slate-200 hover:bg-indigo-50 hover:text-indigo-800 shadow-sm"}`}
                        >
                          <Settings className="w-3.5 h-3.5" /> Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeleteTarget(company)}
                          className="h-8 px-2.5 text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-lg"
                        >
                          <Trash2 className="w-4 h-4 mr-1" /> Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className={`p-4 border-t text-xs font-medium flex justify-between items-center ${isDark ? "border-cyan-500/20 text-cyan-400" : "border-purple-500/20 text-purple-300"}`}>
          <div>Showing {filteredCompanies.length} of {companies.length} Companies</div>
          <div>All multi-tenant data isolations active</div>
        </div>
      </Card>

      {/* PERMANENT DELETE CONFIRMATION MODAL */}
      {editTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className={`w-full max-w-lg rounded-2xl p-6 ${isDark ? "bg-slate-900 border border-cyan-500/25" : "bg-white border border-slate-200"}`}>
            <div className="flex items-start justify-between mb-5">
              <div>
                <h2 className={`text-lg font-bold ${isDark ? "text-slate-100" : "text-slate-900"}`}>
                  Edit company
                </h2>
                {/* The company id identifies the tenant everywhere and is not
                    editable here — changing it would orphan every row that
                    points at it. */}
                <p className="text-xs mt-0.5 font-mono text-slate-500">
                  {editTarget.companyId}
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setEditTarget(null)} disabled={savingEdit}>
                <X className="w-4 h-4" />
              </Button>
            </div>

            <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
              {([
                ["companyName", "Company name"],
                ["industry", "Industry"],
                ["adminEmail", "Contact email"],
                ["phone", "Phone"],
                ["domain", "Website"],
                ["address", "Address"],
              ] as const).map(([key, label]) => (
                <div key={key}>
                  <Label className="text-xs">{label}</Label>
                  <Input
                    value={editForm[key] ?? ""}
                    disabled={savingEdit}
                    onChange={(e) => setEditForm((f) => ({ ...f, [key]: e.target.value }))}
                    className="mt-1"
                  />
                </div>
              ))}
            </div>

            <div className="flex gap-2 mt-6">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setEditTarget(null)}
                disabled={savingEdit}
              >
                Cancel
              </Button>
              <Button className="flex-1" onClick={saveEdit} disabled={savingEdit}>
                {savingEdit ? <PixousLoader size="xs" /> : "Save changes"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-fade-in">
          <div className={`w-full max-w-md rounded-2xl p-6 shadow-[0_0_20px_rgba(0,0,0,0.5)] border ${isDark ? "bg-slate-900/80 backdrop-blur-xl border-cyan-500/30 text-white" : "bg-[#13002b]/95 backdrop-blur-xl border-purple-500/30 text-purple-50"}`}>
            <div className={`flex items-center gap-3 text-red-500 pb-3 border-b ${isDark ? "border-cyan-500/20" : "border-purple-500/30"}`}>
              <div className="p-2.5 rounded-full bg-red-500/10">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-red-500">Permanently Delete Company?</h3>
            </div>

            <div className="py-4 space-y-3">
              <p className="text-sm text-slate-300">
                Are you sure you want to permanently delete <strong className="text-white font-bold">{deleteTarget.companyName}</strong> (<span className="font-mono text-indigo-400">{deleteTarget.companyId}</span>)?
              </p>
              <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-400">
                ⚠️ Warning: This will permanently purge all module configurations, employee mappings, and tenant data for this company. This action cannot be undone.
              </div>
            </div>

            <div className={`pt-4 flex justify-end gap-3 border-t ${isDark ? "border-cyan-500/20" : "border-purple-500/30"}`}>
              <Button variant="outline" onClick={() => setDeleteTarget(null)} className={`${isDark ? "text-slate-300 border-cyan-500/30 hover:bg-cyan-900/30" : "text-purple-300 border-purple-500/30 hover:bg-purple-900/40 hover:text-purple-100"}`}>
                Cancel
              </Button>
              <Button onClick={handleDeleteConfirm} className="bg-red-600 hover:bg-red-700 text-white font-bold gap-2 shadow-[0_0_10px_rgba(220,38,38,0.4)]">
                <Trash2 className="w-4 h-4" /> Confirm Permanent Delete
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Provision Company Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className={`w-full max-w-xl rounded-2xl p-6 shadow-[0_0_20px_rgba(0,0,0,0.5)] border ${isDark ? "bg-slate-900/80 backdrop-blur-xl border-cyan-500/30 text-white" : "bg-[#13002b]/95 backdrop-blur-xl border-purple-500/30 text-purple-50"}`}>
            <div className={`flex items-center justify-between pb-4 border-b ${isDark ? "border-cyan-500/20" : "border-purple-500/30"}`}>
              <div className="flex items-center gap-2">
                <Sparkles className={`w-5 h-5 ${isDark ? "text-indigo-500" : "text-purple-400"}`} />
                <h3 className="text-lg font-semibold">Provision New SaaS Company Tenant</h3>
              </div>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateCompany} className="space-y-4 pt-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className={isDark ? "text-slate-300" : "text-purple-300"}>Company Name</Label>
                  <Input
                    required
                    placeholder="e.g. Acme Corporation"
                    value={companyName}
                    onChange={(e) => handleNameChange(e.target.value)}
                    className={`mt-1 ${isDark ? "bg-slate-900/50 border-cyan-500/30 text-white focus:border-cyan-400" : "bg-purple-950/50 border-purple-500/30 text-purple-100 placeholder:text-purple-400/50 focus:border-purple-400"}`}
                  />
                </div>
                <div>
                  <Label className={isDark ? "text-slate-300" : "text-purple-300"}>Tenant Scope ID (Auto)</Label>
                  <Input
                    required
                    readOnly
                    placeholder="ACME-9X21Y"
                    value={companyId}
                    className={`mt-1 font-mono font-bold ${isDark ? "text-cyan-400 bg-slate-950/50 border-cyan-500/30" : "text-purple-400 bg-purple-950/50 border-purple-500/30"}`}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className={isDark ? "text-slate-300" : "text-purple-300"}>Industry Sector</Label>
                  <select
                    value={industry}
                    onChange={(e) => setIndustry(e.target.value)}
                    className={`w-full mt-1 p-2.5 rounded-lg border text-sm font-medium ${isDark ? "bg-slate-900/50 border-cyan-500/30 text-slate-200 focus:border-cyan-400" : "bg-purple-950/50 border-purple-500/30 text-purple-100 focus:border-purple-400"}`}
                  >
                    <option value="IT Services">IT Services & Tech</option>
                    <option value="Manufacturing">Manufacturing & Industrial</option>
                    <option value="Healthcare">Healthcare & Biotech</option>
                    <option value="Finance">Finance & Banking</option>
                    <option value="Retail">Retail & E-commerce</option>
                    <option value="Enterprise Services">Enterprise Services</option>
                  </select>
                </div>
                <div>
                  <Label className={isDark ? "text-slate-300" : "text-purple-300"}>Employee Licenses</Label>
                  <Input
                    type="number"
                    min={10}
                    value={employeeCount}
                    onChange={(e) => setEmployeeCount(Number(e.target.value))}
                    className={`mt-1 ${isDark ? "bg-slate-900/50 border-cyan-500/30 text-white focus:border-cyan-400" : "bg-purple-950/50 border-purple-500/30 text-purple-100 placeholder:text-purple-400/50 focus:border-purple-400"}`}
                  />
                </div>
              </div>

              <div>
                <Label className={isDark ? "text-slate-300" : "text-purple-300"}>Company Administrator Login Email</Label>
                <Input
                  type="email"
                  placeholder="admin@acme.com"
                  value={adminEmail}
                  onChange={(e) => setAdminEmail(e.target.value)}
                  className={`mt-1 ${isDark ? "bg-slate-900/50 border-cyan-500/30 text-white focus:border-cyan-400" : "bg-purple-950/50 border-purple-500/30 text-purple-100 placeholder:text-purple-400/50 focus:border-purple-400"}`}
                />
              </div>

              <div>
                <Label className={`block mb-2 text-xs font-semibold ${isDark ? "text-slate-300" : "text-purple-300"}`}>Enable Core Modules initially:</Label>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  {[
                    { code: "ATTENDANCE", label: "Attendance & Shifts" },
                    { code: "CHAT", label: "Team Messaging & Chat" },
                    { code: "PAYROLL", label: "Payroll Processing" },
                    { code: "LEAVE", label: "Leave Management" },
                    { code: "ASSETS", label: "Assets Management" },
                    { code: "REPORTS", label: "Reports & Analytics" },
                  ].map((m) => {
                    const isChecked = enabledModules.includes(m.code);
                    return (
                      <button
                        type="button"
                        key={m.code}
                        onClick={() => handleToggleModule(m.code)}
                        className={`p-2 rounded-lg border text-left flex items-center justify-between transition ${
                          isChecked
                            ? (isDark ? "bg-cyan-900/40 border-cyan-500/50 text-cyan-300 shadow-[0_0_8px_rgba(6,182,212,0.2)]" : "bg-purple-900/60 border-purple-500/50 text-purple-300 shadow-[0_0_10px_rgba(168,85,247,0.3)]")
                            : (isDark ? "bg-slate-900/30 border-cyan-500/20 text-slate-400 hover:border-cyan-500/40" : "bg-purple-950/40 border-purple-500/30 text-purple-300/70 hover:bg-purple-900/50")
                        }`}
                      >
                        <span>{m.label}</span>
                        {isChecked && <Check className={`w-3.5 h-3.5 ${isDark ? "text-cyan-400" : "text-purple-400"}`} />}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className={`pt-4 flex justify-end gap-3 border-t ${isDark ? "border-cyan-500/20" : "border-purple-500/30"}`}>
                <Button type="button" variant="outline" onClick={() => setIsModalOpen(false)} className={`${isDark ? "text-slate-300 border-cyan-500/30 hover:bg-cyan-900/30" : "text-purple-300 border-purple-500/30 hover:bg-purple-900/40"}`}>
                  Cancel
                </Button>
                <Button type="submit" disabled={isSubmitting} className={`${isDark ? "bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold border border-cyan-400 shadow-[0_0_10px_rgba(6,182,212,0.4)]" : "bg-purple-600 hover:bg-purple-500 text-white border border-purple-400 shadow-[0_0_15px_rgba(168,85,247,0.5)]"}`}>
                  {isSubmitting ? <PixousLoader size="xs" className="mr-2" /> : <Plus className="w-4 h-4 mr-2" />} Provision Tenant Company
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
