namespace Pixous.HrPortal.Domain.Modules.Calendar;

/// <summary>
/// Everything the company puts on a calendar, in one list. Ported from
/// com.pixous.hrportal.modules.calendar.CalendarService.
///
/// <para>Two of the kinds are <b>not stored anywhere</b>: a birthday and a work
/// anniversary are worked out from the employee record for the range being
/// looked at, so they need no yearly upkeep and cannot drift out of step with
/// the profile.</para>
///
/// <para><b>Holidays are deliberately left out.</b> The page already reads them
/// and has to keep reading them separately, because a holiday is what makes a
/// day non-working — merging it in here would blur a distinction payroll
/// depends on.</para>
/// </summary>
public interface ICalendarBal
{
    /// <summary>
    /// Birthdays, anniversaries and company events touching the range.
    ///
    /// An event addressed to one team is shown to that team and to whoever runs
    /// the portal; a training session for the Civil site has no business
    /// filling everybody else's month.
    /// </summary>
    Task<IReadOnlyList<CalendarEvent>> EventsAsync(DateOnly? from, DateOnly? to, long? requesterId,
                                                   CancellationToken ct = default);

    Task<CalendarEvent> CreateAsync(EventRequest request, long? actorId,
                                    CancellationToken ct = default);

    Task<CalendarEvent> UpdateAsync(long id, EventRequest request, CancellationToken ct = default);

    Task DeleteAsync(long id, CancellationToken ct = default);
}

/// <summary>The rules that decide what a calendar range and an event may be.</summary>
public static class CalendarRules
{
    /// <summary>The event types a company event may carry.</summary>
    public static readonly IReadOnlySet<string> Types =
        new HashSet<string>(StringComparer.Ordinal)
        {
            "CELEBRATION", "MEETING", "TRAINING", "OTHER"
        };

    /// <summary>
    /// The widest range that may be asked for.
    ///
    /// A year and a bit. The birthday and anniversary rows are generated per
    /// year of the range, so an unbounded range would generate unboundedly.
    /// </summary>
    public const int MaxRangeDays = 400;

    /// <summary>
    /// The same day in another year; 29 February lands on 1 MARCH in a common
    /// year.
    ///
    /// Note this differs from the dashboard, which builds the first of the
    /// month and adds one — landing on the same date by a different route. Here
    /// the Java hard-codes 1 March in the catch, so that is what this does.
    /// </summary>
    public static DateOnly OnYear(DateOnly baseDate, int year)
    {
        if (baseDate.Day > DateTime.DaysInMonth(year, baseDate.Month))
        {
            return new DateOnly(year, 3, 1);
        }

        return new DateOnly(year, baseDate.Month, baseDate.Day);
    }

    /// <summary>
    /// Whether this event is visible to somebody on this team.
    ///
    /// An event with no audience is for everybody. One addressed to a team is
    /// for that team only — and for anybody privileged, who sees all of them.
    /// </summary>
    public static bool IsVisibleTo(string? audienceTeam, string? myTeam, bool privileged)
    {
        if (privileged || string.IsNullOrWhiteSpace(audienceTeam))
        {
            return true;
        }

        return myTeam is not null
            && string.Equals(audienceTeam.Trim(), myTeam.Trim(), StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>
    /// A time typed as HH:mm, or the first five characters of something longer.
    ///
    /// The Java takes <c>substring(0, 5)</c> of anything that is not exactly
    /// five characters, so "09:30:00" becomes "09:30" — and a three-character
    /// value throws, which becomes the business error below.
    /// </summary>
    public static bool TryParseTime(string? raw, out TimeOnly? time)
    {
        time = null;

        if (string.IsNullOrWhiteSpace(raw))
        {
            return true;   // absent is valid; it simply has no time
        }

        string trimmed = raw.Trim();

        if (trimmed.Length < 5)
        {
            return false;
        }

        string head = trimmed.Length == 5 ? trimmed : trimmed[..5];

        if (TimeOnly.TryParseExact(head, "HH:mm", out TimeOnly parsed))
        {
            time = parsed;
            return true;
        }

        return false;
    }
}

/// <summary>
/// One thing on one day, whatever kind of thing it is.
///
/// Birthdays and anniversaries are worked out rather than stored, so they carry
/// a person; a meeting carries a time and a place instead. Everything the
/// calendar draws comes through this one shape.
/// </summary>
public sealed record CalendarEvent(
    /// <summary>Null for a birthday or anniversary — those have no row of their own.</summary>
    long? Id,

    /// <summary>BIRTHDAY | ANNIVERSARY | CELEBRATION | MEETING | TRAINING | OTHER.</summary>
    string Type,

    string? Title,
    string? Description,
    DateOnly Date,

    /// <summary>Set only for something running over more than one day.</summary>
    DateOnly? EndDate,

    string? StartTime,
    string? EndTime,
    string? Location,

    /// <summary>Null means the whole company.</summary>
    string? AudienceTeam,

    // ---- set only for a birthday or an anniversary ----
    long? UserId,
    string? EmployeeName,
    string? EmployeeCode,
    string? Team,
    string? PhotoPath,

    /// <summary>Years completed, on an anniversary.</summary>
    int? Years);

/// <summary>Create or update payload for a company event.</summary>
public sealed record EventRequest
{
    public string? Title { get; init; }
    public string? Description { get; init; }
    public string? EventType { get; init; }
    public DateOnly? EventDate { get; init; }
    public DateOnly? EndDate { get; init; }
    public string? StartTime { get; init; }
    public string? EndTime { get; init; }
    public string? Location { get; init; }
    public string? AudienceTeam { get; init; }
}

/// <summary>A row of <c>company_events</c>.</summary>
public sealed class CompanyEventRow
{
    public long Id { get; set; }
    public string? Title { get; set; }
    public string? Description { get; set; }
    public string? EventType { get; set; }
    public DateOnly EventDate { get; set; }
    public DateOnly? EndDate { get; set; }
    public TimeOnly? StartTime { get; set; }
    public TimeOnly? EndTime { get; set; }
    public string? Location { get; set; }
    public string? AudienceTeam { get; set; }
    public long? CreatedBy { get; set; }
    public DateTime? CreatedAt { get; set; }
    public long? CompanyId { get; set; }
}

/// <summary>A person, as the calendar needs them for birthdays and anniversaries.</summary>
public sealed record CalendarPerson(
    long Id,
    string? Name,
    string? EmployeeCode,
    string? DesignationTitle,
    string? PhotoPath,
    string? ProfileStatus,
    DateOnly? Dob,
    DateOnly? DateOfJoining);

/// <summary>Data access for the calendar.</summary>
public interface ICalendarDal
{
    /// <summary>
    /// Everything touching the range, INCLUDING a multi-day event that started
    /// before it — a five-day training should still show on its last day.
    /// </summary>
    Task<IReadOnlyList<CompanyEventRow>> FindTouchingAsync(DateOnly from, DateOnly to,
                                                           CancellationToken ct = default);

    Task<CompanyEventRow?> FindAsync(long id, CancellationToken ct = default);
    Task<long> InsertAsync(CompanyEventRow row, CancellationToken ct = default);
    Task UpdateAsync(CompanyEventRow row, CancellationToken ct = default);
    Task DeleteAsync(long id, CancellationToken ct = default);

    Task<IReadOnlyList<CalendarPerson>> FindEnabledPeopleAsync(CancellationToken ct = default);

    /// <summary>The team a person is on, for the audience rule.</summary>
    Task<string?> FindTeamAsync(long userId, CancellationToken ct = default);
}
