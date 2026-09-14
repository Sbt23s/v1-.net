import { PixousLoader } from "@/components/ui/pixous-loader";
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, ChevronRight, ChevronDown, CheckCircle2, Users2, X, Star } from "lucide-react";
import toast from "react-hot-toast";
import { api, apiMessage } from "@/lib/api";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { PageLoader } from "@/components/ui/page-loader";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogHeader } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { usePagedRows, TablePagination } from "@/components/ui/table-pagination";
import type { ApiEnvelope, PageEnvelope, UserSummary, AttendanceRecord } from "@/types";
import { MonthlySummaryCard } from "@/components/MonthlySummaryCard";
import { Users as UsersIcon, UserCheck, UserX, Layers } from "lucide-react";

/** A Team Leader covering a team other than the one their designation names. */
type ExtraLead = {
  id: number;
  userId: number;
  name: string | null;
  code: string | null;
  ownTeam: string | null;
  teamTitle: string;
};

const NO_DESIGNATION = "No designation";
const norm = (s?: string | null) => (s ?? "").trim().toLowerCase();

export default function TeamsPage() {
  const qc = useQueryClient();
  // Which team the "assign a Team Leader" dialog is open for, if any.
  const [assignTo, setAssignTo] = useState<string | null>(null);
  const { hasPermission } = useAuth();
  // HR runs the team structure alongside admins — adding and deleting teams,
  // setting a team lead and moving people between teams.
  const canManage = hasPermission("USER_MANAGE", "TEAM_MANAGE");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [addTo, setAddTo] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  /*
    The team the delete confirmation is asking about, or null when closed.

    Held with its member count rather than looked up again when the dialog
    renders: what the person clicked is what the dialog should describe, even
    if the roster refetches underneath it a moment later.
  */
  const [confirmDelete, setConfirmDelete] = useState<{ label: string; members: number } | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const designations = useQuery({
    queryKey: ["org-designations-all"],
    queryFn: async () =>
      (await api.post<ApiEnvelope<Record<string, { id: number; label: string }[]>>>("/org/dropdowns", ["designation"]))
        .data.data.designation ?? []
  });

  /*
    Whether this account may read the whole staff directory.

    Both endpoints below are restricted to people who manage others. An
    ordinary employee has none of those permissions, so the page asked for
    the directory, got a 403 and showed an error -- Teams was simply broken
    for the largest group of people in the company, while working perfectly
    for everyone who could have reported it.

    A leader, HR or an administrator still gets every team. An employee gets
    their own, from endpoints that need no permission and return the same
    shapes, so everything downstream is unchanged.
  */
  const seesEveryone = hasPermission("USER_MANAGE", "TEAM_MANAGE", "ATTENDANCE_TEAM", "DASHBOARD_EXEC");

  const employees = useQuery({
    queryKey: ["teams-employees", seesEveryone],
    queryFn: async () => {
      if (seesEveryone) {
        return (await api.get<ApiEnvelope<PageEnvelope<UserSummary>>>(
          "/users?status=ACTIVE&size=1000")).data.data.content;
      }
      return (await api.get<ApiEnvelope<{ teamName: string; members: UserSummary[] }>>(
        "/users/my-team")).data.data.members ?? [];
    }
  });

  // Today's attendance, reduced to "who is in" — the only thing the page asks
  // of it. The two sources describe that differently, so each is converted
  // here rather than leaving the difference for the summary below to handle.
  const attendance = useQuery({
    queryKey: ["teams-attendance-today", seesEveryone],
    queryFn: async (): Promise<number[]> => {
      if (seesEveryone) {
        const rows = (await api.get<ApiEnvelope<AttendanceRecord[]>>(
          "/attendance/team")).data.data ?? [];
        return rows.filter((a) => a.status === "PRESENT").map((a) => a.userId);
      }
      const rows = (await api.get<ApiEnvelope<{ userId: number; punchedIn: boolean }[]>>(
        "/attendance/my-team-today")).data.data ?? [];
      return rows.filter((r) => r.punchedIn).map((r) => r.userId);
    }
  });

  // Move an employee out of their team by clearing their designation title.
  const removeFromTeam = useMutation({
    mutationFn: async (userId: number) => api.put(`/users/${userId}`, { designationTitle: "" }),
    onSuccess: () => {
      toast.success("Removed from team");
      qc.invalidateQueries({ queryKey: ["teams-employees"] });
    },
    onError: (e) => toast.error(apiMessage(e, "Could not remove from team"))
  });

  // Delete a whole team (designation): detaches members, removes the team.
  const deleteTeam = useMutation({
    mutationFn: async (label: string) =>
      api.delete(`/org/designations?name=${encodeURIComponent(label)}`),
    onSuccess: () => {
      toast.success("Team deleted");
      qc.invalidateQueries({ queryKey: ["org-designations-all"] });
      qc.invalidateQueries({ queryKey: ["teams-employees"] });
    },
    onError: (e) => toast.error(apiMessage(e, "Could not delete team"))
  });

  /*
   * Team Leaders who cover a team other than their own designation.
   *
   * A team here is a designation, so a leader normally leads exactly the team
   * whose designation they carry. That leaves a team with members but no
   * leader of its own -- QA Testing -- with nobody to approve its requests.
   * These rows are the extra teams a leader has been given.
   */
  const extraLeads = useQuery({
    queryKey: ["team-leader-extra"],
    queryFn: async () => {
      const res = await api.get<ApiEnvelope<ExtraLead[]>>("/team-leaders");
      return res.data.data ?? [];
    },
    staleTime: 30_000
  });

  /** Assign a Team Leader to another team, or take one back off them. */
  const assignTeam = useMutation({
    mutationFn: async ({ userId, teamTitle }: { userId: number; teamTitle: string }) =>
      api.post(`/team-leaders/${userId}/teams`, { teamTitle }),
    onSuccess: (r: any) => {
      toast.success(r?.data?.message ?? "Team Leader assigned");
      qc.invalidateQueries({ queryKey: ["team-leader-extra"] });
      setAssignTo(null);
    },
    onError: (e) => toast.error(apiMessage(e, "Could not assign the Team Leader"))
  });

  const unassignTeam = useMutation({
    mutationFn: async ({ userId, teamTitle }: { userId: number; teamTitle: string }) =>
      api.delete(`/team-leaders/${userId}/teams?teamTitle=${encodeURIComponent(teamTitle)}`),
    onSuccess: () => {
      toast.success("Removed");
      qc.invalidateQueries({ queryKey: ["team-leader-extra"] });
    },
    onError: (e) => toast.error(apiMessage(e, "Could not remove the assignment"))
  });

  // Make / unset an employee as this team's Team Leader (IT_TL role).
  const setLead = useMutation({
    mutationFn: async ({ userId, lead }: { userId: number; lead: boolean }) =>
      api.put(`/users/${userId}`, { roles: [lead ? "IT_TL" : "IT_EMP"] }),
    onSuccess: (_r, v) => {
      toast.success(v.lead ? "Set as Team Leader" : "Removed Team Leader");
      qc.invalidateQueries({ queryKey: ["teams-employees"] });
    },
    onError: (e) => toast.error(apiMessage(e, "Could not update team leader"))
  });

  // Teams are grouped by the employee's designation TITLE (the field every
  // employee actually carries). Seeded designations are shown even when empty,
  // and any title without a matching designation gets its own group.
  const groups = useMemo(() => {
    type Group = { label: string; members: UserSummary[]; assignable: boolean };
    const byLabel = new Map<string, Group>();
    const order: Group[] = [];
    const ensure = (label: string, assignable: boolean) => {
      const key = norm(label);
      let g = byLabel.get(key);
      if (!g) { g = { label, members: [], assignable }; byLabel.set(key, g); order.push(g); }
      return g;
    };
    for (const d of designations.data ?? []) ensure(d.label, true);
    for (const e of employees.data ?? []) {
      const title = (e.designationTitle || "").trim();
      ensure(title || NO_DESIGNATION, !!title).members.push(e);
    }
    return order;
  }, [designations.data, employees.data]);

  /** The organisation's team picture: sizes, leads, and who is in today. */
  const teamSummary = useMemo(() => {
    const people = employees.data ?? [];
    const assignable = groups.filter((d) => d.assignable);
    const present = new Set(attendance.data ?? []);

    const sized = assignable
      .map((d) => ({ label: d.label, size: d.members.length }))
      .sort((a, b) => b.size - a.size);
    // A team has a leader if one of its own members holds IT_TL, or if a
    // leader from elsewhere has been assigned to cover it. Counting only the
    // first would keep reporting QA Testing as leaderless after somebody had
    // been put in charge of it.
    const assignedTo = (label: string) =>
      (extraLeads.data ?? []).filter(
        (x) => (x.teamTitle || "").trim().toLowerCase() === label.trim().toLowerCase());
    const leadsIn = (d: typeof assignable[number]) =>
      d.members.filter((m) => (m.roles ?? []).includes("IT_TL"));
    const hasLead = (d: typeof assignable[number]) =>
      leadsIn(d).length > 0 || assignedTo(d.label).length > 0;
    const withoutLead = assignable.filter((d) => !hasLead(d));
    const empty = assignable.filter((d) => d.members.length === 0);
    const inTeams = people.filter((p) => (p.designationTitle || "").trim()).length;

    return {
      teams: assignable.length,
      employees: people.length,
      inTeams,
      unassigned: people.length - inTeams,
      leads: assignable.reduce(
        (n, d) => n + leadsIn(d).length + assignedTo(d.label).length, 0),
      present: people.filter((p) => present.has(p.id)).length,
      absent: people.filter((p) => !present.has(p.id)).length,
      avg: assignable.length ? Math.round((inTeams / assignable.length) * 10) / 10 : 0,
      biggest: sized[0],
      withoutLead: withoutLead.map((d) => d.label),
      empty: empty.map((d) => d.label)
    };
  }, [groups, employees.data, attendance.data, extraLeads.data]);

  const summaryText = useMemo(() => {
    const t = teamSummary;
    const gaps: string[] = [];
    if (t.withoutLead.length) gaps.push(`${t.withoutLead.length} without a team lead (${t.withoutLead.slice(0, 3).join(", ")})`);
    if (t.empty.length) gaps.push(`${t.empty.length} with no members (${t.empty.slice(0, 3).join(", ")})`);
    if (t.unassigned > 0) gaps.push(`${t.unassigned} employee${t.unassigned === 1 ? "" : "s"} not in any team`);

    const gapsTa: string[] = [];
    if (t.withoutLead.length) gapsTa.push(`${t.withoutLead.length} குழுவிற்கு தலைவர் இல்லை`);
    if (t.empty.length) gapsTa.push(`${t.empty.length} குழுவில் உறுப்பினர்கள் இல்லை`);
    if (t.unassigned > 0) gapsTa.push(`${t.unassigned} ஊழியர் எந்த குழுவிலும் இல்லை`);

    return {
      shortEn: `${t.teams} team${t.teams === 1 ? "" : "s"} · ${t.employees} employees · `
        + `${t.leads} team lead${t.leads === 1 ? "" : "s"} · ${t.present} in today, ${t.absent} not.`,
      shortTa: `${t.teams} குழுக்கள் · ${t.employees} ஊழியர்கள் · ${t.leads} குழு தலைவர்கள் · `
        + `இன்று ${t.present} வந்தனர், ${t.absent} வரவில்லை.`,
      spokenEn: `Here is the team summary. There are ${t.teams} team`
        + `${t.teams === 1 ? "" : "s"} holding ${t.inTeams} of ${t.employees} employees, `
        + `an average of ${t.avg} per team, led by ${t.leads} team lead${t.leads === 1 ? "" : "s"}. `
        + (t.biggest ? `The largest is ${t.biggest.label} with ${t.biggest.size} members. ` : "")
        + `Today ${t.present} are present and ${t.absent} are not. `
        + (gaps.length ? `Needs attention: ${gaps.join("; ")}.` : "Every team has a lead and members."),
      spokenTa: `இது குழு சுருக்கம். ${t.teams} குழுக்கள் உள்ளன, ${t.employees} ஊழியர்களில் `
        + `${t.inTeams} பேர் குழுக்களில், சராசரி ${t.avg} ஒரு குழுவிற்கு, `
        + `${t.leads} குழு தலைவர்கள். `
        + (t.biggest ? `மிகப்பெரிய குழு ${t.biggest.label}, ${t.biggest.size} உறுப்பினர்கள். ` : "")
        + `இன்று ${t.present} பேர் வந்துள்ளனர், ${t.absent} பேர் வரவில்லை. `
        + (gapsTa.length ? `கவனிக்க: ${gapsTa.join("; ")}.` : "அனைத்து குழுக்களுக்கும் தலைவர் மற்றும் உறுப்பினர்கள் உள்ளனர்.")
    };
  }, [teamSummary]);

  const loading = designations.isLoading || employees.isLoading;
  const q = search.trim().toLowerCase();
  const list = groups.filter((d) => !q || d.label.toLowerCase().includes(q));
  // Paged with the numbers and rows-per-page, like every other listing.
  const listPaged = usePagedRows(list, 10, [search, groups.length]);

  return (
    <div>
      <PageHeader
        title="Teams"
        subtitle="Company designations and the employees in each. Use “Add” to place an employee into a designation."
        actions={
          <div className="flex w-full items-center gap-2">
            <Input
              placeholder="Search designation…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full sm:w-64"
            />
            {canManage && (
              <Button onClick={() => setCreateOpen(true)} className="shrink-0">
                <Plus className="mr-1 h-4 w-4" /> Add Team
              </Button>
            )}
          </div>
        }
      />

      <div className="mb-4">
        <MonthlySummaryCard
          title="AI Team Summary"
          monthLabel={`${teamSummary.teams} teams · ${teamSummary.employees} employees`}
          shortEn={summaryText.shortEn}
          shortTa={summaryText.shortTa}
          spokenEn={summaryText.spokenEn}
          spokenTa={summaryText.spokenTa}
          stats={[
            { icon: Layers, value: teamSummary.teams, label: "Total teams",
              tone: "bg-green-100 text-green-600 dark:bg-green-500/20" },
            { icon: UsersIcon, value: teamSummary.employees, label: "Total employees",
              tone: "bg-sky-100 text-sky-600 dark:bg-sky-500/20" },
            { icon: UserCheck, value: teamSummary.present, label: "Present today",
              tone: "bg-emerald-100 text-emerald-600 dark:bg-emerald-500/20" },
            { icon: UserX, value: teamSummary.absent, label: "Absent today",
              tone: "bg-rose-100 text-rose-600 dark:bg-rose-500/20" }
          ]}
        />
      </div>

      {loading ? (
        <PageLoader text="Loading team and employee details..." />
      ) : list.length === 0 ? (
        <EmptyState icon={Users2} title="No designations" description="Designations will appear here once set up." />
      ) : (
        <div className="space-y-2">
          {listPaged.pageRows.map((d) => {
            const members = d.members;
            const open = expanded === d.label;
            return (
              <div key={d.label} className="rounded-lg border bg-card">
                <div className="flex items-center gap-2 p-3">
                  <button className="flex flex-1 items-center gap-2 text-left" onClick={() => setExpanded(open ? null : d.label)}>
                    {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                    <span className="font-medium">{d.label}</span>
                    <Badge variant="secondary">{members.length}</Badge>
                    {/* A Team Leader from another team who covers this one.
                        Shown beside the name so it is obvious at a glance who
                        this team's requests actually go to. */}
                    {(extraLeads.data ?? [])
                      .filter((x) => norm(x.teamTitle) === norm(d.label))
                      .map((x) => (
                        <Badge
                          key={x.id}
                          variant="outline"
                          className="gap-1 border-amber-300 text-amber-700 dark:text-amber-400"
                          title={`${x.name} leads this team as well as ${x.ownTeam}`}
                        >
                          <Star className="h-3 w-3 fill-current" /> {x.name}
                        </Badge>
                      ))}
                  </button>
                  {d.assignable && canManage && d.label !== NO_DESIGNATION && (
                    <Button size="sm" variant="outline" onClick={() => setAssignTo(d.label)}>
                      <Star className="h-4 w-4" /> Team Leader
                    </Button>
                  )}
                  {d.assignable && canManage && (
                    <Button size="sm" variant="outline" onClick={() => setAddTo(d.label)}>
                      <Plus className="h-4 w-4" /> Add
                    </Button>
                  )}
                  {canManage && d.label !== NO_DESIGNATION && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-destructive hover:bg-destructive/10"
                      disabled={deleteTeam.isPending}
                      onClick={() => setConfirmDelete({ label: d.label, members: members.length })}
                    >
                      <X className="h-4 w-4" /> Delete
                    </Button>
                  )}
                </div>
                {open && (
                  <div className="divide-y border-t">
                    {members.length === 0 ? (
                      <p className="p-4 text-sm text-muted-foreground">No employees in this team yet.</p>
                    ) : (
                      <div className="w-full min-w-0 overflow-x-auto">
                        {/* A floor width, so columns keep a sensible size and the
                            scroller takes the overflow rather than the columns
                            being squeezed to nothing. */}
                        <table className="data-table min-w-[62rem] table-fixed">
                          <colgroup>
                            <col className="w-12" />
                            {d.assignable && canManage && <col className="w-40" />}
                            <col className="w-56" />
                            <col className="w-28" />
                            <col className="w-56" />
                            <col className="w-32" />
                            <col className="w-52" />
                            {d.assignable && canManage && <col className="w-32" />}
                          </colgroup>
                          <thead>
                            <tr className="border-b text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                              <th className="whitespace-nowrap font-medium">#</th>
                              {d.assignable && canManage && <th className="whitespace-nowrap font-medium">Action</th>}
                              <th className="whitespace-nowrap font-medium">Employee</th>
                              <th className="whitespace-nowrap font-medium">Emp ID</th>
                              <th className="whitespace-nowrap font-medium">Email</th>
                              <th className="whitespace-nowrap font-medium">Contact</th>
                              <th className="whitespace-nowrap font-medium">Tech Stack</th>
                              {d.assignable && canManage && <th className="whitespace-nowrap font-medium">Team Lead</th>}
                            </tr>
                          </thead>
                          <tbody>
                            {members.map((m, i) => (
                              <tr key={m.id} className="border-b last:border-0 hover:bg-muted/40">
                                <td className="align-middle text-muted-foreground">{i + 1}</td>
                                {d.assignable && canManage && (
                                  <td className="text-right align-middle">
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-7 px-2 text-xs text-destructive hover:bg-destructive/10"
                                      disabled={removeFromTeam.isPending}
                                      onClick={() => {
                                        if (confirm(`Remove ${m.name} from ${d.label}?`)) {
                                          removeFromTeam.mutate(m.id);
                                        }
                                      }}
                                    >
                                      <X className="mr-1 h-3.5 w-3.5" /> Remove
                                    </Button>
                                  </td>
                                )}
                                <td className="align-middle">
                                  <div className="flex min-w-0 items-center gap-2">
                                    <Avatar name={m.name} />
                                    <span className="truncate font-medium" title={m.name}>{m.name}</span>
                                  </div>
                                </td>
                                <td className="align-middle code-chip text-xs text-muted-foreground">{m.employeeCode}</td>
                                <td className="max-w-0 align-middle text-xs">
                                  {m.email ? (
                                    <a
                                      href={`mailto:${m.email}`}
                                      title={m.email}
                                      className="block truncate text-primary hover:underline"
                                    >
                                      {m.email}
                                    </a>
                                  ) : <span className="text-muted-foreground">—</span>}
                                </td>
                                <td className="align-middle whitespace-nowrap text-xs">
                                  {m.phone ? (
                                    <a href={`tel:${m.phone}`} className="text-primary hover:underline">{m.phone}</a>
                                  ) : <span className="text-muted-foreground">—</span>}
                                </td>
                                <td className="align-middle">
                                  <TechStackCell
                                    member={m}
                                    editable={canManage}
                                    onSaved={() => qc.invalidateQueries({ queryKey: ["teams-employees"] })}
                                  />
                                </td>
                                {d.assignable && canManage && (
                                  <td className="align-middle">
                                    {(m.roles ?? []).includes("IT_TL") ? (
                                      <button
                                        type="button"
                                        disabled={setLead.isPending}
                                        onClick={() => setLead.mutate({ userId: m.id, lead: false })}
                                        className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 hover:bg-amber-200 dark:bg-amber-900/30 dark:text-amber-400"
                                        title="Click to remove as Team Leader"
                                      >
                                        <Star className="h-3.5 w-3.5 fill-current" /> Team Leader
                                      </button>
                                    ) : (
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        className="h-7 px-2 text-xs"
                                        disabled={setLead.isPending}
                                        onClick={() => setLead.mutate({ userId: m.id, lead: true })}
                                      >
                                        <Star className="mr-1 h-3.5 w-3.5" /> Make TL
                                      </Button>
                                    )}
                                  </td>
                                )}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {list.length > 0 && (
            <div className="overflow-hidden rounded-lg border">
              <TablePagination
                page={listPaged.page} totalPages={listPaged.totalPages} onChange={listPaged.setPage}
                pageSize={listPaged.pageSize} onPageSizeChange={listPaged.setPageSize}
                total={listPaged.total}
                always
              />
            </div>
          )}
        </div>
      )}

      {addTo && (
        <AddToDesignationDialog
          label={addTo}
          employees={employees.data ?? []}
          onClose={() => setAddTo(null)}
          onAdded={() => qc.invalidateQueries({ queryKey: ["teams-employees"] })}
        />
      )}

      {createOpen && (
        <CreateTeamDialog
          onClose={() => setCreateOpen(false)}
          onCreated={() => qc.invalidateQueries({ queryKey: ["org-designations-all"] })}
        />
      )}

      {assignTo && (
        <AssignLeaderDialog
          team={assignTo}
          leaders={(employees.data ?? []).filter((e) => (e.roles ?? []).includes("IT_TL"))}
          assigned={(extraLeads.data ?? []).filter((x) => norm(x.teamTitle) === norm(assignTo))}
          busy={assignTeam.isPending || unassignTeam.isPending}
          onAssign={(userId) => assignTeam.mutate({ userId, teamTitle: assignTo })}
          onRemove={(userId) => unassignTeam.mutate({ userId, teamTitle: assignTo })}
          onClose={() => setAssignTo(null)}
        />
      )}

      {/*
        Deleting a team moves everybody in it to "No designation", which is a
        larger thing than the word Delete suggests -- so it is asked in the
        application's own dialog with the count in front of the person, the way
        leave, work from home and claims ask.
      */}
      <ConfirmDialog
        open={!!confirmDelete}
        title={confirmDelete ? `Delete the "${confirmDelete.label}" team?` : ""}
        description={confirmDelete && confirmDelete.members > 0
          ? `The ${confirmDelete.members} ${confirmDelete.members === 1 ? "person" : "people"} in it move to "No designation" — nobody is removed from the company. This cannot be undone.`
          : "This cannot be undone."}
        detail={confirmDelete ? [
          ["Team", confirmDelete.label],
          ["Members", String(confirmDelete.members)],
        ] : undefined}
        confirmLabel="Yes, delete it"
        cancelLabel="No, keep it"
        busy={deleteTeam.isPending}
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => {
          const label = confirmDelete?.label;
          setConfirmDelete(null);
          if (label) deleteTeam.mutate(label);
        }}
      />
    </div>
  );
}

// Structured technical-skills headings the admin fills in per employee.
const SKILL_CATEGORIES = [
  "Programming Languages",
  "AI / ML Frameworks & Libraries",
  "Backend Technologies",
  "Frontend Technologies",
  "Database Technologies",
  "Cloud & DevOps",
  "Integration",
  "Tools & Platforms",
  "Additional Skills",
];

/** Parse the stored "Label: value" lines into a category → value map. */
function parseSkills(raw?: string): Record<string, string> {
  const out: Record<string, string> = {};
  (raw ?? "").split("\n").forEach((line) => {
    const idx = line.indexOf(":");
    if (idx > 0) out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  });
  return out;
}
/** Serialise the category map back to newline-separated "Label: value" lines. */
function serializeSkills(map: Record<string, string>): string {
  return SKILL_CATEGORIES
    .filter((c) => (map[c] || "").trim())
    .map((c) => `${c}: ${map[c].trim()}`)
    .join("\n");
}

function TechStackCell({ member, onSaved, editable = true }: { member: UserSummary; onSaved: () => void; editable?: boolean }) {
  const [open, setOpen] = useState(false);
  const filled = SKILL_CATEGORIES.filter((c) => (parseSkills(member.techStack)[c] || "").trim()).length;

  if (!editable) {
    return (
      <span className="block min-w-[9rem] max-w-[16rem] truncate px-2 py-1 text-xs text-muted-foreground" title={member.techStack || ""}>
        {member.techStack ? `${filled} ${filled === 1 ? "category" : "categories"}` : "—"}
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="min-w-[9rem] max-w-[16rem] truncate rounded px-2 py-1 text-left text-xs hover:bg-muted"
        title={member.techStack || "Add technical skills"}
      >
        {member.techStack
          ? <span>{filled} {filled === 1 ? "category" : "categories"} · edit</span>
          : <span className="italic text-muted-foreground">Add skills…</span>}
      </button>
      {open && <SkillsDialog member={member} onClose={() => setOpen(false)} onSaved={onSaved} />}
    </>
  );
}

function SkillsDialog({ member, onClose, onSaved }: { member: UserSummary; onClose: () => void; onSaved: () => void }) {
  const [map, setMap] = useState<Record<string, string>>(() => parseSkills(member.techStack));

  const save = useMutation({
    mutationFn: async () => api.put(`/users/${member.id}`, { techStack: serializeSkills(map) }),
    onSuccess: () => { toast.success("Technical skills saved"); onSaved(); onClose(); },
    onError: (e) => toast.error(apiMessage(e, "Could not save skills"))
  });

  return (
    <Dialog open onClose={onClose} className="max-w-lg">
      <DialogHeader title={`Technical Skills — ${member.name}`} description="Fill in the skills for each area. Leave blank to skip." />
      <div className="mt-3 max-h-[60vh] space-y-3 overflow-y-auto pr-1">
        {SKILL_CATEGORIES.map((cat) => (
          <div key={cat}>
            <label className="mb-1 block text-xs font-semibold">{cat}</label>
            <Input
              value={map[cat] ?? ""}
              placeholder="e.g. Java, Python, C++"
              onChange={(e) => setMap((m) => ({ ...m, [cat]: e.target.value }))}
              className="h-8 text-sm"
            />
          </div>
        ))}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button disabled={save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? <PixousLoader size="xs" className="mr-2" /> : null}
          Save
        </Button>
      </div>
    </Dialog>
  );
}

/**
 * Put a Team Leader in charge of a team other than their own.
 *
 * A team here is a designation, so a leader normally covers exactly the team
 * whose designation they carry. That leaves a team like QA Testing -- members,
 * but nobody holding that designation as a leader -- with no approver for its
 * leave, permission and work-from-home requests. Assigning a leader here fixes
 * that without moving anybody between teams or changing anyone's designation.
 */
function AssignLeaderDialog({ team, leaders, assigned, busy, onAssign, onRemove, onClose }: {
  team: string;
  leaders: UserSummary[];
  assigned: ExtraLead[];
  busy: boolean;
  onAssign: (userId: number) => void;
  onRemove: (userId: number) => void;
  onClose: () => void;
}) {
  const [chosen, setChosen] = useState<number | null>(null);
  // A leader whose own designation is this team already covers it; offering to
  // assign them again would create a row that changes nothing.
  const own = leaders.filter((l) => norm(l.designationTitle) === norm(team));
  const already = new Set(assigned.map((a) => a.userId));
  const options = leaders.filter((l) => norm(l.designationTitle) !== norm(team) && !already.has(l.id));

  return (
    <Dialog open onClose={onClose} className="max-w-md">
      <DialogHeader
        title={`Team Leader for ${team}`}
        description="Requests from this team go to the leaders listed here."
      />
      <div className="mt-3 space-y-4">
        {own.length > 0 && (
          <div className="text-sm">
            <p className="mb-1 text-xs font-medium text-muted-foreground">Leads this team already</p>
            {own.map((l) => (
              <p key={l.id} className="flex items-center gap-1.5">
                <Star className="h-3.5 w-3.5 fill-current text-amber-500" /> {l.name}
                <span className="text-xs text-muted-foreground">(own team)</span>
              </p>
            ))}
          </div>
        )}

        {assigned.length > 0 && (
          <div className="text-sm">
            <p className="mb-1 text-xs font-medium text-muted-foreground">Also leads this team</p>
            {assigned.map((a) => (
              <p key={a.id} className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5">
                  <Star className="h-3.5 w-3.5 fill-current text-amber-500" /> {a.name}
                  <span className="text-xs text-muted-foreground">from {a.ownTeam}</span>
                </span>
                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-destructive"
                        disabled={busy} onClick={() => onRemove(a.userId)}>
                  Remove
                </Button>
              </p>
            ))}
          </div>
        )}

        {own.length === 0 && assigned.length === 0 && (
          <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-900/20 dark:text-amber-400">
            No Team Leader covers this team yet, so its requests have nowhere
            specific to go. Choose one below.
          </p>
        )}

        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">
            Add a Team Leader from another team
          </label>
          {options.length === 0 ? (
            <p className="text-xs text-muted-foreground">No other Team Leader is available to add.</p>
          ) : (
            <select
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              value={chosen ?? ""}
              onChange={(e) => setChosen(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">Choose a Team Leader…</option>
              {options.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name} — {l.designationTitle || "no team"}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button disabled={!chosen || busy} onClick={() => chosen && onAssign(chosen)}>
            {busy ? <PixousLoader size="xs" className="mr-2" /> : <Star className="mr-2 h-4 w-4" />}
            Assign
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function CreateTeamDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [industry, setIndustry] = useState("IT");

  const create = useMutation({
    mutationFn: async () => api.post("/org/designations", { name: name.trim(), industry }),
    onSuccess: () => {
      toast.success("Team created");
      onCreated();
      onClose();
    },
    onError: (e) => toast.error(apiMessage(e, "Could not create team"))
  });

  return (
    <Dialog open onClose={onClose} className="max-w-md">
      <DialogHeader title="Add a new team" description="Create a new designation employees can be assigned to." />
      <div className="mt-3 space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Team name</label>
          <Input placeholder="e.g. Backend Engineer" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Industry</label>
          <div className="flex gap-2">
            {[["IT", "Digital"], ["CIVIL", "Infra"]].map(([val, lbl]) => (
              <Button
                key={val}
                type="button"
                variant={industry === val ? "default" : "outline"}
                size="sm"
                onClick={() => setIndustry(val)}
              >
                {lbl}
              </Button>
            ))}
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}>
            {create.isPending ? <PixousLoader size="xs" className="mr-2" /> : <Plus className="mr-2 h-4 w-4" />}
            Create
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function AddToDesignationDialog({ label, employees, onClose, onAdded }: {
  label: string;
  employees: UserSummary[];
  onClose: () => void;
  onAdded: () => void;
}) {
  const [empId, setEmpId] = useState<number | null>(null);
  const [search, setSearch] = useState("");

  // An employee belongs to exactly one team. Assigning sets their designation
  // title to this team's name, moving them out of any team they were in.
  const selected = employees.find((e) => e.id === empId);
  const currentTeam = (selected?.designationTitle || "").trim();

  const assign = useMutation({
    mutationFn: async () => api.put(`/users/${empId}`, { designationTitle: label }),
    onSuccess: () => {
      toast.success(`Added to ${label}`);
      onAdded();
      onClose();
    },
    onError: (e) => toast.error(apiMessage(e, "Could not add to designation"))
  });

  const doAssign = () => {
    // Guard: an employee can only be in one team. If they already have one,
    // confirm the move so it isn't done by accident.
    if (currentTeam && norm(currentTeam) !== norm(label)) {
      if (!confirm(`${selected?.name} is already in "${currentTeam}". Move them to "${label}"?`)) return;
    }
    assign.mutate();
  };

  const q = search.trim().toLowerCase();
  const candidates = employees
    .filter((e) => norm(e.designationTitle) !== norm(label))
    .filter((e) => !q || e.name.toLowerCase().includes(q) || (e.employeeCode || "").toLowerCase().includes(q))
    .slice(0, 60);

  return (
    <Dialog open onClose={onClose} className="max-w-md">
      <DialogHeader title={`Add employee to ${label}`} />
      <div className="mt-3 space-y-3">
        <Input placeholder="Search employee…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="max-h-64 divide-y overflow-y-auto rounded-md border">
          {candidates.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">No employees found.</p>
          ) : (
            candidates.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setEmpId(c.id)}
                className={cn("flex w-full items-center gap-2 p-2.5 text-left hover:bg-muted/50", empId === c.id && "bg-primary/10")}
              >
                <Avatar name={c.name} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{c.name}</div>
                  <div className="text-xs text-muted-foreground">{c.employeeCode}</div>
                </div>
                {(c.designationTitle || "").trim()
                  ? <Badge className="shrink-0 border-0 bg-amber-100 text-amber-700 text-[10px] dark:bg-amber-900/30 dark:text-amber-400">In: {c.designationTitle}</Badge>
                  : <span className="shrink-0 text-[10px] text-muted-foreground">No team</span>}
                {empId === c.id && <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />}
              </button>
            ))
          )}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!empId || assign.isPending} onClick={doAssign}>
            {assign.isPending ? <PixousLoader size="xs" className="mr-2" /> : <Plus className="mr-2 h-4 w-4" />}
            {currentTeam && norm(currentTeam) !== norm(label) ? "Move here" : "Add"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
