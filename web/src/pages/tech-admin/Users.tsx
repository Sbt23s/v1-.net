import { PixousLoader } from "@/components/ui/pixous-loader";
import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import toast from "react-hot-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Users, ShieldCheck, Key, Search, Filter, Check, X, Building, Mail, UserCheck, Eye, EyeOff, Edit2 } from "lucide-react";
import { useTechAdminAuth } from "@/context/TechAdminAuthContext";

export function TechAdminUsers() {
  const { theme, currentCompany, companies } = useTechAdminAuth();
  const isDark = theme === "dark";

  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedRoleFilter, setSelectedRoleFilterRaw] = useState("All");

  /**
   * Set the role filter, ignoring choices this view cannot show.
   *
   * Outside Pixous the list is company administrators only, so asking it for
   * employees or team leads could only ever return nothing — and it did: the
   * Employees tile read 1 while the table below said "No accounts match these
   * filters", because the tile counts everyone and the table is restricted. A
   * filter that cannot match is not a filter, it is a dead end.
   */
  const setSelectedRoleFilter = (value: string) => {
    setSelectedRoleFilterRaw(isPixous ? value : "All");
  };
  const [selectedCompanyFilter, setSelectedCompanyFilter] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"ACTIVE" | "OFFBOARDED" | "ALL">("ACTIVE");
  const [visiblePasswords, setVisiblePasswords] = useState<{ [key: number]: boolean }>({});
  /** Whether to list a tenant's non-administrator accounts as well. */
  const [showNonAdmins, setShowNonAdmins] = useState(false);
  
  // Provision User Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Edit User Modal State
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [selectedUserForEdit, setSelectedUserForEdit] = useState<any>(null);

  // Reset Password Modal State
  const [isResetModalOpen, setIsResetModalOpen] = useState(false);
  const [selectedUserForReset, setSelectedUserForReset] = useState<any>(null);
  const [newResetPassword, setNewResetPassword] = useState("");
  const [resetSuccessMessage, setResetSuccessMessage] = useState("");

  // Form State
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("admin123");
  const [companyId, setCompanyId] = useState("PIX-MASTER");
  const [companyName, setCompanyName] = useState("Pixous Technologies");
  /*
   * The roles this screen can create.
   *
   * Kept as a list, and the state below starts from it, because the two had
   * drifted: the dropdown offered Company Admin and nothing else while the
   * state it is bound to started at "EMPLOYEE". A controlled select whose value
   * matches no option still displays the first one, so the form read "Company
   * Admin", nobody touched it, no change event fired — and the account was
   * created as an employee. It then landed in the Employees tile and never in
   * the administrator table, which is exactly what was reported.
   *
   * Adding a role here now adds the option and cannot leave the default behind.
   */
  const CREATABLE_ROLES = [{ code: "COMPANY_ADMIN", label: "Company Admin" }];

  const [role, setRole] = useState(CREATABLE_ROLES[0].code);

  useEffect(() => {
    if (currentCompany?.companyName) {
      setSelectedCompanyFilter(currentCompany.companyName);
      setCompanyName(currentCompany.companyName);
      // CompanyTenant.id is number | string, and companyId is the string one; the
      // fallback could therefore put a number into a string state.
      setCompanyId(String(currentCompany.companyId || currentCompany.id));
    }
  }, [currentCompany]);

  const togglePasswordVisibility = (id: number) => {
    setVisiblePasswords(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const [loadFailed, setLoadFailed] = useState(false);

  /**
   * The server is the only place accounts live.
   *
   * This used to read /users and then merge in whatever was in localStorage
   * under hrp.company_users_*, seeding that store with invented accounts
   * (john/hr/tl, "Bala Admin", "Master Admin", all with the password admin123)
   * the first time it ran. Those accounts existed in one browser and nowhere
   * else: another admin could not see them, clearing site data removed them, and
   * none of them could actually sign in, because no such row was ever created.
   * The list looked populated whether or not the backend was reachable.
   */
  /**
   * @param silent true for background refreshes.
   *
   * Without this the thirty-second poll would flip the page back to its spinner
   * every half minute, wiping the table out from under whoever was reading it.
   * A background reload should show its result, not its progress.
   */
  const fetchUsers = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await api.get("/users?size=300");
      const payload = res.data?.data;
      const rows = Array.isArray(payload?.content)
        ? payload.content
        : Array.isArray(payload)
          ? payload
          : [];
      setUsers(rows);
      setLoadFailed(false);
    } catch (err) {
      // No invented rows to fall back on. An empty table with an error beside it
      // is the truth; a table of accounts that do not exist is not.
      setUsers([]);
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();

    // Kept so other screens can still ask this one to reload.
    const onUsersChanged = () => fetchUsers();
    window.addEventListener("hrp_users_updated", onUsersChanged);

    /**
     * Keeping the counts current without anyone pressing refresh.
     *
     * Two triggers rather than one:
     *
     *  - coming back to the tab. Someone switches to the portal, adds an
     *    employee, switches back — that is the common case, and reloading then
     *    costs one request at the moment it matters.
     *  - a slow poll, for a screen left open on a wall display where nobody ever
     *    switches away.
     *
     * Thirty seconds, not one. The hosting account allows twenty database
     * connections in total; a fast poll on a page that lists three hundred users
     * would spend them, and the portal would lock itself out of its own
     * database. A websocket would be better than either and is the right answer
     * eventually — this is the version that cannot cause an outage.
     *
     * Polling pauses while the tab is hidden, so a forgotten tab is free.
     */
    const onFocus = () => {
      if (document.visibilityState === "visible") fetchUsers(true);
    };
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("focus", onFocus);

    const poll = window.setInterval(() => {
      if (document.visibilityState === "visible") fetchUsers(true);
    }, 30_000);

    return () => {
      window.removeEventListener("hrp_users_updated", onUsersChanged);
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("focus", onFocus);
      window.clearInterval(poll);
    };
  }, [fetchUsers]);

  /**
   * Point the create form at a company, resolving its id from the real list.
   *
   * This used to map three names by hand and send MASTER-7H21LP for anything
   * else. Every tenant added since — Sethu Technologies among them — fell
   * through to that final else, so an account created for one company was filed
   * under another and appeared in a directory it did not belong to. A hard-coded
   * list of three companies cannot be right on a platform whose whole purpose is
   * adding more.
   */
  const handleCompanyChange = (cName: string) => {
    setCompanyName(cName);
    const match = companies.find((c) => c.companyName === cName);
    if (match) {
      setCompanyId(String(match.companyId || match.id));
      return;
    }
    // Refusing to guess. Sending the wrong company writes a real account into
    // somebody else's tenant, and nothing on screen would say so.
    setCompanyId("");
    toast.error(`Could not resolve the tenant for ${cName}. Reload and try again.`);
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();

    // Refuse rather than let the server fall back to somewhere. An account
    // written into the wrong tenant shows up in another company's directory,
    // and nothing about the success message would reveal it.
    if (!companyId) {
      toast.error("Pick the company this account belongs to first.");
      return;
    }

    setIsSubmitting(true);

    try {
      // Awaited, and for every company rather than only PIX-MASTER. The call was
      // previously fired without waiting and with its failure discarded, so a
      // rejected create still reported success and still filled in the table.
      await api.post("/auth/employees", {
        username,
        password: password || "admin123",
        name: fullName,
        email,
        roleCode: role,
        profileStatus: "ACTIVE",
        // Which company the account belongs to.
        //
        // Required, and it has to be sent explicitly here: the server normally
        // takes the company from whoever is signing the request, and a technical
        // admin does not have one — they work across tenants by design. Without
        // it the call comes back "Company ID is required to create a user".
        //
        // It went unnoticed while this screen wrote to localStorage and reported
        // success regardless of what the server said.
        companyId
      });

      toast.success(`User ${fullName} created in ${companyName}`);
      setIsModalOpen(false);
      resetForm();
      await fetchUsers();
      window.dispatchEvent(new Event("hrp_users_updated"));
    } catch (err: any) {
      /*
       * Show which field the server rejected, and why.
       *
       * It sends the reasons per field — "Password must be at least 8
       * characters" — under data.data, and this read only data.message, so
       * every rejection reached the screen as the bare words "Validation
       * failed". Whoever typed a short password was told something was wrong
       * with the form, but not what, and the form gave no clue either.
       */
      const body = err?.response?.data;
      const fields = body?.data && typeof body.data === "object" ? body.data : null;
      const detail = fields
        ? Object.values(fields as Record<string, string>).filter(Boolean).join(" · ")
        : null;
      toast.error(detail || body?.message || err?.message || "Failed to create user");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenEditModal = (user: any) => {
    setSelectedUserForEdit(user);
    setFullName(user.name);
    setEmail(user.email);
    setUsername(user.username);
    /*
     * Read from `roles`, which is what the server sends.
     *
     * `user.role` does not exist on the directory row — it is a list, `roles` —
     * so this set the state to undefined every time, and the select fell back to
     * displaying its first option while holding nothing. Saving from that state
     * would have written whatever the form guessed rather than what was on
     * screen.
     */
    const held: string[] = Array.isArray(user.roles) ? user.roles.map(String) : [];
    setRole(held.find((r) => CREATABLE_ROLES.some((c) => c.code === r)) ?? CREATABLE_ROLES[0].code);
    setIsEditModalOpen(true);
  };

  const handlePerformEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUserForEdit) return;

    setIsSubmitting(true);
    try {
      // Name, email and role go through the profile endpoint; the username is
      // part of the login and has its own, so it is only sent when it changed.
      await api.put(`/users/${selectedUserForEdit.id}`, {
        name: fullName,
        email,
        roles: [role]
      });

      if (username && username !== selectedUserForEdit.username) {
        await api.post(`/users/${selectedUserForEdit.id}/credentials`, { username });
      }

      setIsEditModalOpen(false);
      toast.success(`User ${fullName} updated`);
      await fetchUsers();
      window.dispatchEvent(new Event("hrp_users_updated"));
    } catch (err: any) {
      // The row is left as the server has it. Previously the table was updated
      // first and never corrected, so a rejected edit still looked applied.
      const msg = err?.response?.data?.message || err?.message || "Failed to update user";
      toast.error(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  /**
   * Give an existing account the company administrator role.
   *
   * For the accounts this screen created before the role dropdown was fixed —
   * they were written as employees, which is why they showed up under Employees
   * and could not sign in to anything. Editing each one through the modal would
   * work; this is the same call without making somebody re-type a name and an
   * email to change one field.
   *
   * Replaces the roles rather than adding to them. This tenant's administrator
   * is an administrator, not an employee who is also an administrator, and
   * leaving the old role on would keep them in the employee count.
   */
  /** The user a confirmation is asking about, and which action it is for. */
  const [confirmAction, setConfirmAction] =
    useState<{ kind: "admin" | "delete"; user: any } | null>(null);

  const handleMakeAdmin = async (u: any) => {
    try {
      await api.put(`/users/${u.id}`, { roles: ["COMPANY_ADMIN"] });
      toast.success(`${u.name} is now a company administrator`);
      // Read back rather than adjusting the row here, so what is on screen is
      // what the server actually stored.
      await fetchUsers();
      window.dispatchEvent(new Event("hrp_users_updated"));
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Could not change the role");
    }
  };

  const handleDeleteUser = async (u: any) => {
    /*
      Deleting is real and cannot be undone, so the confirmation has to be
      worth something. A yes/no box is one stray click away from removing a
      colleague's account -- typing the username is deliberate in a way that
      clicking OK is not, and the dialog keeps that requirement rather than
      trading it for a box that merely looks nicer.
    */
    try {
      await api.delete(`/users/${u.id}`);
      toast.success(`User ${u.name} deleted`);
      await fetchUsers();
      window.dispatchEvent(new Event("hrp_users_updated"));
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || "Failed to delete user";
      toast.error(msg);
    }
  };

  const handleOpenResetModal = (user: any) => {
    setSelectedUserForReset(user);
    setNewResetPassword("");
    setIsResetModalOpen(true);
  };

  const handlePerformPasswordReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUserForReset || !newResetPassword.trim()) return;

    setIsSubmitting(true);
    try {
      // The password is now actually changed on the account. It used to be
      // written to localStorage only, so the message said the reset had worked
      // while the person still could not sign in with the new password.
      await api.post(`/users/${selectedUserForReset.id}/credentials`, {
        username: selectedUserForReset.username,
        password: newResetPassword
      });

      setVisiblePasswords(prev => ({ ...prev, [selectedUserForReset.id]: true }));
      setResetSuccessMessage(`Password for ${selectedUserForReset.name} updated to "${newResetPassword}" successfully!`);
      setIsResetModalOpen(false);
      setTimeout(() => setResetSuccessMessage(""), 4000);
      await fetchUsers();
      window.dispatchEvent(new Event("hrp_users_updated"));
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || "Failed to reset password";
      toast.error(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetForm = () => {
    setFullName("");
    setEmail("");
    setUsername("");
    setPassword("admin123");
    setRole(CREATABLE_ROLES[0].code);
  };

  /**
   * The person's first role, or "" when they hold none.
   *
   * It used to answer "EMPLOYEE" for an account with no roles at all. That is a
   * guess presented as a fact, and it is how an account whose role failed to
   * save was filed as ordinary staff instead of showing up as broken.
   */
  const getRoleCode = (u: any) => u.role || (u.roles && u.roles.length > 0 ? u.roles[0] : "");

  /**
   * Pixous sees its own staff in full; every other tenant is shown only its
   * administrator. Read from the company being viewed, not from who is logged
   * in — a technical admin switches between tenants from the header.
   */
  const isPixous = (selectedCompanyFilter ?? currentCompany?.companyName ?? "")
    .toLowerCase()
    .includes("pixous");

  /**
   * Which role codes belong to each group, defined once.
   *
   * The tiles and the role filter each kept their own copy of these lists, and
   * they drifted apart: IT_MGR counted as a team lead but filtered as HR, and
   * CV_SUP counted as a team lead but was missing from the team-lead filter. A
   * tile would read 1 and open onto "No accounts match these filters" — the
   * page disagreeing with itself. Both now read from here.
   */
  /**
   * Every role a person holds, not just the first.
   *
   * Declared above the directory filter because that filter runs while this
   * component renders; leaving it further down threw a reference error before
   * the page could paint.
   */
  const rolesOf = (u: any): string[] => {
    if (Array.isArray(u.roles) && u.roles.length > 0) return u.roles.map(String);
    return u.role ? [String(u.role)] : [];
  };

  const ROLE_GROUPS: Record<string, string[]> = {
    HR_MANAGER: ["HR_MANAGER", "IT_HR", "CV_HR", "IT_MGR"],
    TEAM_LEAD: ["TEAM_LEAD", "IT_TL", "CV_SUP"],
    EMPLOYEE: ["EMPLOYEE", "IT_EMP", "CV_EMP"],
    COMPANY_ADMIN: ["COMPANY_ADMIN", "SUPER_ADMIN", "BOARD_ADMIN", "CV_ADM", "IT_ADM"]
  };

  /**
   * The roles that run a company.
   *
   * Matched by name as well as by the known list. An administrator created
   * here was landing outside every group and being counted as an ordinary
   * employee — the Employees tile read 1 while the administrator table sat
   * empty, and the account that had just been created was nowhere. Rather than
   * guess which spelling the server used, anything whose code says ADMIN or
   * ends in _ADM is treated as one.
   */
  const isAdminRole = (roleCode: string) => {
    if (!roleCode) return false;
    const code = roleCode.toUpperCase();
    return (
      ROLE_GROUPS.COMPANY_ADMIN.includes(code) ||
      code.includes("ADMIN") ||
      code.endsWith("_ADM")
    );
  };

  const filteredUsers = users.filter((u: any) => {
    const matchesCompany = !selectedCompanyFilter || u.companyName === selectedCompanyFilter;
    /*
     * An empty box matches everything, explicitly.
     *
     * This read `u.name?.…  || u.email?.…`, and for a row with neither the whole
     * expression was undefined — so an account with no name was hidden even when
     * nobody had typed anything. A missing name is the mark of an account worth
     * looking at, and this was the one thing guaranteed to keep it off screen.
     */
    const q = searchQuery.trim().toLowerCase();
    const matchesSearch =
      !q ||
      (u.name || "").toLowerCase().includes(q) ||
      (u.email || "").toLowerCase().includes(q) ||
      (u.username || "").toLowerCase().includes(q);
    const roleCode = getRoleCode(u);

    /*
     * Matched against every role the person holds, using the shared groups.
     *
     * Two things were wrong. The lists were hand-written here and had drifted
     * from the ones the tiles count with — CV_SUP was missing, so a team lead
     * counted on the tile vanished when you clicked it. And this read only the
     * first of a person's roles, while the tiles read all of them, so anyone
     * with a second role was counted but not listed.
     */
    let matchesRole = selectedRoleFilter === "All";
    if (!matchesRole) {
      const group = ROLE_GROUPS[selectedRoleFilter];
      const mine = rolesOf(u);
      matchesRole = group
        ? mine.some((r) => group.includes(r))
        : mine.includes(selectedRoleFilter) || roleCode === selectedRoleFilter;
    }


    const userStatus = u.profileStatus || u.status || "ACTIVE";
    const matchesStatus = statusFilter === "ALL" || userStatus === statusFilter;

    /*
     * Outside Pixous, list only each company's administrator.
     *
     * This screen showed every tenant's HR, team leads and employees with a
     * PASSWORD column beside them. Reading another company's staff passwords is
     * not part of running the platform, and putting the column there made it
     * look as though it were. The administrator is the account a technical
     * admin genuinely needs — it is who they hand a tenant over to.
     */
    /*
     * The one way out of a deadlock.
     *
     * Restricting this table to administrators is right, but it also meant an
     * account created with the wrong role could not be seen here, and therefore
     * could not be corrected — the screen that made the mistake was the one
     * screen that could not fix it. The toggle opens the rest of the tenant's
     * accounts for exactly that. The password column stays hidden for them; being
     * able to repair a role is not a reason to read somebody's login.
     */
    const adminOnly = !isPixous && !showNonAdmins && !isAdminRole(roleCode);

    return matchesCompany && matchesSearch && matchesRole && matchesStatus && !adminOnly;
  });

  const checkStatus = (u: any) => {
    const userStatus = u.profileStatus || u.status || "ACTIVE";
    return statusFilter === "ALL" || userStatus === statusFilter;
  };

  /**
   * Every role a person holds, not just the first one.
   *
   * The counts used to read getRoleCode(u), which returns roles[0]. Somebody who
   * is both IT_MGR and IT_HR was therefore counted once, under whichever role
   * happened to be first in the array — which is why the totals never added up
   * to the number of rows in the table.
   */

  /**
   * No company filter means "everyone this admin can see"; a filter narrows it.
   * Matching on the company name alone left every count at zero whenever the
   * name on the row did not match the filter string exactly.
   */
  const inSelectedCompany = (u: any) =>
    !selectedCompanyFilter || u.companyName === selectedCompanyFilter;

  const countWithAnyRole = (codes: string[]) =>
    users.filter(
      (u: any) =>
        inSelectedCompany(u) &&
        checkStatus(u) &&
        rolesOf(u).some((r) => codes.includes(r)),
    ).length;

  const privacyMaskedCounts = {
    // Same groups the filter uses, so a tile and the list it opens can never
    // disagree again.
    hr: countWithAnyRole(ROLE_GROUPS.HR_MANAGER),
    tl: countWithAnyRole(ROLE_GROUPS.TEAM_LEAD),
    // Administrators are excluded here rather than left to fall through. An
    // account whose role matched no group was landing in this tile, which is
    // how a newly created administrator turned up as an employee.
    // Requires an actual role. An account carrying none was landing here too,
    // so "Employees" was really "everyone left over" — and a role that failed to
    // save looked like an ordinary member of staff instead of a broken account.
    // Those are counted separately below and said out loud.
    emp: users.filter(
      (u: any) =>
        inSelectedCompany(u) &&
        checkStatus(u) &&
        rolesOf(u).length > 0 &&
        !rolesOf(u).some((r) => isAdminRole(r)) &&
        !rolesOf(u).some((r) => ROLE_GROUPS.HR_MANAGER.includes(r)) &&
        !rolesOf(u).some((r) => ROLE_GROUPS.TEAM_LEAD.includes(r))
    ).length,
    noRole: users.filter(
      (u: any) => inSelectedCompany(u) && checkStatus(u) && rolesOf(u).length === 0
    ).length,
    admin: users.filter(
      (u: any) => inSelectedCompany(u) && checkStatus(u) && rolesOf(u).some((r) => isAdminRole(r))
    ).length,
    total: users.filter((u: any) => inSelectedCompany(u) && checkStatus(u)).length};

  /**
   * Accounts in this tenant that the administrator-only table leaves out.
   *
   * Stated on screen rather than left implicit: a table that quietly shows a
   * subset is indistinguishable from a table showing everything, and that is how
   * a mis-created account went missing.
   */
  const otherAccounts = privacyMaskedCounts.total - privacyMaskedCounts.admin;

  /*
   * Matched to the Dashboard and Companies pages.
   *
   * In light mode this page used a dark purple panel at 40% over the same
   * background image the others use, with light text on top. At that opacity
   * the photograph came through the panel and sat behind the words, which is
   * why the headings and the empty-state line read as greyed out — they were
   * competing with a beach. The rest of the section uses a near-opaque white
   * card and dark text; this now does the same.
   */
  const cardBg = isDark
    ? "bg-slate-900/40 backdrop-blur-xl border border-cyan-500/30 shadow-[0_0_15px_rgba(6,182,212,0.15)] text-slate-100"
    : "bg-white/90 backdrop-blur-md border border-white text-slate-800 shadow-xl shadow-slate-200/50";

  if (loading) return <div className="flex p-12 justify-center"><PixousLoader size="md" /></div>;

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className={`text-xl font-semibold flex items-center gap-2 ${isDark ? "text-cyan-400 drop-shadow-[0_0_8px_rgba(6,182,212,0.8)]" : "text-purple-700"}`}>
            <Users className={`w-5 h-5 ${isDark ? "text-cyan-400" : "text-slate-500"}`} /> Multi-Tenant Company User Directory
          </h2>
          <p className={`text-sm mt-1 font-medium ${isDark ? "text-cyan-400" : "text-slate-600"}`}>
            Manage login credentials, roles (Company Admin, HR, Team Lead, Employee) and company assignments.
          </p>
        </div>
        <Button onClick={() => setIsModalOpen(true)} className={`${isDark ? "bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold border border-cyan-400 shadow-[0_0_10px_rgba(6,182,212,0.4)]" : "bg-purple-600 hover:bg-purple-500 text-white border border-purple-400 "} font-medium`}>
          <Plus className="w-4 h-4 mr-2" /> Add Company User
        </Button>
      </div>

      {resetSuccessMessage && (
        <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm flex items-center gap-2">
          <Check className="w-4 h-4" /> {resetSuccessMessage}
        </div>
      )}

      {/* Filter Bar */}
      <Card className={cardBg}>
        <CardContent className="p-4 flex flex-col md:flex-row gap-4 justify-between items-center">
          <div className="relative w-full md:w-80">
            <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
            <Input
              placeholder="Search user name, email, tenant ID..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={`pl-9 ${isDark ? "bg-slate-900/50 border-cyan-500/30 text-white focus:border-cyan-400" : "bg-white border-slate-300 text-slate-800 placeholder:text-slate-400 focus:border-purple-500"}`}
            />
          </div>

          <div className="flex items-center gap-3 w-full md:w-auto">
            <div className={`flex items-center p-1 rounded-lg ${isDark ? "bg-slate-900/40 border-cyan-500/20 border shadow-[0_0_8px_rgba(6,182,212,0.1)]" : "bg-slate-100 border border-slate-200"}`}>
              <button
                onClick={() => setStatusFilter("ACTIVE")}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${statusFilter === "ACTIVE" ? (isDark ? "bg-emerald-500 text-white shadow-sm" : "bg-purple-600 text-white shadow-[0_0_10px_rgba(168,85,247,0.4)]") : (isDark ? "text-slate-500 hover:text-slate-300" : "text-slate-500 hover:text-slate-800")}`}
              >
                Onboard
              </button>
              <button
                onClick={() => setStatusFilter("OFFBOARDED")}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${statusFilter === "OFFBOARDED" ? (isDark ? "bg-slate-400 text-white shadow-sm" : "bg-purple-600 text-white shadow-[0_0_10px_rgba(168,85,247,0.4)]") : (isDark ? "text-slate-500 hover:text-slate-300" : "text-slate-500 hover:text-slate-800")}`}
              >
                Offboard
              </button>
              <button
                onClick={() => setStatusFilter("ALL")}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${statusFilter === "ALL" ? (isDark ? "bg-blue-500 text-white shadow-sm" : "bg-purple-600 text-white shadow-[0_0_10px_rgba(168,85,247,0.4)]") : (isDark ? "text-slate-500 hover:text-slate-300" : "text-slate-500 hover:text-slate-800")}`}
              >
                All
              </button>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400">Role:</span>
              <select
                value={selectedRoleFilter}
                onChange={(e) => setSelectedRoleFilter(e.target.value)}
                className={`p-2 rounded text-xs font-semibold ${isDark ? "bg-slate-900/50 border-cyan-500/30 text-white focus:border-cyan-400" : "bg-white border-slate-300 text-slate-800 focus:border-purple-500"}`}
              >
                <option value="All">All Roles</option>
                <option value="COMPANY_ADMIN">Company Admin</option>
                <option value="HR_MANAGER">HR Manager</option>
                <option value="TEAM_LEAD">Team Lead</option>
                <option value="EMPLOYEE">Employee</option>
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Role Summary Cards */}
      {selectedCompanyFilter && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <Card 
            onClick={() => setSelectedRoleFilter("HR_MANAGER")}
            className={`${cardBg} ${isDark ? "border-cyan-500/30 hover:border-cyan-400" : "border-slate-200 hover:border-slate-300"} cursor-pointer transition-all ${selectedRoleFilter === "HR_MANAGER" ? (isDark ? "ring-2 ring-cyan-500 shadow-[0_0_15px_rgba(6,182,212,0.3)]" : "ring-2 ring-purple-500/50 shadow-[0_0_15px_rgba(168,85,247,0.3)]") : ""}`}
          >
            <CardContent className="p-4 flex items-center justify-between">
              <div>
                <p className={`text-sm font-bold ${isDark ? "text-cyan-400" : "text-slate-600"}`}>HR Managers</p>
                <h3 className={`text-2xl font-bold mt-1 ${isDark ? "text-cyan-400" : "text-slate-600"}`}>{privacyMaskedCounts.hr}</h3>
              </div>
              <div className={`w-10 h-10 rounded-full flex items-center justify-center ${isDark ? "bg-cyan-900/40 text-cyan-400 shadow-[0_0_8px_rgba(6,182,212,0.3)]" : "bg-slate-100 text-slate-600"}`}>
                <UserCheck className="w-5 h-5" />
              </div>
            </CardContent>
          </Card>
          <Card 
            onClick={() => setSelectedRoleFilter("TEAM_LEAD")}
            className={`${cardBg} ${isDark ? "border-cyan-500/30 hover:border-cyan-400" : "border-slate-200 hover:border-slate-300"} cursor-pointer transition-all ${selectedRoleFilter === "TEAM_LEAD" ? (isDark ? "ring-2 ring-cyan-500 shadow-[0_0_15px_rgba(6,182,212,0.3)]" : "ring-2 ring-purple-500/50 shadow-[0_0_15px_rgba(168,85,247,0.3)]") : ""}`}
          >
            <CardContent className="p-4 flex items-center justify-between">
              <div>
                <p className={`text-sm font-bold ${isDark ? "text-cyan-400" : "text-slate-600"}`}>Team Leads</p>
                <h3 className={`text-2xl font-bold mt-1 ${isDark ? "text-cyan-400" : "text-slate-600"}`}>{privacyMaskedCounts.tl}</h3>
              </div>
              <div className={`w-10 h-10 rounded-full flex items-center justify-center ${isDark ? "bg-cyan-900/40 text-cyan-400 shadow-[0_0_8px_rgba(6,182,212,0.3)]" : "bg-slate-100 text-slate-600"}`}>
                <ShieldCheck className="w-5 h-5" />
              </div>
            </CardContent>
          </Card>
          <Card 
            onClick={() => setSelectedRoleFilter("EMPLOYEE")}
            className={`${cardBg} ${isDark ? "border-cyan-500/30 hover:border-cyan-400" : "border-slate-200 hover:border-slate-300"} cursor-pointer transition-all ${selectedRoleFilter === "EMPLOYEE" ? (isDark ? "ring-2 ring-cyan-500 shadow-[0_0_15px_rgba(6,182,212,0.3)]" : "ring-2 ring-purple-500/50 shadow-[0_0_15px_rgba(168,85,247,0.3)]") : ""}`}
          >
            <CardContent className="p-4 flex items-center justify-between">
              <div>
                <p className={`text-sm font-bold ${isDark ? "text-cyan-400" : "text-slate-600"}`}>Employees</p>
                <h3 className={`text-2xl font-bold mt-1 ${isDark ? "text-cyan-400" : "text-slate-600"}`}>{privacyMaskedCounts.emp}</h3>
              </div>
              <div className={`w-10 h-10 rounded-full flex items-center justify-center ${isDark ? "bg-cyan-900/40 text-cyan-400 shadow-[0_0_8px_rgba(6,182,212,0.3)]" : "bg-slate-100 text-slate-600"}`}>
                <Users className="w-5 h-5" />
              </div>
            </CardContent>
          </Card>

          {/* Administrators, alongside the rest. Without this tile there was no
              way to tell a newly created administrator from one that had failed
              to be created — both looked like nothing had happened. */}
          <Card className={cardBg}>
            <CardContent className="p-4 flex items-center justify-between">
              <div>
                <p className={`text-sm font-bold ${isDark ? "text-cyan-400" : "text-slate-600"}`}>Company Admins</p>
                <h3 className={`text-2xl font-bold mt-1 ${isDark ? "text-cyan-400" : "text-slate-600"}`}>{privacyMaskedCounts.admin}</h3>
              </div>
              <div className={`w-10 h-10 rounded-full flex items-center justify-center ${isDark ? "bg-cyan-900/40 text-cyan-400 shadow-[0_0_8px_rgba(6,182,212,0.3)]" : "bg-slate-100 text-slate-600"}`}>
                <ShieldCheck className="w-5 h-5" />
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Users Directory Table */}
      <Card className={cardBg}>
        <CardHeader className={`pb-3 flex flex-row items-center justify-between border-b ${isDark ? "border-cyan-500/20" : "border-slate-200"}`}>
          <div>
            <CardTitle className="text-md">User Accounts ({filteredUsers.length})</CardTitle>
            <CardDescription className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
              {/* Says why the tiles above can show more people than the table
                  below lists — otherwise the two look like they disagree. */}
              {!isPixous
                ? showNonAdmins
                  ? "Every account in this tenant. Passwords stay hidden for anyone who is not an administrator."
                  : "Company administrators only. The counts above cover everyone; staff logins are that company's own business."
                : "User accounts isolated by tenant scope ID."}
            </CardDescription>

            {/* Names what the table is not showing, and offers it.
                Without this, an account created with the wrong role was both
                invisible here and impossible to correct anywhere. */}
            {!isPixous && otherAccounts > 0 && (
              <p className={`mt-1.5 text-xs ${isDark ? "text-amber-400" : "text-amber-600"}`}>
                {otherAccounts} other account{otherAccounts === 1 ? "" : "s"} in this tenant
                {privacyMaskedCounts.noRole > 0
                  ? `, ${privacyMaskedCounts.noRole} with no role assigned`
                  : ""}
                .{" "}
                <button
                  type="button"
                  onClick={() => setShowNonAdmins((v) => !v)}
                  className="font-semibold underline underline-offset-2"
                >
                  {showNonAdmins ? "Show administrators only" : "Show them"}
                </button>
              </p>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className={`uppercase font-semibold border-b ${isDark ? "bg-cyan-950/40 text-cyan-400 border-cyan-500/20" : "bg-slate-100 text-slate-600 border-slate-200"}`}>
              <tr>
                <th className="p-4">User</th>
                <th className="p-4">Login Email</th>
                <th className="p-4">Password</th>
                <th className="p-4">Company Tenant</th>
                <th className="p-4">Role</th>
                <th className="p-4">Status</th>
                <th className="p-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className={`divide-y ${isDark ? "divide-cyan-500/10" : "divide-slate-200"}`}>
              {/* An empty table after a failed load would read as "these accounts
                  are gone". Say which of the two it is. */}
              {loadFailed && (
                <tr>
                  <td colSpan={7} className="p-8 text-center">
                    <p className="font-semibold text-red-400">Couldn't load accounts from the server</p>
                    <p className="mt-1 text-sm text-slate-400">
                      Nothing has been lost — this list simply has not been read yet.
                    </p>
                    <Button variant="outline" className="mt-4" onClick={() => fetchUsers()}>
                      Try again
                    </Button>
                  </td>
                </tr>
              )}
              {!loadFailed && !loading && filteredUsers.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-slate-400">
                    No accounts match these filters.
                  </td>
                </tr>
              )}
              {filteredUsers.map((u) => (
                <tr key={u.id} className={`transition-colors ${isDark ? "hover:bg-cyan-900/20" : "hover:bg-slate-50"}`}>
                  <td className="p-4 font-semibold text-slate-200 flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-full font-bold flex items-center justify-center ${isDark ? "bg-cyan-900/40 text-cyan-400 shadow-[0_0_8px_rgba(6,182,212,0.3)]" : "bg-slate-100 text-slate-600"}`}>
                      {/* Guarded. An account with no name — which the directory
                          does return — threw here and took the whole table down
                          with it, so one bad row read as "accounts failed to
                          load". */}
                      {(u.name || u.username || "?").charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <span className={`block font-medium ${isDark ? "text-slate-200" : "text-slate-800"}`}>{u.name}</span>
                      <span className={`text-[11px] ${isDark ? 'text-slate-500' : 'text-slate-500'}`}>@{u.username}</span>
                    </div>
                  </td>
                  <td className={`p-4 font-mono ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{u.email}</td>

                  <td className="p-4 font-mono text-slate-500 relative group">
                    {(() => {
                      // Was a hard-coded company name compared against roles[0],
                      // so an administrator holding a second role had their
                      // password shown, and a tenant whose name differed by a
                      // word was treated as Pixous. Both read from the shared
                      // helpers now.
                      const isNonAdminNonPixous = !isPixous && !rolesOf(u).some((r) => isAdminRole(r));
                      if (isNonAdminNonPixous) {
                        return <span className={`italic text-[10px] font-medium ${isDark ? "text-cyan-400" : "text-slate-600"}`}>Hidden for Privacy</span>;
                      }
                      return (
                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-0.5 rounded text-xs font-semibold ${isDark ? "bg-slate-900/50 border border-cyan-500/30 text-slate-200" : "bg-slate-100 border border-slate-200 text-slate-600"}`}>
                             {visiblePasswords[u.id] ? (u.password || "admin123") : "••••••••"}
                          </span>
                          <button onClick={() => togglePasswordVisibility(u.id)} className="opacity-0 group-hover:opacity-100 transition-opacity">
                            {visiblePasswords[u.id] ? <EyeOff className="w-3 h-3"/> : <Eye className="w-3 h-3"/>}
                          </button>
                        </div>
                      );
                    })()}
                  </td>
                  <td className="p-4">
                    <span className={`font-semibold block ${isDark ? "text-slate-200" : "text-slate-800"}`}>{u.companyName}</span>
                    <span className={`font-mono text-[11px] font-bold ${isDark ? "text-cyan-400" : "text-slate-500"}`}>{u.companyId}</span>
                  </td>
                  <td className="p-4">
                    <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold border ${
                      (u.role === 'COMPANY_ADMIN' || (u.roles && u.roles.includes('COMPANY_ADMIN'))) ? (isDark ? 'bg-cyan-900/40 text-cyan-400 border-cyan-500/30 shadow-[0_0_8px_rgba(6,182,212,0.3)]' : 'bg-indigo-50 text-indigo-700 border-indigo-200 ') :
                      (u.role === 'HR_MANAGER' || (u.roles && u.roles.includes('HR_MANAGER'))) ? (isDark ? 'bg-indigo-900/40 text-indigo-400 border-indigo-500/30 shadow-[0_0_8px_rgba(99,102,241,0.3)]' : 'bg-indigo-50 text-indigo-700 border-indigo-200 shadow-[0_0_8px_rgba(99,102,241,0.3)]') :
                      (u.role === 'TEAM_LEAD' || (u.roles && u.roles.includes('TEAM_LEAD'))) ? (isDark ? 'bg-teal-900/40 text-teal-400 border-teal-500/30 shadow-[0_0_8px_rgba(20,184,166,0.3)]' : 'bg-teal-50 text-teal-700 border-teal-200 shadow-[0_0_8px_rgba(20,184,166,0.3)]') :
                      (isDark ? 'bg-emerald-900/40 text-emerald-400 border-emerald-500/30 shadow-[0_0_8px_rgba(16,185,129,0.3)]' : 'bg-emerald-50 text-emerald-700 border-emerald-200 shadow-[0_0_8px_rgba(16,185,129,0.3)]')
                    }`}>
                      {/* "No role" rather than "EMPLOYEE". An account whose role
                          did not save is a broken account, and labelling it as
                          an employee hid the very thing worth noticing. */}
                      {u.role
                        ? u.role.replace(/_/g, " ")
                        : u.roles && u.roles.length > 0
                          ? u.roles.join(", ").replace(/_/g, " ")
                          : "No role"}
                    </span>
                  </td>
                  <td className="p-4">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${isDark ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30 shadow-[0_0_8px_rgba(16,185,129,0.2)]" : "bg-indigo-50 text-indigo-700 border-indigo-200"}`}>
                      {/* profileStatus is the field the server sends; `status`
                          does not exist on the row, so this column was blank. */}
                      {u.profileStatus || u.status || "ACTIVE"}
                    </span>
                  </td>
                  <td className="p-4 text-right space-x-2">
                    {/* One click, for the accounts this screen created with the
                        wrong role. Only offered where it would change something —
                        an administrator has no "make administrator" button. */}
                    {!rolesOf(u).some((r) => isAdminRole(r)) && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setConfirmAction({ kind: "admin", user: u })}
                        className={`h-7 text-xs font-semibold ${isDark ? "text-emerald-400 hover:bg-emerald-400/10" : "text-emerald-600 hover:bg-emerald-400/20"}`}
                      >
                        Make Company Admin
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleOpenEditModal(u)}
                      className={`h-7 text-xs ${isDark ? 'text-indigo-400 hover:bg-indigo-400/10' : 'text-slate-600 hover:bg-slate-100'}`}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleOpenResetModal(u)}
                      className={`h-7 text-xs ${isDark ? 'text-blue-400 hover:bg-blue-400/10' : 'text-indigo-300 hover:bg-slate-100'}`}
                    >
                      Reset Password
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setConfirmAction({ kind: "delete", user: u })}
                      className={`h-7 text-xs ${isDark ? 'text-red-400 hover:bg-red-400/10' : 'text-red-400 hover:bg-red-50'}`}
                    >
                      Delete
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Reset Password Modal */}
      {isResetModalOpen && selectedUserForReset && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className={`w-full max-w-md rounded-2xl p-6 shadow-[0_0_20px_rgba(0,0,0,0.5)] border ${isDark ? "bg-slate-900/80 backdrop-blur-xl border-cyan-500/30 text-white shadow-[0_0_15px_rgba(6,182,212,0.15)]" : "bg-[#13002b]/95 backdrop-blur-xl border-slate-300 text-purple-50"}`}>
            <div className={`flex items-center justify-between pb-4 border-b ${isDark ? "border-cyan-500/20" : "border-slate-300"}`}>
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <Key className={`w-5 h-5 ${isDark ? "text-cyan-400" : "text-slate-500"}`} /> Reset User Password
              </h3>
              <button onClick={() => setIsResetModalOpen(false)} className="text-slate-400 hover:text-white transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handlePerformPasswordReset} className="space-y-4 pt-4">
              <div className={`p-3 rounded-lg border text-xs ${isDark ? "bg-slate-900/50 border-cyan-500/30" : "bg-white border-slate-300"}`}>
                <p className="font-semibold">{selectedUserForReset.name}</p>
                <p className={`font-mono text-[11px] font-medium ${isDark ? "text-cyan-400" : "text-slate-300"}`}>{selectedUserForReset.email}</p>
                <p className={`font-mono text-[11px] mt-1 ${isDark ? "text-cyan-400" : "text-slate-500"}`}>{selectedUserForReset.companyName} ({selectedUserForReset.companyId})</p>
              </div>

              <div>
                <Label className={isDark ? "text-slate-300" : "text-slate-600"}>New Password</Label>
                <Input
                  type="text"
                  required
                  placeholder="Enter new password (e.g. NewPass123!)"
                  value={newResetPassword}
                  onChange={(e) => setNewResetPassword(e.target.value)}
                  className={`mt-1 font-mono ${isDark ? "bg-slate-900/50 border-cyan-500/30 text-white focus:border-cyan-400" : "bg-white border-slate-300 text-slate-800 placeholder:text-slate-400 focus:border-purple-500"}`}
                />
              </div>

              <div className={`pt-4 flex justify-end gap-3 border-t ${isDark ? "border-cyan-500/20" : "border-slate-300"}`}>
                <Button type="button" variant="outline" onClick={() => setIsResetModalOpen(false)} className={isDark ? "text-slate-300 border-cyan-500/30 hover:bg-cyan-900/30" : "text-slate-600 border-slate-300 hover:bg-slate-100 hover:text-slate-800"}>
                  Cancel
                </Button>
                <Button type="submit" className={isDark ? "bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold border border-cyan-400 shadow-[0_0_10px_rgba(6,182,212,0.4)]" : "bg-purple-600 hover:bg-purple-500 text-white border border-purple-400 "}>
                  Update Password
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add User Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className={`w-full max-w-lg rounded-2xl p-6 shadow-[0_0_20px_rgba(0,0,0,0.5)] border ${isDark ? "bg-slate-900/80 backdrop-blur-xl border-cyan-500/30 text-white shadow-[0_0_15px_rgba(6,182,212,0.15)]" : "bg-[#13002b]/95 backdrop-blur-xl border-slate-300 text-purple-50"}`}>
            <div className={`flex items-center justify-between pb-4 border-b ${isDark ? "border-cyan-500/20" : "border-slate-300"}`}>
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <UserCheck className={`w-5 h-5 ${isDark ? "text-cyan-400" : "text-slate-500"}`} /> Provision Company User Account
              </h3>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-white transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateUser} className="space-y-4 pt-4">
              <div>
                <Label className={isDark ? "text-slate-300" : "text-slate-600"}>Full Name</Label>
                <Input
                  required
                  placeholder="e.g. Rahul Sharma"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className={`mt-1 ${isDark ? "bg-slate-900/50 border-cyan-500/30 text-white focus:border-cyan-400" : "bg-white border-slate-300 text-slate-800 placeholder:text-slate-400 focus:border-purple-500"}`}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className={isDark ? "text-slate-300" : "text-slate-600"}>Email (Login Username)</Label>
                  <Input
                    type="email"
                    required
                    placeholder="rahul@pixoustech.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className={`mt-1 ${isDark ? "bg-slate-900/50 border-cyan-500/30 text-white focus:border-cyan-400" : "bg-white border-slate-300 text-slate-800 placeholder:text-slate-400 focus:border-purple-500"}`}
                  />
                </div>
                <div>
                  <Label className={isDark ? "text-slate-300" : "text-slate-600"}>Username</Label>
                  <Input
                    required
                    placeholder="rahul_s"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    minLength={3}
                    maxLength={60}
                    className={`mt-1 ${isDark ? "bg-slate-900/50 border-cyan-500/30 text-white focus:border-cyan-400" : "bg-white border-slate-300 text-slate-800 placeholder:text-slate-400 focus:border-purple-500"}`}
                  />
                  {/* The server wants three characters, and nothing beyond
                      letters, numbers, dot, underscore and hyphen. A two-letter
                      username was refused with nothing on screen saying which
                      field had failed. */}
                  <p className={`mt-1 text-[11px] ${username && username.length < 3
                    ? "text-rose-500 font-medium"
                    : (isDark ? "text-slate-400" : "text-slate-500")}`}>
                    3+ characters · letters, numbers, . _ -
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className={isDark ? "text-slate-300" : "text-slate-600"}>Target Company Tenant</Label>
                  <div className={`w-full mt-1 p-2 rounded border text-sm font-semibold opacity-70 cursor-not-allowed ${isDark ? "bg-slate-900/50 border-cyan-500/30 text-white" : "bg-slate-100 border-slate-300 text-slate-600"}`}>
                    {currentCompany?.companyName} ({currentCompany?.id})
                  </div>
                </div>

                <div>
                  <Label className={isDark ? "text-slate-300" : "text-slate-600"}>User Role</Label>
                  <select
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                    className={`w-full mt-1 p-2 rounded border text-sm ${isDark ? "bg-slate-900/50 border-cyan-500/30 text-white focus:border-cyan-400" : "bg-white border-slate-300 text-slate-800 focus:border-purple-500"}`}
                  >
                    {CREATABLE_ROLES.map((r) => (
                      <option key={r.code} value={r.code}>{r.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <Label className={isDark ? "text-slate-300" : "text-slate-600"}>Initial Password</Label>
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  minLength={8}
                  className={`mt-1 ${isDark ? "bg-slate-900/50 border-cyan-500/30 text-white focus:border-cyan-400" : "bg-white border-slate-300 text-slate-800 focus:border-purple-500"}`}
                />
                {/* The server requires eight. Saying so here beats submitting
                    the form to find out. */}
                <p className={`mt-1 text-[11px] ${password && password.length < 8
                  ? "text-rose-500 font-medium"
                  : (isDark ? "text-slate-400" : "text-slate-500")}`}>
                  At least 8 characters
                </p>
              </div>

              <div className={`pt-4 flex justify-end gap-3 border-t ${isDark ? "border-cyan-500/20" : "border-slate-300"}`}>
                <Button type="button" variant="outline" onClick={() => setIsModalOpen(false)} className={isDark ? "text-slate-300 border-cyan-500/30 hover:bg-cyan-900/30" : "text-slate-600 border-slate-300 hover:bg-slate-100 hover:text-slate-800"}>
                  Cancel
                </Button>
                <Button type="submit" disabled={isSubmitting} className={isDark ? "bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold border border-cyan-400 shadow-[0_0_10px_rgba(6,182,212,0.4)]" : "bg-purple-600 hover:bg-purple-500 text-white border border-purple-400 "}>
                  {isSubmitting ? <PixousLoader size="xs" className="mr-2" /> : <Plus className="w-4 h-4 mr-2" />} Create User Account
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit User Modal */}
      {isEditModalOpen && selectedUserForEdit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className={`w-full max-w-lg rounded-2xl p-6 shadow-[0_0_20px_rgba(0,0,0,0.5)] border ${isDark ? "bg-slate-900/80 backdrop-blur-xl border-cyan-500/30 text-white shadow-[0_0_15px_rgba(6,182,212,0.15)]" : "bg-[#13002b]/95 backdrop-blur-xl border-slate-300 text-purple-50"}`}>
            <div className={`flex items-center justify-between pb-4 border-b ${isDark ? "border-cyan-500/20" : "border-slate-300"}`}>
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <Edit2 className={`w-5 h-5 ${isDark ? "text-cyan-400" : "text-slate-500"}`} /> Edit User Account
              </h3>
              <button onClick={() => setIsEditModalOpen(false)} className="text-slate-400 hover:text-white transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handlePerformEdit} className="space-y-4 pt-4">
              <div>
                <Label className={isDark ? "text-slate-300" : "text-slate-600"}>Full Name</Label>
                <Input
                  required
                  placeholder="e.g. Rahul Sharma"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className={`mt-1 ${isDark ? "bg-slate-900/50 border-cyan-500/30 text-white focus:border-cyan-400" : "bg-white border-slate-300 text-slate-800 placeholder:text-slate-400 focus:border-purple-500"}`}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className={isDark ? "text-slate-300" : "text-slate-600"}>Email (Login Username)</Label>
                  <Input
                    type="email"
                    required
                    placeholder="rahul@sethu.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className={`mt-1 ${isDark ? "bg-slate-900/50 border-cyan-500/30 text-white focus:border-cyan-400" : "bg-white border-slate-300 text-slate-800 placeholder:text-slate-400 focus:border-purple-500"}`}
                  />
                </div>
                <div>
                  <Label className={isDark ? "text-slate-300" : "text-slate-600"}>Username</Label>
                  <Input
                    required
                    placeholder="rahul_s"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    minLength={3}
                    maxLength={60}
                    className={`mt-1 ${isDark ? "bg-slate-900/50 border-cyan-500/30 text-white focus:border-cyan-400" : "bg-white border-slate-300 text-slate-800 placeholder:text-slate-400 focus:border-purple-500"}`}
                  />
                  {/* The server wants three characters, and nothing beyond
                      letters, numbers, dot, underscore and hyphen. A two-letter
                      username was refused with nothing on screen saying which
                      field had failed. */}
                  <p className={`mt-1 text-[11px] ${username && username.length < 3
                    ? "text-rose-500 font-medium"
                    : (isDark ? "text-slate-400" : "text-slate-500")}`}>
                    3+ characters · letters, numbers, . _ -
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className={isDark ? "text-slate-300" : "text-slate-600"}>Target Company Tenant</Label>
                  <div className={`w-full mt-1 p-2 rounded border text-sm font-semibold opacity-70 cursor-not-allowed ${isDark ? "bg-slate-900/50 border-cyan-500/30 text-white" : "bg-slate-100 border-slate-300 text-slate-600"}`}>
                    {selectedUserForEdit.companyName}
                  </div>
                </div>

                <div>
                  <Label className={isDark ? "text-slate-300" : "text-slate-600"}>User Role</Label>
                  <select
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                    className={`w-full mt-1 p-2 rounded border text-sm ${isDark ? "bg-slate-900/50 border-cyan-500/30 text-white focus:border-cyan-400" : "bg-white border-slate-300 text-slate-800 focus:border-purple-500"}`}
                  >
                    {CREATABLE_ROLES.map((r) => (
                      <option key={r.code} value={r.code}>{r.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className={`pt-4 flex justify-end gap-3 border-t ${isDark ? "border-cyan-500/20" : "border-slate-300"}`}>
                <Button type="button" variant="outline" onClick={() => setIsEditModalOpen(false)} className={isDark ? "text-slate-300 border-cyan-500/30 hover:bg-cyan-900/30" : "text-slate-600 border-slate-300 hover:bg-slate-100 hover:text-slate-800"}>
                  Cancel
                </Button>
                <Button type="submit" className={isDark ? "bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold border border-cyan-400 shadow-[0_0_10px_rgba(6,182,212,0.4)]" : "bg-purple-600 hover:bg-purple-500 text-white border border-purple-400 "}>
                  Update Account
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/*
        Both of these change somebody's account, and one of them cannot be
        undone -- so they are asked in the application's own dialog with the
        person named, and deleting still requires the username typed out.
      */}
      <ConfirmDialog
        open={!!confirmAction}
        title={confirmAction?.kind === "delete"
          ? `Permanently delete ${confirmAction.user.name}?`
          : confirmAction
            ? `Make ${confirmAction.user.name} a company administrator?`
            : ""}
        description={confirmAction?.kind === "delete"
          ? "This removes the account and everything tied to it. It cannot be undone."
          : "Their existing role is replaced, not added to — an administrator is an administrator rather than an employee who is also one, so they leave the employee count."}
        detail={confirmAction ? [
          ["Name", confirmAction.user.name ?? "—"],
          ["Username", confirmAction.user.username ?? "—"],
          ["Company", confirmAction.user.companyName ?? "—"],
        ] : undefined}
        confirmPhrase={confirmAction?.kind === "delete" ? confirmAction.user.username : undefined}
        confirmPhraseLabel="username"
        confirmLabel={confirmAction?.kind === "delete" ? "Yes, delete it" : "Yes, make them admin"}
        cancelLabel="No, go back"
        onCancel={() => setConfirmAction(null)}
        onConfirm={() => {
          const a = confirmAction;
          setConfirmAction(null);
          if (!a) return;
          if (a.kind === "delete") handleDeleteUser(a.user);
          else handleMakeAdmin(a.user);
        }}
      />
    </div>
  );
}
