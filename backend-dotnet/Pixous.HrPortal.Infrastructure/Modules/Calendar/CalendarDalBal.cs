using Dapper;
using Pixous.HrPortal.Domain.Common;
using Pixous.HrPortal.Domain.Modules.Calendar;
using Pixous.HrPortal.Domain.Security;
using Pixous.HrPortal.Infrastructure.Persistence;

namespace Pixous.HrPortal.Infrastructure.Modules.Calendar;

/// <summary>Dapper access to <c>company_events</c>.</summary>
public sealed class CalendarDal : DalBase, ICalendarDal
{
    public CalendarDal(IDbConnectionFactory connectionFactory) : base(connectionFactory) { }

    private const string Columns = """
        id            AS Id,
        title         AS Title,
        description   AS Description,
        event_type    AS EventType,
        event_date    AS EventDate,
        end_date      AS EndDate,
        start_time    AS StartTime,
        end_time      AS EndTime,
        location      AS Location,
        audience_team AS AudienceTeam,
        created_by    AS CreatedBy,
        created_at    AS CreatedAt,
        company_id    AS CompanyId
        """;

    /// <summary>
    /// <c>COALESCE(end_date, event_date) &gt;= from</c> is what keeps a
    /// multi-day event visible on its last day: a single-day event stores no
    /// end date, so its own date stands in.
    /// </summary>
    public async Task<IReadOnlyList<CompanyEventRow>> FindTouchingAsync(
        DateOnly from, DateOnly to, CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<CompanyEventRow>(
            new CommandDefinition($"""
                SELECT {Columns} FROM company_events
                WHERE event_date <= @to
                  AND COALESCE(end_date, event_date) >= @from
                ORDER BY event_date ASC, start_time ASC
                """, new { from, to }, cancellationToken: ct)), ct)).AsList();

    public Task<CompanyEventRow?> FindAsync(long id, CancellationToken ct = default) =>
        QueryAsync(conn => conn.QueryFirstOrDefaultAsync<CompanyEventRow>(
            new CommandDefinition($"SELECT {Columns} FROM company_events WHERE id = @id",
                new { id }, cancellationToken: ct)), ct);

    public Task<long> InsertAsync(CompanyEventRow row, CancellationToken ct = default) =>
        QueryAsync(async conn =>
        {
            row.CreatedAt ??= DateTime.Now;
            row.Id = await conn.ExecuteScalarAsync<long>(new CommandDefinition("""
                INSERT INTO company_events
                    (title, description, event_type, event_date, end_date, start_time,
                     end_time, location, audience_team, created_by, created_at, company_id)
                VALUES
                    (@Title, @Description, @EventType, @EventDate, @EndDate, @StartTime,
                     @EndTime, @Location, @AudienceTeam, @CreatedBy, @CreatedAt, @CompanyId);
                SELECT LAST_INSERT_ID();
                """, row, cancellationToken: ct));
            return row.Id;
        }, ct);

    /// <summary>
    /// created_by and created_at are left alone: an edit records what changed,
    /// not who last touched it, and overwriting the author would lose who
    /// actually put the event on the calendar.
    /// </summary>
    public Task UpdateAsync(CompanyEventRow row, CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteAsync(new CommandDefinition("""
            UPDATE company_events SET
                title         = @Title,
                description   = @Description,
                event_type    = @EventType,
                event_date    = @EventDate,
                end_date      = @EndDate,
                start_time    = @StartTime,
                end_time      = @EndTime,
                location      = @Location,
                audience_team = @AudienceTeam
            WHERE id = @Id
            """, row, cancellationToken: ct)), ct);

    public Task DeleteAsync(long id, CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteAsync(
            new CommandDefinition("DELETE FROM company_events WHERE id = @id",
                new { id }, cancellationToken: ct)), ct);

    public async Task<IReadOnlyList<CalendarPerson>> FindEnabledPeopleAsync(
        CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<CalendarPerson>(
            new CommandDefinition("""
                SELECT id AS Id, name AS Name, employee_code AS EmployeeCode,
                       designation_title AS DesignationTitle, photo_path AS PhotoPath,
                       profile_status AS ProfileStatus, dob AS Dob,
                       date_of_joining AS DateOfJoining
                FROM users WHERE enabled = 1
                """, cancellationToken: ct)), ct)).AsList();

    public Task<string?> FindTeamAsync(long userId, CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteScalarAsync<string?>(
            new CommandDefinition("SELECT designation_title FROM users WHERE id = @userId",
                new { userId }, cancellationToken: ct)), ct);
}

/// <summary>Ported from CalendarService.</summary>
public sealed class CalendarBal : ICalendarBal
{
    private readonly ICalendarDal _dal;
    private readonly ICurrentUser _currentUser;

    public CalendarBal(ICalendarDal dal, ICurrentUser currentUser)
    {
        _dal = dal;
        _currentUser = currentUser;
    }

    public async Task<IReadOnlyList<CalendarEvent>> EventsAsync(
        DateOnly? from, DateOnly? to, long? requesterId, CancellationToken ct = default)
    {
        if (from is null || to is null || to.Value < from.Value)
        {
            throw ApiException.Business("Give a from date and a to date, in that order.");
        }

        if (to.Value.DayNumber - from.Value.DayNumber > CalendarRules.MaxRangeDays)
        {
            throw ApiException.Business("Ask for a year at a time or less.");
        }

        var events = new List<CalendarEvent>();

        // ---- birthdays and anniversaries, worked out from the records ----
        foreach (CalendarPerson u in await _dal.FindEnabledPeopleAsync(ct))
        {
            if (string.Equals(u.ProfileStatus, "OFFBOARDED", StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            AddRecurring(events, u, u.Dob, "BIRTHDAY", from.Value, to.Value);
            AddRecurring(events, u, u.DateOfJoining, "ANNIVERSARY", from.Value, to.Value);
        }

        // ---- company events, narrowed to the caller's audience ----
        bool privileged = _currentUser.HasPermission("ORG_MANAGE")
                       || _currentUser.HasPermission("USER_MANAGE");

        string? myTeam = null;

        // Only looked up when it will actually be used: somebody privileged
        // sees everything, so their team is irrelevant.
        if (!privileged && requesterId is not null)
        {
            myTeam = await _dal.FindTeamAsync(requesterId.Value, ct);
        }

        foreach (CompanyEventRow e in await _dal.FindTouchingAsync(from.Value, to.Value, ct))
        {
            if (CalendarRules.IsVisibleTo(e.AudienceTeam, myTeam, privileged))
            {
                events.Add(ToEvent(e));
            }
        }

        // Date, then start time, then title -- the Java's three-key sort. An
        // absent start time sorts as "" so all-day entries come first.
        return events
            .OrderBy(c => c.Date)
            .ThenBy(c => c.StartTime ?? "", StringComparer.Ordinal)
            .ThenBy(c => c.Title, StringComparer.OrdinalIgnoreCase)
            .ToArray();
    }

    /// <summary>
    /// Every occurrence of a yearly date inside the range.
    ///
    /// A range may span a new year, so MORE THAN ONE occurrence can land in it —
    /// which is why this loops over the years rather than computing one date.
    /// </summary>
    private static void AddRecurring(List<CalendarEvent> into, CalendarPerson u, DateOnly? baseDate,
                                     string type, DateOnly from, DateOnly to)
    {
        if (baseDate is null)
        {
            return;
        }

        for (int year = from.Year; year <= to.Year; year++)
        {
            DateOnly when = CalendarRules.OnYear(baseDate.Value, year);

            if (when < from || when > to)
            {
                continue;
            }

            int? years = null;

            if (type == "ANNIVERSARY")
            {
                int completed = when.Year - baseDate.Value.Year;

                // The joining day itself is not an anniversary.
                if (completed < 1)
                {
                    continue;
                }

                years = completed;
            }

            string title = type == "BIRTHDAY"
                ? $"{u.Name}'s birthday"
                : $"{u.Name} · {years} {(years == 1 ? "year" : "years")}";

            into.Add(new CalendarEvent(
                null, type, title, null, when, null, null, null, null, null,
                u.Id, u.Name, u.EmployeeCode, u.DesignationTitle, u.PhotoPath, years));
        }
    }

    public async Task<CalendarEvent> CreateAsync(EventRequest request, long? actorId,
                                                 CancellationToken ct = default)
    {
        var row = new CompanyEventRow { CreatedBy = actorId };
        Apply(row, request);

        await _dal.InsertAsync(row, ct);
        return ToEvent(row);
    }

    public async Task<CalendarEvent> UpdateAsync(long id, EventRequest request,
                                                 CancellationToken ct = default)
    {
        CompanyEventRow row = await _dal.FindAsync(id, ct) ?? throw ApiException.NotFound("Event");

        Apply(row, request);

        await _dal.UpdateAsync(row, ct);
        return ToEvent(row);
    }

    public async Task DeleteAsync(long id, CancellationToken ct = default)
    {
        _ = await _dal.FindAsync(id, ct) ?? throw ApiException.NotFound("Event");
        await _dal.DeleteAsync(id, ct);
    }

    /// <summary>Validates a request onto a row. Shared by create and update.</summary>
    private static void Apply(CompanyEventRow e, EventRequest req)
    {
        string title = (req.Title ?? "").Trim();

        if (title.Length == 0)
        {
            throw ApiException.Business("Give the event a name.");
        }

        if (req.EventDate is null)
        {
            throw ApiException.Business("Pick a date for the event.");
        }

        // An unrecognised type falls back to OTHER rather than being refused --
        // the event is worth keeping even if the category was wrong.
        string type = (req.EventType ?? "").Trim().ToUpperInvariant();

        if (!CalendarRules.Types.Contains(type))
        {
            type = "OTHER";
        }

        DateOnly? end = req.EndDate;

        if (end is not null && end.Value < req.EventDate.Value)
        {
            throw ApiException.Business("The last day cannot be before the first.");
        }

        // A single-day event needs no end date; storing one is only noise.
        if (end is not null && end.Value == req.EventDate.Value)
        {
            end = null;
        }

        if (!CalendarRules.TryParseTime(req.StartTime, out TimeOnly? start))
        {
            throw ApiException.Business("Give the start time as HH:mm.");
        }

        if (!CalendarRules.TryParseTime(req.EndTime, out TimeOnly? finish))
        {
            throw ApiException.Business("Give the end time as HH:mm.");
        }

        // Only checked on a single-day event: across several days an end time
        // earlier than the start is normal.
        if (start is not null && finish is not null && finish < start && end is null)
        {
            throw ApiException.Business("The end time is before the start time.");
        }

        e.Title = title;
        e.Description = Blank(req.Description);
        e.EventType = type;
        e.EventDate = req.EventDate.Value;
        e.EndDate = end;
        e.StartTime = start;
        e.EndTime = finish;
        e.Location = Blank(req.Location);
        e.AudienceTeam = Blank(req.AudienceTeam);
    }

    private static string? Blank(string? s) =>
        string.IsNullOrWhiteSpace(s) ? null : s.Trim();

    private static CalendarEvent ToEvent(CompanyEventRow e) =>
        new(e.Id, e.EventType ?? "OTHER", e.Title, e.Description, e.EventDate, e.EndDate,
            e.StartTime?.ToString("HH:mm:ss"), e.EndTime?.ToString("HH:mm:ss"),
            e.Location, e.AudienceTeam,
            null, null, null, null, null, null);
}
