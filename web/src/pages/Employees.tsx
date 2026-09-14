import { PixousLoader } from "@/components/ui/pixous-loader";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import {
  useReactTable, getCoreRowModel, flexRender, createColumnHelper
} from "@tanstack/react-table";
import { Search, Users, ChevronLeft, ChevronRight, UserPlus, Camera, RefreshCw, Download, FileSpreadsheet, UploadCloud, CheckCircle2, AlertCircle, Upload, Paperclip, KeyRound, Eye, EyeOff, Trash2, X, History as HistoryIcon, ScanFace, ShieldCheck, ShieldAlert, Pencil, Filter, FilterX } from "lucide-react";
import * as XLSX from "xlsx";
import toast from "react-hot-toast";
import { api, apiMessage } from "@/lib/api";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ViewButton } from "@/components/ui/view-button";
import { ExportExcelButton } from "@/components/ui/export-excel-button";
import { EmployeeHistoryDialog } from "@/components/EmployeeHistoryDialog";
import { Badge } from "@/components/ui/badge";
import { Avatar, resolvePhotoUrl } from "@/components/ui/avatar";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { PageLoader } from "@/components/ui/page-loader";
import { Dialog, DialogHeader } from "@/components/ui/dialog";
import { FaceTrainDialog } from "@/components/ui/FaceTrainDialog";
import { useAuth } from "@/hooks/useAuth";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from "@/components/ui/table";
import type { ApiEnvelope, PageEnvelope, UserSummary, Profile, DropdownItem, BankResponse } from "@/types";
import {
  parseEmployeeWorkbook, credsToCsv, buildImportTemplate, IMPORT_SHEETS,
  type EmployeeImportPayload, type ImportCred, type SheetReport
} from "@/lib/employeeImport";
import dayjs from "dayjs";
import { useRef, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import { EMAIL_PATTERN, digitsOnly } from "@/lib/validation";
import { TablePagination } from "@/components/ui/table-pagination";
import { roleCodeLabel, roleLabels } from "@/lib/roles";
import { DATE_MIN, DATE_MAX } from "@/lib/dates";

const column = createColumnHelper<UserSummary>();

export default function EmployeesPage() {
  const { user, hasPermission, hasRole } = useAuth();


  const [q, setQ] = useState("");
  /*
    The box updates as you type; the request waits until the typing stops.

    q is part of the query key below, so each keystroke was a new key and a
    new /users call across three thousand employees -- six requests to type a
    name, five of them answers nobody reads. Only the server query is
    debounced: the local filter and the export still read q directly, because
    those are instant and a delay there would just be a slower page.
  */
  const dq = useDebouncedValue(q);
  const [industry, setIndustry] = useState("");
  const [status, setStatus] = useState<"ACTIVE" | "OFFBOARDED">("ACTIVE");
  const [page, setPage] = useState(0);
  /** Rows per page. The server pages this list, so the size goes with the call. */
  const [pageSize, setPageSize] = useState(10);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [addIndustry, setAddIndustry] = useState<"IT" | "CIVIL" | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [exportingLogins, setExportingLogins] = useState(false);
  // Add, Import and Edit. HR reaches these through EMPLOYEE_MANAGE; offboarding
  // and deleting an employee remain admin-only.
  const canManage = hasPermission("USER_MANAGE", "EMPLOYEE_MANAGE") || hasRole("SUPER_ADMIN") || hasRole("COMPANY_ADMIN");

  /*
   * Permanent deletion.
   *
   * Separate from offboarding, which disables an account and keeps the record.
   * This removes the row and forty-two tables cascade from it, so the dialog
   * asks the administrator to type the person's name -- a destructive button
   * sitting next to Edit on a crowded table is easy to hit by accident, and
   * there is no undo.
   */
  const deleteQc = useQueryClient();
  const [deleteTarget, setDeleteTarget] = useState<{
    id: number; name: string; code: string;
  } | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const deleteEmployee = useMutation({
    /*
     * No typed confirmation. The server still accepts one -- assertDeletable
     * skips the check when it is absent -- so the guards that matter are
     * untouched: nobody can delete their own account, and an employee with
     * payslips is refused because PF and ESI figures have to be kept.
     *
     * What is gone is the second step. One confirm on a dialog that says what
     * will be removed is a deliberate act; asking for a name as well was
     * friction the person deleting had already decided against.
     */
    mutationFn: async (vars: { id: number }) =>
      (await api.delete(`/users/${vars.id}`)).data,
    onSuccess: () => {
      deleteQc.invalidateQueries({ queryKey: ["employees"] });
      setDeleteTarget(null);
      setDeleteError(null);
    },
    onError: (e: any) => {
      // The server explains why -- payslips on record, a name that does not
      // match -- and that sentence is more use than "delete failed".
      setDeleteError(e?.response?.data?.message ?? "Could not delete this employee.");
    }
  });

  /** The narrowing filters, kept together so clearing them is one action. */
  const [filters, setFilters] = useState({
    designationTitle: "", roleCode: "", departmentId: "", employmentType: "", profileStatus: "", companyId: "", joinedFrom: "", joinedTo: ""
  });
  const setFilter = (key: keyof typeof filters, value: string) => {
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(0);
  };
  const filtersOn = Object.values(filters).some((v) => v.trim() !== "");
  const clearFilters = () => {
    setFilters({ designationTitle: "", roleCode: "", departmentId: "", employmentType: "", profileStatus: "", companyId: "", joinedFrom: "", joinedTo: "" });
    setPage(0);
  };

  const directory = useQuery({
    queryKey: ["employees", dq, industry, status, page, pageSize, filters],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      try {
        const params = new URLSearchParams({ page: String(page), size: String(pageSize) });
        if (dq) params.set("q", dq);
        if (industry) params.set("industry", industry);
        params.set("status", status);
        Object.entries(filters).forEach(([k, v]) => {
          if (v.trim()) params.set(k, v.trim());
        });
        const res = await api.get<ApiEnvelope<PageEnvelope<UserSummary>>>(
          `/users?${params.toString()}`
        );
        const data = res.data?.data;
      /*
        No filtering here any more.

        This dropped the CTO record unless the viewer was the CTO, guessing at
        which row that was from the employee code, the literal name "CTO", or
        the word appearing anywhere in a designation -- so an employee whose
        title read "CTO Office Assistant" vanished from the directory, and the
        CTO saw their own row while HR did not.

        The server now excludes all three platform accounts -- the super
        administrator, the system administrator and the company head -- inside
        the directory query itself, so the page count and the rows agree.
        Filtering afterwards took three rows off an already-paged result and
        then reported the shortened length as the total, which made the last
        page of the directory unreachable.
      */
      if (data?.content) {
        return data;
      }
      } catch {}

      // Original fallback employee list - STRICT MULTI-TENANT ISOLATION
      let tenantList: any[] = [];
      const tenantId = user?.tenantId;
      
      if (tenantId) {
        // Load dynamically created mock users for the current offline test company
        const storageKey = `hrp.company_users_${tenantId}`;
        const storedUsersStr = localStorage.getItem(storageKey);
        if (storedUsersStr) {
          const storedUsers = JSON.parse(storedUsersStr);
          tenantList = storedUsers.map((u: any) => ({
            id: u.id,
            employeeCode: (u.role === "COMPANY_ADMIN" || u.role === "SUPER_ADMIN") ? "ADMIN" : `EMP${u.id.toString().substring(0, 4)}`,
            firstName: u.name.split(" ")[0] || "",
            lastName: u.name.split(" ").slice(1).join(" ") || "",
            name: u.name,
            email: u.email,
            departmentName: "General",
            designationTitle: u.role.replace("_", " "),
            roles: [u.role],
            active: u.status === "ACTIVE"
          }));
        }
      }
      


      const filtered = tenantList.filter(e => {
        if (!q) return true;
        const name = `${e.firstName} ${e.lastName}`.toLowerCase();
        return name.includes(q.toLowerCase()) || e.email.toLowerCase().includes(q.toLowerCase()) || (e.employeeCode && e.employeeCode.toLowerCase().includes(q.toLowerCase()));
      });

      // page/size/last are part of PageEnvelope; leaving them out and casting
      // made the object look like a page without being one.
      const envelope: PageEnvelope<UserSummary> = {
        content: filtered as unknown as UserSummary[],
        page: 0,
        size: filtered.length,
        totalPages: 1,
        totalElements: filtered.length,
        last: true
      };
      return envelope;
    }
  });

  // Teams, departments and roles to filter by — the same lists the joining form
  // offers, so a filter can never name a team that does not exist.
  const filterLookups = useQuery({
    enabled: canManage,
    queryKey: ["org-dropdowns", "employee-filters"],
    queryFn: async () => {
      const res = await api.post<ApiEnvelope<Record<string, DropdownItem[]>>>(
        "/org/dropdowns", ["department", "designation"]
      );
      return res.data.data;
    }
  });

  /**
   * Excel of the whole directory under the filters on screen — not just the page
   * being viewed, which is what makes the download worth having.
   */
  const exportEmployees = async () => {
    setExporting(true);
    const id = toast.loading("Preparing the employee export…");
    try {
      const params = new URLSearchParams({ page: "0", size: "2000" });
      if (q) params.set("q", q);
      if (industry) params.set("industry", industry);
      params.set("status", status);
      // The narrowing filters travel too, so the file is what is on screen.
      Object.entries(filters).forEach(([k, v]) => {
        if (v.trim()) params.set(k, v.trim());
      });
      const res = await api.get<ApiEnvelope<PageEnvelope<UserSummary>>>(
        `/users?${params.toString()}`
      );
      const people = res.data.data.content ?? [];
      if (people.length === 0) {
        toast.error("No employees match these filters.", { id });
        return;
      }

      const headers = ["#", "Employee ID", "Name", "Email", "Contact", "Industry",
                       "Roles", "Designation", "Date of Birth", "Status"];
      const rows = people.map((u, i) => [
        i + 1,
        u.employeeCode ?? "",
        u.name ?? "",
        u.email ?? "",
        u.phone ?? "",
        industryLabel(u.industry) ?? "",
        roleLabels(u.roles).join(", "),
        u.designationTitle || desigMap.get(u.designationId ?? -1) || "",
        u.dob ? dayjs(u.dob).format("DD MMM YYYY") : "",
        u.profileStatus ?? ""
      ]);

      const scope = [
        industry ? industryLabel(industry) : "All industries",
        status === "ACTIVE" ? "Onboarded" : "Offboarded",
        q ? `matching “${q}”` : ""
      ].filter(Boolean).join(" · ");

      const ws = XLSX.utils.aoa_to_sheet([
        [`Employee Directory — ${scope}`],
        [`${people.length} employee${people.length === 1 ? "" : "s"} · exported ${dayjs().format("DD MMM YYYY, h:mm A")}`],
        [],
        headers,
        ...rows
      ]);
      // Widths so nothing opens truncated, and a merged title across the table.
      ws["!cols"] = [{ wch: 5 }, { wch: 14 }, { wch: 26 }, { wch: 32 }, { wch: 14 },
                     { wch: 12 }, { wch: 18 }, { wch: 26 }, { wch: 15 }, { wch: 13 }];
      ws["!merges"] = [
        { s: { r: 0, c: 0 }, e: { r: 0, c: headers.length - 1 } },
        { s: { r: 1, c: 0 }, e: { r: 1, c: headers.length - 1 } }
      ];

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Employees");
      XLSX.writeFile(wb, `Employees_${dayjs().format("YYYY-MM-DD")}.xlsx`);
      toast.success(`Exported ${people.length} employees`, { id });
    } catch (err) {
      toast.error(apiMessage(err, "Could not export the directory"), { id });
    } finally {
      setExporting(false);
    }
  };

  /**
   * Roles and logins for everyone. There is deliberately no password column —
   * passwords are stored as one-way hashes (AuthService encodes them), so no
   * export can contain them. Use Reset Login on an employee to set a new one.
   */
  const exportLogins = async () => {
    setExportingLogins(true);
    const id = toast.loading("Preparing the login list…");
    try {
      const res = await api.get<ApiEnvelope<PageEnvelope<UserSummary>>>(
        "/users?page=0&size=2000&status=ACTIVE"
      );
      const people = res.data.data.content ?? [];
      if (people.length === 0) {
        toast.error("No active employees to export.", { id });
        return;
      }

      const ROLE_LABEL: Record<string, string> = {
        SUPER_ADMIN: "Admin", IT_HR: "HR Head", IT_MGR: "HR", IT_TL: "Team Leader",
        IT_EMP: "Employee", CV_EMP: "Field Employee", CV_SUP: "Site Supervisor",
        CV_HR: "HR", IT_FIN: "Finance", IT_CEO: "CTO", IT_AST: "Asset Manager",
        CV_ADM: "Facilities Admin"
      };
      const label = (roles?: string[]) =>
        (roles ?? []).map((r) => ROLE_LABEL[r] || r.replace(/_/g, " ")).join(", ") || "—";

      // Seniority first so the sheet reads admin, HR, TL, then employees.
      const rank = (roles?: string[]) => {
        const r = roles ?? [];
        if (r.includes("SUPER_ADMIN")) return 0;
        if (r.includes("IT_HR") || r.includes("CV_HR")) return 1;
        if (r.includes("IT_MGR")) return 2;
        if (r.includes("IT_TL") || r.includes("CV_SUP")) return 3;
        return 4;
      };
      const sorted = [...people].sort((a, b) =>
        rank(a.roles) - rank(b.roles) || a.name.localeCompare(b.name));

      const headers = ["#", "Employee ID", "Name", "Role", "Username", "Email",
                       "Contact", "Team", "Status"];
      const rows = sorted.map((u, i) => [
        i + 1,
        u.employeeCode ?? "",
        u.name ?? "",
        label(u.roles),
        u.username || "— not set —",
        u.email ?? "",
        u.phone ?? "",
        u.designationTitle || desigMap.get(u.designationId ?? -1) || "",
        u.profileStatus ?? ""
      ]);

      const ws = XLSX.utils.aoa_to_sheet([
        ["Roles & Logins — Pixous Technologies"],
        [`${sorted.length} active employees · exported ${dayjs().format("DD MMM YYYY, h:mm A")}`],
        ["Passwords are stored as one-way hashes and cannot be exported. "
          + "To give someone a new password, open the employee and use Reset Login."],
        [],
        headers,
        ...rows
      ]);
      ws["!cols"] = [{ wch: 5 }, { wch: 14 }, { wch: 26 }, { wch: 16 }, { wch: 22 },
                     { wch: 32 }, { wch: 14 }, { wch: 24 }, { wch: 12 }];
      ws["!merges"] = [
        { s: { r: 0, c: 0 }, e: { r: 0, c: headers.length - 1 } },
        { s: { r: 1, c: 0 }, e: { r: 1, c: headers.length - 1 } },
        { s: { r: 2, c: 0 }, e: { r: 2, c: headers.length - 1 } }
      ];

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Roles & Logins");
      XLSX.writeFile(wb, `Roles_and_Logins_${dayjs().format("YYYY-MM-DD")}.xlsx`);
      toast.success(`Exported ${sorted.length} logins`, { id });
    } catch (err) {
      toast.error(apiMessage(err, "Could not export the login list"), { id });
    } finally {
      setExportingLogins(false);
    }
  };

  // Designation lookup (id -> label) so the table can show a real title for
  // employees whose designation is stored as an id rather than free text.
  const desigLookup = useQuery({
    queryKey: ["org-dropdowns", "designation-list"],
    queryFn: async () => {
      const res = await api.post<ApiEnvelope<Record<string, DropdownItem[]>>>(
        "/org/dropdowns",
        ["designation"]
      );
      return res.data.data;
    }
  });
  const desigMap = useMemo(() => {
    const m = new Map<number, string>();
    (desigLookup.data?.designation ?? []).forEach((d) => m.set(d.id, d.label));
    return m;
  }, [desigLookup.data]);

  const columns = useMemo(
    () => [
      column.accessor("name", {
        header: "Employee",
        cell: (info) => (
          <div className="flex items-center gap-3">
            <Avatar name={info.getValue()} src={info.row.original.photoPath} className="h-9 w-9 border shadow-sm" />
            <div>
              <div className="font-semibold text-foreground leading-tight">{info.getValue()}</div>
              <div className="mt-0.5 inline-block code-chip text-[11px] font-mono text-muted-foreground">
                {info.row.original.employeeCode || `PIX-E${String(info.row.original.id).padStart(3, '0')}`}
              </div>
            </div>
          </div>
        )
      }),
      column.accessor("email", {
        header: "Contact",
        cell: (info) => (
          <div className="text-xs">
            <div className="font-medium text-foreground truncate max-w-[190px]" title={info.getValue() || "—"}>
              {info.getValue() || "—"}
            </div>
            <div className="text-muted-foreground font-mono mt-0.5">{info.row.original.phone || "—"}</div>
          </div>
        )
      }),

      column.display({
        id: "designation",
        header: "Designation",
        cell: (info) => {
          const row = info.row.original;
          const label =
            row.designationTitle ||
            (row.designationId != null ? desigMap.get(row.designationId) : undefined);
          return <span className="text-xs text-foreground">{label || "—"}</span>;
        }
      }),

      column.accessor("roles", {
        header: "Role",
        cell: (info) => {
          const rList = info.getValue() ?? [];
          if (rList.length === 0) return <span className="text-xs text-muted-foreground">—</span>;
          const mainRole = rList[0];
          const roleLabel = roleCodeLabel(mainRole);
          const isManager = mainRole === "SUPER_ADMIN" || mainRole === "COMPANY_ADMIN" || mainRole === "IT_HR" || mainRole === "IT_MGR";
          return (
            <Badge className={cn("text-[10px] font-semibold border whitespace-nowrap", isManager ? "bg-purple-500/10 text-purple-700 dark:text-purple-300 border-purple-500/30" : "bg-muted text-muted-foreground")}>
              {roleLabel}
            </Badge>
          );
        }
      }),

      column.display({
        id: "status",
        header: "Status",
        cell: (info) => {
          const pStatus = info.row.original.profileStatus || ((info.row.original as any).active === false ? "OFFBOARDED" : "ACTIVE");
          const isOffboard = pStatus === "OFFBOARDED";
          const isOnboarding = pStatus === "ONBOARDING";
          return (
            <Badge className={cn("text-[10px] font-bold tracking-wide border whitespace-nowrap",
              isOnboarding ? "bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/20"
              : isOffboard ? "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20"
              : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20"
            )}>
              {isOffboard ? "OFFBOARDED" : isOnboarding ? "ONBOARDING" : "ACTIVE"}
            </Badge>
          );
        }
      }),
      column.display({
        id: "actions",
        header: () => <div className="text-right">Actions</div>,
        cell: (info) => (
          <div className="flex items-center justify-end gap-1">
            <ViewButton onClick={() => setDetailId(info.row.original.id)} />
            {canManage && info.row.original.profileStatus !== "OFFBOARDED" && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-xs gap-1 font-medium text-primary hover:text-primary hover:bg-primary/10"
                onClick={() => setEditId(info.row.original.id)}
              >
                <Pencil className="h-3.5 w-3.5" /> Edit
              </Button>
            )}
            {/*
              Offered on offboarded employees too, unlike Edit. Somebody who has
              left is exactly who an administrator wants to remove, and hiding
              the button there would mean the only accounts you can delete are
              the ones still working here.
            */}
            {canManage && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-xs gap-1 font-medium text-destructive hover:text-destructive hover:bg-destructive/10"
                onClick={() => setDeleteTarget({
                  id: info.row.original.id,
                  name: info.row.original.name,
                  code: info.row.original.employeeCode
                })}
              >
                <Trash2 className="h-3.5 w-3.5" /> Delete
              </Button>
            )}
          </div>
        )
      })
    ],
    [canManage, desigMap, user, setDeleteTarget]
  );

  const rows = directory.data?.content ?? [];
  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel()
  });

  const totalPages = directory.data?.totalPages ?? 1;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Employees"
        subtitle="Company directory across IT and field teams."
        actions={
          <div className="flex flex-wrap items-center gap-3">
            {/* Onboard / Offboard Toggle */}
            <div className="flex gap-1 bg-muted/60 p-1 rounded-full border">
              <button
                type="button"
                onClick={() => {
                  setStatus("ACTIVE");
                  setPage(0);
                }}
                className={cn(
                  "px-3 py-1 rounded-full text-xs font-semibold transition-all duration-200",
                  status === "ACTIVE"
                    ? "bg-emerald-600 text-white shadow-sm"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                )}
              >
                Onboard
              </button>
              <button
                type="button"
                onClick={() => {
                  setStatus("OFFBOARDED");
                  setPage(0);
                }}
                className={cn(
                  "px-3 py-1 rounded-full text-xs font-semibold transition-all duration-200",
                  status === "OFFBOARDED"
                    ? "bg-slate-600 text-white shadow-sm"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                )}
              >
                Offboard
              </button>
            </div>

            {/* Industry Toggle */}
            <div className="flex gap-1 bg-muted/60 p-1 rounded-full border">
              <button
                type="button"
                onClick={() => {
                  setIndustry("");
                  setFilter("designationTitle", "");
                  setPage(0);
                }}
                className={cn(
                  "px-3 py-1 rounded-full text-xs font-semibold transition-all duration-200",
                  industry === "" 
                    ? "bg-primary text-primary-foreground shadow-sm" 
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                )}
              >
                All
              </button>
              <button
                type="button"
                onClick={() => {
                  setIndustry("IT");
                  setFilter("designationTitle", "");
                  setPage(0);
                }}
                className={cn(
                  "px-3 py-1 rounded-full text-xs font-semibold transition-all duration-200",
                  industry === "IT" 
                    ? "bg-sky-600 text-white shadow-sm" 
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                )}
              >
                Digital
              </button>
              <button
                type="button"
                onClick={() => {
                  setIndustry("CIVIL");
                  setPage(0);
                }}
                className={cn(
                  "px-3 py-1 rounded-full text-xs font-semibold transition-all duration-200",
                  industry === "CIVIL" 
                    ? "bg-amber-600 text-white shadow-sm" 
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                )}
              >
                Infra
              </button>
            </div>

            {canManage && (
              <div className="flex flex-wrap items-center gap-2">
                {/* Recommended Action Order: Export Excel -> Roles & Logins -> Import Excel -> Add Employee */}
                {/* This export can take a moment, so it says so while it runs.
                    The shared button renders its own icon; the spinner replaces
                    the label rather than the icon. */}
                <ExportExcelButton onClick={exportEmployees} disabled={exporting}>
                  {exporting ? "Exporting…" : "Export Excel"}
                </ExportExcelButton>
                <Button
                  variant="outline"
                  onClick={() => setImportOpen(true)}
                  className="rounded-md font-semibold border-border hover:bg-muted text-xs h-9 px-3"
                >
                  <FileSpreadsheet className="mr-1.5 h-3.5 w-3.5" /> Import Excel
                </Button>
                <Button
                  onClick={() => setAddIndustry("IT")}
                  className="rounded-md font-semibold bg-primary hover:bg-primary/90 text-primary-foreground shadow-md shadow-primary/20 text-xs h-9 px-3"
                >
                  <UserPlus className="mr-1.5 h-3.5 w-3.5" /> Add Employee
                </Button>
              </div>
            )}
          </div>
        }
      />

      <Card className="border shadow-sm">
        <CardContent className="p-4 space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search by employee name, ID, email, phone or designation…"
                className="pl-9 pr-9 text-sm"
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setPage(0);
                }}
              />
              {/*
                A spinner while the search is in flight.

                The box debounces, so between the last keystroke and the new
                rows there is a quarter-second where the old results are still
                on screen and nothing says why. That gap is most of what "the
                search feels slow" describes -- the work is quick, the silence
                is not. isFetching covers both the wait and the request.
              */}
              {(directory.isFetching || q !== dq) && (
                <span className="absolute right-3 top-1/2 -translate-y-1/2">
                  <PixousLoader size="xs" />
                </span>
              )}
            </div>
          </div>

          {/* Narrowing filters */}
          {canManage && (
            <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-muted/20 p-3">
              <div className="flex flex-col">
                <label className="mb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Designation</label>
                <Select
                  className="h-[36px] w-[12rem] text-xs"
                  value={filters.designationTitle}
                  onChange={(e) => setFilter("designationTitle", e.target.value)}
                >
                  <option value="">All designations</option>
                  {(filterLookups.data?.designation ?? []).map((d) => (
                    <option key={d.id} value={d.label}>{d.label}</option>
                  ))}
                </Select>
              </div>
              <div className="flex flex-col">
                <label className="mb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Role</label>
                <Select
                  className="h-[36px] w-[11rem] text-xs"
                  value={filters.roleCode}
                  onChange={(e) => setFilter("roleCode", e.target.value)}
                >
                  <option value="">All roles</option>
                  {ROLE_OPTIONS.map((r) => (
                    <option key={r.code} value={r.code}>{r.label}</option>
                  ))}
                </Select>
              </div>

              {filtersOn && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={clearFilters}
                  className="h-[36px] gap-1 text-xs text-muted-foreground hover:bg-muted font-medium"
                >
                  <FilterX className="h-3.5 w-3.5" /> Clear filters
                </Button>
              )}

              {/*
                Service record, at the far right of the filter row.

                It belongs beside the filters rather than with the header
                actions: those four create and move data, this one only looks
                back at it. ml-auto pushes it into the space the filters leave.
              */}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setHistoryOpen(true)}
                className="ml-auto h-[36px] gap-1.5 text-xs font-medium"
              >
                <HistoryIcon className="h-3.5 w-3.5" /> Employee History
              </Button>
            </div>
          )}

          {directory.isLoading ? (
            <PageLoader text="Loading employee directory..." className="min-h-[300px]" />
          ) : directory.isError ? (
            <div className="flex flex-col items-center justify-center p-8 text-center space-y-3">
              <AlertCircle className="h-10 w-10 text-destructive" />
              <p className="text-sm font-medium text-destructive">Could not load employee directory</p>
              <Button size="sm" variant="outline" onClick={() => directory.refetch()}>
                Retry
              </Button>
            </div>
          ) : rows.length === 0 ? (
            <EmptyState icon={Users} title="No employees found" description="Try changing your search or filters." />
          ) : (
            <>
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader className="bg-muted/50 sticky top-0 z-10 backdrop-blur">
                    {table.getHeaderGroups().map((hg) => (
                      <TableRow key={hg.id} className="hover:bg-transparent">
                        {hg.headers.map((h) => (
                          <TableHead key={h.id} className="font-semibold text-xs text-foreground uppercase tracking-wider py-3">
                            {flexRender(h.column.columnDef.header, h.getContext())}
                          </TableHead>
                        ))}
                      </TableRow>
                    ))}
                  </TableHeader>
                  <TableBody>
                    {table.getRowModel().rows.map((row) => (
                      <TableRow key={row.id} className="hover:bg-muted/40 transition-colors">
                        {row.getVisibleCells().map((cell) => (
                          <TableCell key={cell.id} className="py-3">
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="sticky bottom-0 z-10 mt-4 border-t bg-background/95 pr-16 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:pr-20">
                <TablePagination
                  page={page}
                  totalPages={totalPages}
                  onChange={setPage}
                  pageSize={pageSize}
                  onPageSizeChange={(n) => { setPageSize(n); setPage(0); }}
                  total={directory.data?.totalElements}
                  always
                />
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <EmployeeDetail id={detailId} onClose={() => setDetailId(null)} />
      {addIndustry && (
        <AddEmployeeDialog
          onClose={() => setAddIndustry(null)}
          defaultIndustry={addIndustry}
        />
      )}
      {importOpen && <ImportEmployeesDialog onClose={() => setImportOpen(false)} />}
      {editId && (
        <EditEmployeeDialog
          id={editId}
          onClose={() => setEditId(null)}
        />
      )}

      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => { setDeleteTarget(null); setDeleteError(null); }}
        >
          <div
            className="w-full max-w-md rounded-lg border bg-background p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="flex items-center gap-2 text-sm font-semibold text-destructive">
              <AlertCircle className="h-4 w-4" />
              Delete {deleteTarget.name}?
            </h3>

            <p className="mt-3 text-[13px] text-muted-foreground">
              This removes the employee and everything recorded about them:
              attendance, leave, claims, tickets, tasks, work reports, documents
              and bank details. There is no undo.
            </p>
            <p className="mt-2 text-[13px] text-muted-foreground">
              To keep the record and only stop access, offboard them instead.
            </p>

            {deleteError && (
              <p className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
                {deleteError}
              </p>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => { setDeleteTarget(null); setDeleteError(null); }}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={deleteEmployee.isPending}
                onClick={() => deleteEmployee.mutate({ id: deleteTarget.id })}
              >
                {deleteEmployee.isPending ? "Deleting..." : "Delete"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {historyOpen && <EmployeeHistoryDialog onClose={() => setHistoryOpen(false)} />}
    </div>
  );
}

const ANALYTICS_BASE = import.meta.env.VITE_ANALYTICS_URL || "http://localhost:8082";

/**
 * Registering an employee's face, from their profile.
 *
 * <p>HR does this rather than the employee, for two reasons that matter: somebody
 * has to be able to confirm it is the right person in front of the camera, and
 * nobody can punch at all until it is done — so it belongs where the rest of
 * setting up an employee happens.
 */
function EmployeeFaceSection({
  userId, name, facePhotoPath, faceRegisteredAt, faceRegisteredByName, onChanged
}: {
  userId: number;
  name: string;
  facePhotoPath?: string | null;
  faceRegisteredAt?: string | null;
  faceRegisteredByName?: string | null;
  onChanged?: () => void;
}) {
  const [trainOpen, setTrainOpen] = useState(false);
  const photoUrl = resolvePhotoUrl(facePhotoPath ?? undefined);

  const status = useQuery({
    queryKey: ["face-status", userId],
    retry: false,
    queryFn: async (): Promise<{ enrolled: boolean; photos: number; available: boolean; maxPhotos?: number }> => {
      const res = await fetch(`${ANALYTICS_BASE}/api/face/status/${userId}`);
      if (!res.ok) throw new Error("unavailable");
      return res.json();
    }
  });

  const secure = typeof window !== "undefined" && window.isSecureContext;
  const unavailable = status.isError || status.data?.available === false;
  const enrolled = !!status.data?.enrolled;

  return (
    <div className="mt-4 rounded-lg border bg-muted/30 p-3">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <ScanFace className="h-3.5 w-3.5" /> Face registration
      </div>

      {unavailable ? (
        <p className="text-xs text-muted-foreground">
          The face service is not reachable, so registration cannot be checked from here.
        </p>
      ) : status.isLoading ? (
        <Skeleton className="h-9" />
      ) : (
        <>
          <div className="flex flex-wrap items-start gap-3">
            {/* The face itself. The point of HR registering it is being able to
                look afterwards and confirm it was the right person. */}
            <div className={cn(
              "flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border",
              enrolled ? "border-emerald-500/40" : "border-dashed"
            )}>
              {photoUrl ? (
                <img src={photoUrl} alt={`${name}'s registered face`} className="h-full w-full object-cover" />
              ) : (
                <ScanFace className="h-7 w-7 text-muted-foreground/50" />
              )}
            </div>

            <div className="min-w-0 flex-1">
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold",
                  enrolled
                    ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                    : "bg-amber-500/10 text-amber-700 dark:text-amber-400"
                )}
              >
                {enrolled ? <ShieldCheck className="h-3.5 w-3.5" /> : <ShieldAlert className="h-3.5 w-3.5" />}
                {enrolled
                  ? `Registered — ${status.data?.photos} of ${status.data?.maxPhotos ?? 5} photos`
                  : "Not registered — cannot punch attendance"}
              </span>

              {enrolled && faceRegisteredAt && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {dayjs(faceRegisteredAt).format("DD MMM YYYY, h:mm A")}
                  {faceRegisteredByName && ` · by ${faceRegisteredByName}`}
                </p>
              )}
              {enrolled && !photoUrl && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Registered before the portal kept a photo — re-register to have one to look at.
                </p>
              )}

              <Button
                size="sm"
                variant={enrolled ? "outline" : "default"}
                className="mt-2"
                disabled={!secure}
                onClick={() => setTrainOpen(true)}
              >
                <Camera className="mr-1.5 h-4 w-4" />
                {enrolled ? "Re-register face" : "Register face"}
              </Button>
            </div>
          </div>

          {!secure && (
            <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-400">
              The camera needs a secure (https) connection. This works on localhost.
            </p>
          )}

          <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
            {enrolled
              ? `${name} can punch in and out with their face. Re-register if it stops recognising them.`
              : `${name} cannot punch until their face is registered. Sit them in front of the camera and take four photos.`}
          </p>
        </>
      )}

      <FaceTrainDialog
        open={trainOpen}
        onOpenChange={setTrainOpen}
        userId={userId}
        onComplete={() => { status.refetch(); onChanged?.(); }}
      />
    </div>
  );
}

interface EmployeeImportRow {
  id: number;
  fileName: string;
  importedAt: string;
  importedBy?: string | null;
  totalRows: number;
  createdCount: number;
  failedCount: number;
  /** Accounts from this import that still exist. */
  remaining: number;
  revertedAt?: string | null;
}

interface ImportPreviewPerson {
  userId: number;
  name: string;
  employeeCode?: string;
  username?: string;
  reason?: string;
}

/**
 * Sheets uploaded before, and a way to take one back out.
 *
 * <p>An import used to be a one-way door — a wrong sheet left accounts scattered
 * through the directory with nothing marking where they came from. Each import is
 * now listed, and removing one takes only the accounts that import created.
 */
function PastImports() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState<EmployeeImportRow | null>(null);

  const imports = useQuery({
    queryKey: ["employee-imports"],
    queryFn: async () =>
      (await api.get<ApiEnvelope<EmployeeImportRow[]>>("/auth/employees/imports")).data.data,
    enabled: open
  });

  const rows = imports.data ?? [];

  /**
   * Takes the sheet itself off the list.
   *
   * <p>Separate from removing the accounts, and only offered once none are left:
   * the row is then a record of something that no longer exists, and it used to
   * sit here for good with no way to clear it. The server refuses this while any
   * account from the sheet is still in the directory, so this cannot become a way
   * to lose track of accounts that are still there.
   */
  const forget = useMutation({
    mutationFn: async (id: number) =>
      (await api.delete<ApiEnvelope<void>>(`/auth/employees/imports/${id}/record`)).data,
    onSuccess: () => {
      toast.success("Sheet removed from the list");
      qc.invalidateQueries({ queryKey: ["employee-imports"] });
    },
    onError: (err) => toast.error(apiMessage(err, "Could not remove the sheet from the list"))
  });

  /**
   * Matches a sheet against employees already in the directory.
   *
   * <p>For the case the list could not otherwise help with at all: a directory
   * filled from a sheet before imports were recorded, so nothing says which sheet
   * anybody came from and there is no batch to offer a Remove button for. Uploading
   * the sheet again claims those accounts for it, after which the ordinary Remove
   * button appears and does the removing — with its preview, its typed
   * confirmation, and its refusal to touch anybody who has started using the portal.
   *
   * <p>This step itself deletes nothing. It reads the sheet in the browser, exactly
   * as an import does, and sends only the Emp Ids.
   */
  const matchRef = useRef<HTMLInputElement>(null);
  const [matching, setMatching] = useState(false);

  async function onMatchSheet(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setMatching(true);
    try {
      const { payloads } = await parseEmployeeWorkbook(file);
      // The Emp Id is what identifies a person across the sheet and the portal.
      const ids = payloads
        .map((p) => p.employeeCode || p.username)
        .filter((s): s is string => !!s && !!s.trim());
      if (ids.length === 0) {
        toast.error("No Emp Id values found. The sheet needs an “Employee List” sheet with an “Emp Id” column.");
        return;
      }
      const res = await api.post<ApiEnvelope<{
        linkedCount: number; notFoundCount: number; alreadyLinkedCount: number;
      }>>(
        `/auth/employees/imports/adopt?fileName=${encodeURIComponent(file.name)}`,
        ids
      );
      const d = res.data.data;
      toast.success(
        `${d.linkedCount} employee(s) matched to ${file.name}` +
        (d.notFoundCount ? ` · ${d.notFoundCount} Emp Id(s) matched nobody` : "") +
        (d.alreadyLinkedCount ? ` · ${d.alreadyLinkedCount} already on another sheet` : "")
      );
      qc.invalidateQueries({ queryKey: ["employee-imports"] });
    } catch (err) {
      toast.error(apiMessage(err, "Could not match that sheet"));
    } finally {
      setMatching(false);
    }
  }

  return (
    <div className="rounded-lg border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left"
      >
        <span className="flex items-center gap-2 text-sm font-semibold">
          <HistoryIcon className="h-4 w-4 text-primary" />
          Previous imports
        </span>
        <span className="text-xs font-medium text-primary">{open ? "Hide" : "Show"}</span>
      </button>

      {open && (
        <div className="border-t px-3 py-2.5">
          {imports.isLoading ? (
            <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
              <PixousLoader size="xs" /> Loading…
            </div>
          ) : rows.length === 0 ? (
            /* This said "nothing has been imported yet", which on a database whose
               directory was filled from a sheet reads as a bug. Nothing is listed
               because the list itself is newer than that import: no sheet was on
               record before it existed, so there is no batch to offer a Remove
               button for. Saying so is better than implying the button is missing. */
            <div className="space-y-2 py-2 text-xs text-muted-foreground">
              <p>
                No sheet on record. Upload one and it appears here with a{" "}
                <strong className="text-destructive">Remove this import</strong> button that
                takes the accounts it created back out again.
              </p>
              <p>
                Employees already in the directory are not listed, and cannot be removed as a
                batch: they were added before this list existed, so nothing recorded which
                sheet each one came from. Remove those one at a time from the employee's own
                page, or all at once from <strong>Fresh Start</strong>.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {rows.map((r) => (
                <div key={r.id} className="rounded-md border bg-muted/20 p-2.5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-xs font-semibold">{r.fileName}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {dayjs(r.importedAt).format("DD MMM YYYY, h:mm A")}
                        {r.importedBy && ` · by ${r.importedBy}`}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px]">
                        <span className="text-emerald-700 dark:text-emerald-400">
                          {r.createdCount} created
                        </span>
                        {r.failedCount > 0 && (
                          <span className="text-destructive">{r.failedCount} failed</span>
                        )}
                        <span className="font-semibold">
                          {r.remaining} still in the directory
                        </span>
                      </div>
                    </div>

                    {r.remaining > 0 ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 shrink-0 border-destructive/40 px-2 text-[11px] text-destructive hover:bg-destructive/10"
                        onClick={() => setConfirming(r)}
                      >
                        <Trash2 className="mr-1 h-3 w-3" />
                        Remove this import
                      </Button>
                    ) : (
                      /* Nothing of this sheet is left in the directory, so the only
                         thing still removable is the row itself. No confirmation:
                         there is nothing behind it to lose, and the accounts it
                         once created are already gone. */
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                          {r.revertedAt ? "Accounts removed" : "Nothing left"}
                        </span>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-[11px] text-muted-foreground hover:text-destructive"
                          title="Take this sheet off the list. The accounts are already gone."
                          disabled={forget.isPending}
                          onClick={() => forget.mutate(r.id)}
                        >
                          {forget.isPending && forget.variables === r.id ? (
                            <PixousLoader size="xs" className="mr-1" />
                          ) : (
                            <X className="mr-1 h-3 w-3" />
                          )}
                          Remove sheet
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          <p className="mt-2.5 rounded-md bg-muted/40 p-2 text-[11px] leading-relaxed text-muted-foreground">
            Removing an import deletes only the accounts <strong>that import created</strong>.
            Anybody added by hand is never touched, and anybody who has since started using the
            portal — a punch, a leave request, a payslip — is kept and listed for you.
          </p>

          {/* The way out for a directory this list cannot otherwise account for.
              Upload the sheet those employees came from and it is matched to them,
              which makes the Remove button above apply to them as well. */}
          <div className="mt-2.5 rounded-md border border-dashed p-2.5">
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Employees already here, from a sheet that was never recorded? Upload that sheet
              and it is matched to them — then <strong>Remove this import</strong> above takes
              them out. Matching by itself deletes nothing.
            </p>
            <input
              ref={matchRef}
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              onChange={onMatchSheet}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-2 h-8 px-2.5 text-[11px]"
              disabled={matching}
              onClick={() => matchRef.current?.click()}
            >
              {matching ? (
                <PixousLoader size="xs" className="mr-1.5" />
              ) : (
                <FileSpreadsheet className="mr-1.5 h-3.5 w-3.5" />
              )}
              {matching ? "Reading the sheet…" : "Match a sheet to these employees"}
            </Button>
          </div>
        </div>
      )}

      {confirming && (
        <RevertImportDialog
          batch={confirming}
          onClose={() => setConfirming(null)}
          onDone={() => {
            setConfirming(null);
            qc.invalidateQueries({ queryKey: ["employee-imports"] });
            qc.invalidateQueries({ queryKey: ["employees"] });
          }}
        />
      )}
    </div>
  );
}

/** Names first, then the decision. */
function RevertImportDialog({
  batch, onClose, onDone
}: {
  batch: EmployeeImportRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const [typed, setTyped] = useState("");

  const preview = useQuery({
    queryKey: ["employee-import-preview", batch.id],
    queryFn: async () =>
      (await api.get<ApiEnvelope<{
        fileName: string;
        removable: ImportPreviewPerson[];
        keeping: ImportPreviewPerson[];
      }>>(`/auth/employees/imports/${batch.id}/preview`)).data.data
  });

  const revert = useMutation({
    mutationFn: async () =>
      (await api.delete<ApiEnvelope<{ removedCount: number; keptCount: number }>>(
        `/auth/employees/imports/${batch.id}`)).data,
    onSuccess: (res) => {
      const removed = res.data?.removedCount ?? 0;
      const kept = res.data?.keptCount ?? 0;
      toast.success(
        kept > 0
          ? `${removed} removed · ${kept} kept (already in use)`
          : `${removed} account(s) removed`
      );
      onDone();
    },
    onError: (err) => toast.error(apiMessage(err, "Could not remove the import"))
  });

  const removable = preview.data?.removable ?? [];
  const keeping = preview.data?.keeping ?? [];

  return (
    <Dialog open onClose={onClose} className="max-w-md">
      <DialogHeader
        title="Remove this import?"
        description={batch.fileName}
      />

      {preview.isLoading ? (
        <div className="flex h-24 items-center justify-center">
          <PixousLoader size="sm" />
        </div>
      ) : (
        <div className="space-y-3">
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3">
            <div className="text-xs font-semibold text-destructive">
              {removable.length} account{removable.length === 1 ? "" : "s"} will be deleted
            </div>
            {removable.length === 0 ? (
              <p className="mt-1 text-[11px] text-muted-foreground">
                None of this import's accounts can be removed — every one of them is already
                in use. Nothing will happen.
              </p>
            ) : (
              <div className="mt-1.5 max-h-32 space-y-0.5 overflow-y-auto text-[11px]">
                {removable.map((p) => (
                  <div key={p.userId} className="flex items-baseline justify-between gap-2">
                    <span className="truncate">{p.name}</span>
                    <span className="shrink-0 text-muted-foreground">{p.employeeCode}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {keeping.length > 0 && (
            <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 dark:border-emerald-800 dark:bg-emerald-950/20">
              <div className="text-xs font-semibold text-emerald-800 dark:text-emerald-300">
                {keeping.length} will be kept — already in use
              </div>
              <div className="mt-1.5 max-h-28 space-y-0.5 overflow-y-auto text-[11px]">
                {keeping.map((p) => (
                  <div key={p.userId} className="flex items-baseline justify-between gap-2">
                    <span className="truncate">{p.name}</span>
                    <span className="shrink-0 text-muted-foreground">{p.reason}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="revert-confirm" className="text-xs">
              Type <span className="font-mono font-bold">REMOVE</span> to confirm
            </Label>
            <Input
              id="revert-confirm"
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder="REMOVE"
            />
            <p className="text-[11px] text-muted-foreground">
              This cannot be undone. The accounts and everything attached to them go.
            </p>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={typed.trim() !== "REMOVE" || removable.length === 0 || revert.isPending}
              onClick={() => revert.mutate()}
            >
              {revert.isPending
                ? <PixousLoader size="xs" className="mr-2" />
                : <Trash2 className="mr-2 h-4 w-4" />}
              Remove {removable.length}
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

function ImportEmployeesDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [parsing, setParsing] = useState(false);
  const [payloads, setPayloads] = useState<EmployeeImportPayload[]>([]);
  const [creds, setCreds] = useState<ImportCred[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<{ created: number; failed: number; fails: { name: string; error: string }[] } | null>(null);
  // Which of the four sheets the uploaded file turned out to have.
  const [sheets, setSheets] = useState<SheetReport[]>([]);
  const [showFormat, setShowFormat] = useState(false);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null); setResults(null); setPayloads([]); setCreds([]); setSheets([]);
    setFileName(file.name); setParsing(true);
    try {
      const { payloads, creds, sheets } = await parseEmployeeWorkbook(file);
      setSheets(sheets);
      if (payloads.length === 0) {
        const list = sheets.find((s) => s.name === "Employee List");
        setError(!list?.found
          ? "This workbook has no sheet named “Employee List”. Check the format below — the sheet name has to match exactly."
          : "No employees found. The “Employee List” sheet needs an “Emp Id” column and a “Name” column, spelled exactly that way.");
        setShowFormat(true);
      }
      setPayloads(payloads); setCreds(creds);
    } catch (err: any) {
      setError("Could not read the file. Please upload a valid .xlsx workbook.");
      setShowFormat(true);
    } finally {
      setParsing(false);
    }
  }

  function downloadTemplate() {
    const url = URL.createObjectURL(buildImportTemplate());
    const a = document.createElement("a");
    a.href = url;
    a.download = "Pixous_Employee_Import_Template.xlsx";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success("Template downloaded — fill it in and upload it back");
  }

  const importMutation = useMutation({
    mutationFn: async () => {
      // The file name travels with the rows so the import can be listed — and
      // undone — by the sheet it came from rather than by a bare timestamp.
      const res = await api.post<ApiEnvelope<{ username: string; name: string; created: boolean; error: string | null }[]>>(
        `/auth/employees/bulk?fileName=${encodeURIComponent(fileName || "Employee sheet")}`,
        payloads
      );
      return res.data.data;
    },
    onSuccess: (data) => {
      const created = data.filter((d) => d.created).length;
      const fails = data.filter((d) => !d.created).map((d) => ({ name: d.name, error: d.error || "failed" }));
      setResults({ created, failed: fails.length, fails });
      qc.invalidateQueries({ queryKey: ["employees"] });
      qc.invalidateQueries({ queryKey: ["employee-imports"] });
      if (created > 0) toast.success(`${created} employee(s) imported`);
    },
    onError: (err) => setError(apiMessage(err, "Import failed"))
  });

  function downloadCreds() {
    const url = URL.createObjectURL(credsToCsv(creds));
    const a = document.createElement("a");
    a.href = url;
    a.download = "Employee_Login_Credentials.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  const activeCount = payloads.filter((p) => p.profileStatus === "ACTIVE").length;

  return (
    <Dialog open onClose={onClose} className="max-w-lg">
      <DialogHeader
        title="Import employees from Excel"
        description="Upload the company employee sheet (.xlsx). Each employee gets a login (username = Emp ID, password = Firstname@123)."
      />

      {error && (
        <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={onPick} />

      {!results ? (
        <div className="space-y-4">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border py-8 text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
          >
            {parsing ? <PixousLoader size="md" /> : <UploadCloud className="h-7 w-7" />}
            <span className="text-sm font-medium">{fileName || "Click to choose an .xlsx file"}</span>
          </button>

          {/* What the file turned out to hold — shown as soon as one is picked. */}
          {sheets.length > 0 && (
            <div className="rounded-lg border p-3">
              <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Sheets read from this file
              </div>
              <div className="space-y-1 text-xs">
                {sheets.map((s) => (
                  <div key={s.name} className="flex items-center justify-between gap-2">
                    <span className={`flex items-center gap-1.5 font-medium ${
                      s.found ? "text-emerald-600 dark:text-emerald-400"
                        : s.name === "Employee List" ? "text-destructive" : "text-muted-foreground"}`}>
                      {s.found
                        ? <CheckCircle2 className="h-3.5 w-3.5" />
                        : <AlertCircle className="h-3.5 w-3.5" />}
                      {s.name}
                    </span>
                    <span className="text-muted-foreground">
                      {s.found ? `${s.rows} row${s.rows === 1 ? "" : "s"}` : "not in this file"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Sheets uploaded before, and a way to take one back out. */}
          <PastImports />

          {/* The format itself: the sheet names and column headers the importer
              looks for, letter for letter, plus a blank copy to fill in. */}
          <div className="rounded-lg border">
            <button
              type="button"
              onClick={() => setShowFormat((v) => !v)}
              className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left"
            >
              <span className="flex items-center gap-2 text-sm font-semibold">
                <FileSpreadsheet className="h-4 w-4 text-primary" />
                Required Excel format
              </span>
              <span className="text-xs font-medium text-primary">
                {showFormat ? "Hide" : "Show"}
              </span>
            </button>

            {showFormat && (
              <div className="space-y-3 border-t px-3 py-3">
                <p className="text-xs text-muted-foreground">
                  Sheet names and column headers must match <strong>exactly</strong> — spelling,
                  spaces and capitals. Columns marked <span className="text-destructive">*</span> are
                  needed; the rest fill in whatever they have and are skipped when empty. Any extra
                  column is ignored, not rejected.
                </p>

                {IMPORT_SHEETS.map((s) => (
                  <div key={s.name} className="rounded-md border bg-muted/30 p-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="code-chip text-xs font-bold">{s.name}</span>
                      {s.required
                        ? <Badge variant="destructive" className="text-[10px]">Must be present</Badge>
                        : <Badge variant="secondary" className="text-[10px]">Optional sheet</Badge>}
                    </div>
                    <p className="mt-1 text-[11px] text-muted-foreground">{s.note}</p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {s.columns.map((c) => (
                        <span
                          key={c.header}
                          title={`Example: ${c.example}`}
                          className={`code-chip rounded px-1.5 py-0.5 text-[10px] ${
                            c.required
                              ? "bg-destructive/10 font-bold text-destructive ring-1 ring-destructive/30"
                              : "bg-background text-muted-foreground ring-1 ring-border"}`}
                        >
                          {c.header}{c.required && <span className="ml-0.5">*</span>}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}

                <div className="rounded-md border border-primary/30 bg-primary/5 p-2.5 text-xs">
                  <div className="font-semibold">How the rest is worked out</div>
                  <ul className="mt-1 space-y-0.5 text-muted-foreground">
                    <li>· Username = Emp Id in lowercase · Password = Firstname@123</li>
                    <li>· Status “Working” → Active, anything else → Offboarded</li>
                    <li>· Category and Role are read from Designation / Department / Position</li>
                    <li>· Dates take 01-09-2025, 2025-09-01 or an Excel date cell</li>
                    <li>· Phone keeps 10–15 digits, Aadhaar exactly 12; a repeat is left blank</li>
                  </ul>
                </div>

                <Button variant="outline" size="sm" className="w-full" onClick={downloadTemplate}>
                  <Download className="mr-1.5 h-4 w-4" />
                  Download blank template (.xlsx)
                </Button>
              </div>
            )}
          </div>

          {payloads.length > 0 && (
            <div className="rounded-lg border bg-muted/30 p-3 text-sm">
              <div className="flex items-center gap-2 font-medium">
                <CheckCircle2 className="h-4 w-4 text-success" />
                {payloads.length} employees found
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {activeCount} active · {payloads.length - activeCount} offboarded. Duplicate/blank phone &amp; Aadhaar are auto-handled.
              </div>
              <div className="mt-2 max-h-32 overflow-y-auto text-xs">
                {payloads.slice(0, 8).map((p) => (
                  <div key={p.username} className="flex justify-between border-b py-0.5 last:border-0">
                    <span className="truncate">{p.name}</span>
                    <span className="code-chip text-muted-foreground">{p.username}</span>
                  </div>
                ))}
                {payloads.length > 8 && <div className="pt-1 text-muted-foreground">+{payloads.length - 8} more…</div>}
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 border-t pt-4">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button
              onClick={() => importMutation.mutate()}
              disabled={payloads.length === 0 || importMutation.isPending}
            >
              {importMutation.isPending ? <PixousLoader size="xs" className="mr-2" /> : <UploadCloud className="mr-2 h-4 w-4" />}
              Import {payloads.length || ""} employees
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-lg border bg-muted/30 p-4">
            <div className="flex items-center gap-2 text-lg font-bold">
              <CheckCircle2 className="h-5 w-5 text-success" /> {results.created} imported
            </div>
            {results.failed > 0 && (
              <div className="mt-2">
                <div className="flex items-center gap-1.5 text-sm font-medium text-destructive">
                  <AlertCircle className="h-4 w-4" /> {results.failed} skipped (already exists / invalid)
                </div>
                <div className="mt-1 max-h-28 overflow-y-auto text-xs text-muted-foreground">
                  {results.fails.map((f, i) => (
                    <div key={i}>{f.name} — {f.error}</div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Download the credentials list to share usernames &amp; passwords with employees.
          </p>
          <div className="flex justify-end gap-2 border-t pt-4">
            <Button variant="outline" onClick={downloadCreds}>
              <Download className="mr-1.5 h-4 w-4" /> Download credentials
            </Button>
            <Button onClick={onClose}>Done</Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

function genderLabel(g?: string): string | undefined {
  if (!g) return undefined;
  const c = g.trim().toUpperCase()[0];
  return c === "M" ? "Male" : c === "F" ? "Female" : c === "O" ? "Other" : g;
}

function industryLabel(i?: string): string | undefined {
  return i === "IT" ? "DIGITAL" : i === "CIVIL" ? "INFRA" : i;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Declared as Profile so the query that falls back to it stays typed. Without
// this the fallback widened detail.data to `any`, and every field read off it --
// roles, documents -- lost its type along with the callbacks that map over them.
function getMockUserById(id: number): Profile | null {
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith("hrp.company_users_")) {
      const usersStr = localStorage.getItem(key);
      if (usersStr) {
        try {
          const users = JSON.parse(usersStr);
          const found = users.find((u: any) => u.id === id);
          if (found) {
            return {
              ...found,
              employeeCode: (found.role === "COMPANY_ADMIN" || found.role === "SUPER_ADMIN") ? "ADMIN" : `EMP${found.id.toString().substring(0, 4)}`,
              roles: [found.role || found.roles?.[0] || "EMPLOYEE"],
              profileStatus: found.status || "ACTIVE"};
          }
        } catch(e) {}
      }
    }
  }

  const mocks: Record<number, any> = {
    1: { id: 1, employeeCode: "EMP0001", name: "System Admin", email: "admin@pixous.com", roles: ["SUPER_ADMIN", "COMPANY_ADMIN"], profileStatus: "ACTIVE" },
    2: { id: 2, employeeCode: "EMP0002", name: "John Doe", email: "john@pixous.com", roles: ["EMPLOYEE"], profileStatus: "ACTIVE" },
    3: { id: 3, employeeCode: "EMP0003", name: "Jane Smith", email: "hr@pixous.com", roles: ["HR_MANAGER", "IT_HR"], profileStatus: "ACTIVE" },
    4: { id: 4, employeeCode: "EMP0004", name: "Mike Johnson", email: "tl@pixous.com", roles: ["IT_TL"], profileStatus: "ACTIVE" }
  };
  return mocks[id] || null;
}

function EmployeeDetail({ id, onClose }: { id: number | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [showOffboard, setShowOffboard] = useState(false);
  /*
    Resetting a login. Two prompts in a row gave no way back from the second
    one and hid the password as it was typed into a browser box -- and there
    was nothing on screen to say whose account was being changed.
  */
  const [resetLoginFor, setResetLoginFor] = useState<any | null>(null);
  const [resetUsername, setResetUsername] = useState("");
  const [resetPassword, setResetPassword] = useState("");
  const [savingLogin, setSavingLogin] = useState(false);
  const [relievingDate, setRelievingDate] = useState("");
  const [reason, setReason] = useState("");
  const [downloading, setDownloading] = useState(false);
  // null = hidden, "" = nothing recorded for this account, otherwise the password.
  const [shownPassword, setShownPassword] = useState<string | null>(null);
  const [loadingPassword, setLoadingPassword] = useState(false);
  // Removing a record for good asks for the employee code to be typed out.
  const [showDelete, setShowDelete] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");

  /** Fetches the password only when asked for it. */
  async function revealPassword() {
    if (id == null) return;
    setLoadingPassword(true);
    try {
      const res = await api.get<ApiEnvelope<{ password: string | null }>>(`/users/${id}/password`);
      setShownPassword(res.data.data?.password ?? "");
    } catch (err) {
      toast.error(apiMessage(err, "Could not read the password"));
    } finally {
      setLoadingPassword(false);
    }
  }

  const detail = useQuery({
    queryKey: ["employee", id],
    enabled: id != null,
    queryFn: async () => {
      try {
        return (await api.get<ApiEnvelope<Profile>>(`/users/${id}`)).data.data;
      } catch (err) {
        const mockUser = getMockUserById(id as number);
        if (mockUser) return mockUser;
        throw err;
      }
    }
  });

  // Salary account, so the payroll detail can be checked without leaving here.
  // Read-only, and quiet if the caller is not allowed to see it.
  const banks = useQuery({
    queryKey: ["employee-bank", id],
    enabled: id != null,
    retry: false,
    queryFn: async () =>
      (await api.get<ApiEnvelope<BankResponse[]>>(`/users/${id}/bank`)).data.data
  });

  const orgLookups = useQuery({
    queryKey: ["org-dropdowns", "employee-detail"],
    enabled: id != null,
    queryFn: async () => {
      const res = await api.post<ApiEnvelope<Record<string, DropdownItem[]>>>(
        "/org/dropdowns",
        ["department", "designation", "office_location"]
      );
      return res.data.data;
    }
  });

  const labelFor = (items: DropdownItem[] | undefined, key?: number) =>
    key == null ? undefined : items?.find((i) => i.id === key)?.label;

  const offboardMutation = useMutation({
    mutationFn: async (data: { relievingDate: string; reason: string }) => {
      await api.post(`/users/${id}/offboarding`, data);
    },
    onSuccess: () => {
      toast.success("Employee offboarded successfully");
      queryClient.invalidateQueries({ queryKey: ["employee", id] });
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      setShowOffboard(false);
      setRelievingDate("");
      setReason("");
    },
    onError: (err) => toast.error(apiMessage(err, "Could not offboard employee"))
  });

  /** Removes the record and everything filed against it. Not reversible. */
  const deleteMutation = useMutation({
    mutationFn: async () => { await api.delete(`/users/${id}`); },
    onSuccess: () => {
      toast.success("Employee deleted permanently");
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      queryClient.removeQueries({ queryKey: ["employee", id] });
      setShowDelete(false);
      setDeleteConfirm("");
      onClose();
    },
    onError: (err) => toast.error(apiMessage(err, "Could not delete employee"))
  });

  const p = detail.data;

  const deptName = labelFor(orgLookups.data?.department, p?.departmentId);
  const desigName = labelFor(orgLookups.data?.designation, p?.designationId);
  const officeName = labelFor(orgLookups.data?.office_location, p?.officeLocationId);
  const addressStr = p?.address
    ? [p.address.house, p.address.street, p.address.locality, p.address.district, p.address.state, p.address.pincode]
        .filter(Boolean)
        .join(", ")
    : "";

  async function downloadProfile() {
    if (!p) return;
    setDownloading(true);
    try {
      // Embed the photo as base64 so the document is self-contained.
      let photoHtml = "";
      if (p.photoPath) {
        try {
          const url = resolvePhotoUrl(p.photoPath);
          const blob = await (await fetch(url!)).blob();
          const dataUrl: string = await new Promise((res, rej) => {
            const fr = new FileReader();
            fr.onloadend = () => res(fr.result as string);
            fr.onerror = rej;
            fr.readAsDataURL(blob);
          });
          photoHtml = `<img src="${dataUrl}" width="132" height="132" style="object-fit:cover;border-radius:10px;" />`;
        } catch {
          /* no photo — skip */
        }
      }

      const rows: [string, string | undefined][] = [
        ["Employee Code", p.employeeCode],
        ["Full Name", p.name],
        ["Email", p.email],
        ["Personal Email", p.personalEmail],
        ["Phone", p.phone],
        ["Alternate Phone", p.alternatePhone],
        ["Aadhaar Number", p.aadhar],
        ["PAN", p.pan],
        ["PF Number", p.pfNumber],
        ["Gender", genderLabel(p.gender)],
        ["Date of Birth", p.dob ? dayjs(p.dob).format("DD MMM YYYY") : undefined],
        ["Blood Group", p.bloodGroup],
        ["Industry", industryLabel(p.industry)],
        ["Designation", p.designationTitle || desigName],
        ["Department", p.departmentTitle || deptName],
        ["Position", p.positionTitle],
        ["Office Location", officeName],
        ["Employment Type", p.employmentType],
        ["Date of Joining", p.dateOfJoining ? dayjs(p.dateOfJoining).format("DD MMM YYYY") : undefined],
        ["Emergency Contact", p.emergencyContact ? `${p.emergencyContact}${p.emergencyContactRelation ? ` (${p.emergencyContactRelation})` : ""}` : undefined],
        ["Status", p.profileStatus],
        ["Roles", roleLabels(p.roles).join(", ")],
        ["Address", addressStr]
      ];

      const tableRows = rows
        .map(
          ([k, v]) =>
            `<tr><td style="padding:6px 12px;border:1px solid #d9d9d9;background:#f5f6fa;font-weight:bold;width:34%;">${escapeHtml(
              k
            )}</td><td style="padding:6px 12px;border:1px solid #d9d9d9;">${escapeHtml(v || "—")}</td></tr>`
        )
        .join("");

      const html = `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
<head><meta charset='utf-8'><title>${escapeHtml(p.name)} - Profile</title></head>
<body style="font-family:Calibri,Arial,sans-serif;color:#1f2937;">
  <div style="text-align:center;margin-bottom:6px;">${photoHtml}</div>
  <h1 style="text-align:center;margin:6px 0 0;font-size:22px;">${escapeHtml(p.name)}</h1>
  <p style="text-align:center;color:#6b7280;margin:2px 0 18px;">${escapeHtml(p.employeeCode)} &middot; Pixous Technologies</p>
  <table style="border-collapse:collapse;width:100%;font-size:13px;">${tableRows}</table>
  <p style="margin-top:22px;color:#9ca3af;font-size:11px;">Generated on ${dayjs().format("DD MMM YYYY, h:mm A")}</p>
</body></html>`;

      const blob = new Blob(["﻿", html], { type: "application/msword" });
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = `${p.employeeCode}_${p.name.replace(/\s+/g, "_")}_Profile.doc`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(href);
      toast.success("Profile downloaded");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <>
    <Dialog className="max-w-2xl" open={id != null} onClose={() => { onClose(); setShowOffboard(false); }}>
      {detail.isLoading || !p ? (
        <Skeleton className="h-48" />
      ) : (
        <>
          <div className="mb-5 flex flex-col items-center gap-3 text-center sm:flex-row sm:items-center sm:gap-5 sm:text-left">
            <Avatar name={p.name} src={p.photoPath} className="h-28 w-28 text-4xl ring-2 ring-primary/20" />
            <div>
              <h2 className="font-display text-2xl font-bold">{p.name}</h2>
              <div className="code-chip text-sm text-muted-foreground">{p.employeeCode}</div>
              <div className="mt-2 flex flex-wrap items-center justify-center gap-1.5 sm:justify-start">
                <Badge
                  variant={p.profileStatus === "OFFBOARDED" ? "destructive" : "success"}
                >
                  {p.profileStatus || "ACTIVE"}
                </Badge>
                {roleLabels(p.roles).map((label) => (
                  <Badge key={label} className="code-chip">
                    {label}
                  </Badge>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
            <Field label="Email" value={p.email} />
            <Field label="Phone" value={p.phone} />
            <Field label="Aadhaar Number" value={p.aadhar} mono />
            <Field label="PAN" value={p.pan} mono />
            <Field label="PF Number" value={p.pfNumber} mono />
            <Field label="Gender" value={genderLabel(p.gender)} />
            <Field label="Date of Birth" value={p.dob ? dayjs(p.dob).format("DD MMM YYYY") : undefined} />
            <Field label="Blood Group" value={p.bloodGroup} />
            <Field label="Industry" value={industryLabel(p.industry)} />
            <Field label="Designation" value={p.designationTitle || desigName} />
            <Field label="Department" value={p.departmentTitle || deptName} />
            <Field label="Position" value={p.positionTitle} />
            <Field label="Office Location" value={officeName} />
            <Field label="Employment" value={p.employmentType} />
            <Field
              label="Joined"
              value={p.dateOfJoining ? dayjs(p.dateOfJoining).format("DD MMM YYYY") : undefined}
            />
            <Field label="Alternate Phone" value={p.alternatePhone} />
            <Field label="Personal Email" value={p.personalEmail} />
            <Field
              label="Emergency Contact"
              value={p.emergencyContact ? `${p.emergencyContact}${p.emergencyContactRelation ? ` (${p.emergencyContactRelation})` : ""}` : undefined}
            />
          </div>

          {/* This employee's login. Show fetches the password on its own call, so
              it never travels with an ordinary profile read. */}
          <div className="mt-4 rounded-lg border bg-muted/30 p-3">
            <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <KeyRound className="h-3.5 w-3.5" /> Login credentials
            </div>
            <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <div>
                <div className="text-xs text-muted-foreground">Username</div>
                <div className="mt-0.5 flex items-center gap-2">
                  <span className="code-chip font-semibold">{p.username || "— not set —"}</span>
                  {p.username && (
                    <button
                      type="button"
                      className="text-xs font-medium text-primary hover:underline"
                      onClick={() => {
                        navigator.clipboard?.writeText(p.username!);
                        toast.success("Username copied");
                      }}
                    >
                      Copy
                    </button>
                  )}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Password</div>
                <div className="mt-0.5 flex items-center gap-2">
                  {shownPassword === null ? (
                    <>
                      <span className="code-chip font-semibold tracking-widest">••••••••</span>
                      <button
                        type="button"
                        disabled={loadingPassword}
                        className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline disabled:opacity-60"
                        onClick={revealPassword}
                      >
                        {loadingPassword
                          ? <PixousLoader size="xs" />
                          : <Eye className="h-3 w-3" />}
                        Show
                      </button>
                    </>
                  ) : shownPassword === "" ? (
                    <span className="text-xs text-muted-foreground">— not recorded —</span>
                  ) : (
                    <>
                      <span className="code-chip font-semibold text-foreground">{shownPassword}</span>
                      <button
                        type="button"
                        className="text-xs font-medium text-primary hover:underline"
                        onClick={() => {
                          navigator.clipboard?.writeText(shownPassword);
                          toast.success("Password copied");
                        }}
                      >
                        Copy
                      </button>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:underline"
                        onClick={() => setShownPassword(null)}
                      >
                        <EyeOff className="h-3 w-3" /> Hide
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
            <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
              {shownPassword === ""
                ? <>This account&apos;s password was last set before the portal began keeping a
                    readable copy, and a stored hash cannot be turned back into a password. Use{" "}
                    <strong>Reset Login</strong> below to set one — from then on it shows here.</>
                : <>Visible to HR and the admin only. If the employee changes their own password,
                    this follows it.</>}
            </p>
          </div>

          {/* Face registration. Done from here rather than by the employee, so HR
              can confirm it is the right person in front of the camera — and
              because nobody can punch until it is done. */}
          <EmployeeFaceSection
            userId={p.id}
            name={p.name}
            facePhotoPath={p.facePhotoPath}
            faceRegisteredAt={p.faceRegisteredAt}
            faceRegisteredByName={p.faceRegisteredByName}
            onChanged={() => queryClient.invalidateQueries({ queryKey: ["employee", p.id] })}
          />

          <div className="mt-4">
            <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Address
            </div>
            <p className="text-sm">{addressStr || "—"}</p>
          </div>

          {/* Salary account, so payroll details can be checked from here. */}
          <div className="mt-4">
            <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Bank details
            </div>
            {(banks.data?.length ?? 0) === 0 ? (
              <p className="rounded-lg border border-dashed px-3 py-2.5 text-xs text-muted-foreground">
                No bank account on record. Add one from <strong>Edit</strong> so payroll can be
                credited.
              </p>
            ) : (
              <div className="space-y-2">
                {banks.data!.map((b) => (
                  <div key={b.id} className="rounded-lg border p-2.5 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{b.bankName}</span>
                      {b.primary && <Badge variant="success" className="text-[10px]">Primary</Badge>}
                      {b.branchName && <span className="text-xs text-muted-foreground">{b.branchName}</span>}
                    </div>
                    <div className="mt-1 grid grid-cols-1 gap-x-4 gap-y-0.5 text-xs sm:grid-cols-2">
                      <div><span className="text-muted-foreground">Holder: </span>{b.accountHolderName || "—"}</div>
                      <div><span className="text-muted-foreground">A/c: </span><span className="code-chip">{b.accountNumber}</span></div>
                      <div><span className="text-muted-foreground">IFSC: </span><span className="code-chip">{b.ifscCode}</span></div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Paperwork filed with this employee, opened in a new tab. */}
          {(() => {
            const files = p.documents ? p.documents.split(",").filter(Boolean) : [];
            if (files.length === 0) return null;
            return (
              <div className="mt-4">
                <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Attachments
                </div>
                <ul className="space-y-1.5">
                  {files.map((path) => (
                    <li key={path}>
                      <a
                        href={resolvePhotoUrl(path)}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-2 rounded-md border px-3 py-2 text-xs hover:bg-muted/50"
                      >
                        <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span className="truncate">{path.split("/").pop()}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })()}

          {p.profileStatus !== "OFFBOARDED" ? (
            <div className="mt-6 border-t pt-4">
              {!showOffboard ? (
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={downloadProfile} disabled={downloading}>
                    {downloading ? <PixousLoader size="xs" className="mr-1.5" /> : <Download className="mr-1.5 h-4 w-4" />}
                    Download Profile
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setResetUsername(p.username || "");
                      setResetPassword("");
                      setResetLoginFor(p);
                    }}
                  >
                    Reset Login
                  </Button>
                  <Button variant="destructive" onClick={() => setShowOffboard(true)}>
                    Offboard Employee
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  <h3 className="text-sm font-medium text-destructive">Offboard Employee</h3>
                  <div className="grid gap-2 text-sm">
                    <div>
                      <label className="mb-1 block text-xs text-muted-foreground">Relieving Date</label>
                      <Input type="date" min={DATE_MIN} max={DATE_MAX} value={relievingDate} onChange={e => setRelievingDate(e.target.value)} />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-muted-foreground">Reason</label>
                      <Input value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Resigned, Terminated" />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="destructive"
                      onClick={() => offboardMutation.mutate({ relievingDate, reason })}
                      disabled={!relievingDate || offboardMutation.isPending}
                    >
                      {offboardMutation.isPending ? "Processing..." : "Confirm Offboarding"}
                    </Button>
                    <Button variant="ghost" onClick={() => setShowOffboard(false)}>Cancel</Button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="mt-6 border-t pt-4 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Badge variant="destructive">OFFBOARDED</Badge>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={downloadProfile} disabled={downloading}>
                    {downloading ? <PixousLoader size="xs" className="mr-1.5" /> : <Download className="mr-1.5 h-4 w-4" />}
                    Download Profile
                  </Button>
                  {!showDelete && (
                    <Button variant="destructive" size="sm" onClick={() => setShowDelete(true)}>
                      <Trash2 className="mr-1.5 h-4 w-4" />
                      Delete Permanently
                    </Button>
                  )}
                </div>
              </div>

              {/* Nothing comes back from this, so the employee code has to be
                  typed out before the button will do anything. */}
              {showDelete && (
                <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3">
                  <h3 className="flex items-center gap-1.5 text-sm font-semibold text-destructive">
                    <AlertCircle className="h-4 w-4" /> Delete this employee permanently
                  </h3>
                  <p className="mt-1.5 text-xs leading-snug text-muted-foreground">
                    This removes <strong>{p.name}</strong> and everything filed against them —
                    attendance, leave, claims, tasks, work reports, payslips, tickets, documents,
                    bank details and their login. It cannot be undone, and the record will not
                    appear under Offboarded any more. Their name will also disappear from records
                    that referred to them.
                  </p>
                  <label className="mt-3 block text-xs font-medium">
                    Type <span className="code-chip">{p.employeeCode}</span> to confirm
                  </label>
                  <Input
                    className="mt-1"
                    value={deleteConfirm}
                    onChange={(e) => setDeleteConfirm(e.target.value)}
                    placeholder={p.employeeCode}
                  />
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      variant="destructive"
                      disabled={
                        deleteConfirm.trim().toUpperCase() !== (p.employeeCode || "").toUpperCase()
                        || deleteMutation.isPending
                      }
                      onClick={() => deleteMutation.mutate()}
                    >
                      {deleteMutation.isPending
                        ? <PixousLoader size="xs" className="mr-1.5" />
                        : <Trash2 className="mr-1.5 h-4 w-4" />}
                      Delete permanently
                    </Button>
                    <Button variant="ghost" onClick={() => { setShowDelete(false); setDeleteConfirm(""); }}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </Dialog>

    {/* Resetting a login: whose account, both fields at once, and a way back
        from either of them. */}
    {resetLoginFor && (
      <Dialog open onClose={() => setResetLoginFor(null)} className="max-w-md">
        <DialogHeader
          title="Reset login"
          description={`${resetLoginFor.name} · ${resetLoginFor.employeeCode ?? ""}`}
        />
        <div className="mt-3 space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="rl-user">Username</Label>
            <Input
              id="rl-user"
              autoFocus
              autoComplete="off"
              value={resetUsername}
              onChange={(e) => setResetUsername(e.target.value)}
              placeholder="Login username"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rl-pass">
              New password <span className="font-normal text-muted-foreground">(leave blank to keep the current one)</span>
            </Label>
            <Input
              id="rl-pass"
              type="password"
              autoComplete="new-password"
              value={resetPassword}
              onChange={(e) => setResetPassword(e.target.value)}
              placeholder="Leave blank to keep current"
            />
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2 border-t pt-4">
          <Button variant="outline" onClick={() => setResetLoginFor(null)} disabled={savingLogin}>
            Cancel
          </Button>
          <Button
            disabled={savingLogin || (!resetUsername.trim() && !resetPassword.trim())}
            onClick={async () => {
              setSavingLogin(true);
              try {
                await api.post(`/users/${resetLoginFor.id}/credentials`, {
                  username: resetUsername.trim() || undefined,
                  password: resetPassword.trim() || undefined,
                });
                toast.success("Login updated");
                setResetLoginFor(null);
              } catch (err) {
                toast.error(apiMessage(err, "Could not update login"));
              } finally {
                setSavingLogin(false);
              }
            }}
          >
            {savingLogin && <PixousLoader size="xs" className="mr-1.5" />}
            Save login
          </Button>
        </div>
      </Dialog>
    )}
    </>
  );
}

function Field({ label, value, mono }: { label: string; value?: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={mono ? "font-medium code-chip" : "font-medium"}>{value || "—"}</div>
    </div>
  );
}

/** Red asterisk shown on every field that must be filled. */
function Req() {
  return <span className="ml-0.5 text-destructive">*</span>;
}

/**
 * The roles offered when creating someone: a team member, or the team leader.
 * Anything else -- HR, finance, asset manager -- is granted afterwards through
 * Edit, so the joining form stays about the two everyday cases.
 */
const NEW_EMPLOYEE_ROLES = {
  IT: [
    { code: "COMPANY_ADMIN", label: "Company Admin" },
    { code: "IT_MGR", label: "HR Manager" },
    { code: "IT_EMP", label: "Employee" },
    { code: "IT_TL", label: "Team Leader" }
  ],
  CIVIL: [
    { code: "COMPANY_ADMIN", label: "Company Admin" },
    { code: "CV_HR", label: "HR Manager" },
    { code: "CV_EMP", label: "Employee" },
    { code: "CV_SUP", label: "Team Leader" }
  ]
} as const;

const ROLE_OPTIONS = [
  { code: "SUPER_ADMIN", label: "Super Admin" },
  { code: "COMPANY_ADMIN", label: "Company Admin" },
  { code: "IT_EMP", label: "IT Employee" },
  { code: "IT_TL", label: "Team Leader" },
  { code: "IT_MGR", label: "HR" },
  { code: "IT_HR", label: "IT HR / Payroll" },
  { code: "IT_FIN", label: "Finance Officer" },
  { code: "IT_AST", label: "IT Asset Manager" },
  { code: "CV_EMP", label: "Civil Site Employee" },
  { code: "CV_SUP", label: "Civil Supervisor" },
  { code: "CV_HR", label: "Civil HR Manager" },
  { code: "CV_ADM", label: "Civil / Facilities Admin" },
  { code: "CV_AST", label: "Civil Asset Manager" }
];

/**
 * What each field on the joining form will accept, and what to say when it
 * does not. Two halves to each rule: `keep` filters keystrokes as they are
 * typed, so a wrong character never lands; `check` runs on the finished value
 * and produces the message shown under the box.
 */
/**
 * A usable email address.
 *
 * The domain ending is two letters **or more**. It previously required exactly
 * two, which rejected every ordinary address: .com, .info and .org all have
 * three or four, so "name@gmail.com" was refused by a rule whose own error
 * message offered "name@gmail.com" as the example to follow. Only two-letter
 * endings such as .in or .co were accepted, which is why the form appeared to
 * reject whatever was typed.
 *
 * Deliberately permissive about the rest. Addresses legitimately contain plus
 * signs, dots and subdomains, and a stricter expression rejects real addresses
 * far more often than it catches typing mistakes. The server validates it
 * again, and a wrong-but-well-formed address can only be caught by sending mail
 * to it.
 */
/** The eight groups that exist. Nothing else is a blood group. */
const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];

const FIELD_RULES: Record<string, {
  keep?: (raw: string) => string;
  check: (value: string) => string;
}> = {
  // A person's name is letters. Initials and hyphenated names are ordinary, so
  // a dot, an apostrophe and a hyphen are allowed through; digits are not.
  name: {
    keep: (v) => v.replace(/[^A-Za-z .'-]/g, ""),
    check: (v) => !v.trim() ? "Full name is required"
      : /\d/.test(v) ? "A name cannot contain numbers"
        : /^[A-Za-z .'-]+$/.test(v.trim()) ? "" : "Letters only"
  },
  email: {
    check: (v) => !v.trim() ? "Email is required"
      : EMAIL_PATTERN.test(v.trim()) ? ""
        : "Enter a full email address, like name@gmail.com"
  },
  // Optional — but if one is given it has to be a real address.
  personalEmail: {
    check: (v) => !v.trim() ? ""
      : EMAIL_PATTERN.test(v.trim()) ? ""
        : "Enter a full email address, like name@gmail.com"
  },
  // A mobile number is ten digits and nothing else.
  phone: {
    keep: (v) => v.replace(/\D/g, "").slice(0, 10),
    check: (v) => !v ? "Phone is required"
      : /^\d{10}$/.test(v) ? "" : "Phone must be exactly 10 digits"
  },
  /*
    Optional, unlike the main phone. A second number is genuinely useful and
    often genuinely not known on the day somebody is onboarded, and demanding
    one only taught people to type the first number again to get past the
    form. Blank is accepted; anything entered still has to be a real number.
  */
  alternatePhone: {
    keep: (v) => v.replace(/\D/g, "").slice(0, 10),
    check: (v) => !v ? ""
      : /^\d{10}$/.test(v) ? "" : "Alternate phone must be exactly 10 digits"
  },
  // Aadhaar is twelve digits.
  aadhar: {
    keep: (v) => v.replace(/\D/g, "").slice(0, 12),
    check: (v) => !v ? "Aadhaar is required"
      : /^\d{12}$/.test(v) ? "" : "Aadhaar must be exactly 12 digits"
  },
  /*
    Chosen from the eight that exist rather than typed. Free text produced
    "o+", "O positive", "B Positive" and "b+" for the same four groups, which
    is unusable for the one thing the field is for -- finding a match in a
    hurry.
  */
  bloodGroup: {
    keep: (v) => v,
    check: (v) => !v.trim() ? "Blood group is required"
      : BLOOD_GROUPS.includes(v.trim()) ? "" : "Choose a blood group from the list"
  },
  /*
    A number to ring, so it is held to the same shape as any other mobile.

    It used to accept twenty-five characters of mixed letters and digits,
    which let "94881428199999999999999" through -- a value that looks like a
    phone number, is not one, and would only be discovered at the moment
    somebody actually needed to make the call.
  */
  emergencyContact: {
    keep: (v) => v.replace(/\D/g, "").slice(0, 10),
    check: (v) => !v ? "Emergency contact is required"
      : /^\d{10}$/.test(v) ? "" : "Emergency contact must be exactly 10 digits"
  },
  // A relationship is a word: father, mother, spouse.
  emergencyContactRelation: {
    keep: (v) => v.replace(/[^A-Za-z ]/g, ""),
    check: (v) => !v.trim() ? "Emergency contact relation is required"
      : /\d/.test(v) ? "A relation cannot contain numbers"
        : /^[A-Za-z ]+$/.test(v.trim()) ? "" : "Letters only"
  },
  // ---- Salary account. Payroll cannot credit anyone without these three, so
  // they are asked for on the way in rather than chased later.
  accountHolderName: {
    keep: (v) => v.replace(/[^A-Za-z .'-]/g, ""),
    check: (v) => !v.trim() ? "Account holder name is required"
      : /\d/.test(v) ? "A name cannot contain numbers" : ""
  },
  accountNumber: {
    keep: (v) => v.replace(/\D/g, "").slice(0, 20),
    check: (v) => !v ? "Account number is required"
      : /^\d{6,20}$/.test(v) ? "" : "An account number is 6 to 20 digits"
  },
  // An IFSC is four letters, a zero, then six letters or digits.
  ifscCode: {
    keep: (v) => v.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 11),
    check: (v) => !v.trim() ? "IFSC code is required"
      : /^[A-Z]{4}0[A-Z0-9]{6}$/.test(v.trim().toUpperCase()) ? ""
        : "An IFSC is 4 letters, a zero, then 6 letters or digits — e.g. HDFC0001234"
  },
  bankName: {
    check: (v) => v.trim() ? "" : "Bank name is required"
  },
  // Optional — checked for shape only when one is entered.
  pfNumber: {
    keep: (v) => v.replace(/[^A-Za-z0-9/]/g, "").toUpperCase().slice(0, 30),
    check: () => ""
  },
  // Optional — checked for shape only when one is entered.
  pan: {
    keep: (v) => v.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 10),
    check: (v) => !v.trim() ? ""
      : /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(v.trim().toUpperCase()) ? ""
        : "A PAN is 5 letters, 4 digits, then a letter"
  }
};

interface NewEmployeeForm {
  username: string;
  password: string;
  name: string;
  email: string;
  phone: string;
  aadhar: string;
  gender: string;
  dob: string;
  industry: string;
  roleCode: string;
  departmentId: string;
  designationId: string;
  officeLocationId: string;
  dateOfJoining: string;
  house: string;
  street: string;
  district: string;
  state: string;
  pincode: string;
  // extra detail (Excel-style)
  designationTitle: string;
  departmentTitle: string;
  positionTitle: string;
  bloodGroup: string;
  pan: string;
  alternatePhone: string;
  personalEmail: string;
  emergencyContact: string;
  emergencyContactRelation: string;
  /** Provident fund account number. Optional. */
  pfNumber: string;
  // Salary account — required, so payroll has somewhere to credit from day one.
  bankName: string;
  branchName: string;
  accountHolderName: string;
  accountNumber: string;
  ifscCode: string;
  /** Comma-separated upload paths: offer letter, ID scan, certificates. */
  documents: string;
}

const EMPTY_FORM: NewEmployeeForm = {
  username: "",
  password: "",
  name: "",
  email: "",
  phone: "",
  aadhar: "",
  gender: "",
  dob: "",
  industry: "IT",
  roleCode: "IT_EMP",
  departmentId: "",
  designationId: "",
  officeLocationId: "",
  dateOfJoining: "",
  house: "",
  street: "",
  district: "",
  state: "",
  pincode: "",
  designationTitle: "",
  departmentTitle: "",
  positionTitle: "",
  bloodGroup: "",
  pan: "",
  alternatePhone: "",
  personalEmail: "",
  emergencyContact: "",
  emergencyContactRelation: "",
  pfNumber: "",
  bankName: "",
  branchName: "",
  accountHolderName: "",
  accountNumber: "",
  ifscCode: "",
  documents: ""
};

function AddEmployeeDialog({ onClose, defaultIndustry }: { onClose: () => void; defaultIndustry: string }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<NewEmployeeForm>(() => ({
    ...EMPTY_FORM,
    industry: defaultIndustry === "CIVIL" ? "CIVIL" : "IT",
    roleCode: defaultIndustry === "CIVIL" ? "CV_EMP" : "IT_EMP"
  }));
  const [error, setError] = useState<string | null>(null);
  // Files chosen for this employee, uploaded one at a time and kept as paths.
  // Which boxes are wrong, so each can say so in red under itself.
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  
  /** Sets a value through its rule, filtering keystrokes and re-checking it. */
  const setChecked = <K extends keyof NewEmployeeForm>(key: K, raw: string) => {
    const rule = FIELD_RULES[key as string];
    const value = rule?.keep ? rule.keep(raw) : raw;
    set(key, value as NewEmployeeForm[K]);
    // Clear the complaint as soon as it stops being true; do not start
    // complaining about an empty box someone has not finished yet.
    setFieldErrors((prev) => {
      if (!prev[key as string]) return prev;
      const still = rule ? rule.check(value) : "";
      const next = { ...prev };
      if (still) next[key as string] = still; else delete next[key as string];
      return next;
    });
  };
  
  /** Red ring on a box that is wrong. */
  const bad = (key: string) => fieldErrors[key]
    ? "border-destructive ring-1 ring-destructive focus-visible:ring-destructive"
    : "";
  
  /** The message under a box that is wrong. */
  const Bad = ({ name }: { name: string }) => fieldErrors[name]
    ? <p className="text-xs font-medium text-destructive">{fieldErrors[name]}</p>
    : null;

  const docsInput = useRef<HTMLInputElement>(null);
  const [uploadingDocs, setUploadingDocs] = useState(false);
  const docList = form.documents ? form.documents.split(",").filter(Boolean) : [];
  
  async function uploadDocs(files: File[]) {
    setUploadingDocs(true);
    try {
      const paths: string[] = [];
      for (const file of files) {
        const data = new FormData();
        data.append("file", file);
        const res = await api.post<ApiEnvelope<{ path: string }>>("/users/documents", data, {
          headers: { "Content-Type": "multipart/form-data" }
        });
        if (res.data.data?.path) paths.push(res.data.data.path);
      }
      setForm((prev) => ({
        ...prev,
        documents: [...(prev.documents ? prev.documents.split(",").filter(Boolean) : []), ...paths].join(",")
      }));
    } catch (err) {
      toast.error(apiMessage(err, "Could not upload the file"));
    } finally {
      setUploadingDocs(false);
    }
  }

  const set = (key: keyof NewEmployeeForm, value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  // No industry on the call: every team in the company is offered, not just the
  // ones tagged with the chosen category.
  const dropdowns = useQuery({
    queryKey: ["org-dropdowns", "employee-form"],
    queryFn: async () => {
      const res = await api.post<ApiEnvelope<Record<string, DropdownItem[]>>>(
        "/org/dropdowns",
        ["department", "designation", "office_location"]
      );
      return res.data.data;
    }
  });


  const createMutation = useMutation({
    mutationFn: async (payload: NewEmployeeForm) => {
      const body = {
        username: payload.username.trim(),
        password: payload.password,
        name: payload.name.trim(),
        email: payload.email.trim() || undefined,
        phone: payload.phone.trim() || undefined,
        aadhar: payload.aadhar.trim() || undefined,
        gender: payload.gender || undefined,
        dob: payload.dob || undefined,
        industry: payload.industry,
        roleCode: payload.roleCode,
        dateOfJoining: payload.dateOfJoining || undefined,
        departmentId: payload.departmentId ? Number(payload.departmentId) : undefined,
        designationId: payload.designationId ? Number(payload.designationId) : undefined,
        officeLocationId: payload.officeLocationId ? Number(payload.officeLocationId) : undefined,
        house: payload.house.trim() || undefined,
        street: payload.street.trim() || undefined,
        district: payload.district.trim() || undefined,
        state: payload.state.trim() || undefined,
        pincode: payload.pincode.trim() || undefined,
        designationTitle: payload.designationTitle.trim() || undefined,
        departmentTitle: payload.departmentTitle.trim() || undefined,
        positionTitle: payload.positionTitle.trim() || undefined,
        bloodGroup: payload.bloodGroup.trim() || undefined,
        pan: payload.pan.trim().toUpperCase() || undefined,
        alternatePhone: payload.alternatePhone.trim() || undefined,
        personalEmail: payload.personalEmail.trim() || undefined,
        emergencyContact: payload.emergencyContact.trim() || undefined,
        emergencyContactRelation: payload.emergencyContactRelation.trim() || undefined,
        pfNumber: payload.pfNumber.trim() || undefined,
        documents: payload.documents || undefined
      };
      const res = await api.post<ApiEnvelope<Profile>>("/auth/employees", body);
      const created = res.data.data;

      // The salary account, saved against the person just created. If this one
      // call fails the employee still exists, so the failure is carried back
      // rather than thrown — otherwise the form would invite a second attempt
      // at a username that is already taken.
      let bankError: string | null = null;
      try {
        await api.post(`/users/${created.id}/bank`, {
          bankName: payload.bankName.trim(),
          branchName: payload.branchName.trim() || undefined,
          accountNumber: payload.accountNumber.trim(),
          ifscCode: payload.ifscCode.trim().toUpperCase(),
          accountHolderName: payload.accountHolderName.trim(),
          primary: true
        });
      } catch (err) {
        bankError = apiMessage(err, "the bank account could not be saved");
      }
      return { created, bankError };
    },
    onSuccess: async ({ created, bankError }) => {
      if (bankError) {
        toast.error(`${created.name} was created, but ${bankError}. Add the account from their profile.`,
          { duration: 8000 });
      } else {
        toast.success(`${created.name} created successfully!`);
      }
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      onClose();
    },
    onError: (err) => {
      setError(apiMessage(err, "Could not create employee"));
    }
  });

  /**
   * The teams on offer: the team list itself, and nothing else. Merging in the
   * titles sitting on employee records dragged in text an import left behind —
   * "0", near-duplicates like Dev-Ops Lead beside DevOps Engineer — and a joining
   * form is no place to pick one of those. Teams is where a team is created or
   * removed, so Teams decides what can be chosen here.
   */
  const teamChoices = useMemo(() => {
    const byKey = new Map<string, { label: string; id?: number }>();
    (dropdowns.data?.designation ?? []).forEach((d) => {
      const label = (d.label ?? "").trim();
      if (label) byKey.set(label.toLowerCase(), { label, id: d.id });
    });
    return Array.from(byKey.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [dropdowns.data?.designation]);

  /** Records the chosen team as both an id (when it has one) and a title. */
  const chooseTeam = (label: string) => {
    const match = teamChoices.find((t) => t.label === label);
    setForm((f) => ({
      ...f,
      designationTitle: label,
      designationId: match?.id != null ? String(match.id) : ""
    }));
    setFieldErrors((prev) => {
      if (!prev.designationTitle) return prev;
      const next = { ...prev };
      if (label) delete next.designationTitle;
      return next;
    });
  };

  function submit() {
    setError(null);
    // Every box with a rule of its own, checked together so all the wrong ones
    // light up at once rather than one per attempt.
    const found: Record<string, string> = {};
    for (const [key, rule] of Object.entries(FIELD_RULES)) {
      const message = rule.check(String(form[key as keyof NewEmployeeForm] ?? ""));
      if (message) found[key] = message;
    }

    if (!form.username.trim() || form.username.trim().length < 3) {
      found.username = "Username must be at least 3 characters";
    } else if (!/^[A-Za-z0-9._-]+$/.test(form.username.trim())) {
      found.username = "Letters, numbers, dot, underscore or hyphen only";
    }
    if (form.password.length < 8) {
      found.password = "Password must be at least 8 characters";
    }

    // The picked-from-a-list fields have no format to get wrong, only a value
    // to be missing.
    const chosen: [string, string, string][] = [
      ["gender", form.gender, "Gender is required"],
      ["dob", form.dob, "Date of birth is required"],
      ["roleCode", form.roleCode, "Role is required"],
      ["departmentId", form.departmentId, "Department is required"],
      ["designationTitle", form.designationTitle, "Designation is required"],
      ["officeLocationId", form.officeLocationId, "Office location is required"],
      ["dateOfJoining", form.dateOfJoining, "Date of joining is required"],
      ["positionTitle", form.positionTitle, "Position is required"]
    ];
    for (const [key, value, message] of chosen) {
      if (!String(value ?? "").trim()) found[key] = message;
    }

    setFieldErrors(found);
    const count = Object.keys(found).length;
    if (count > 0) {
      setError(count === 1
        ? Object.values(found)[0]
        : `${count} fields need attention — they are marked in red below.`);
      return;
    }
    createMutation.mutate(form);
  }

  const departments = dropdowns.data?.department ?? [];
  const designations = dropdowns.data?.designation ?? [];
  const offices = dropdowns.data?.office_location ?? [];

  return (
    <Dialog open onClose={onClose} className="max-w-2xl">
      <DialogHeader
        title="Add Employee"
        description="Create a login and profile. The employee signs in with the username and password you set here."
      />

      {error && (
        <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="space-y-5">
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Login credentials
          </h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="ne-username">Username<Req /></Label>
              <Input id="ne-username" className={bad("username")} value={form.username} autoComplete="off"
                onChange={(e) => set("username", e.target.value)} placeholder="e.g. arun.k" />
              <Bad name="username" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ne-password">Temporary password<Req /></Label>
              <Input id="ne-password" type="text" className={bad("password")} value={form.password} autoComplete="off"
                onChange={(e) => set("password", e.target.value)} placeholder="min 8 characters" />
              <Bad name="password" />
            </div>
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Personal details
          </h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="ne-name">Full name<Req /></Label>
              <Input id="ne-name" className={bad("name")} value={form.name} placeholder="e.g. Arun Kumar"
                onChange={(e) => setChecked("name", e.target.value)} />
              <Bad name="name" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ne-email">Email<Req /></Label>
              <Input id="ne-email" type="email" value={form.email} placeholder="name@gmail.com"
                className={bad("email")}
                onChange={(e) => setChecked("email", e.target.value)} />
              <Bad name="email" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ne-phone">Phone<Req /></Label>
              <Input id="ne-phone" value={form.phone} inputMode="numeric" maxLength={10}
                className={bad("phone")}
                onChange={(e) => setChecked("phone", e.target.value)} placeholder="10-digit mobile" />
              <Bad name="phone" />
            </div>
            
            <div className="space-y-1">
              <Label htmlFor="ne-gender">Gender<Req /></Label>
              <Select id="ne-gender" className={bad("gender")} value={form.gender} onChange={(e) => set("gender", e.target.value)}>
                <option value="">—</option>
                <option value="M">Male</option>
                <option value="F">Female</option>
                <option value="O">Other</option>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="ne-dob">Date of birth<Req /></Label>
              <Input id="ne-dob" type="date" min={DATE_MIN} max={DATE_MAX} className={bad("dob")} value={form.dob}
                onChange={(e) => set("dob", e.target.value)} />
              <Bad name="dob" />
            </div>
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Employment
          </h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="ne-industry">Category<Req /></Label>
              <Select id="ne-industry" value={form.industry}
                onChange={(e) => {
                  const val = e.target.value;
                  setForm(f => ({
                    ...f,
                    industry: val,
                    roleCode: val === "CIVIL" ? "CV_EMP" : "IT_EMP",
                    designationId: ""
                  }));
                }}>
                <option value="IT">Digital</option>
                <option value="CIVIL">Infra</option>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="ne-role">Role<Req /></Label>
              <Select id="ne-role" className={bad("roleCode")} value={form.roleCode}
                onChange={(e) => set("roleCode", e.target.value)}>
                {/* A new joiner is either a team member or the person who leads
                    them. Any other role is set afterwards, on Edit. */}
                {NEW_EMPLOYEE_ROLES[form.industry === "CIVIL" ? "CIVIL" : "IT"].map((r) => (
                  <option key={r.code} value={r.code}>{r.label}</option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="ne-dept">Department<Req /></Label>
              <Select id="ne-dept" className={bad("departmentId")} value={form.departmentId}
                onChange={(e) => set("departmentId", e.target.value)}>
                <option value="">—</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>{d.label}</option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="ne-desig">Designation (team)<Req /></Label>
              <Input 
                id="ne-desig" 
                list="ne-desig-list" 
                className={bad("designationTitle")} 
                value={form.designationTitle}
                placeholder="Select or type new..."
                onChange={(e) => chooseTeam(e.target.value)} 
              />
              <datalist id="ne-desig-list">
                {teamChoices.map((t) => (
                  <option key={t.label} value={t.label} />
                ))}
              </datalist>
              <Bad name="designationTitle" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ne-office">Office location<Req /></Label>
              <Select id="ne-office" className={bad("officeLocationId")} value={form.officeLocationId}
                onChange={(e) => set("officeLocationId", e.target.value)}>
                <option value="">—</option>
                {offices.map((d) => (
                  <option key={d.id} value={d.id}>{d.label}</option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="ne-doj">Date of joining<Req /></Label>
              <Input id="ne-doj" type="date" min={DATE_MIN} max={DATE_MAX} className={bad("dateOfJoining")} value={form.dateOfJoining}
                onChange={(e) => set("dateOfJoining", e.target.value)} />
              <Bad name="dateOfJoining" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ne-position">Position<Req /></Label>
              <Input id="ne-position" className={bad("positionTitle")} value={form.positionTitle}
                onChange={(e) => set("positionTitle", e.target.value)} placeholder="e.g. Software Developer" />
              <Bad name="positionTitle" />
            </div>
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Additional details
          </h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="ne-blood">Blood group<Req /></Label>
              <Select id="ne-blood" value={form.bloodGroup}
                className={bad("bloodGroup")}
                onChange={(e) => setChecked("bloodGroup", e.target.value)}>
                <option value="">Select…</option>
                {BLOOD_GROUPS.map((g) => <option key={g} value={g}>{g}</option>)}
              </Select>
              <Bad name="bloodGroup" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ne-pan">PAN</Label>
              <Input id="ne-pan" className={`uppercase ${bad("pan")}`} value={form.pan} maxLength={10}
                onChange={(e) => setChecked("pan", e.target.value)} placeholder="ABCDE1234F" />
              <Bad name="pan" />
            </div>

            <div className="space-y-1">
              <Label htmlFor="ne-aadhar">Aadhaar<Req /></Label>
              <Input id="ne-aadhar" value={form.aadhar} inputMode="numeric" maxLength={12}
                className={bad("aadhar")}
                onChange={(e) => setChecked("aadhar", e.target.value)} placeholder="12 digits" />
              <Bad name="aadhar" />
            </div>
            
            <div className="space-y-1">
              <Label htmlFor="ne-alt">Alternate phone</Label>
              <Input id="ne-alt" value={form.alternatePhone} inputMode="numeric" maxLength={10}
                className={bad("alternatePhone")}
                onChange={(e) => setChecked("alternatePhone", e.target.value)} placeholder="10-digit mobile" />
              <Bad name="alternatePhone" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ne-pemail">Personal email</Label>
              <Input id="ne-pemail" type="email" value={form.personalEmail} placeholder="name@gmail.com"
                className={bad("personalEmail")}
                onChange={(e) => setChecked("personalEmail", e.target.value)} />
              <Bad name="personalEmail" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ne-emc">Emergency contact<Req /></Label>
              <Input id="ne-emc" value={form.emergencyContact} inputMode="numeric" maxLength={10}
                className={bad("emergencyContact")}
                onChange={(e) => setChecked("emergencyContact", e.target.value)}
                placeholder="10-digit mobile" />
              <Bad name="emergencyContact" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ne-emr">Emergency contact relation<Req /></Label>
              <Input id="ne-emr" value={form.emergencyContactRelation}
                className={bad("emergencyContactRelation")}
                onChange={(e) => setChecked("emergencyContactRelation", e.target.value)} placeholder="e.g. Father" />
              <Bad name="emergencyContactRelation" />
            </div>
          </div>
        </section>

        {/* Salary account — payroll credits into this, so it is not optional. */}
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Bank details
          </h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="ne-acholder">Account holder name<Req /></Label>
              <Input id="ne-acholder" value={form.accountHolderName}
                className={bad("accountHolderName")}
                onChange={(e) => setChecked("accountHolderName", e.target.value)}
                placeholder="As printed in the passbook" />
              <Bad name="accountHolderName" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ne-acnum">Account number<Req /></Label>
              <Input id="ne-acnum" value={form.accountNumber} inputMode="numeric" maxLength={20}
                className={bad("accountNumber")}
                onChange={(e) => setChecked("accountNumber", e.target.value)}
                placeholder="6–20 digits" />
              <Bad name="accountNumber" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ne-ifsc">IFSC code<Req /></Label>
              <Input id="ne-ifsc" value={form.ifscCode} maxLength={11}
                className={`uppercase ${bad("ifscCode")}`}
                onChange={(e) => setChecked("ifscCode", e.target.value)}
                placeholder="e.g. HDFC0001234" />
              <Bad name="ifscCode" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ne-bank">Bank name<Req /></Label>
              <Input id="ne-bank" value={form.bankName}
                className={bad("bankName")}
                onChange={(e) => setChecked("bankName", e.target.value)}
                placeholder="e.g. HDFC Bank" />
              <Bad name="bankName" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ne-branch">Branch</Label>
              <Input id="ne-branch" value={form.branchName} placeholder="e.g. Peelamedu"
                onChange={(e) => set("branchName", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ne-pf">PF number</Label>
              <Input id="ne-pf" value={form.pfNumber} maxLength={30}
                className="uppercase"
                onChange={(e) => setChecked("pfNumber", e.target.value)}
                placeholder="Optional" />
            </div>
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Address (optional)
          </h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="ne-house">House / building</Label>
              <Input id="ne-house" value={form.house} placeholder="e.g. 12A, Green Villa"
                onChange={(e) => set("house", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ne-street">Street</Label>
              <Input id="ne-street" value={form.street} placeholder="e.g. Anna Nagar 2nd Street"
                onChange={(e) => set("street", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ne-district">District</Label>
              <Input id="ne-district" value={form.district} placeholder="e.g. Coimbatore"
                onChange={(e) => set("district", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ne-state">State</Label>
              <Input id="ne-state" value={form.state} placeholder="e.g. Tamil Nadu"
                onChange={(e) => set("state", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ne-pincode">Pincode</Label>
              {/* inputMode only asks a phone for a number keypad; a desktop
                  keyboard still types letters, so the value is filtered. */}
              <Input id="ne-pincode" value={form.pincode} placeholder="6 digits" inputMode="numeric" maxLength={6}
                onChange={(e) => set("pincode", digitsOnly(e.target.value, 6))} />
            </div>
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Attachments (optional)
          </h3>
          <p className="mb-2 text-xs text-muted-foreground">
            Photos or documents that belong with this employee — offer letter, ID
            proof, certificates. They show on their profile once created.
          </p>
          <input
            ref={docsInput}
            type="file"
            multiple
            className="hidden"
            accept="image/*,.pdf,.doc,.docx,.xls,.xlsx"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              if (files.length) void uploadDocs(files);
              e.target.value = "";
            }}
          />
          <Button
            type="button"
            variant="outline"
            disabled={uploadingDocs}
            onClick={() => docsInput.current?.click()}
          >
            {uploadingDocs
              ? <PixousLoader size="xs" className="mr-1.5" />
              : <Upload className="mr-1.5 h-4 w-4" />}
            {uploadingDocs ? "Uploading…" : "Add files"}
          </Button>
          {docList.length > 0 && (
            <ul className="mt-2 space-y-1.5">
              {docList.map((p) => (
                <li key={p} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
                  <span className="truncate text-xs">{p.split("/").pop()}</span>
                  <button
                    type="button"
                    className="shrink-0 text-xs font-medium text-destructive hover:underline"
                    onClick={() => set("documents", docList.filter((x) => x !== p).join(","))}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="mt-6 flex justify-end gap-2 border-t pt-4">
        <Button variant="ghost" onClick={onClose} disabled={createMutation.isPending}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={createMutation.isPending}>
          {createMutation.isPending && <PixousLoader size="xs" className="mr-2" />}
          {createMutation.isPending ? "Creating…" : "Create Employee"}
        </Button>
      </div>
    </Dialog>
  );
}

interface EditEmployeeForm {
  employeeCode: string;
  name: string;
  email: string;
  phone: string;
  aadhar: string;
  gender: string;
  dob: string;
  industry: string;
  roleCode: string;
  departmentId: string;
  designationId: string;
  officeLocationId: string;
  dateOfJoining: string;
  house: string;
  street: string;
  district: string;
  state: string;
  pincode: string;
  designationTitle: string;
  departmentTitle: string;
  positionTitle: string;
  bloodGroup: string;
  pan: string;
  pfNumber: string;
  alternatePhone: string;
  personalEmail: string;
  emergencyContact: string;
  emergencyContactRelation: string;
  profileStatus: string;
}

function EditEmployeeDialog({ id, onClose }: { id: number; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<EditEmployeeForm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  // The salary account is edited here too, so it is held separately from the
  // profile form — it is saved through its own endpoint.
  const [bank, setBank] = useState({
    bankName: "", branchName: "", accountHolderName: "", accountNumber: "", ifscCode: ""
  });

  const detail = useQuery({
    queryKey: ["employee", id],
    queryFn: async () => {
      try {
        return (await api.get<ApiEnvelope<Profile>>(`/users/${id}`)).data.data;
      } catch (err) {
        const mockUser = getMockUserById(id as number);
        if (mockUser) return mockUser;
        throw err;
      }
    }
  });

  const banks = useQuery({
    queryKey: ["employee-bank", id],
    retry: false,
    queryFn: async () =>
      (await api.get<ApiEnvelope<BankResponse[]>>(`/users/${id}/bank`)).data.data
  });

  // Whichever account payroll would use — the primary one, or the only one.
  const primaryBank = (banks.data ?? []).find((b) => b.primary) ?? (banks.data ?? [])[0];

  useEffect(() => {
    if (primaryBank) {
      setBank({
        bankName: primaryBank.bankName || "",
        branchName: primaryBank.branchName || "",
        accountHolderName: primaryBank.accountHolderName || "",
        accountNumber: primaryBank.accountNumber || "",
        ifscCode: primaryBank.ifscCode || ""
      });
    }
  }, [primaryBank?.id]);

  useEffect(() => {
    if (detail.data) {
      const p = detail.data;
      setForm({
        employeeCode: p.employeeCode || "",
        name: p.name || "",
        email: p.email || "",
        phone: p.phone || "",
        aadhar: p.aadhar || "",
        gender: p.gender || "",
        dob: p.dob || "",
        industry: p.industry || "IT",
        roleCode: p.roles?.[0] || "",
        departmentId: p.departmentId ? String(p.departmentId) : "",
        designationId: p.designationId ? String(p.designationId) : "",
        officeLocationId: p.officeLocationId ? String(p.officeLocationId) : "",
        dateOfJoining: p.dateOfJoining || "",
        house: p.address?.house || "",
        street: p.address?.street || "",
        district: p.address?.district || "",
        state: p.address?.state || "",
        pincode: p.address?.pincode || "",
        designationTitle: p.designationTitle || "",
        departmentTitle: p.departmentTitle || "",
        positionTitle: p.positionTitle || "",
        bloodGroup: p.bloodGroup || "",
        pan: p.pan || "",
        pfNumber: p.pfNumber || "",
        alternatePhone: p.alternatePhone || "",
        personalEmail: p.personalEmail || "",
        emergencyContact: p.emergencyContact || "",
        emergencyContactRelation: p.emergencyContactRelation || "",
        profileStatus: p.profileStatus || "ACTIVE"
      });
    }
  }, [detail.data]);

  const set = (key: keyof EditEmployeeForm, value: string) => {
    if (!form) return;
    setForm((f) => f ? ({ ...f, [key]: value }) : null);
  };

  // Same here: editing someone shows every team, so they can be moved to any of
  // them rather than only the ones under their current category.
  const dropdowns = useQuery({
    queryKey: ["org-dropdowns", "employee-edit-form"],
    queryFn: async () => {
      const res = await api.post<ApiEnvelope<Record<string, DropdownItem[]>>>(
        "/org/dropdowns",
        ["department", "designation", "office_location"]
      );
      return res.data.data;
    }
  });

  const updateMutation = useMutation({
    mutationFn: async (payload: EditEmployeeForm) => {
      const body = {
        name: payload.name.trim(),
        email: payload.email.trim() || undefined,
        phone: payload.phone.trim() || undefined,
        aadhar: payload.aadhar.trim() || undefined,
        gender: payload.gender || undefined,
        dob: payload.dob || undefined,
        industry: payload.industry,
        roles: payload.roleCode ? [payload.roleCode] : [],
        departmentId: payload.departmentId ? Number(payload.departmentId) : undefined,
        designationId: payload.designationId ? Number(payload.designationId) : undefined,
        officeLocationId: payload.officeLocationId ? Number(payload.officeLocationId) : undefined,
        house: payload.house.trim() || undefined,
        street: payload.street.trim() || undefined,
        district: payload.district.trim() || undefined,
        state: payload.state.trim() || undefined,
        pincode: payload.pincode.trim() || undefined,
        designationTitle: payload.designationTitle.trim() || undefined,
        departmentTitle: payload.departmentTitle.trim() || undefined,
        positionTitle: payload.positionTitle.trim() || undefined,
        bloodGroup: payload.bloodGroup.trim() || undefined,
        pan: payload.pan.trim().toUpperCase() || undefined,
        pfNumber: payload.pfNumber.trim().toUpperCase() || undefined,
        alternatePhone: payload.alternatePhone.trim() || undefined,
        personalEmail: payload.personalEmail.trim() || undefined,
        emergencyContact: payload.emergencyContact.trim() || undefined,
        emergencyContactRelation: payload.emergencyContactRelation.trim() || undefined,
        profileStatus: payload.profileStatus,
        employeeCode: payload.employeeCode.trim() || undefined,
        dateOfJoining: payload.dateOfJoining || undefined
      };
      const res = await api.put<ApiEnvelope<Profile>>(`/users/${id}`, body);

      // The salary account goes through its own endpoint: updated when one is
      // already on file, created when it is not. Left alone when the four boxes
      // are empty, so editing a profile never wipes an account by omission.
      const filled = bank.accountNumber.trim() && bank.ifscCode.trim()
        && bank.accountHolderName.trim() && bank.bankName.trim();
      let bankError: string | null = null;
      if (filled) {
        const body2 = {
          bankName: bank.bankName.trim(),
          branchName: bank.branchName.trim() || undefined,
          accountNumber: bank.accountNumber.trim(),
          ifscCode: bank.ifscCode.trim().toUpperCase(),
          accountHolderName: bank.accountHolderName.trim(),
          primary: true
        };
        try {
          if (primaryBank) await api.put(`/users/${id}/bank/${primaryBank.id}`, body2);
          else await api.post(`/users/${id}/bank`, body2);
        } catch (err) {
          bankError = apiMessage(err, "the bank account could not be saved");
        }
      }
      return { updated: res.data.data, bankError };
    },
    onSuccess: async ({ updated, bankError }) => {
      if (bankError) {
        toast.error(`${updated.name} was updated, but ${bankError}.`, { duration: 8000 });
      } else {
        toast.success(`${updated.name} updated successfully!`);
      }
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      queryClient.invalidateQueries({ queryKey: ["employee", id] });
      queryClient.invalidateQueries({ queryKey: ["employee-bank", id] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      onClose();
    },
    onError: (err) => {
      setError(apiMessage(err, "Could not update employee"));
    }
  });

  function submit() {
    if (!form) return;
    setError(null);
    setFormErrors({});

    let hasErrors = false;
    const errors: Record<string, string> = {};

    if (!form.name.trim()) {
      errors.name = "Full name is required.";
      hasErrors = true;
    }
    
    if (!form.phone.trim()) {
      errors.phone = "Phone number is required.";
      hasErrors = true;
    } else if (form.phone.length !== 10) {
      errors.phone = "Phone number must be exactly 10 digits.";
      hasErrors = true;
    }

    if (!form.roleCode) {
      errors.roleCode = "Role is required.";
      hasErrors = true;
    }

    if (!form.designationTitle.trim()) {
      errors.designationTitle = "Designation is required.";
      hasErrors = true;
    }

    if (form.personalEmail.trim() && form.personalEmail.trim().toLowerCase() === form.email.trim().toLowerCase()) {
      errors.personalEmail = "Personal email cannot be the same as the official email (already exists).";
      hasErrors = true;
    }

    if (!form.emergencyContact.trim()) {
      errors.emergencyContact = "Emergency contact number is required.";
      hasErrors = true;
    } else if (form.emergencyContact.length !== 10) {
      errors.emergencyContact = "Emergency contact must be exactly 10 digits.";
      hasErrors = true;
    } else if (form.emergencyContact === form.phone) {
      errors.emergencyContact = "Emergency contact cannot be the same as your own phone number (already exists).";
      hasErrors = true;
    }

    if (!bank.accountHolderName.trim()) {
      errors.accountHolderName = "Account holder name is required.";
      hasErrors = true;
    }
    if (!bank.accountNumber.trim()) {
      errors.accountNumber = "Account number is required.";
      hasErrors = true;
    }
    if (!bank.ifscCode.trim()) {
      errors.ifscCode = "IFSC code is required.";
      hasErrors = true;
    }
    if (!bank.bankName.trim()) {
      errors.bankName = "Bank name is required.";
      hasErrors = true;
    }
    if (!bank.branchName.trim()) {
      errors.branchName = "Branch is required.";
      hasErrors = true;
    }

    if (hasErrors) {
      setFormErrors(errors);
      return;
    }

    if (form.aadhar && !/^\d{12}$/.test(form.aadhar)) {
      setError("Aadhaar must be exactly 12 digits (or leave it blank)");
      return;
    }
    updateMutation.mutate(form);
  }

  if (detail.isLoading || !form) {
    return (
      <Dialog open onClose={onClose} className="max-w-2xl">
        <DialogHeader title="Edit Employee" />
        <div className="flex items-center justify-center p-8">
          <PixousLoader size="md" />
        </div>
      </Dialog>
    );
  }

  const departments = dropdowns.data?.department ?? [];
  const designations = dropdowns.data?.designation ?? [];
  const offices = dropdowns.data?.office_location ?? [];

  return (
    <Dialog open onClose={onClose} className="max-w-2xl">
      <DialogHeader
        title="Edit Employee Profile"
        description="Update personal details, employment information, additional data, and address block."
      />

      {error && (
        <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="space-y-5 max-h-[65vh] overflow-y-auto pr-1">
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Personal details
          </h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="ee-name">Full name <span className="text-destructive">*</span></Label>
              <Input id="ee-name" value={form.name}
                onChange={(e) => { set("name", e.target.value); setFormErrors(prev => ({...prev, name: ""})) }} />
              {formErrors.name && <p className="text-[10px] text-destructive mt-1">{formErrors.name}</p>}
            </div>
            <div className="space-y-1">
              <Label htmlFor="ee-email">Email</Label>
              <Input id="ee-email" type="email" value={form.email}
                onChange={(e) => set("email", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ee-phone">Phone <span className="text-destructive">*</span></Label>
              <Input id="ee-phone" value={form.phone} inputMode="numeric" maxLength={10}
                onChange={(e) => {
                  const digits = e.target.value.replace(/\D/g, "").slice(0, 10);
                  set("phone", digits);
                  setFormErrors(prev => ({...prev, phone: ""}))
                }} placeholder="10-digit mobile" />
              {formErrors.phone && <p className="text-[10px] text-destructive mt-1">{formErrors.phone}</p>}
            </div>
            <div className="space-y-1">
              <Label htmlFor="ee-aadhar">Aadhaar</Label>
              <Input id="ee-aadhar" value={form.aadhar} inputMode="numeric" maxLength={12}
                onChange={(e) => set("aadhar", e.target.value)} placeholder="12 digits" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ee-gender">Gender</Label>
              <Select id="ee-gender" value={form.gender} onChange={(e) => set("gender", e.target.value)}>
                <option value="">—</option>
                <option value="M">Male</option>
                <option value="F">Female</option>
                <option value="O">Other</option>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="ee-dob">Date of birth</Label>
              <Input id="ee-dob" type="date" min={DATE_MIN} max={DATE_MAX} value={form.dob}
                onChange={(e) => set("dob", e.target.value)} />
            </div>
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Employment
          </h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="ee-code">Employee code</Label>
              <Input id="ee-code" value={form.employeeCode}
                onChange={(e) => set("employeeCode", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ee-industry">Industry</Label>
              <Select id="ee-industry" value={form.industry}
                onChange={(e) => {
                  const val = e.target.value;
                  setForm(f => f ? ({
                    ...f,
                    industry: val,
                    roleCode: val === "CIVIL" ? "CV_EMP" : "IT_EMP",
                    designationId: ""
                  }) : null);
                }}>
                <option value="IT">IT</option>
                <option value="CIVIL">Civil</option>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="ee-role">Role <span className="text-destructive">*</span></Label>
              <Select id="ee-role" value={form.roleCode}
                onChange={(e) => { set("roleCode", e.target.value); setFormErrors(prev => ({...prev, roleCode: ""})) }}>
                {ROLE_OPTIONS.filter(r => {
                  if (form.industry === "CIVIL") return r.code.startsWith("CV_") || r.code === "COMPANY_ADMIN";
                  return r.code.startsWith("IT_") || r.code === "SUPER_ADMIN" || r.code === "COMPANY_ADMIN";
                }).map((r) => (
                  <option key={r.code} value={r.code}>{r.label}</option>
                ))}
              </Select>
              {formErrors.roleCode && <p className="text-[10px] text-destructive mt-1">{formErrors.roleCode}</p>}
            </div>
            <div className="space-y-1">
              <Label htmlFor="ee-dept">Department</Label>
              <Select id="ee-dept" value={form.departmentId}
                onChange={(e) => set("departmentId", e.target.value)}>
                <option value="">—</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>{d.label}</option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="ee-desig">Designation <span className="text-destructive">*</span></Label>
              <Input 
                id="ee-desig" 
                list="ee-desig-list" 
                value={form.designationTitle}
                placeholder="Select or type new..."
                onChange={(e) => {
                  const val = e.target.value.replace(/[^A-Za-z\s]/g, '');
                  const match = designations.find(d => d.label.toLowerCase() === val.toLowerCase());
                  setForm(f => f ? {
                    ...f,
                    designationTitle: val,
                    designationId: match ? String(match.id) : ""
                  } : null);
                  setFormErrors(prev => ({...prev, designationTitle: ""}));
                }} 
              />
              <datalist id="ee-desig-list">
                {designations.map((d) => (
                  <option key={d.id} value={d.label} />
                ))}
              </datalist>
              {formErrors.designationTitle && <p className="text-[10px] text-destructive mt-1">{formErrors.designationTitle}</p>}
            </div>
            <div className="space-y-1">
              <Label htmlFor="ee-office">Office location</Label>
              <Select id="ee-office" value={form.officeLocationId}
                onChange={(e) => set("officeLocationId", e.target.value)}>
                <option value="">—</option>
                {offices.map((d) => (
                  <option key={d.id} value={d.id}>{d.label}</option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="ee-doj">Date of joining</Label>
              <Input id="ee-doj" type="date" min={DATE_MIN} max={DATE_MAX} value={form.dateOfJoining}
                onChange={(e) => set("dateOfJoining", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ee-position">Position</Label>
              <Input id="ee-position" value={form.positionTitle}
                onChange={(e) => set("positionTitle", e.target.value)} placeholder="e.g. Software Developer" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ee-status">Profile Status</Label>
              <Select id="ee-status" value={form.profileStatus}
                onChange={(e) => set("profileStatus", e.target.value)}>
                <option value="ACTIVE">Active</option>
                <option value="PENDING">Pending</option>
                <option value="OFFBOARDED">Offboarded</option>
              </Select>
            </div>
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Additional details
          </h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="ee-blood">Blood group</Label>
              <Select id="ee-blood" value={form.bloodGroup}
                onChange={(e) => set("bloodGroup", e.target.value)}>
                <option value="">Select…</option>
                {BLOOD_GROUPS.map((g) => <option key={g} value={g}>{g}</option>)}
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="ee-pan">PAN</Label>
              <Input id="ee-pan" className="uppercase" value={form.pan}
                onChange={(e) => set("pan", e.target.value)} placeholder="10-char PAN" maxLength={10} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ee-pf">PF number</Label>
              <Input id="ee-pf" className="uppercase" value={form.pfNumber} maxLength={30}
                onChange={(e) => set("pfNumber", e.target.value)} placeholder="Optional" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ee-alt">Alternate phone</Label>
              <Input id="ee-alt" value={form.alternatePhone} inputMode="numeric" maxLength={10}
                onChange={(e) => set("alternatePhone", e.target.value.replace(/\D/g, "").slice(0, 10))}
                placeholder="10-digit mobile (optional)" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ee-pemail">Personal email</Label>
              <Input id="ee-pemail" type="email" value={form.personalEmail}
                onChange={(e) => { set("personalEmail", e.target.value); setFormErrors(prev => ({...prev, personalEmail: ""})) }} />
              {formErrors.personalEmail && <p className="text-[10px] text-destructive mt-1">{formErrors.personalEmail}</p>}
            </div>
            <div className="space-y-1">
              <Label htmlFor="ee-emc">Emergency contact <span className="text-destructive">*</span></Label>
              <Input id="ee-emc" value={form.emergencyContact} inputMode="numeric" maxLength={10}
                onChange={(e) => {
                  const digits = e.target.value.replace(/\D/g, "").slice(0, 10);
                  set("emergencyContact", digits);
                  setFormErrors(prev => ({...prev, emergencyContact: ""}))
                }} placeholder="10-digit mobile" />
              {formErrors.emergencyContact && <p className="text-[10px] text-destructive mt-1">{formErrors.emergencyContact}</p>}
            </div>
            <div className="space-y-1">
              <Label htmlFor="ee-emr">Emergency contact relation</Label>
              <Input id="ee-emr" value={form.emergencyContactRelation}
                onChange={(e) => set("emergencyContactRelation", e.target.value)} placeholder="e.g. Father" />
            </div>
          </div>
        </section>

        {/* The salary account. Filling all four saves it; leaving them as they
            are changes nothing. */}
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Bank details
          </h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="ee-acholder">Account holder name <span className="text-destructive">*</span></Label>
              <Input id="ee-acholder" value={bank.accountHolderName}
                onChange={(e) => {
                  setBank((b) => ({
                    ...b, accountHolderName: e.target.value.replace(/[^A-Za-z .'-]/g, "")
                  }));
                  setFormErrors(prev => ({...prev, accountHolderName: ""}));
                }}
                placeholder="As printed in the passbook" />
              {formErrors.accountHolderName && <p className="text-[10px] text-destructive mt-1">{formErrors.accountHolderName}</p>}
            </div>
            <div className="space-y-1">
              <Label htmlFor="ee-acnum">Account number <span className="text-destructive">*</span></Label>
              <Input id="ee-acnum" value={bank.accountNumber} inputMode="numeric" maxLength={20}
                onChange={(e) => {
                  setBank((b) => ({
                    ...b, accountNumber: e.target.value.replace(/\D/g, "").slice(0, 20)
                  }));
                  setFormErrors(prev => ({...prev, accountNumber: ""}));
                }}
                placeholder="6–20 digits" />
              {formErrors.accountNumber && <p className="text-[10px] text-destructive mt-1">{formErrors.accountNumber}</p>}
            </div>
            <div className="space-y-1">
              <Label htmlFor="ee-ifsc">IFSC code <span className="text-destructive">*</span></Label>
              <Input id="ee-ifsc" className="uppercase" value={bank.ifscCode} maxLength={11}
                onChange={(e) => {
                  setBank((b) => ({
                    ...b, ifscCode: e.target.value.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 11)
                  }));
                  setFormErrors(prev => ({...prev, ifscCode: ""}));
                }}
                placeholder="e.g. HDFC0001234" />
              {formErrors.ifscCode && <p className="text-[10px] text-destructive mt-1">{formErrors.ifscCode}</p>}
            </div>
            <div className="space-y-1">
              <Label htmlFor="ee-bank">Bank name <span className="text-destructive">*</span></Label>
              <Input id="ee-bank" value={bank.bankName}
                onChange={(e) => {
                  setBank((b) => ({ ...b, bankName: e.target.value }));
                  setFormErrors(prev => ({...prev, bankName: ""}));
                }}
                placeholder="e.g. HDFC Bank" />
              {formErrors.bankName && <p className="text-[10px] text-destructive mt-1">{formErrors.bankName}</p>}
            </div>
            <div className="space-y-1">
              <Label htmlFor="ee-branch">Branch <span className="text-destructive">*</span></Label>
              <Input id="ee-branch" value={bank.branchName}
                onChange={(e) => {
                  setBank((b) => ({ ...b, branchName: e.target.value }));
                  setFormErrors(prev => ({...prev, branchName: ""}));
                }}
                placeholder="e.g. Peelamedu" />
              {formErrors.branchName && <p className="text-[10px] text-destructive mt-1">{formErrors.branchName}</p>}
            </div>
          </div>
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            {primaryBank
              ? "Saving updates the account payroll credits into."
              : "No account on file yet. Fill in the holder name, number, IFSC and bank to add one."}
          </p>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Address (optional)
          </h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="ee-house">House / building</Label>
              <Input id="ee-house" value={form.house}
                onChange={(e) => set("house", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ee-street">Street</Label>
              <Input id="ee-street" value={form.street}
                onChange={(e) => set("street", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ee-district">District</Label>
              <Input id="ee-district" value={form.district}
                onChange={(e) => set("district", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ee-state">State</Label>
              <Input id="ee-state" value={form.state}
                onChange={(e) => set("state", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ee-pincode">Pincode</Label>
              <Input id="ee-pincode" value={form.pincode}
                onChange={(e) => set("pincode", e.target.value)} />
            </div>
          </div>
        </section>
      </div>

      <div className="mt-6 flex justify-end gap-2 border-t pt-4">
        <Button variant="ghost" onClick={onClose} disabled={updateMutation.isPending}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={updateMutation.isPending}>
          {updateMutation.isPending && <PixousLoader size="xs" className="mr-2" />}
          {updateMutation.isPending ? "Saving…" : "Save Changes"}
        </Button>
      </div>
    </Dialog>
  );
}
