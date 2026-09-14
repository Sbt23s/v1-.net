import { PixousLoader, PixousPanelLoader } from "@/components/ui/pixous-loader";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Calendar, Briefcase, Plus, Trash2, CalendarCheck, Users, Pencil, Search
} from "lucide-react";
import toast from "react-hot-toast";
import { api, apiMessage } from "@/lib/api";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogHeader } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";
import type { ApiEnvelope, LeaveType, HolidayResponse } from "@/types";
import { useAuth } from "@/hooks/useAuth";
import { todayIso, DATE_MIN, DATE_MAX } from "@/lib/dates";
import { usePagedRows, TablePagination } from "@/components/ui/table-pagination";

export default function LeavePoliciesPage() {
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  const [activeTab, setActiveTab] = useState<"types" | "holidays">("types");
  const [createTypeOpen, setCreateTypeOpen] = useState(false);
  const [editType, setEditType] = useState<LeaveType | null>(null);
  const [createHolidayOpen, setCreateHolidayOpen] = useState(false);

  // Strict Current Year enforcement (e.g., 2026)
  const thisYear = new Date().getFullYear();
  const [allocYearStr, setAllocYearStr] = useState<string>(String(thisYear));
  const [typeQuery, setTypeQuery] = useState("");

  /*
   * Three questions this page used to ask with window.confirm().
   *
   * That draws the browser's own box: pinned to the top of the window, the
   * hostname printed above the question, unstyleable, and it blocks the page
   * behind it. The portal already has a centred ConfirmDialog that five other
   * screens use, so these hold what it needs -- null or false means closed.
   */
  const [confirmAllocate, setConfirmAllocate] = useState(false);
  const [confirmType, setConfirmType] = useState<LeaveType | null>(null);
  const [confirmHoliday, setConfirmHoliday] = useState<HolidayResponse | null>(null);

  const numYear = Number(allocYearStr);
  const isInvalidYear = allocYearStr.length > 0 && numYear !== thisYear;

  // Declared before the query below, which reads it to decide which listing
  // to ask for. const is not hoisted, so its old position further down would
  // have been a runtime error rather than a mistake tsc could see.
  const canManage = hasPermission("ORG_MANAGE");

  // Fetch Leave Types
  const leaveTypes = useQuery({
    queryKey: ["leave-types", canManage],
    /*
      The configuration screen asks for everything, switched-off types
      included; everybody else asks for what can be applied for.

      Deleting switches a type off rather than removing it, because leave
      already taken points at it. But this screen only ever listed the active
      ones, so a type vanished from the page that switched it off and there
      was no way back -- which is why deleting looked broken even though the
      row had changed.
    */
    queryFn: async () =>
      (await api.get<ApiEnvelope<LeaveType[]>>(
        canManage ? "/leave/types/all" : "/leave/types")).data.data
  });

  // Fetch Holidays
  const holidays = useQuery({
    queryKey: ["holidays"],
    queryFn: async () => (await api.get<ApiEnvelope<HolidayResponse[]>>("/org/holidays")).data.data
  });

  const deleteTypeMutation = useMutation({
    mutationFn: async (id: number) => {
      await api.delete(`/leave/types/${id}`);
    },
    onSuccess: () => {
      toast.success("Leave type deleted");
      queryClient.invalidateQueries({ queryKey: ["leave-types"] });
    },
    onError: (err) => toast.error(apiMessage(err, "Failed to delete leave type"))
  });

  const deleteHolidayMutation = useMutation({
    mutationFn: async (id: number) => {
      await api.delete(`/org/holidays/${id}`);
    },
    onSuccess: () => {
      toast.success("Holiday deleted");
      queryClient.invalidateQueries({ queryKey: ["holidays"] });
    },
    onError: (err) => toast.error(apiMessage(err, "Failed to delete holiday"))
  });

  const allocateMutation = useMutation({
    mutationFn: async (year: number) =>
      (await api.post<ApiEnvelope<{ created: number; employees: number; year: number }>>(
        `/leave/allocations/apply-defaults?year=${year}`
      )).data.data,
    onSuccess: (res) => {
      if (res.created > 0) {
        toast.success(`Allocated leave to ${res.employees} employees (${res.created} balances created) for ${res.year}`);
      } else {
        toast.success(`All ${res.employees} employees already have their ${res.year} leave allocated`);
      }
      queryClient.invalidateQueries({ queryKey: ["leave-types"] });
    },
    onError: (err) => toast.error(apiMessage(err, "Failed to allocate leave balances"))
  });

  const filteredTypes = (leaveTypes.data ?? []).filter((t) => {
    const needle = typeQuery.trim().toLowerCase();
    if (!needle) return true;
    return `${t.name ?? ""} ${t.code ?? ""}`.toLowerCase().includes(needle);
  });

  const typesPaged = usePagedRows(filteredTypes, 10, [typeQuery, leaveTypes.data]);
  const holidaysPaged = usePagedRows(holidays.data ?? [], 10, [holidays.data]);

  return (
    <div>
      <PageHeader 
        icon={Briefcase}
        title="Leave Policies & Holidays" 
        subtitle="Manage organization leave types and holiday calendar." 
      />

      <div className="flex gap-2 mb-6 border-b pb-2">
        <button
          className={`px-4 py-2 text-sm font-semibold rounded-md transition-colors flex items-center ${
            activeTab === "types" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
          }`}
          onClick={() => setActiveTab("types")}
        >
          <Briefcase className="w-4 h-4 mr-2 shrink-0" /> Leave Types
        </button>
        <button
          className={`px-4 py-2 text-sm font-semibold rounded-md transition-colors flex items-center ${
            activeTab === "holidays" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
          }`}
          onClick={() => setActiveTab("holidays")}
        >
          <Calendar className="w-4 h-4 mr-2 shrink-0" /> Holidays
        </button>
      </div>

      {activeTab === "types" && (
        <div className="space-y-4">
          {canManage && (
            <Card className="border-primary/30 bg-primary/5">
              <CardContent className="p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                  <div className="rounded-lg bg-primary/10 p-2 text-primary">
                    <CalendarCheck className="h-5 w-5" />
                  </div>
                  <div>
                    <h4 className="font-semibold text-sm">Allocate leave to all employees</h4>
                    <p className="text-xs text-muted-foreground max-w-md">
                      Gives every employee their annual balance using each type&apos;s max days
                      (e.g. Casual 12, Sick 12, Earned 18). Employees must have a balance before
                      they can apply. Safe to run again — existing balances are kept.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-2 shrink-0">
                  <div className="flex flex-col">
                    <Label htmlFor="allocYear" className="text-[10px] uppercase text-muted-foreground font-bold">Year</Label>
                    <Input
                      id="allocYear"
                      type="text"
                      inputMode="numeric"
                      maxLength={4}
                      placeholder={String(thisYear)}
                      value={allocYearStr}
                      onChange={(e) => setAllocYearStr(e.target.value.replace(/\D/g, "").slice(0, 4))}
                      className={`h-9 w-24 font-bold text-center ${isInvalidYear ? "border-destructive ring-1 ring-destructive" : ""}`}
                    />
                    <p className={`mt-1 text-[10px] ${isInvalidYear ? "font-bold text-destructive" : "text-emerald-600 font-semibold"}`}>
                      {isInvalidYear ? `Only ${thisYear} allowed` : `Current year (${thisYear})`}
                    </p>
                  </div>
                  <Button
                    className="mt-[18px] bg-green-600 text-white hover:bg-green-700"
                    disabled={allocateMutation.isPending || isInvalidYear}
                    onClick={() => {
                      if (numYear !== thisYear) {
                        toast.error(`Only the current year (${thisYear}) can be allocated. Past and future years are not allowed.`);
                        return;
                      }
                      setConfirmAllocate(true);
                    }}
                  >
                    {allocateMutation.isPending ? <PixousLoader size="xs" className="mr-2" /> : <Users className="h-4 w-4 mr-2" />}
                    Allocate to all
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="font-semibold text-lg">Leave Types</h3>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="h-9 w-64 pl-9"
                  placeholder="Search by name or code…"
                  value={typeQuery}
                  onChange={(e) => setTypeQuery(e.target.value)}
                />
              </div>
              {canManage && (
                <Button size="sm" onClick={() => setCreateTypeOpen(true)}>
                  <Plus className="w-4 h-4 mr-2" /> Add Leave Type
                </Button>
              )}
            </div>
          </div>

          {leaveTypes.isLoading ? (
            <PixousPanelLoader height="h-40" />
          ) : (
            <Card>
              <CardContent className="p-0">
                {/* Scrolls itself rather than pushing the page sideways. */}
                <div className="w-full overflow-x-auto">
                <table className="data-table">
                  <thead className="bg-muted text-muted-foreground font-semibold uppercase text-xs">
                    <tr>
                      <th className="font-bold">Name</th>
                      <th className="font-bold">Code</th>
                      <th className="font-bold">Max Days/Year</th>
                      <th className="font-bold">Per 3 months</th>
                      <th className="font-bold">Pay</th>
                      {canManage && <th className="font-bold">Status</th>}
                      <th className="font-bold text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {typesPaged.pageRows.map((t) => (
                      <tr
                        key={t.id}
                        /* A switched-off type is dimmed rather than hidden:
                           it is still here, and can be switched back on. */
                        className={cn("hover:bg-muted/50", t.active === false && "opacity-55")}
                      >
                        <td className="font-medium">{t.name}</td>
                        <td className="text-muted-foreground">{t.code}</td>
                        <td className="text-muted-foreground">{t.maxDaysPerYear || "Unlimited"}</td>
                        <td className="text-muted-foreground">
                          {t.monthlyLimit ? t.monthlyLimit : "—"}
                        </td>
                        <td>
                          {t.paid ? (
                            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                              Paid
                            </span>
                          ) : (
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                              Unpaid (LOP)
                            </span>
                          )}
                        </td>
                        {canManage && (
                          <td>
                            {t.active === false ? (
                              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                                Switched off
                              </span>
                            ) : (
                              <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700 dark:bg-green-900/30 dark:text-green-400">
                                Active
                              </span>
                            )}
                          </td>
                        )}
                        <td className="text-right">
                          {canManage && (
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                title="Edit leave type"
                                onClick={() => setEditType(t)}
                              >
                                <Pencil className="w-4 h-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                title="Delete leave type"
                                onClick={() => {
                                  setConfirmType(t);
                                }}
                              >
                                <Trash2 className="w-4 h-4 text-destructive" />
                              </Button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
                <TablePagination
                  page={typesPaged.page}
                  totalPages={typesPaged.totalPages}
                  onChange={typesPaged.setPage}
                  pageSize={typesPaged.pageSize}
                  onPageSizeChange={typesPaged.setPageSize}
                  total={typesPaged.total}
                />
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {activeTab === "holidays" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-lg">Holidays Calendar</h3>
            {canManage && (
              <Button size="sm" onClick={() => setCreateHolidayOpen(true)}>
                <Plus className="w-4 h-4 mr-2" /> Add Holiday
              </Button>
            )}
          </div>
          {holidays.isLoading ? (
            <PixousPanelLoader height="h-40" />
          ) : (
            <Card>
              <CardContent className="p-0">
                {/* Scrolls itself rather than pushing the page sideways. */}
                <div className="w-full overflow-x-auto">
                <table className="data-table">
                  <thead className="bg-muted text-muted-foreground font-semibold uppercase text-xs">
                    <tr>
                      <th className="font-bold">Date</th>
                      <th className="font-bold">Holiday Name</th>
                      <th className="font-bold">Type</th>
                      <th className="font-bold text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {holidaysPaged.pageRows.map((h) => (
                      <tr key={h.id} className="hover:bg-muted/50">
                        <td className="font-medium">{h.holidayDate || (h as any).date}</td>
                        <td className="font-semibold">{h.name}</td>
                        <td className="text-muted-foreground">{(h as any).type || "National"}</td>
                        <td className="text-right">
                          {canManage && (
                            <Button
                              variant="ghost"
                              size="sm"
                              title="Delete holiday"
                              onClick={() => {
                                setConfirmHoliday(h);
                              }}
                            >
                              <Trash2 className="w-4 h-4 text-destructive" />
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
                <TablePagination
                  page={holidaysPaged.page}
                  totalPages={holidaysPaged.totalPages}
                  onChange={holidaysPaged.setPage}
                  pageSize={holidaysPaged.pageSize}
                  onPageSizeChange={holidaysPaged.setPageSize}
                  total={holidaysPaged.total}
                />
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Dialogs */}
      {createTypeOpen && (
        <CreateTypeDialog onClose={() => setCreateTypeOpen(false)} />
      )}
      {editType && (
        <EditTypeDialog type={editType} onClose={() => setEditType(null)} />
      )}
      {createHolidayOpen && (
        <CreateHolidayDialog onClose={() => setCreateHolidayOpen(false)} />
      )}

      <ConfirmDialog
        open={confirmAllocate}
        title={`Allocate leave for ${thisYear}?`}
        description="Every employee is given their annual balance from each leave type's maximum. Existing balances are kept, so this is safe to run again."
        detail={
          (leaveTypes.data ?? [])
            .filter((t: LeaveType) => !!t.maxDaysPerYear && t.maxDaysPerYear > 0)
            .map((t: LeaveType) => [t.name, `${t.maxDaysPerYear} days`] as [string, string])
        }
        confirmLabel="Allocate to all"
        cancelLabel="Cancel"
        busy={allocateMutation.isPending}
        onConfirm={() => {
          allocateMutation.mutate(thisYear);
          setConfirmAllocate(false);
        }}
        onCancel={() => setConfirmAllocate(false)}
      />

      <ConfirmDialog
        open={confirmType !== null}
        title={confirmType ? `Delete ${confirmType.name}?` : ""}
        description="Balances already given to employees stay as they are, but nobody can be granted this leave type again."
        detail={confirmType ? [["Code", confirmType.code]] : undefined}
        confirmLabel="Delete leave type"
        busy={deleteTypeMutation.isPending}
        onConfirm={() => {
          if (confirmType) deleteTypeMutation.mutate(confirmType.id);
          setConfirmType(null);
        }}
        onCancel={() => setConfirmType(null)}
      />

      <ConfirmDialog
        open={confirmHoliday !== null}
        title={confirmHoliday ? `Delete ${confirmHoliday.name}?` : ""}
        description="The holiday is removed from the company calendar."
        detail={confirmHoliday ? [["Date", confirmHoliday.holidayDate]] : undefined}
        confirmLabel="Delete holiday"
        busy={deleteHolidayMutation.isPending}
        onConfirm={() => {
          if (confirmHoliday) deleteHolidayMutation.mutate(confirmHoliday.id);
          setConfirmHoliday(null);
        }}
        onCancel={() => setConfirmHoliday(null)}
      />
    </div>
  );
}

function CreateTypeDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const { register, handleSubmit } = useForm();
  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      await api.post("/leave/types", data);
    },
    onSuccess: () => {
      toast.success("Leave type created");
      queryClient.invalidateQueries({ queryKey: ["leave-types"] });
      onClose();
    },
    onError: (err) => toast.error(apiMessage(err, "Failed to create leave type"))
  });

  return (
    <Dialog open onClose={onClose}>
      <DialogHeader title="Add Leave Type" />
      <form onSubmit={handleSubmit((d) => createMutation.mutate(d))} className="space-y-4 mt-2">
        <div>
          <Label htmlFor="name">Name</Label>
          <Input id="name" {...register("name", { required: true })} placeholder="e.g. Casual Leave" />
        </div>
        <div>
          <Label htmlFor="code">Code</Label>
          <Input id="code" {...register("code", { required: true })} placeholder="e.g. CL" />
        </div>
        <div>
          <Label htmlFor="maxDaysPerYear">Max Days Per Year</Label>
          <Input id="maxDaysPerYear" type="number" {...register("maxDaysPerYear")} placeholder="e.g. 12 (leave blank for unlimited)" />
        </div>
        <div className="flex items-center gap-2">
          <input type="checkbox" id="paid" {...register("paid")} defaultChecked className="h-4 w-4 rounded border-gray-300 accent-primary" />
          <Label htmlFor="paid">Paid Leave</Label>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={createMutation.isPending}>Save</Button>
        </div>
      </form>
    </Dialog>
  );
}

function EditTypeDialog({ type, onClose }: { type: LeaveType; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { register, handleSubmit } = useForm({
    /*
      Every setting the type actually has, not the four this form used to show.

      The other seven were still stored and still enforced -- monthlyLimit is
      what the three-month rule reads -- but there was no way to see or change
      them from here. A policy you cannot read is a policy nobody can
      maintain.
    */
    defaultValues: {
      name: type.name,
      code: type.code,
      maxDaysPerYear: type.maxDaysPerYear ?? "",
      monthlyLimit: type.monthlyLimit ?? "",
      minNoticeDays: type.minNoticeDays ?? "",
      accrualType: type.accrualType ?? "ANNUAL",
      genderRestriction: type.genderRestriction ?? "",
      carryForward: type.carryForward ?? false,
      encashable: type.encashable ?? false,
      allowPastDates: type.allowPastDates ?? false,
      paid: type.paid ?? false,
      active: type.active ?? true
    }
  });

  const editMutation = useMutation({
    mutationFn: async (data: any) => {
      /*
        Numbers arrive from the form as strings, and an empty field as "".

        Sent as they are, "" became null on the server and cleared the
        setting, which is right for a field somebody emptied on purpose and
        wrong for nothing else. Converted here so a number is a number and a
        cleared field is an explicit null.
      */
      const num = (v: any) =>
        v === "" || v === null || v === undefined ? null : Number(v);
      await api.put(`/leave/types/${type.id}`, {
        ...data,
        maxDaysPerYear: num(data.maxDaysPerYear),
        minNoticeDays: num(data.minNoticeDays),
        monthlyLimit: num(data.monthlyLimit),
        // "" is the "no restriction" option in the select, and the server
        // reads a blank string as exactly that.
        genderRestriction: data.genderRestriction ?? ""
      });
    },
    onSuccess: () => {
      toast.success("Leave type updated");
      queryClient.invalidateQueries({ queryKey: ["leave-types"] });
      onClose();
    },
    onError: (err) => toast.error(apiMessage(err, "Failed to update leave type"))
  });

  return (
    <Dialog open onClose={onClose}>
      <DialogHeader title={`Edit ${type.name}`} />
      <form onSubmit={handleSubmit((d) => editMutation.mutate(d))} className="space-y-4 mt-2">
        <div>
          <Label htmlFor="name">Name</Label>
          <Input id="name" {...register("name", { required: true })} />
        </div>
        <div>
          <Label htmlFor="code">Code</Label>
          <Input id="code" {...register("code", { required: true })} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="maxDaysPerYear">Max days per year</Label>
            <Input id="maxDaysPerYear" type="number" min={0} {...register("maxDaysPerYear")} />
            <p className="mt-1 text-[11px] text-muted-foreground">Blank means no yearly cap.</p>
          </div>
          <div>
            <Label htmlFor="monthlyLimit">Allowed per 3 months</Label>
            <Input id="monthlyLimit" type="number" min={0} {...register("monthlyLimit")} />
            {/* Naming what this actually governs. It is read by the quarterly
                cap, and "monthly limit" was a name from an earlier rule. */}
            <p className="mt-1 text-[11px] text-muted-foreground">
              1 means one every three months. Blank means no such limit.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="minNoticeDays">Minimum notice (days)</Label>
            <Input id="minNoticeDays" type="number" min={0} {...register("minNoticeDays")} />
          </div>
          <div>
            <Label htmlFor="accrualType">Accrual</Label>
            <Select id="accrualType" {...register("accrualType")}>
              <option value="ANNUAL">Annual — the whole allowance at once</option>
              <option value="MONTHLY">Monthly — accrues through the year</option>
              <option value="QUARTERLY">Quarterly</option>
              <option value="NONE">None — no allocation</option>
            </Select>
          </div>
        </div>

        <div>
          <Label htmlFor="genderRestriction">Who can apply</Label>
          <Select id="genderRestriction" {...register("genderRestriction")}>
            <option value="">Everyone</option>
            <option value="F">Female employees only</option>
            <option value="M">Male employees only</option>
          </Select>
        </div>

        <div className="space-y-2 rounded-[10px] border border-border p-3">
          <CheckboxRow id="paid" label="Paid leave" hint="Unpaid types are treated as loss of pay." register={register} />
          <CheckboxRow id="carryForward" label="Carry forward" hint="Unused days roll into next year." register={register} />
          <CheckboxRow id="encashable" label="Encashable" hint="Unused days can be paid out." register={register} />
          <CheckboxRow id="allowPastDates" label="Allow past dates" hint="For sick leave, applied after the fact." register={register} />
          {/* The other half of deleting: a type switched off can be switched
              back on from the same form that switched it off. */}
          <CheckboxRow id="active" label="Active" hint="Switch off to stop offering this type. Leave already taken is kept." register={register} />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={editMutation.isPending}>Save</Button>
        </div>
      </form>
    </Dialog>
  );
}

function CreateHolidayDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  /*
    The field is holidayDate, not date.

    This form posted the raw object it collected -- { date, name, type } -- and
    the server's HolidayRequest asks for { name, holidayDate }. Jackson ignored
    the unknown "date", holidayDate arrived null, @NotNull rejected it, and the
    toast said "Validation failed" without saying which field: HR could not add
    a holiday at all, and nothing on screen pointed at the cause.

    Named to match the DTO rather than mapped in the mutation, so the form and
    the contract are one thing and the next field added cannot drift the same
    way.
  */
  const { register, handleSubmit } = useForm({
    defaultValues: { holidayDate: todayIso(), name: "", state: "National" }
  });

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      await api.post("/org/holidays", data);
    },
    onSuccess: () => {
      toast.success("Holiday added");
      queryClient.invalidateQueries({ queryKey: ["holidays"] });
      onClose();
    },
    onError: (err) => toast.error(apiMessage(err, "Failed to add holiday"))
  });

  return (
    <Dialog open onClose={onClose}>
      <DialogHeader title="Add Holiday" />
      <form onSubmit={handleSubmit((d) => createMutation.mutate(d))} className="space-y-4 mt-2">
        <div>
          <Label htmlFor="holidayDate">Date</Label>
          <Input id="holidayDate" type="date" min={DATE_MIN} max={DATE_MAX}
                 {...register("holidayDate", { required: true })} />
        </div>
        <div>
          <Label htmlFor="name">Holiday Name</Label>
          <Input id="name" {...register("name", { required: true })} placeholder="e.g. Gandhi Jayanti" />
        </div>
        <div>
          {/* The column behind this is `state` -- it distinguishes a national
              holiday from one observed in a single state. It was posted as
              "type", which no DTO field matched, so whatever HR typed here was
              silently dropped and every holiday saved without it. */}
          <Label htmlFor="state">Type</Label>
          <Input id="state" {...register("state")} placeholder="e.g. National, Optional" />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={createMutation.isPending}>Save</Button>
        </div>
      </form>
    </Dialog>
  );
}

/**
 * One policy switch, with the sentence that says what it does.
 *
 * <p>"Carry forward" and "Encashable" mean nothing to somebody who has not
 * met them before, and this form is where a leave policy is decided -- so the
 * explanation belongs beside the box rather than in a manual.
 */
function CheckboxRow({
  id, label, hint, register
}: {
  id: string;
  label: string;
  hint: string;
  register: any;
}) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-start gap-2.5">
      <input
        type="checkbox"
        id={id}
        {...register(id)}
        className="mt-0.5 h-4 w-4 shrink-0 rounded border-input accent-primary"
      />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-foreground">{label}</span>
        <span className="block text-[11px] text-muted-foreground">{hint}</span>
      </span>
    </label>
  );
}
