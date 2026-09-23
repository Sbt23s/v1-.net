import { useState } from "react";
import { useTechAdminAuth, type CompanyTenant } from "@/context/TechAdminAuthContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogHeader } from "@/components/ui/dialog";
import { PixousLoader } from "@/components/ui/pixous-loader";
import toast from "react-hot-toast";
import {
  Building2, Plus, Edit2, Globe, Mail, Phone, MapPin, Users,
  CheckCircle2, AlertTriangle, Trash2, Power, RefreshCw
} from "lucide-react";

export function SettingsCompanyTab() {
  const {
    companies,
    currentCompany,
    setCurrentCompany,
    addCompany,
    updateCompany,
    deleteCompany,
    refreshCompanies,
    companiesFailed
  } = useTechAdminAuth();

  // Edit Company modal state
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editForm, setEditForm] = useState<Partial<CompanyTenant>>({});
  const [savingEdit, setSavingEdit] = useState(false);

  // New Company modal state
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [addForm, setAddForm] = useState({
    companyName: "",
    companyId: "",
    industry: "IT Services",
    employeeCount: 50,
    adminEmail: "",
    adminPassword: "admin123",
    domain: "",
    address: "",
    phone: ""
  });
  const [savingAdd, setSavingAdd] = useState(false);

  // Delete modal state
  const [deleteTarget, setDeleteTarget] = useState<CompanyTenant | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Handle open edit
  const handleOpenEdit = (comp: CompanyTenant) => {
    setEditForm({
      companyName: comp.companyName || "",
      industry: comp.industry || "",
      adminEmail: comp.adminEmail || "",
      phone: comp.phone || "",
      domain: comp.domain || "",
      address: comp.address || ""
    });
    setIsEditOpen(true);
  };

  // Save edited company
  const handleSaveEdit = async () => {
    if (!editForm.companyName?.trim()) {
      toast.error("Company name is required");
      return;
    }
    setSavingEdit(true);
    try {
      await updateCompany(String(currentCompany.companyId || currentCompany.id), {
        companyName: editForm.companyName.trim(),
        industry: editForm.industry?.trim(),
        adminEmail: editForm.adminEmail?.trim(),
        phone: editForm.phone?.trim(),
        domain: editForm.domain?.trim(),
        address: editForm.address?.trim()
      });
      toast.success(`${editForm.companyName.trim()} updated successfully`);
      setIsEditOpen(false);
    } catch (err: any) {
      toast.error(err?.response?.data?.message || err?.message || "Failed to update company");
    } finally {
      setSavingEdit(false);
    }
  };

  // Generate ID on name change
  const handleAddNameChange = (name: string) => {
    const prefix = name.replace(/[^a-zA-Z]/g, "").substring(0, 5).toUpperCase() || "COMP";
    const randomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    setAddForm((prev) => ({
      ...prev,
      companyName: name,
      companyId: name.trim() ? `${prefix}-${randomCode}` : ""
    }));
  };

  // Save new company
  const handleSaveAdd = async () => {
    if (!addForm.companyName.trim() || !addForm.companyId.trim()) {
      toast.error("Company name and ID are required");
      return;
    }
    setSavingAdd(true);
    try {
      const newTenant: CompanyTenant = {
        id: addForm.companyId,
        companyId: addForm.companyId,
        companyName: addForm.companyName.trim(),
        industry: addForm.industry,
        employeeCount: Number(addForm.employeeCount) || 1,
        adminEmail: addForm.adminEmail.trim(),
        adminUsername: `${addForm.companyId.toLowerCase()}_admin`,
        adminPassword: addForm.adminPassword,
        status: "ACTIVE",
        domain: addForm.domain.trim() || `${addForm.companyId.toLowerCase()}.pixous.com`,
        address: addForm.address.trim(),
        phone: addForm.phone.trim()
      };
      await addCompany(newTenant);
      toast.success(`Company ${addForm.companyName} created successfully`);
      setIsAddOpen(false);
      setAddForm({
        companyName: "",
        companyId: "",
        industry: "IT Services",
        employeeCount: 50,
        adminEmail: "",
        adminPassword: "admin123",
        domain: "",
        address: "",
        phone: ""
      });
    } catch (err: any) {
      toast.error(err?.response?.data?.message || err?.message || "Failed to create company");
    } finally {
      setSavingAdd(false);
    }
  };

  // Delete company
  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteCompany(String(deleteTarget.companyId || deleteTarget.id));
      toast.success(`Company ${deleteTarget.companyName} deleted`);
      setDeleteTarget(null);
    } catch (err: any) {
      toast.error(err?.response?.data?.message || err?.message || "Failed to delete company");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner & Quick Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl border border-border bg-card shadow-sm">
        <div>
          <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
            <Building2 className="w-5 h-5 text-primary" />
            Company & Tenant Profiles
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Switch between tenant workspaces or create a new enterprise tenant.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => refreshCompanies()}
            className="gap-1.5 text-xs h-9"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </Button>
          <Button
            size="sm"
            onClick={() => setIsAddOpen(true)}
            className="gap-1.5 text-xs h-9"
          >
            <Plus className="w-4 h-4" />
            Add Company
          </Button>
        </div>
      </div>

      {/* Tenant Selector Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
        {companies.map((comp) => {
          const isSelected =
            String(comp.companyId) === String(currentCompany.companyId) ||
            String(comp.id) === String(currentCompany.id);

          return (
            <div
              key={String(comp.id || comp.companyId)}
              onClick={() => setCurrentCompany(comp)}
              className={`p-3.5 rounded-xl border cursor-pointer transition-all duration-200 ${
                isSelected
                  ? "border-primary bg-primary/5 ring-2 ring-primary/20 shadow-sm"
                  : "border-border bg-card hover:border-primary/40 hover:bg-muted/30"
              }`}
            >
              <div className="flex items-start justify-between">
                <div>
                  <h4 className="text-sm font-semibold text-foreground line-clamp-1">
                    {comp.companyName}
                  </h4>
                  <p className="text-xs font-mono text-muted-foreground mt-0.5">
                    {comp.companyId}
                  </p>
                </div>
                <Badge
                  variant={comp.status === "ACTIVE" ? "default" : "secondary"}
                  className="text-[10px] px-1.5 py-0.5 capitalize"
                >
                  {comp.status || "ACTIVE"}
                </Badge>
              </div>

              <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-border/50 text-[11px] text-muted-foreground">
                <span className="truncate">{comp.industry || "General"}</span>
                <span className="flex items-center gap-1 font-medium">
                  <Users className="w-3 h-3 text-muted-foreground" />
                  {comp.employeeCount ?? 0}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {companiesFailed && (
        <div className="p-4 rounded-xl border border-destructive/20 bg-destructive/5 text-destructive text-sm flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <span>Unable to connect to tenant directory. Showing cached tenant data.</span>
        </div>
      )}

      {/* Selected Company Detailed View */}
      {currentCompany && currentCompany.companyName && (
        <Card className="border-border bg-card shadow-sm">
          <CardHeader className="border-b border-border/60 pb-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <CardTitle className="text-lg font-bold text-foreground">
                    {currentCompany.companyName}
                  </CardTitle>
                  <Badge variant="outline" className="font-mono text-xs">
                    {currentCompany.companyId}
                  </Badge>
                  <Badge
                    variant={currentCompany.status === "ACTIVE" ? "default" : "secondary"}
                    className="text-xs"
                  >
                    {currentCompany.status || "ACTIVE"}
                  </Badge>
                </div>
                <CardDescription className="text-xs mt-1">
                  Active tenant profile configuration and master details.
                </CardDescription>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleOpenEdit(currentCompany)}
                  className="gap-1.5 text-xs h-8"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                  Edit Profile
                </Button>
                {companies.length > 1 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setDeleteTarget(currentCompany)}
                    className="text-destructive hover:bg-destructive/10 text-xs h-8 px-2.5"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>

          <CardContent className="pt-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-5">
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-primary/10 text-primary">
                  <Globe className="w-4 h-4" />
                </div>
                <div>
                  <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider block">
                    Domain / Website
                  </span>
                  <span className="text-sm font-semibold text-foreground mt-0.5 block">
                    {currentCompany.domain || "Not configured"}
                  </span>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-primary/10 text-primary">
                  <Mail className="w-4 h-4" />
                </div>
                <div>
                  <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider block">
                    Contact Email
                  </span>
                  <span className="text-sm font-semibold text-foreground mt-0.5 block">
                    {currentCompany.adminEmail || "Not configured"}
                  </span>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-primary/10 text-primary">
                  <Phone className="w-4 h-4" />
                </div>
                <div>
                  <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider block">
                    Phone Number
                  </span>
                  <span className="text-sm font-semibold text-foreground mt-0.5 block">
                    {currentCompany.phone || "Not configured"}
                  </span>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-primary/10 text-primary">
                  <Building2 className="w-4 h-4" />
                </div>
                <div>
                  <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider block">
                    Industry Sector
                  </span>
                  <span className="text-sm font-semibold text-foreground mt-0.5 block">
                    {currentCompany.industry || "General Enterprise"}
                  </span>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-primary/10 text-primary">
                  <Users className="w-4 h-4" />
                </div>
                <div>
                  <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider block">
                    Active Employees
                  </span>
                  <span className="text-sm font-semibold text-foreground mt-0.5 block">
                    {currentCompany.employeeCount ?? 0} Accounts
                  </span>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-primary/10 text-primary">
                  <MapPin className="w-4 h-4" />
                </div>
                <div>
                  <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider block">
                    Corporate Address
                  </span>
                  <span className="text-sm font-semibold text-foreground mt-0.5 block">
                    {currentCompany.address || "Not configured"}
                  </span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Edit Company Dialog */}
      <Dialog open={isEditOpen} onClose={() => setIsEditOpen(false)}>
        <DialogHeader
          title="Edit Company Profile"
          description="Update organization identity and contact information for this tenant."
        />

        <div className="space-y-4 my-4">
          <div>
            <Label className="text-xs font-semibold">Company Name</Label>
            <Input
              value={editForm.companyName || ""}
              onChange={(e) => setEditForm({ ...editForm, companyName: e.target.value })}
              className="mt-1"
              placeholder="e.g. Pixous Technologies"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs font-semibold">Industry</Label>
              <Input
                value={editForm.industry || ""}
                onChange={(e) => setEditForm({ ...editForm, industry: e.target.value })}
                className="mt-1"
                placeholder="e.g. Information Technology"
              />
            </div>
            <div>
              <Label className="text-xs font-semibold">Phone</Label>
              <Input
                value={editForm.phone || ""}
                onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                className="mt-1"
                placeholder="+91 98765 43210"
              />
            </div>
          </div>

          <div>
            <Label className="text-xs font-semibold">Contact Email</Label>
            <Input
              type="email"
              value={editForm.adminEmail || ""}
              onChange={(e) => setEditForm({ ...editForm, adminEmail: e.target.value })}
              className="mt-1"
              placeholder="contact@company.com"
            />
          </div>

          <div>
            <Label className="text-xs font-semibold">Domain / Website</Label>
            <Input
              value={editForm.domain || ""}
              onChange={(e) => setEditForm({ ...editForm, domain: e.target.value })}
              className="mt-1"
              placeholder="portal.company.com"
            />
          </div>

          <div>
            <Label className="text-xs font-semibold">Address</Label>
            <Input
              value={editForm.address || ""}
              onChange={(e) => setEditForm({ ...editForm, address: e.target.value })}
              className="mt-1"
              placeholder="Corporate headquarters address"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsEditOpen(false)}
            disabled={savingEdit}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSaveEdit}
            disabled={savingEdit}
            className="gap-1.5"
          >
            {savingEdit && <PixousLoader size="xs" />}
            {savingEdit ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </Dialog>

      {/* Add Company Dialog */}
      <Dialog open={isAddOpen} onClose={() => setIsAddOpen(false)}>
        <DialogHeader
          title="Provision New Tenant"
          description="Add a new company tenant to the platform with dedicated workspace configuration."
        />

        <div className="space-y-4 my-4">
          <div>
            <Label className="text-xs font-semibold">Company Name *</Label>
            <Input
              value={addForm.companyName}
              onChange={(e) => handleAddNameChange(e.target.value)}
              className="mt-1"
              placeholder="e.g. Acme Corp"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs font-semibold">Company ID *</Label>
              <Input
                value={addForm.companyId}
                onChange={(e) => setAddForm({ ...addForm, companyId: e.target.value })}
                className="mt-1 font-mono text-xs uppercase"
                placeholder="ACME-100"
              />
            </div>
            <div>
              <Label className="text-xs font-semibold">Industry</Label>
              <Input
                value={addForm.industry}
                onChange={(e) => setAddForm({ ...addForm, industry: e.target.value })}
                className="mt-1"
                placeholder="IT Services"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs font-semibold">Admin Email</Label>
              <Input
                type="email"
                value={addForm.adminEmail}
                onChange={(e) => setAddForm({ ...addForm, adminEmail: e.target.value })}
                className="mt-1"
                placeholder="admin@acme.com"
              />
            </div>
            <div>
              <Label className="text-xs font-semibold">Est. Employees</Label>
              <Input
                type="number"
                value={addForm.employeeCount}
                onChange={(e) => setAddForm({ ...addForm, employeeCount: Number(e.target.value) })}
                className="mt-1"
              />
            </div>
          </div>

          <div>
            <Label className="text-xs font-semibold">Portal Domain</Label>
            <Input
              value={addForm.domain}
              onChange={(e) => setAddForm({ ...addForm, domain: e.target.value })}
              className="mt-1"
              placeholder="acme.pixous.com"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsAddOpen(false)}
            disabled={savingAdd}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSaveAdd}
            disabled={savingAdd}
            className="gap-1.5"
          >
            {savingAdd && <PixousLoader size="xs" />}
            {savingAdd ? "Creating..." : "Create Tenant"}
          </Button>
        </div>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={Boolean(deleteTarget)} onClose={() => setDeleteTarget(null)}>
        <DialogHeader
          title="Delete Company Tenant"
          description={`Are you sure you want to delete ${deleteTarget?.companyName}? This action cannot be undone.`}
        />

        <div className="flex items-center justify-end gap-2 pt-4 mt-4 border-t border-border">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setDeleteTarget(null)}
            disabled={deleting}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={handleConfirmDelete}
            disabled={deleting}
            className="gap-1.5"
          >
            {deleting && <PixousLoader size="xs" />}
            {deleting ? "Deleting..." : "Delete Company"}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
