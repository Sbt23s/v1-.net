namespace Pixous.HrPortal.Domain.Modules.Privileges;

/// <summary>
/// One permission code as the Privileges screen presents it: which module it
/// belongs to, which actions it unlocks there, and whether any endpoint
/// actually checks it.
///
/// The codes are the ones the endpoints are guarded by -- [Authorize(Policy =
/// "LEAVE_APPROVE")] and the in-code HasPermission checks. Nothing here grants
/// anything by itself; it describes what granting the code already does, so an
/// admin ticking a box knows what they have just opened up.
/// </summary>
public sealed record PermissionDefinition(
    string Code,
    string Module,
    string Label,
    string Description,
    IReadOnlyList<string> Actions,
    bool Enforced,
    bool Critical);

public static class PrivilegeCatalog
{
    // Action names, shared with the web client's column headers.
    public const string View = "View";
    public const string ViewAll = "View All";
    public const string Create = "Create";
    public const string Edit = "Edit";
    public const string Delete = "Delete";
    public const string Approve = "Approve";
    public const string Reject = "Reject";
    public const string Export = "Export";
    public const string Import = "Import";
    public const string Assign = "Assign";
    public const string Configure = "Configure";

    /// <summary>
    /// Every permission code the application knows, grouped by module.
    ///
    /// <c>Enforced = false</c> marks the three codes no endpoint checks
    /// (ATTENDANCE_SELF, LEAVE_APPLY, HELPDESK_RAISE): every signed-in person
    /// can punch in, apply for leave and raise a ticket whether or not they
    /// hold them. The screen says so rather than letting an admin believe that
    /// unticking one stops anybody.
    /// </summary>
    public static readonly IReadOnlyList<PermissionDefinition> Permissions =
    [
        new("USER_MANAGE", "Employees", "Full employee administration",
            "Create, edit, offboard and delete employees; onboarding; biometric admin; leave types; system settings; AI assistant settings. Also counts as admin for leave, tasks and requests.",
            [ViewAll, Create, Edit, Delete, Import, Export, Configure], true, true),
        new("EMPLOYEE_MANAGE", "Employees", "Manage employee records",
            "Add and edit employee records, bank details, documents and face photos; bulk import; view the audit log.",
            [ViewAll, Create, Edit, Delete, Import], true, false),

        new("ATTENDANCE_SELF", "Attendance", "Own attendance",
            "Punch in/out and view own attendance. Not checked by any endpoint: every employee can already do this.",
            [View, Create], false, false),
        new("ATTENDANCE_TEAM", "Attendance", "Team attendance",
            "View team and company attendance, who is absent today, team WFH; open the employee directory.",
            [ViewAll, Export], true, false),

        new("LEAVE_APPLY", "Leave", "Apply for leave",
            "Apply for own leave. Not checked by any endpoint: every employee can already do this.",
            [Create], false, false),
        new("LEAVE_APPROVE", "Leave", "Approve leave & permission",
            "See pending leave and short-permission requests addressed to them, approve, reject and bulk-decide; the leave calendar.",
            [ViewAll, Approve, Reject], true, false),

        new("PAYROLL_VIEW", "Payroll", "View payroll",
            "View salary structures, payslips of other employees and monthly salary sheets; bank details; payroll reports.",
            [ViewAll, Export], true, false),
        new("PAYROLL_RUN", "Payroll", "Run payroll",
            "Generate payslips, set salaries, create and confirm payroll runs, handle payroll requests, LOP preview.",
            [Create, Edit, Approve, Reject], true, false),
        new("PAYROLL_APPROVE", "Payroll", "Finance approval",
            "Finance-approve and finalise payroll runs.",
            [ViewAll, Approve], true, false),

        new("ASSET_MANAGE", "Assets", "Manage assets",
            "View the inventory, add, delete, allocate and take back assets.",
            [ViewAll, Create, Delete, Assign], true, false),

        new("HELPDESK_RAISE", "Helpdesk", "Raise tickets",
            "Raise own helpdesk tickets. Not checked by any endpoint: every employee can already do this.",
            [Create], false, false),
        new("HELPDESK_AGENT", "Helpdesk", "Helpdesk agent",
            "See tickets assigned to them and all tickets; change ticket status.",
            [ViewAll, Edit], true, false),

        new("COMPLAINT_MANAGE", "Complaints & Discipline", "Handle complaints & discipline",
            "Review and respond to complaints; issue, edit and cancel discipline records; issue appreciation letters.",
            [ViewAll, Create, Edit, Delete], true, false),

        new("CLAIM_APPROVE", "Claims", "Approve claims",
            "See every TA/expense claim and approve or reject it; email claim reports.",
            [ViewAll, Approve, Reject, Export], true, false),

        new("TASK_ASSIGN", "Tasks", "Assign tasks",
            "Create, edit and assign tasks; see the task list.",
            [Create, Edit, Assign], true, false),
        new("TASK_VIEW_ALL", "Tasks", "View all tasks",
            "See every task, export them, configure and send task reminders.",
            [ViewAll, Export, Configure], true, false),

        new("REPORT_VIEW", "Reports", "View reports",
            "Attendance, leave and payroll reports; every work report and its export; safety incidents.",
            [ViewAll, Export], true, false),

        new("DASHBOARD_EXEC", "Dashboard", "Executive dashboard",
            "Executive dashboard and org insights; sees everyone's attendance, WFH, tickets and claims.",
            [ViewAll, Approve], true, false),

        new("ORG_MANAGE", "Organization", "Organization setup",
            "Leave policies and allocations, calendar events, designations, office locations, holidays, approval routing; approve claims.",
            [Create, Edit, Delete, Configure], true, true),
        new("TEAM_MANAGE", "Organization", "Manage teams",
            "Create and edit teams and designations.",
            [Create, Edit, Delete], true, false),
        new("CALENDAR_MANAGE", "Organization", "Manage calendar",
            "Add and remove company holidays and calendar events.",
            [Create, Edit, Delete], true, false),

        new("COMMUNITY_MANAGE", "Communities", "Manage communities",
            "Open the Communities admin area and the onboarding employee list.",
            [ViewAll, Create, Delete], true, false),
    ];

    public static readonly IReadOnlySet<string> KnownCodes =
        Permissions.Select(p => p.Code).ToHashSet(StringComparer.Ordinal);

    public static readonly IReadOnlyList<string> Actions =
        [View, ViewAll, Create, Edit, Delete, Approve, Reject, Export, Import, Assign, Configure];

    // ---- Protection -------------------------------------------------------

    public const string SuperAdmin = "SUPER_ADMIN";
    public const string CompanyAdmin = "COMPANY_ADMIN";

    /// <summary>The roles that open Admin Settings itself.</summary>
    public static readonly IReadOnlySet<string> AdminRoles =
        new HashSet<string>(StringComparer.Ordinal) { SuperAdmin, CompanyAdmin };

    /// <summary>
    /// Codes that can never be taken away from an admin role. Without these an
    /// admin still opens Settings (that is role-gated) but loses the employee
    /// and organisation screens they would need to repair the damage.
    /// </summary>
    public static readonly IReadOnlySet<string> LockedAdminCodes =
        new HashSet<string>(StringComparer.Ordinal) { "USER_MANAGE", "ORG_MANAGE" };

    /// <summary>A bulk change larger than this is refused rather than half-applied.</summary>
    public const int MaxBulkUsers = 500;
}
