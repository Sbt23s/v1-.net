using System.Globalization;
using Pixous.HrPortal.Domain.Common;
using Pixous.HrPortal.Domain.Modules.Dashboard;
using Pixous.HrPortal.Domain.Modules.Leave;
using Pixous.HrPortal.Domain.Modules.Notification;

namespace Pixous.HrPortal.Infrastructure.Modules.Dashboard;

/// <summary>
/// Ported from com.pixous.hrportal.modules.dashboard.DashboardService.
///
/// The date and eligibility judgements live in <see cref="CelebrationRules"/>
/// and <see cref="OrgInsightRules"/> in the Domain; what remains here is
/// gathering rows and shaping the payloads.
/// </summary>
public sealed class DashboardBal : IDashboardBal
{
    private readonly IDashboardDal _dal;
    private readonly ILeaveBal _leave;
    private readonly INotificationBal _notifications;

    public DashboardBal(IDashboardDal dal, ILeaveBal leave, INotificationBal notifications)
    {
        _dal = dal;
        _leave = leave;
        _notifications = notifications;
    }

    /// <summary>Office close, for the early-out count.</summary>
    private static readonly TimeOnly OfficeEnd = new(18, 0);

    // ---- The employee's own dashboard -------------------------------------

    public async Task<EmployeeDashboard> EmployeeAsync(long userId, CancellationToken ct = default)
    {
        DashboardUser user = await _dal.FindUserAsync(userId, ct)
            ?? throw ApiException.NotFound("User");

        DateOnly today = DateOnly.FromDateTime(DateTime.Now);

        DashboardAttendance? att = await _dal.FindAttendanceForAsync(userId, today, ct);

        IReadOnlyList<LeaveBalanceRecord> balances =
            await _leave.ListBalancesAsync(userId, today.Year, ct);

        long pendingLeaves = await _dal.CountPendingLeaveForAsync(userId, ct);
        long openTickets = await _dal.CountOpenTicketsForAsync(userId, ct);
        long myAssets = await _dal.CountAssetsForAsync(userId, ct);

        PageResponse<NotificationResponse> recent =
            await _notifications.ListAsync(userId, 0, 5, ct);

        return new EmployeeDashboard(
            user.Name,
            user.EmployeeCode,
            att?.PunchInAt is not null,
            att?.PunchInAt,
            att?.PunchOutAt,
            att?.WorkedMinutes,
            balances,
            pendingLeaves,
            openTickets,
            myAssets,
            recent.Content);
    }

    // ---- Celebrations ------------------------------------------------------

    public async Task<IReadOnlyList<Celebration>> CelebrationsAsync(
        string? industry, CancellationToken ct = default)
    {
        DateOnly today = DateOnly.FromDateTime(DateTime.Now);
        var celebrations = new List<Celebration>();

        foreach (DashboardUser u in await AddressableAsync(industry, ct))
        {
            AddUpcoming(celebrations, u, u.Dob, "BIRTHDAY", today, isAnniversary: false);
            AddUpcoming(celebrations, u, u.DateOfJoining, "ANNIVERSARY", today, isAnniversary: true);
        }

        // Nearest first, then cut. The industry filter has already run, so
        // narrowing to one side shows twelve of THAT side rather than whatever
        // survived an org-wide cut.
        return celebrations.OrderBy(c => c.DaysUntil)
                           .Take(CelebrationRules.CardLimit)
                           .ToArray();
    }

    public async Task<IReadOnlyList<Celebration>> CelebrationsInYearAsync(
        int year, string? industry, CancellationToken ct = default)
    {
        DateOnly today = DateOnly.FromDateTime(DateTime.Now);
        var celebrations = new List<Celebration>();

        foreach (DashboardUser u in await AddressableAsync(industry, ct))
        {
            AddInYear(celebrations, u, u.Dob, "BIRTHDAY", year, today, isAnniversary: false);
            AddInYear(celebrations, u, u.DateOfJoining, "ANNIVERSARY", year, today,
                      isAnniversary: true);
        }

        // Date order, and NO limit: somebody looking at a year wants the year,
        // and a list that silently drops the first eight months because they
        // have already happened is a list that cannot be checked against
        // anything.
        return celebrations.OrderBy(c => c.Date).ToArray();
    }

    /// <summary>Enabled, not offboarded, and in the selected industry.</summary>
    private async Task<IReadOnlyList<DashboardUser>> AddressableAsync(string? industry,
                                                                      CancellationToken ct)
    {
        string? want = OrgInsightRules.NormaliseIndustry(industry);

        return (await _dal.FindEnabledUsersAsync(ct))
            .Where(u => !OrgInsightRules.IsGone(u.ProfileStatus))
            .Where(u => want is null
                     || string.Equals(want, u.Industry, StringComparison.OrdinalIgnoreCase))
            .ToArray();
    }

    private static void AddUpcoming(List<Celebration> into, DashboardUser u, DateOnly? baseDate,
                                    string type, DateOnly today, bool isAnniversary)
    {
        if (baseDate is null)
        {
            return;
        }

        DateOnly next = CelebrationRules.NextOccurrence(baseDate.Value, today);

        if (!CelebrationRules.BelongsOnCard(baseDate.Value, next, today, isAnniversary))
        {
            return;
        }

        into.Add(new Celebration(
            u.Id, u.Name, u.EmployeeCode, u.DesignationTitle, u.PhotoPath, type, next,
            CelebrationRules.DaysBetween(today, next),
            CelebrationRules.YearsCompleted(baseDate.Value, next, isAnniversary)));
    }

    private static void AddInYear(List<Celebration> into, DashboardUser u, DateOnly? baseDate,
                                  string type, int year, DateOnly today, bool isAnniversary)
    {
        if (baseDate is null
            || !CelebrationRules.HasOccurrenceIn(baseDate.Value, year, isAnniversary))
        {
            return;
        }

        DateOnly on = CelebrationRules.InYear(baseDate.Value, year);

        into.Add(new Celebration(
            u.Id, u.Name, u.EmployeeCode, u.DesignationTitle, u.PhotoPath, type, on,
            CelebrationRules.DaysBetween(today, on),
            CelebrationRules.YearsInYear(baseDate.Value, year, isAnniversary)));
    }

    // ---- The organisation at a glance -------------------------------------

    public async Task<OrgInsights> OrgInsightsAsync(string? industry,
                                                    CancellationToken ct = default)
    {
        string? want = OrgInsightRules.NormaliseIndustry(industry);
        DateOnly today = DateOnly.FromDateTime(DateTime.Now);
        DateOnly monthStart = new(today.Year, today.Month, 1);

        DashboardUser[] everyone = (await _dal.FindAllUsersAsync(ct))
            .Where(u => want is null
                     || string.Equals(want, u.Industry, StringComparison.OrdinalIgnoreCase))
            .ToArray();

        DashboardUser[] active = everyone.Where(u => !OrgInsightRules.IsGone(u.ProfileStatus)
                                                 && !string.Equals(u.ProfileStatus, "RESIGNED", StringComparison.OrdinalIgnoreCase))
                                         .ToArray();
        DashboardUser[] gone = everyone.Where(u => OrgInsightRules.IsGone(u.ProfileStatus)
                                                || string.Equals(u.ProfileStatus, "RESIGNED", StringComparison.OrdinalIgnoreCase)
                                                || string.Equals(u.ProfileStatus, "NOTICE_PERIOD", StringComparison.OrdinalIgnoreCase))
                                       .ToArray();

        // ---- who has just joined ----
        DashboardUser[] joinedThisMonth = active
            .Where(u => u.DateOfJoining is not null
                     && u.DateOfJoining.Value >= monthStart
                     && u.DateOfJoining.Value <= today)
            .Where(u => !OrgInsightRules.IsPlatformAccount(u.EmployeeCode, u.Name))
            .OrderByDescending(u => u.DateOfJoining!.Value)
            .ToArray();

        long joinedToday = joinedThisMonth.Count(u => u.DateOfJoining == today);

        // ---- probation, and whose confirmation is due ----
        DashboardUser[] probation = active
            .Where(u => OrgInsightRules.IsOnProbation(u.EmploymentType, u.ProbationEndDate, today))
            .ToArray();

        DashboardUser[] confirmations = probation
            .Where(u => OrgInsightRules.IsConfirmationDue(
                            OrgInsightRules.ProbationEnd(u.ProbationEndDate, u.DateOfJoining),
                            today))
            .OrderBy(u => OrgInsightRules.ProbationEnd(u.ProbationEndDate, u.DateOfJoining)
                          ?? DateOnly.MaxValue)
            .ToArray();

        // ---- today's attendance, broken down ----
        var activeIds = active.Select(u => u.Id).ToHashSet();

        DashboardAttendance[] todays = (await _dal.FindAttendanceOnAsync(today, ct))
            .Where(a => activeIds.Contains(a.UserId))
            .ToArray();

        var wfhUserIds = todays
            .Where(a => string.Equals(a.Status, "WFH", StringComparison.OrdinalIgnoreCase))
            .Select(a => a.UserId)
            .ToHashSet();

        try
        {
            var approvedWfhIds = await _dal.FindApprovedWfhUserIdsOnAsync(today, ct);
            foreach (var uid in approvedWfhIds)
            {
                wfhUserIds.Add(uid);
            }
        }
        catch
        {
            // Fallback gracefully if table query encounters error
        }

        DashboardUser[] wfhUsers = active.Where(u => wfhUserIds.Contains(u.Id)).ToArray();
        long wfh = wfhUsers.Length;

        long present = todays.Count(a => a.PunchInAt is not null
                                      && !string.Equals(a.Status, "ABSENT",
                                                        StringComparison.OrdinalIgnoreCase));

        // Either signal counts: a recorded lateness in minutes, or the flag.
        long late = todays.Count(a => a.LateMinutes > 0 || a.Late);

        long earlyOut = todays.Count(a => a.PunchOutAt is not null
                                       && TimeOnly.FromDateTime(a.PunchOutAt.Value) < OfficeEnd);

        var marked = todays.Select(a => a.UserId).ToHashSet();
        long notMarked = active.Count(u => !marked.Contains(u.Id));

        // ---- how the company is distributed ----
        IReadOnlyDictionary<long, string> deptNames = await _dal.FindDepartmentNamesAsync(ct);
        IReadOnlyDictionary<long, string> desigNames = await _dal.FindDesignationNamesAsync(ct);

        IReadOnlyDictionary<string, long> byDepartment = CountBy(active, u =>
            !string.IsNullOrWhiteSpace(u.DepartmentTitle)
                ? u.DepartmentTitle.Trim()
                : Lookup(deptNames, u.DepartmentId, "Unassigned"));

        // Team is the designation title people actually carry; designation is
        // the master list entry. They differ often enough to show apart.
        IReadOnlyDictionary<string, long> byTeam = CountBy(active, u =>
            !string.IsNullOrWhiteSpace(u.DesignationTitle) ? u.DesignationTitle.Trim() : "No team");

        IReadOnlyDictionary<string, long> byDesignation = CountBy(active, u =>
            Lookup(desigNames, u.DesignationId,
                   !string.IsNullOrWhiteSpace(u.DesignationTitle)
                       ? u.DesignationTitle.Trim()
                       : "Unassigned"));

        // ---- joins and exits, month by month over the last year ----
        IReadOnlyDictionary<long, DateOnly> relievedOn =
            await _dal.FindRelievingDatesAsync(gone.Select(u => u.Id).ToArray(), ct);

        var growth = new List<IReadOnlyDictionary<string, object>>();
        for (int back = 11; back >= 0; back--)
        {
            DateOnly anchor = monthStart.AddMonths(-back);
            DateOnly from = new(anchor.Year, anchor.Month, 1);
            DateOnly to = from.AddMonths(1).AddDays(-1);

            long joined = everyone.Count(u => InRange(u.DateOfJoining, from, to));
            long exited = gone.Count(u => InRange(Relieved(relievedOn, u.Id), from, to));

            growth.Add(new Dictionary<string, object>
            {
                ["month"] = $"{MonthAbbrev(from)} {from.Year}",
                ["joined"] = joined,
                ["exited"] = exited
            });
        }

        return new OrgInsights(
            joinedToday, joinedThisMonth.Length, wfh, probation.Length, gone.Length,
            confirmations.Length,
            present, late, earlyOut, notMarked,
            People(joinedThisMonth, today, u => u.DateOfJoining),
            People(probation, today, u => OrgInsightRules.ProbationEnd(u.ProbationEndDate,
                                                                      u.DateOfJoining)),
            // This list says when each of them was RELIEVED, not when they joined.
            People(gone, today, u => Relieved(relievedOn, u.Id)),
            People(confirmations, today, u => OrgInsightRules.ProbationEnd(u.ProbationEndDate,
                                                                          u.DateOfJoining)),
            byDepartment, byTeam, byDesignation, growth,
            People(wfhUsers, today, u => today));
    }

    private static DateOnly? Relieved(IReadOnlyDictionary<long, DateOnly> map, long userId) =>
        map.TryGetValue(userId, out DateOnly d) ? d : null;

    private static string Lookup(IReadOnlyDictionary<long, string> map, long? id, string fallback) =>
        id is not null && map.TryGetValue(id.Value, out string? name) ? name : fallback;

    private static bool InRange(DateOnly? d, DateOnly from, DateOnly to) =>
        d is not null && d.Value >= from && d.Value <= to;

    /// <summary>Three-letter English month, as Java's TextStyle.SHORT gives.</summary>
    private static string MonthAbbrev(DateOnly d) =>
        CultureInfo.InvariantCulture.DateTimeFormat.GetAbbreviatedMonthName(d.Month);

    /// <summary>Grouped, counted, and ordered by count descending.</summary>
    private static IReadOnlyDictionary<string, long> CountBy(
        IEnumerable<DashboardUser> users, Func<DashboardUser, string> key)
    {
        var counts = new Dictionary<string, long>(StringComparer.Ordinal);

        foreach (DashboardUser u in users)
        {
            string k = key(u);
            counts[k] = counts.TryGetValue(k, out long n) ? n + 1 : 1;
        }

        return counts.OrderByDescending(e => e.Value)
                     .ToDictionary(e => e.Key, e => e.Value, StringComparer.Ordinal);
    }

    /// <summary>
    /// The people behind a count, capped at fifty.
    ///
    /// The cap is the Java's: these are list panels beside a headline number,
    /// and the number is the answer -- the list is there to be scanned, not
    /// paged through.
    /// </summary>
    private static IReadOnlyList<InsightPerson> People(
        IEnumerable<DashboardUser> users, DateOnly today, Func<DashboardUser, DateOnly?> dateOf) =>
        users.Take(50).Select(u =>
        {
            DateOnly? d = dateOf(u);

            return new InsightPerson(
                u.Id, u.Name, u.EmployeeCode, u.DesignationTitle, u.PhotoPath,
                d?.ToString("yyyy-MM-dd"),
                d is null ? null : CelebrationRules.DaysBetween(today, d.Value));
        }).ToArray();

    // ---- The executive dashboard ------------------------------------------

    public async Task<ExecutiveDashboard> ExecutiveAsync(string? industry,
                                                         CancellationToken ct = default)
    {
        // NOTE: unlike everywhere else, the executive dashboard does NOT treat
        // "ALL" as no filter -- it tests only for blank. Transcribed as-is; the
        // screen sends an empty value for Overall.
        string? filter = string.IsNullOrWhiteSpace(industry) ? null : industry.Trim();

        DateOnly today = DateOnly.FromDateTime(DateTime.Now);

        // Index every employee once so the per-record filters below do not hit
        // the database repeatedly. "" means no industry recorded.
        IReadOnlyList<DashboardUser> users = await _dal.FindAllUsersAsync(ct);

        var industryByUser = new Dictionary<long, string>();
        foreach (DashboardUser u in users)
        {
            industryByUser.TryAdd(u.Id, u.Industry ?? "");
        }

        // Does this record belong to somebody in THIS company, and in the
        // selected industry?
        //
        // Both halves matter. The Java carries a long note about the company
        // half having been missing: the counts run over tables that carry no
        // company_id at all (leave_requests, tickets, payslips), so an
        // administrator of one company was shown pending approvals, open
        // tickets, leave utilisation and payroll cost totalled across every
        // company on the installation. industryByUser is built from the user
        // table, which carries the tenant filter, so requiring the owner to be
        // in that map IS the company check and costs nothing extra.
        bool InFilter(long userId) =>
            industryByUser.TryGetValue(userId, out string? ind)
            && (filter is null || string.Equals(filter, ind, StringComparison.OrdinalIgnoreCase));

        // Currently-working headcount: offboarded staff excluded so "Total" and
        // the attendance percentage match the admin dashboard.
        var activeUserIds = users.Where(u => !OrgInsightRules.IsGone(u.ProfileStatus))
                                 .Select(u => u.Id)
                                 .ToHashSet();

        long headcount = users.Count(u => !OrgInsightRules.IsGone(u.ProfileStatus)
                                       && (filter is null
                                           || string.Equals(filter, u.Industry,
                                                            StringComparison.OrdinalIgnoreCase)));

        long presentToday = (await _dal.FindAttendanceOnAsync(today, ct))
            .Count(a => a.PunchInAt is not null
                     && activeUserIds.Contains(a.UserId)
                     && InFilter(a.UserId));

        double pct = OrgInsightRules.AttendancePercent(presentToday, headcount);

        // The leave table read ONCE, for both figures below.
        var allLeave = await _dal.FindAllLeaveAsync(ct);

        long pendingApprovals = allLeave.Count(r => r.Status == "PENDING" && InFilter(r.UserId));

        long openTickets = (await _dal.FindOpenTicketRaisersAsync(ct)).Count(InFilter);

        long assigned = await _dal.CountAssetsByStatusAsync("ASSIGNED", ct);
        long inStock = await _dal.CountAssetsByStatusAsync("IN_STOCK", ct);

        // People per department, active staff only, honouring the filter.
        // Insertion-ordered, NOT sorted by count -- unlike OrgInsights.
        var departmentBreakdown = new Dictionary<string, long>(StringComparer.Ordinal);
        foreach (DashboardUser u in users.Where(u => !OrgInsightRules.IsGone(u.ProfileStatus)
                                                  && (filter is null
                                                      || string.Equals(filter, u.Industry,
                                                            StringComparison.OrdinalIgnoreCase))
                                                  && !string.IsNullOrWhiteSpace(u.DepartmentTitle)))
        {
            string key = u.DepartmentTitle!;
            departmentBreakdown[key] = departmentBreakdown.TryGetValue(key, out long n) ? n + 1 : 1;
        }

        // ---- present and absent for each of the last six months ----
        // One query for the whole window, counted into a map keyed by day, so
        // the loop below never goes back to the database.
        DateOnly trendStart = new DateOnly(today.Year, today.Month, 1).AddMonths(-5);

        var presentByDay = new Dictionary<DateOnly, long>();
        foreach (DashboardAttendance a in await _dal.FindAttendanceBetweenAsync(trendStart, today, ct))
        {
            if (a.PunchInAt is null || !activeUserIds.Contains(a.UserId) || !InFilter(a.UserId))
            {
                continue;
            }

            presentByDay[a.WorkDate] =
                presentByDay.TryGetValue(a.WorkDate, out long n) ? n + 1 : 1;
        }

        var monthlyAttendanceTrend = new List<IReadOnlyDictionary<string, object>>();
        for (int back = 5; back >= 0; back--)
        {
            DateOnly monthStart = new DateOnly(today.Year, today.Month, 1).AddMonths(-back);
            DateOnly monthEnd = monthStart.AddMonths(1).AddDays(-1);

            if (monthEnd > today)
            {
                monthEnd = today;
            }

            long present = 0;
            long workingDays = 0;

            for (DateOnly d = monthStart; d <= monthEnd; d = d.AddDays(1))
            {
                // Saturday is a weekend here. Counting it inflated the expected
                // attendance and made every month look worse than it was.
                if (WorkCalendar.IsWeekend(d))
                {
                    continue;
                }

                workingDays++;
                present += presentByDay.TryGetValue(d, out long n) ? n : 0;
            }

            long expected = workingDays * headcount;

            monthlyAttendanceTrend.Add(new Dictionary<string, object>
            {
                ["month"] = MonthAbbrev(monthStart),
                ["present"] = present,
                ["absent"] = OrgInsightRules.Absent(expected, present)
            });
        }

        // ---- days actually taken, by leave type, from approved requests ----
        IReadOnlyDictionary<long, string> leaveTypeNames = await _dal.FindLeaveTypeNamesAsync(ct);

        var leaveUtilization = new Dictionary<string, long>(StringComparer.Ordinal);
        foreach (var r in allLeave.Where(r => string.Equals(r.Status, "APPROVED",
                                                            StringComparison.OrdinalIgnoreCase)
                                           && InFilter(r.UserId)
                                           && r.WorkingDays is not null))
        {
            string name = r.LeaveTypeId is not null
                          && leaveTypeNames.TryGetValue(r.LeaveTypeId.Value, out string? n)
                ? n
                : "Other";

            // Java sums the working days as a long, truncating a half day.
            long days = (long)r.WorkingDays!.Value;
            leaveUtilization[name] = leaveUtilization.TryGetValue(name, out long acc)
                ? acc + days
                : days;
        }

        // ---- payroll cost per month, from payslips actually generated ----
        // Empty until the first run: the honest answer, and what the chart
        // should show rather than a number nobody can trace.
        var costByMonth = new SortedDictionary<(int Year, int Month), decimal>();
        foreach (var p in await _dal.FindPayslipTotalsAsync(ct))
        {
            if (!InFilter(p.UserId))
            {
                continue;
            }

            var key = (p.Year, p.Month);
            costByMonth[key] = costByMonth.TryGetValue(key, out decimal acc)
                ? acc + p.Gross
                : p.Gross;
        }

        var payrollCosts = costByMonth
            .Skip(Math.Max(0, costByMonth.Count - 6))
            .Select(e => (IReadOnlyDictionary<string, object>)new Dictionary<string, object>
            {
                ["month"] = MonthAbbrev(new DateOnly(e.Key.Year, e.Key.Month, 1)),
                ["cost"] = e.Value
            })
            .ToArray();

        return new ExecutiveDashboard(
            headcount, presentToday, pct, pendingApprovals, openTickets, assigned, inStock,
            departmentBreakdown, monthlyAttendanceTrend, leaveUtilization, payrollCosts);
    }
}
