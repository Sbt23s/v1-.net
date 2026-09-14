namespace Pixous.HrPortal.Domain.Modules.Admin;

/// <summary>
/// The areas a data reset can clear, with what each one clears and what it
/// deliberately leaves behind. Ported from
/// com.pixous.hrportal.modules.admin.DataResetService.Area.
///
/// The <c>Keeps</c> text is shown to whoever is about to press the button, so it
/// is carried over word for word: "the asset inventory itself stays" is the
/// difference between clearing who holds what and losing the asset register.
/// </summary>
public sealed record DataResetArea(string Name, string Clears, string Keeps)
{
    public static readonly DataResetArea Attendance =
        new("ATTENDANCE", "Attendance punches", "Shifts, sites and holidays stay");

    public static readonly DataResetArea Leave =
        new("LEAVE", "Leave requests, and the used count on balances",
            "Leave types, policies and the allocated days stay");

    public static readonly DataResetArea Permission =
        new("PERMISSION", "Permission (short-leave) requests", "");

    public static readonly DataResetArea WorkReports =
        new("WORK_REPORTS", "Work reports and their attachments", "");

    public static readonly DataResetArea Tasks =
        new("TASKS", "Tasks and every task discussion", "");

    public static readonly DataResetArea Payroll =
        new("PAYROLL",
            "Payslips, payroll runs, payslip requests, month-wise basic pay, salary structures",
            "Bank details stay");

    public static readonly DataResetArea Chat =
        new("CHAT", "Chat messages, reactions, read marks and poll votes",
            "The rooms themselves and who is in them stay");

    public static readonly DataResetArea Helpdesk =
        new("HELPDESK", "Support tickets and their comments", "");

    public static readonly DataResetArea Complaints =
        new("COMPLAINTS", "Complaints and needs", "");

    public static readonly DataResetArea Discipline =
        new("DISCIPLINE", "Disciplinary records", "");

    public static readonly DataResetArea Appreciation =
        new("APPRECIATION", "Appreciation letters", "");

    public static readonly DataResetArea Claims =
        new("CLAIMS", "Travel and expense claims", "");

    public static readonly DataResetArea Notifications =
        new("NOTIFICATIONS", "Notifications", "");

    public static readonly DataResetArea AssetAllocations =
        new("ASSET_ALLOCATIONS", "Who is holding which asset",
            "The asset inventory itself stays");

    public static readonly DataResetArea Performance =
        new("PERFORMANCE", "Performance reviews and goals", "");

    public static readonly DataResetArea Safety =
        new("SAFETY", "Safety incidents", "");

    public static readonly DataResetArea Onboarding =
        new("ONBOARDING", "Onboarding checklists and their tasks", "");

    public static readonly DataResetArea CalendarEvents =
        new("CALENDAR_EVENTS", "Celebrations, meetings and training on the calendar",
            "Public holidays stay — those are not events");

    public static readonly DataResetArea LoginHistory =
        new("LOGIN_HISTORY", "Login history", "Nobody is signed out");

    /// <summary>Every area, in the order the Java enum declares them.</summary>
    public static readonly IReadOnlyList<DataResetArea> All =
    [
        Attendance, Leave, Permission, WorkReports, Tasks, Payroll, Chat, Helpdesk,
        Complaints, Discipline, Appreciation, Claims, Notifications, AssetAllocations,
        Performance, Safety, Onboarding, CalendarEvents, LoginHistory
    ];

    /// <summary>
    /// Resolves a name, trimmed and upper-cased as the Java's
    /// <c>Area.valueOf(name.trim().toUpperCase())</c> does. Null when unknown.
    /// </summary>
    public static DataResetArea? Parse(string? name)
    {
        if (string.IsNullOrWhiteSpace(name))
        {
            return null;
        }

        string key = name.Trim().ToUpperInvariant();
        return All.FirstOrDefault(a => a.Name == key);
    }
}
