import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { SlidersHorizontal, Save, RotateCcw } from "lucide-react";
import toast from "react-hot-toast";
import { api, apiMessage } from "@/lib/api";
import { PageHeader } from "@/components/PageHeader";
import { PageLoader } from "@/components/ui/page-loader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { ApiEnvelope } from "@/types";

/**
 * Who each module may address a request to.
 *
 * Every "Request to" / "Send to" dropdown in the portal was assembled by its
 * own service with its own hard-coded idea of the answer, so changing it meant
 * changing Java — and the four lists had drifted apart from each other because
 * nothing held them to a common answer. This screen is that answer.
 *
 * It narrows rather than produces. The services still decide the candidates,
 * because they know things a grid cannot: that a complaint raised by HR goes
 * above HR, that an employee's short leave stays with their own team leader,
 * that nobody appears in their own dropdown. Ticking a role a module never
 * offers changes nothing; unticking one removes it wherever that module asks.
 *
 * A module with nothing ticked is unrestricted, not silent. That is the only
 * way to say "offer whatever you would have offered", and it is what every
 * module does today — so this screen changes nothing until somebody uses it.
 */

type Grid = Record<string, Record<string, boolean>>;

interface VisibilityResponse {
  roles: string[];
  modules: string[];
  config: Grid;
}

interface Candidate {
  id: number;
  name: string;
  code: string;
  roles: string[];
}

interface ConfigResponse {
  modules: string[];
  roles: string[];
  config: Grid;
  /** Who actually holds each role, by name. */
  holders: Record<string, string[]>;
  /** The people named on each module, by id. */
  people: Record<string, number[]>;
  /** Everybody who could be named. */
  candidates: Candidate[];
}

/** What each module code is called on screen. */
const MODULE_LABELS: Record<string, string> = {
  HELPDESK: "Support requests",
  COMPLAINT: "Complaints",
  PERMISSION: "Permission",
  LEAVE: "Leave",
  WFH: "Work from home"
};

/** The Leave Management tabs, as the visibility grid names them. */
const LM_MODULE_LABELS: Record<string, string> = {
  LEAVE: "Leave",
  PERMISSION: "Permission",
  WFH: "Work From Home",
  APPROVALS: "Approvals",
  POLICIES: "Leave Policies"
};

/** What each configurable role is called on screen. */
const SUBJECT_LABELS: Record<string, { label: string; hint: string }> = {
  IT_EMP: { label: "Employee", hint: "Everyone else" },
  IT_TL: { label: "Team Leader", hint: "Leads a team" },
  IT_HR: { label: "HR", hint: "The HR desk" },
  CV_HR: { label: "HR (Civil)", hint: "Civil-side HR" },
  IT_MGR: { label: "HR (Manager)", hint: "The HR account" },
  CTO: { label: "CTO", hint: "The company head" },
  SUPER_ADMIN: { label: "Super Admin", hint: "Platform owner" },
  COMPANY_ADMIN: { label: "Company Admin", hint: "System administrator" }
};

/** What each recipient is called, and a word on who that is. */
const ROLE_LABELS: Record<string, { label: string; hint: string }> = {
  CTO: { label: "CTO", hint: "The company head" },
  SUPER_ADMIN: { label: "Super Admin", hint: "Platform owner" },
  COMPANY_ADMIN: { label: "Company Admin", hint: "System administrator" },
  IT_MGR: { label: "HR (Manager)", hint: "The HR account" },
  IT_HR: { label: "HR", hint: "The HR desk" },
  CV_HR: { label: "HR (Civil)", hint: "Civil-side HR" },
  IT_TL: { label: "Team Leader", hint: "The employee's own TL" }
};

export default function ApprovalConfigPage() {
  const qc = useQueryClient();
  /** Local edits, by module. Absent means "unchanged from the server". */
  const [draft, setDraft] = useState<Grid>({});
  /*
    The second grid, and the role it is showing.

    One role at a time rather than all eight at once: eight roles times five
    modules is forty checkboxes, and an administrator changing what Team
    Leaders see does not want the other seven rows on screen while they do it.
    Held here so switching roles keeps unsaved edits to the others.
  */
  const [subject, setSubject] = useState("IT_EMP");
  /*
    People named on a module, by module. Absent means "unchanged from the
    server", the same convention the role draft uses.

    Separate from the role draft because they are separate controls and save
    separately: a module can allow the HR role and additionally name one
    person, and saving either must not clear the other.
  */
  const [peopleDraft, setPeopleDraft] = useState<Record<string, number[]>>({});
  const [visDraft, setVisDraft] = useState<Grid>({});

  const query = useQuery({
    queryKey: ["approval-config"],
    queryFn: async () =>
      (await api.get<ApiEnvelope<ConfigResponse>>("/admin/approval-config")).data.data
  });

  const visQuery = useQuery({
    queryKey: ["approval-config", "visibility"],
    queryFn: async () =>
      (await api.get<ApiEnvelope<VisibilityResponse>>(
        "/admin/approval-config/visibility")).data.data
  });

  const saveVisibility = useMutation({
    mutationFn: async ({ role, modules }: { role: string; modules: string[] }) =>
      api.put(`/admin/approval-config/visibility/${role}`, { modules }),
    onSuccess: (_res, v) => {
      toast.success(`${SUBJECT_LABELS[v.role]?.label ?? v.role} updated`);
      setVisDraft((d) => {
        const next = { ...d };
        delete next[v.role];
        return next;
      });
      /*
        Both keys, because the tabs a person sees are derived from this and
        every open page holds its own copy. Invalidating the prefix reaches the
        admin grid and the per-user list a Leave Management page is reading, so
        the change lands on other screens without a reload.
      */
      qc.invalidateQueries({ queryKey: ["approval-config"] });
      qc.invalidateQueries({ queryKey: ["leave-modules"] });
    },
    onError: (e) => toast.error(apiMessage(e, "Could not save that configuration"))
  });

  const savePeople = useMutation({
    mutationFn: async ({ module, users }: { module: string; users: number[] }) =>
      api.put(`/admin/approval-config/${module}/people`, { users }),
    onSuccess: (_res, v) => {
      toast.success(`${MODULE_LABELS[v.module] ?? v.module} recipients updated`);
      setPeopleDraft((d) => {
        const next = { ...d };
        delete next[v.module];
        return next;
      });
      qc.invalidateQueries({ queryKey: ["approval-config"] });
    },
    onError: (e) => toast.error(apiMessage(e, "Could not save those recipients"))
  });

  const save = useMutation({
    mutationFn: async ({ module, roles }: { module: string; roles: string[] }) =>
      api.put(`/admin/approval-config/${module}`, { roles }),
    onSuccess: (_res, v) => {
      toast.success(`${MODULE_LABELS[v.module] ?? v.module} updated`);
      setDraft((d) => {
        const next = { ...d };
        delete next[v.module];
        return next;
      });
      qc.invalidateQueries({ queryKey: ["approval-config"] });
    },
    onError: (e) => toast.error(apiMessage(e, "Could not save that configuration"))
  });

  if (query.isLoading) return <PageLoader />;

  const data = query.data;
  if (!data) return null;

  /** The current state of one module's ticks: the draft if edited, else saved. */
  const rowOf = (module: string): Record<string, boolean> =>
    draft[module] ?? data.config[module] ?? {};

  const toggle = (module: string, role: string) => {
    const current = rowOf(module);
    setDraft((d) => ({ ...d, [module]: { ...current, [role]: !current[role] } }));
  };

  const revert = (module: string) =>
    setDraft((d) => {
      const next = { ...d };
      delete next[module];
      return next;
    });

  const peopleOf = (module: string): number[] =>
    peopleDraft[module] ?? data.people?.[module] ?? [];

  const togglePerson = (module: string, id: number) => {
    const current = peopleOf(module);
    setPeopleDraft((d) => ({
      ...d,
      [module]: current.includes(id) ? current.filter((x) => x !== id) : [...current, id]
    }));
  };

  const revertPeople = (module: string) =>
    setPeopleDraft((d) => {
      const next = { ...d };
      delete next[module];
      return next;
    });

  const visRow = (role: string): Record<string, boolean> =>
    visDraft[role] ?? visQuery.data?.config[role] ?? {};

  const visToggle = (role: string, module: string) => {
    const current = visRow(role);
    setVisDraft((d) => ({ ...d, [role]: { ...current, [module]: !current[module] } }));
  };

  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        title="Approval configuration"
        subtitle="Which roles each module may address a request to."
      />

      <Card className="mb-4">
        <CardContent className="flex gap-3 p-4 text-sm text-muted-foreground">
          <SlidersHorizontal className="mt-0.5 h-4 w-4 shrink-0" />
          <p className="leading-relaxed">
            Ticking a role lets that module's <strong>Request to</strong> list
            offer it. <strong>A module with nothing ticked is unrestricted</strong>
            {" "}— it offers whatever it would have offered, which is how every
            module behaves today. This narrows the list; it does not replace the
            routing rules, so a request still reaches the person the module was
            always going to send it to, chosen from a shorter list.
          </p>
        </CardContent>
      </Card>

      {/*
        Which modules a role sees.

        A different question from the grid below, and the one an administrator
        asks first: not "who may this be sent to" but "does this role have a
        Work From Home tab at all". The Leave Management tabs were decided by
        role checks written into the component, so answering it meant editing
        TypeScript.

        Untouched roles show everything, which is how the application behaves
        today -- so this changes nothing until it is used. It hides tabs; it
        does not grant anything, because the pages behind them are guarded
        individually and a tab appearing does not get anybody past a guard.
      */}
      <Card className="mb-6">
        <CardContent className="p-4">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h3 className="font-display text-lg font-bold">Module visibility by role</h3>
              <p className="text-xs text-muted-foreground">
                Which Leave Management tabs this role sees.
              </p>
            </div>
            <div className="flex items-end gap-2">
              <div className="space-y-1">
                <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Role
                </label>
                <Select
                  className="w-52"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                >
                  {(visQuery.data?.roles ?? []).map((r) => (
                    <option key={r} value={r}>{SUBJECT_LABELS[r]?.label ?? r}</option>
                  ))}
                </Select>
              </div>
              {visDraft[subject] && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setVisDraft((d) => {
                      const next = { ...d };
                      delete next[subject];
                      return next;
                    })
                  }
                >
                  <RotateCcw className="h-4 w-4" /> Undo
                </Button>
              )}
              <Button
                size="sm"
                disabled={!visDraft[subject] || saveVisibility.isPending}
                onClick={() =>
                  saveVisibility.mutate({
                    role: subject,
                    modules: (visQuery.data?.modules ?? []).filter((m) => visRow(subject)[m])
                  })
                }
              >
                <Save className="h-4 w-4" /> Save
              </Button>
            </div>
          </div>

          {visQuery.isLoading ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
          ) : (
            <>
              <p className="mb-2 text-xs text-muted-foreground">
                {SUBJECT_LABELS[subject]?.hint}
              </p>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                {(visQuery.data?.modules ?? []).map((module) => {
                  const on = !!visRow(subject)[module];
                  return (
                    <label
                      key={module}
                      className={cn(
                        "flex cursor-pointer items-center gap-2 rounded-lg border p-2.5 transition",
                        on ? "border-primary bg-primary/5" : "hover:bg-muted/40"
                      )}
                    >
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-[hsl(var(--primary))]"
                        checked={on}
                        onChange={() => visToggle(subject, module)}
                      />
                      <span className="text-sm font-semibold">
                        {LM_MODULE_LABELS[module] ?? module}
                      </span>
                    </label>
                  );
                })}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <h3 className="mb-3 font-display text-lg font-bold">Request recipients</h3>

      <div className="space-y-4">
        {data.modules.map((module) => {
          const row = rowOf(module);
          const edited = !!draft[module];
          const ticked = data.roles.filter((r) => row[r]).length;
          return (
            <Card key={module}>
              <CardContent className="p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="font-display text-lg font-bold">
                      {MODULE_LABELS[module] ?? module}
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      {ticked === 0
                        ? "Unrestricted — offers whatever the module would offer"
                        : `${ticked} role${ticked === 1 ? "" : "s"} may be addressed`}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {edited && (
                      <Button variant="outline" size="sm" onClick={() => revert(module)}>
                        <RotateCcw className="h-4 w-4" /> Undo
                      </Button>
                    )}
                    <Button
                      size="sm"
                      disabled={!edited || save.isPending}
                      onClick={() =>
                        save.mutate({
                          module,
                          roles: data.roles.filter((r) => row[r])
                        })
                      }
                    >
                      <Save className="h-4 w-4" /> Save
                    </Button>
                  </div>
                </div>

                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  {data.roles.map((role) => {
                    const on = !!row[role];
                    const meta = ROLE_LABELS[role] ?? { label: role, hint: "" };
                    /*
                      Who this tick actually reaches.

                      The grid named roles -- "HR", "Team Leader" -- and an
                      administrator could not tell who that was. HR is three
                      accounts here, and which people a request will be offered
                      to is the whole question being answered, so the names go
                      under the label rather than the description of the role.

                      Nobody holding it is worth saying too: it stops a tick
                      that would silently do nothing.
                    */
                    const who = data.holders?.[role] ?? [];
                    return (
                      <label
                        key={role}
                        className={cn(
                          "flex cursor-pointer items-start gap-2 rounded-lg border p-2.5 transition",
                          on ? "border-primary bg-primary/5" : "hover:bg-muted/40"
                        )}
                      >
                        <input
                          type="checkbox"
                          className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]"
                          checked={on}
                          onChange={() => toggle(module, role)}
                        />
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold">{meta.label}</span>
                          <span className="block text-[11px] leading-tight text-muted-foreground">
                            {who.length > 0 ? who.join(", ") : `${meta.hint} — nobody holds this`}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>

                {/*
                  Naming people, where a role is too broad.

                  Ticking "HR" offers all three HR accounts, and on this
                  company's data they are not interchangeable -- the question
                  being asked is often "this person, not their colleagues".
                  A role tick still has its place: it keeps working when
                  somebody joins or leaves, where a list of names quietly stops
                  offering the new person. Both are here and the administrator
                  picks per module.

                  Saved separately from the ticks above, because a module can
                  do both and saving one must not clear the other.
                */}
                <div className="mt-4 border-t pt-3">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                        Or name people
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {peopleOf(module).length === 0
                          ? "Nobody named — the ticks above decide it"
                          : `${peopleOf(module).length} named`}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      {peopleDraft[module] && (
                        <Button variant="outline" size="sm" onClick={() => revertPeople(module)}>
                          <RotateCcw className="h-4 w-4" /> Undo
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!peopleDraft[module] || savePeople.isPending}
                        onClick={() =>
                          savePeople.mutate({ module, users: peopleOf(module) })
                        }
                      >
                        <Save className="h-4 w-4" /> Save people
                      </Button>
                    </div>
                  </div>

                  <div className="grid max-h-44 gap-1.5 overflow-y-auto pr-1 sm:grid-cols-2 lg:grid-cols-3">
                    {(data.candidates ?? []).map((c) => {
                      const on = peopleOf(module).includes(c.id);
                      return (
                        <label
                          key={c.id}
                          className={cn(
                            "flex cursor-pointer items-start gap-2 rounded-lg border p-2 transition",
                            on ? "border-primary bg-primary/5" : "hover:bg-muted/40"
                          )}
                        >
                          <input
                            type="checkbox"
                            className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]"
                            checked={on}
                            onChange={() => togglePerson(module, c.id)}
                          />
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-semibold">{c.name}</span>
                            <span className="block truncate text-[11px] leading-tight text-muted-foreground">
                              {c.code}
                            </span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
