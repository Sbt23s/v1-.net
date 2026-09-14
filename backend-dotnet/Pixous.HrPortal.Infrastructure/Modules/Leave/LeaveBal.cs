using System.Globalization;
using Pixous.HrPortal.Domain.Common;
using Pixous.HrPortal.Domain.Modules.Leave;
using Pixous.HrPortal.Domain.Modules.Notification;
using Pixous.HrPortal.Domain.Modules.Wfh;
using Pixous.HrPortal.Domain.Security;

namespace Pixous.HrPortal.Infrastructure.Modules.Leave;

/// <summary>
/// Leave, ported from com.pixous.hrportal.modules.leave.LeaveService.
///
/// <see cref="ApplyAsync"/> runs eleven checks and their ORDER is the contract.
/// Each refuses a different thing and says so in its own words, and several
/// exist because an earlier version let something through — two leaves on one
/// day, a week taken on a one-day allowance, a "three-month" gap that turned out
/// to be one day. Moving a check changes which message somebody gets; removing
/// one changes what they can do.
/// </summary>
public sealed class LeaveBal : ILeaveBal
{
    private readonly ILeaveDal _dal;
    private readonly INotificationBal _notifications;

    /// <summary>
    /// Needed by the approver queue and the calendar: both widen what somebody
    /// SEES on a permission (USER_MANAGE) while leaving what they may DECIDE
    /// unchanged.
    /// </summary>
    private readonly ICurrentUser _currentUser;

    /// <summary>
    /// The approver pool is the whole company, and IWfhDal already reads it
    /// with roles folded in. Reusing that query keeps one definition of
    /// "who could approve anything" rather than two that can drift.
    /// </summary>
    private readonly IWfhDal _people;

    /// <summary>The copy to whoever watches the whole thing. Never throws.</summary>
    private readonly IOversightNotifier _oversight;

    public LeaveBal(ILeaveDal dal, INotificationBal notifications, ICurrentUser currentUser,
                    IWfhDal people, IOversightNotifier oversight)
    {
        _oversight = oversight;
        _people = people;
        _currentUser = currentUser;
        _dal = dal;
        _notifications = notifications;
    }

    /// <summary>"dd MMM yyyy", the format the three-month message uses.</summary>
    private const string LongDate = "dd MMM yyyy";

    public Task<IReadOnlyList<LeaveTypeRecord>> ListTypesAsync(bool includeInactive,
                                                               CancellationToken ct = default) =>
        includeInactive ? _dal.FindAllTypesAsync(ct) : _dal.FindActiveTypesAsync(ct);

    public Task<IReadOnlyList<LeaveBalanceRecord>> ListBalancesAsync(long userId, int year,
                                                                     CancellationToken ct = default) =>
        _dal.FindBalancesAsync(userId, year, ct);

    public Task<IReadOnlyList<LeaveRequestRecord>> ListMineAsync(long userId,
                                                                 CancellationToken ct = default) =>
        _dal.FindRequestsForUserAsync(userId, ct);

    public Task<IReadOnlyList<LeaveRequestRecord>> ListPendingAsync(CancellationToken ct = default) =>
        _dal.FindPendingAsync(ct);

    public async Task<LeaveRequestRecord> ApplyAsync(long userId, LeaveApplyRequest req,
                                                     CancellationToken ct = default)
    {
        DateOnly today = DateOnly.FromDateTime(DateTime.Now);

        // 1. The range must run forwards.
        if (req.ToDate < req.FromDate)
        {
            throw ApiException.Business("End date cannot be before start date");
        }

        LeaveTypeRecord type = await _dal.FindTypeAsync(req.LeaveTypeId, ct)
            ?? throw ApiException.NotFound("Leave type");

        (string? gender, string? userName) = await _dal.FindUserGenderAndNameAsync(userId, ct);
        if (userName is null)
        {
            throw ApiException.NotFound("User");
        }

        // 2. Gender restriction (e.g. maternity = 'F').
        //
        // Only when BOTH are set. A type with no restriction applies to
        // everyone, and a person with no gender recorded is not refused -- they
        // are asked for it elsewhere, and refusing leave is the wrong place to
        // chase a missing profile field.
        if (!string.IsNullOrEmpty(type.GenderRestriction) && !string.IsNullOrEmpty(gender))
        {
            if (!string.Equals(type.GenderRestriction, gender, StringComparison.OrdinalIgnoreCase))
            {
                throw ApiException.Business($"{type.Name} is not applicable for your profile");
            }
        }

        // 3. Past-date guard unless the type explicitly allows it (sick leave).
        if (!type.AllowPastDates && req.FromDate < today)
        {
            throw ApiException.Business("This leave type cannot be applied for past dates");
        }

        // 4. Minimum notice, counted the way java.time counts it -- see
        //    LeaveRules.NoticeDays, which is not a plain day difference.
        //    Only applied to FUTURE start dates, as the Java does.
        if (type.MinNoticeDays is > 0 && req.FromDate > today)
        {
            long noticeDays = LeaveRules.NoticeDays(today, req.FromDate);
            if (noticeDays < type.MinNoticeDays)
            {
                throw ApiException.Business(
                    $"{type.Name} requires at least {type.MinNoticeDays} day(s) notice");
            }
        }

        // 5. One leave per person per day, whatever its type.
        //
        // Somebody on Sick Leave on the 27th cannot also be on Casual Leave on
        // the 27th -- they are one person and it is one day. Nothing stopped
        // that before: the quarterly cap and the notice period are per-type, so
        // two different types on the same date passed every check and produced
        // two leave records for one absence, each deducting from a different
        // balance.
        IReadOnlyList<LeaveRequestRecord> clashes =
            await _dal.FindOverlappingAsync(userId, req.FromDate, req.ToDate, null, ct);

        if (clashes.Count > 0)
        {
            LeaveRequestRecord first = clashes[0];
            LeaveTypeRecord? clashType = await _dal.FindTypeAsync(first.LeaveTypeId, ct);
            string typeName = clashType?.Name ?? "leave";
            string when = first.FromDate == first.ToDate
                ? $"on {Iso(first.FromDate)}"
                : $"from {Iso(first.FromDate)} to {Iso(first.ToDate)}";

            throw ApiException.Business(
                $"You already have {typeName} {when} ({first.Status?.ToLowerInvariant()}). "
                + "Only one leave per day is allowed, whatever the type. "
                + "Cancel that request first, or choose other dates.");
        }

        // 6. A leave that starts or ends on a weekend is a mistake, not a
        //    request. Counting already ignores weekends, so a Saturday-to-Sunday
        //    range produced a request for zero days and the message underneath
        //    said only "no working days" -- true, but it did not say why.
        if (WorkCalendar.IsWeekend(req.FromDate))
        {
            throw ApiException.Business(
                $"Leave cannot start on a {LeaveRules.DayName(req.FromDate)}. "
                + "Saturdays and Sundays are not working days — choose a weekday.");
        }

        if (WorkCalendar.IsWeekend(req.ToDate))
        {
            throw ApiException.Business(
                $"Leave cannot end on a {LeaveRules.DayName(req.ToDate)}. "
                + "Saturdays and Sundays are not working days — choose a weekday.");
        }

        // 7. There has to be something in the range to take.
        IReadOnlyList<DateOnly> holidays =
            await _dal.FindHolidaysAsync(req.FromDate, req.ToDate, ct);

        int workingDays = LeaveRules.CountWorkingDays(
            req.FromDate, req.ToDate, holidays.ToHashSet());

        if (workingDays <= 0)
        {
            throw ApiException.Business(
                "That range has no working days in it — every day in it is a "
                + "weekend or a public holiday.");
        }

        // 8. One day at a time, for Casual and Sick leave.
        //
        // The quarterly cap below counts REQUESTS, not days, so "one leave every
        // three months" was satisfied by a single request covering a whole week.
        // Checked on the dates rather than on workingDays: a Friday-to-Monday
        // range is two working days but four calendar days, and asking for a
        // span at all is the thing being refused.
        if (LeaveRules.IsSingleDayAllowance(type.Code) && req.FromDate != req.ToDate)
        {
            throw ApiException.Business(
                $"{type.Name} is one day at a time. Choose the same date for both "
                + "From and To, or apply for a different type of leave.");
        }

        // 9. Quarterly cap. monthly_limit (=1) is read as the per-quarter
        //    allowance, so four a year.
        if (type.MonthlyLimit is > 0)
        {
            (DateOnly qStart, DateOnly qEnd) = LeaveRules.QuarterOf(req.FromDate);
            long usedThisQuarter =
                await _dal.CountRequestsInRangeAsync(userId, type.Id, qStart, qEnd, ct);

            if (usedThisQuarter >= type.MonthlyLimit)
            {
                throw ApiException.Business(
                    $"No {type.Name} left: only {type.MonthlyLimit} {type.Name} allowed per "
                    + $"3 months. Next available from {Iso(qEnd.AddDays(1))}.");
            }
        }

        // 10. The three-month gap, counted from the last day actually taken
        //     rather than by calendar quarter. The cap above would let 31 March
        //     and 1 April stand as two separate quarters -- one day apart --
        //     which is not what "one every three months" means.
        if (LeaveRules.IsSingleDayAllowance(type.Code))
        {
            DateOnly? lastTaken = await _dal.FindLatestDayTakenAsync(userId, type.Id, ct);
            if (lastTaken is not null)
            {
                DateOnly availableFrom = LeaveRules.AvailableFrom(lastTaken.Value);
                if (req.FromDate < availableFrom)
                {
                    throw ApiException.Business(
                        $"{type.Name} can only be taken once every three months. "
                        + $"Your last one ran to {Long(lastTaken.Value)}, so the next can "
                        + $"start on or after {Long(availableFrom)}.");
                }
            }
        }

        // 11. Balance. LOP has no allocation and is skipped -- there is nothing
        //     to run out of.
        int year = req.FromDate.Year;
        if (!LeaveRules.IsLossOfPay(type.Code))
        {
            LeaveBalanceRecord balance = await _dal.FindBalanceAsync(userId, type.Id, year, ct)
                ?? throw ApiException.Business($"No leave balance allocated for {type.Name}");

            if (balance.Available < workingDays)
            {
                throw ApiException.Business(
                    $"Insufficient balance: available {balance.Available}, requested {workingDays}");
            }
        }

        var request = new LeaveRequestRecord
        {
            UserId = userId,
            LeaveTypeId = type.Id,
            FromDate = req.FromDate,
            ToDate = req.ToDate,
            WorkingDays = workingDays,
            Reason = req.Reason,
            AttachmentPath = req.AttachmentPath,
            RequestedTo = req.RequestedTo,
            Status = "PENDING"
        };

        await _dal.InsertRequestAsync(request, ct);

        // Tell whoever has to decide. The SMS to the approver and the copy to
        // the CTO are not ported yet -- both need the SMS gateway and the
        // oversight notifier, which are listed as outstanding.
        string label = $"{type.Name} ({workingDays} day(s), {Iso(req.FromDate)}"
                     + (req.FromDate == req.ToDate ? "" : $" to {Iso(req.ToDate)}") + ")";

        if (req.RequestedTo is not null)
        {
            await _notifications.CreateAndPushAsync(
                req.RequestedTo.Value, "Leave request pending",
                $"{userName} applied for {label}", "LEAVE", "/leave/approvals", ct);
        }

        return request;
    }

    /// <summary>ISO yyyy-MM-dd, which is what LocalDate.toString() produces.</summary>
    private static string Iso(DateOnly d) => d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    /// <summary>"dd MMM yyyy", the long form the three-month message uses.</summary>
    private static string Long(DateOnly d) => d.ToString(LongDate, CultureInfo.InvariantCulture);

    // ---- the queues ---------------------------------------------------------

    public async Task<IReadOnlyList<LeaveRequestView>> MyQueueAsync(
        long userId, CancellationToken ct = default)
    {
        IReadOnlyList<LeaveRequestRecord> mine = await _dal.FindRequestsForUserAsync(userId, ct);
        return await EnrichAsync(mine, viewerId: userId, canActOn: _ => false, ct);
    }

    public async Task<IReadOnlyList<LeaveRequestView>> ApproverQueueAsync(
        long approverId, CancellationToken ct = default)
    {
        IReadOnlyList<LeaveRequestRecord> all = await _dal.FindAllRequestsAsync(ct);

        IReadOnlyDictionary<long, LeavePerson> people = await PeopleForAsync(all, approverId, ct);

        if (!people.TryGetValue(approverId, out LeavePerson? approver))
        {
            return [];
        }

        bool isAdmin = _currentUser.HasPermission("USER_MANAGE")
                    || LeaveRules.HasRole(approver.RoleCodes, "SUPER_ADMIN");

        bool isHr = LeaveRules.HasRole(approver.RoleCodes, "IT_MGR")
                 || LeaveRules.HasRole(approver.RoleCodes, "IT_HR");

        bool isTeamLeader = LeaveRules.HasRole(approver.RoleCodes, "IT_TL");

        var visible = all.Where(r =>
        {
            people.TryGetValue(r.UserId, out LeavePerson? applicant);

            return LeaveRules.IsInQueue(approverId, r.RequestedTo, isAdmin, isHr, isTeamLeader,
                                        approver.DesignationTitle, applicant?.DesignationTitle);
        }).ToArray();

        // CanAct is narrower than visibility on purpose: only a PENDING row this
        // person is actually named on may be decided.
        return Build(visible, people, await _dal.FindTypeNamesAsync(ct),
                     r => r.Status == "PENDING" && LeaveRules.CanDecide(approverId, r.RequestedTo));
    }

    public async Task<IReadOnlyList<LeaveRequestView>> OnLeaveTodayAsync(
        CancellationToken ct = default)
    {
        IReadOnlyList<LeaveRequestRecord> all =
            await _dal.FindOnLeaveAsync(DateOnly.FromDateTime(DateTime.Now), ct);

        return await EnrichAsync(all, viewerId: null, canActOn: _ => false, ct);
    }

    public async Task<IReadOnlyList<LeaveRequestView>> CalendarAsync(
        long viewerId, DateOnly from, DateOnly to, CancellationToken ct = default)
    {
        IReadOnlyList<LeaveRequestRecord> all = await _dal.FindInRangeAsync(from, to, ct);

        IReadOnlyDictionary<long, LeavePerson> people = await PeopleForAsync(all, viewerId, ct);

        people.TryGetValue(viewerId, out LeavePerson? viewer);

        // HR and administrators see the whole organisation; a Team Leader sees
        // the people they lead, and themselves -- not other teams.
        bool seesEveryone = viewer is null
            || LeaveRules.SeesEveryone(_currentUser.HasPermission("USER_MANAGE"), viewer.RoleCodes);

        var visible = all.Where(r =>
        {
            if (seesEveryone || r.UserId == viewerId)
            {
                return true;
            }

            people.TryGetValue(r.UserId, out LeavePerson? applicant);
            return LeaveRules.SameTeam(viewer!.DesignationTitle, applicant?.DesignationTitle);
        }).ToArray();

        return Build(visible, people, await _dal.FindTypeNamesAsync(ct), _ => false);
    }

    // ---- shaping ------------------------------------------------------------

    private async Task<IReadOnlyDictionary<long, LeavePerson>> PeopleForAsync(
        IReadOnlyList<LeaveRequestRecord> rows, long? alsoInclude, CancellationToken ct)
    {
        // Everybody these rows mention, in ONE query rather than one per row.
        var ids = new HashSet<long>();

        foreach (LeaveRequestRecord r in rows)
        {
            ids.Add(r.UserId);
            if (r.RequestedTo is not null) ids.Add(r.RequestedTo.Value);
            if (r.DecidedBy is not null) ids.Add(r.DecidedBy.Value);
        }

        if (alsoInclude is not null)
        {
            ids.Add(alsoInclude.Value);
        }

        return await _dal.FindPeopleAsync(ids, ct);
    }

    private async Task<IReadOnlyList<LeaveRequestView>> EnrichAsync(
        IReadOnlyList<LeaveRequestRecord> rows, long? viewerId,
        Func<LeaveRequestRecord, bool> canActOn, CancellationToken ct) =>
        Build(rows, await PeopleForAsync(rows, viewerId, ct),
              await _dal.FindTypeNamesAsync(ct), canActOn);

    private static IReadOnlyList<LeaveRequestView> Build(
        IReadOnlyList<LeaveRequestRecord> rows,
        IReadOnlyDictionary<long, LeavePerson> people,
        IReadOnlyDictionary<long, string> typeNames,
        Func<LeaveRequestRecord, bool> canActOn) =>
        rows.Select(r =>
        {
            people.TryGetValue(r.UserId, out LeavePerson? applicant);

            LeavePerson? to = r.RequestedTo is not null
                ? people.GetValueOrDefault(r.RequestedTo.Value) : null;

            LeavePerson? by = r.DecidedBy is not null
                ? people.GetValueOrDefault(r.DecidedBy.Value) : null;

            return new LeaveRequestView(
                r.Id, r.UserId, applicant?.Name ?? "?", r.LeaveTypeId,
                // "?" rather than null when a type has been deleted -- the Java's
                // getOrDefault, and a column reading "?" beats one reading blank.
                typeNames.GetValueOrDefault(r.LeaveTypeId, "?"),
                r.FromDate, r.ToDate, r.WorkingDays, r.Reason, r.AttachmentPath,
                r.Status, r.DecidedBy, r.DecidedAt, r.DecisionComment, r.CreatedAt,
                LeaveRules.TopLeaveRole(applicant?.RoleCodes),
                canActOn(r),
                to?.Name, by?.Name,
                applicant?.DesignationTitle, applicant?.EmployeeCode,
                LeaveRules.RoleLabel(to?.RoleCodes), LeaveRules.RoleLabel(by?.RoleCodes),
                r.RequestedTo);
        }).ToArray();


    // ---- who a request may be addressed to ---------------------------------

    /// <summary>
    /// Valid approvers for a leave of this length.
    ///
    /// One rung up the ladder and only one. See LeaveApproverRules for why a
    /// chain that offers a choice is not a chain.
    /// </summary>
    public async Task<IReadOnlyList<ApproverOption>> LeaveApproversAsync(
        long userId, double days, CancellationToken ct = default)
    {
        ApproverCandidate me = await _people.FindCandidateAsync(userId, ct)
            ?? throw ApiException.NotFound("User");

        LeaveRung rung = LeaveApproverRules.RungFor(me, days);

        IReadOnlyList<ApproverCandidate> pool =
            (await _people.FindApproverCandidatesAsync(ct))
            .Where(u => u.Id != userId)
            .Where(u => LeaveApproverRules.OnRung(u, rung))
            .ToArray();

        pool = LeaveApproverRules.Narrow(pool, me, rung, days);

        return pool.Select(u => new ApproverOption(
            u.Id,
            LeaveApproverRules.DisplayName(u),
            u.EmployeeCode,
            LeaveApproverRules.Label(u))).ToArray();
    }


    // ---- decisions ----------------------------------------------------------

    /// <summary>
    /// Approves or rejects a leave request.
    ///
    /// The balance is only touched on approval, and only for types that consume
    /// one — Loss of Pay does not, which is the whole point of it.
    /// </summary>
    public async Task<LeaveRequestView> DecideAsync(long approverId, long requestId,
                                                    string? decision, string? comment,
                                                    CancellationToken ct = default)
    {
        LeaveRequestRecord lr = await _dal.FindRequestAsync(requestId, ct)
            ?? throw ApiException.NotFound("Leave request");

        if (lr.Status != "PENDING")
        {
            throw ApiException.Business($"Request already {lr.Status?.ToLowerInvariant()}");
        }

        // The person the request NAMES decides it. See LeaveRules.CanDecide --
        // an override here once made the whole approval chain optional.
        if (!LeaveRules.CanDecide(approverId, lr.RequestedTo))
        {
            throw ApiException.Business("You are not authorized to decide this leave request");
        }

        string normalised = (decision ?? "").Trim().ToUpperInvariant();

        if (normalised != "APPROVED" && normalised != "REJECTED")
        {
            throw ApiException.Business("Decision must be APPROVED or REJECTED");
        }

        // A rejection without a reason leaves the applicant with nothing to act
        // on, so the reason is required rather than encouraged.
        if (normalised == "REJECTED" && string.IsNullOrWhiteSpace(comment))
        {
            throw ApiException.Business("A reason is required to reject a leave request");
        }

        LeaveTypeRecord? type = await _dal.FindTypeAsync(lr.LeaveTypeId, ct);

        if (normalised == "APPROVED" && type is not null && !LeaveRules.IsLossOfPay(type.Code))
        {
            LeaveBalanceRecord balance =
                await _dal.FindBalanceAsync(lr.UserId, lr.LeaveTypeId, lr.FromDate.Year, ct)
                ?? throw ApiException.Business("Balance record missing");

            // Re-checked at the moment of approval, not only when applying:
            // other leave may have been approved in between.
            if (balance.Available < lr.WorkingDays)
            {
                throw ApiException.Business("Employee no longer has sufficient balance");
            }

            await _dal.AdjustBalanceUsedAsync(lr.UserId, lr.LeaveTypeId, lr.FromDate.Year,
                                              lr.WorkingDays, ct);
        }

        DateTime now = DateTime.Now;
        await _dal.UpdateDecisionAsync(requestId, normalised, approverId, now, comment, ct);

        await NotifyDecisionAsync(lr, type, normalised, approverId, ct);

        lr.Status = normalised;
        lr.DecidedBy = approverId;
        lr.DecidedAt = now;
        lr.DecisionComment = comment;

        return (await EnrichAsync([lr], approverId, _ => false, ct))[0];
    }

    private async Task NotifyDecisionAsync(LeaveRequestRecord lr, LeaveTypeRecord? type,
                                           string decision, long approverId, CancellationToken ct)
    {
        string typeName = type?.Name ?? "leave";
        string verb = decision.ToLowerInvariant();
        string window = $"{lr.FromDate:yyyy-MM-dd} to {lr.ToDate:yyyy-MM-dd}";

        await _notifications.CreateAndPushAsync(
            lr.UserId, $"Leave {verb}",
            $"Your {typeName} request ({window}) was {verb}", "LEAVE", "/leave", ct);

        IReadOnlyDictionary<long, LeavePerson> people =
            await _dal.FindPeopleAsync([lr.UserId, approverId], ct);

        string empName = people.GetValueOrDefault(lr.UserId)?.Name ?? "?";
        string byName = people.GetValueOrDefault(approverId)?.Name ?? "their approver";

        // The decision AND who made it -- the half oversight could not see from
        // the request alone.
        await _oversight.NotifyCtoAsync(approverId, $"Leave {verb}",
            $"{empName}'s {typeName} ({window}) was {verb} by {byName}.",
            "LEAVE", "/leave/approvals", ct);
    }

    /// <summary>
    /// Withdraws a request.
    ///
    /// Approved leave refunds its balance on the way out; pending leave never
    /// took one. Cancelling something already decided against would be
    /// rewriting history, so only PENDING and APPROVED may be withdrawn.
    /// </summary>
    public async Task CancelAsync(long userId, long requestId, CancellationToken ct = default)
    {
        LeaveRequestRecord lr = await _dal.FindRequestAsync(requestId, ct)
            ?? throw ApiException.NotFound("Leave request");

        if (lr.UserId != userId)
        {
            throw ApiException.Business("You can only cancel your own request");
        }

        if (lr.Status != "PENDING" && lr.Status != "APPROVED")
        {
            throw ApiException.Business("Only pending or approved leave can be cancelled");
        }

        string previous = lr.Status;

        if (previous == "APPROVED")
        {
            LeaveTypeRecord? type = await _dal.FindTypeAsync(lr.LeaveTypeId, ct);

            // Only refund what was actually deducted. LOP never took a balance,
            // so refunding it would credit days nobody spent.
            if (type is not null && !LeaveRules.IsLossOfPay(type.Code))
            {
                await _dal.AdjustBalanceUsedAsync(lr.UserId, lr.LeaveTypeId, lr.FromDate.Year,
                                                  -lr.WorkingDays, ct);
            }
        }

        await _dal.UpdateStatusAsync(requestId, "CANCELLED", DateTime.Now, ct);

        // Whoever was handling it should know it is withdrawn, so they are not
        // deciding something that no longer exists.
        long? notify = lr.RequestedTo ?? lr.DecidedBy;

        if (notify is not null && notify != userId)
        {
            IReadOnlyDictionary<long, LeavePerson> people = await _dal.FindPeopleAsync([userId], ct);
            string who = people.GetValueOrDefault(userId)?.Name ?? "An employee";

            IReadOnlyDictionary<long, string> typeNames = await _dal.FindTypeNamesAsync(ct);
            string typeName = typeNames.GetValueOrDefault(lr.LeaveTypeId, "leave");

            await _notifications.CreateAndPushAsync(
                notify.Value, "Leave cancelled",
                $"{who} cancelled their {(previous == "APPROVED" ? "approved " : "")}"
                + $"{typeName} ({lr.FromDate:yyyy-MM-dd} to {lr.ToDate:yyyy-MM-dd})",
                "LEAVE", "/leave/approvals", ct);
        }
    }

    // ---- leave types --------------------------------------------------------

    public async Task<LeaveTypeRecord> CreateTypeAsync(LeaveTypeRecord type,
                                                       CancellationToken ct = default)
    {
        Validate(type);

        if (await _dal.TypeNameExistsAsync(type.Name!, null, ct))
        {
            throw ApiException.Business("A leave type with this name already exists.");
        }

        await _dal.InsertTypeAsync(type, ct);
        return type;
    }

    public async Task<LeaveTypeRecord> UpdateTypeAsync(long id, LeaveTypeRecord type,
                                                       CancellationToken ct = default)
    {
        _ = await _dal.FindTypeAsync(id, ct) ?? throw ApiException.NotFound("Leave type");

        Validate(type);
        type.Id = id;

        if (await _dal.TypeNameExistsAsync(type.Name!, id, ct))
        {
            throw ApiException.Business("A leave type with this name already exists.");
        }

        await _dal.UpdateTypeAsync(type, ct);
        return type;
    }

    /// <summary>
    /// Retires a leave type. The row stays and only stops being offered — see
    /// the DAL for why deleting would orphan every request that used it.
    /// </summary>
    public async Task DeleteTypeAsync(long id, CancellationToken ct = default)
    {
        _ = await _dal.FindTypeAsync(id, ct) ?? throw ApiException.NotFound("Leave type");

        await _dal.DeactivateTypeAsync(id, ct);
    }

    private static void Validate(LeaveTypeRecord type)
    {
        if (string.IsNullOrWhiteSpace(type.Name))
        {
            throw ApiException.Business("Give the leave type a name.");
        }

        type.Name = type.Name.Trim();
        type.Code = string.IsNullOrWhiteSpace(type.Code) ? null : type.Code.Trim().ToUpperInvariant();

        if (type.MaxDaysPerYear is < 0)
        {
            throw ApiException.Business("A yearly allowance cannot be negative.");
        }

        // 'M', 'F' or nothing. Anything else is a typo that would silently
        // hide the type from everybody.
        if (!string.IsNullOrWhiteSpace(type.GenderRestriction))
        {
            string g = type.GenderRestriction.Trim().ToUpperInvariant();

            if (g != "M" && g != "F")
            {
                throw ApiException.Business("Gender restriction must be M, F, or left empty.");
            }

            type.GenderRestriction = g;
        }
        else
        {
            type.GenderRestriction = null;
        }
    }

    public async Task<IReadOnlyDictionary<string, int>> AllocateDefaultsToAllAsync(
        int? year, CancellationToken ct = default)
    {
        int y = year ?? DateTime.Now.Year;
        int thisYear = DateTime.Now.Year;

        if (y < thisYear)
        {
            throw ApiException.Business($"Leave cannot be allocated for {y} — pick {thisYear} or a later year.");
        }

        (int created, int employees) = await _dal.AllocateDefaultsAsync(y, ct);

        return new Dictionary<string, int>
        {
            ["created"] = created,
            ["employees"] = employees,
            ["year"] = y
        };
    }

    public Task ResetUserLeaveAsync(long userId, CancellationToken ct = default) =>
        _dal.ResetUserLeaveAsync(userId, ct);

    public async Task<int> BulkDecideAsync(long approverId, BulkLeaveDecisionRequest req,
                                           CancellationToken ct = default)
    {
        int count = 0;
        foreach (long id in req.RequestIds)
        {
            LeaveRequestRecord? lr = await _dal.FindRequestAsync(id, ct);
            if (lr is not null && lr.Status == "PENDING" && LeaveRules.CanDecide(approverId, lr.RequestedTo))
            {
                await DecideAsync(approverId, id, req.Decision, req.Comment, ct);
                count++;
            }
        }
        return count;
    }

    public async Task<IReadOnlyDictionary<string, object>> LopPreviewAsync(
        long userId, int year, int month, CancellationToken ct = default)
    {
        IReadOnlyList<LeaveTypeRecord> allTypes = await _dal.FindAllTypesAsync(ct);
        HashSet<long> paidTypeIds = allTypes.Where(t => t.Paid).Select(t => t.Id).ToHashSet();

        var leaves = await _dal.FindApprovedLeaveForMonthAsync(userId, year, month, ct);

        decimal unpaidDays = 0m;
        decimal paidDays = 0m;
        int leaveCount = leaves.Count;

        foreach (var (typeId, workingDays) in leaves)
        {
            if (paidTypeIds.Contains(typeId))
            {
                paidDays += workingDays;
            }
            else
            {
                unpaidDays += workingDays;
            }
        }

        var firstDay = new DateOnly(year, month, 1);
        var lastDay = new DateOnly(year, month, DateTime.DaysInMonth(year, month));

        var holidayList = await _dal.FindHolidaysAsync(firstDay, lastDay, ct);
        var holidays = holidayList.ToHashSet();

        int workingDaysInMonth = 0;
        for (var d = firstDay; d <= lastDay; d = d.AddDays(1))
        {
            if (WorkCalendar.IsWeekend(d) || holidays.Contains(d)) continue;
            workingDaysInMonth++;
        }

        (long present, long totalRows) = await _dal.CountAttendanceDaysAsync(userId, firstDay, lastDay, ct);
        decimal leaveDays = paidDays + unpaidDays;

        bool tracked = WorkCalendar.AttendanceWasKept(totalRows);
        int absent = tracked
            ? Math.Max(0, (int)(workingDaysInMonth - present - (long)leaveDays))
            : 0;

        decimal deductibleDays = unpaidDays + absent;

        return new Dictionary<string, object>
        {
            ["unpaidLeaveDays"] = unpaidDays,
            ["paidLeaveDays"] = paidDays,
            ["totalLeaveDays"] = leaveDays,
            ["leaveRequestCount"] = leaveCount,
            ["presentDays"] = present,
            ["absentDays"] = absent,
            ["workingDaysInMonth"] = workingDaysInMonth,
            ["deductibleDays"] = deductibleDays,
            ["lopFromUnpaidLeave"] = unpaidDays,
            ["lopFromAbsence"] = absent
        };
    }

}
