using System.Globalization;
using Pixous.HrPortal.Domain.Common;
using Pixous.HrPortal.Domain.Modules.Leave;
using Pixous.HrPortal.Domain.Modules.Notification;
using Pixous.HrPortal.Domain.Modules.Wfh;

namespace Pixous.HrPortal.Infrastructure.Modules.Wfh;

/// <summary>
/// Work from home, ported from com.pixous.hrportal.modules.wfh.WfhService.
///
/// <see cref="ApplyAsync"/> runs six checks in order. Three of them are the
/// sides of one triangle: a day cannot be both WFH and leave, and cannot be both
/// WFH and permission. Leave and permission already refused each other; the WFH
/// side was the one that was open, and approving both wrote the day into
/// attendance twice.
/// </summary>
public sealed class WfhBal : IWfhBal
{
    private readonly IWfhDal _dal;
    private readonly INotificationBal _notifications;
    private readonly IOversightNotifier _oversight;

    public WfhBal(IWfhDal dal, INotificationBal notifications, IOversightNotifier oversight)
    {
        _dal = dal;
        _notifications = notifications;
        _oversight = oversight;
    }

    public async Task<WfhView> ApplyAsync(long userId, WfhApplyRequest req,
                                           CancellationToken ct = default)
    {
        ApproverCandidate me = await _dal.FindCandidateAsync(userId, ct)
            ?? throw ApiException.NotFound("User");

        // 1. The range must run forwards.
        if (req.ToDate < req.FromDate)
        {
            throw ApiException.Business("The end date cannot be before the start date.");
        }

        // 2. A weekend is already not a working day, so working from home on one
        //    is not a thing to request. Said plainly, naming the day, rather
        //    than accepted and then counted as zero.
        if (WorkCalendar.IsWeekend(req.FromDate))
        {
            throw ApiException.Business(
                $"Work from home cannot start on a {req.FromDate.DayOfWeek}. Choose a weekday.");
        }

        if (WorkCalendar.IsWeekend(req.ToDate))
        {
            throw ApiException.Business(
                $"Work from home cannot end on a {req.ToDate.DayOfWeek}. Choose a weekday.");
        }

        // 3. There has to be something in the range to work.
        IReadOnlyList<DateOnly> holidays = await _dal.FindHolidaysAsync(req.FromDate, req.ToDate, ct);
        int days = LeaveRules.CountWorkingDays(req.FromDate, req.ToDate, holidays.ToHashSet());

        if (days <= 0)
        {
            throw ApiException.Business(
                "That range has no working days in it — every day in it is a "
                + "weekend or a public holiday.");
        }

        // 4. One request per person per day, as leave and permission have.
        //    Two overlapping WFH requests are two answers to one question, and
        //    if both are approved the status board shows the same person twice.
        IReadOnlyList<WfhRequestRecord> clash =
            await _dal.FindOverlappingAsync(userId, req.FromDate, req.ToDate, ct);

        if (clash.Count > 0)
        {
            WfhRequestRecord first = clash[0];
            string when = first.FromDate == first.ToDate
                ? $"on {Iso(first.FromDate)}"
                : $"from {Iso(first.FromDate)} to {Iso(first.ToDate)}";

            throw ApiException.Business(
                $"You already have a work from home request {when} "
                + $"({first.Status?.ToLowerInvariant()}). "
                + "Cancel that one first, or choose other dates.");
        }

        // 5. Leave already booked on any day of the range. Working from home and
        //    being on leave are different answers to "were you working that
        //    day", and approving both writes the day into attendance twice.
        var onLeave = await _dal.FindOverlappingLeaveAsync(userId, req.FromDate, req.ToDate, ct);
        if (onLeave is not null)
        {
            (DateOnly lFrom, DateOnly lTo, string? lStatus) = onLeave.Value;
            string when = lFrom == lTo
                ? $"on {Iso(lFrom)}"
                : $"from {Iso(lFrom)} to {Iso(lTo)}";

            throw ApiException.Business(
                $"You already have leave {when} ({lStatus?.ToLowerInvariant()}). "
                + "Work from home cannot be asked for on a day already booked as leave.");
        }

        // 6. And permission, for the same reason read from the other direction:
        //    permission is hours off inside a working day, so the day has to be
        //    one the person is working -- but it was already claimed as hours
        //    off from the office, and this would move the whole day home
        //    underneath it.
        var onPermission =
            await _dal.FindOverlappingPermissionAsync(userId, req.FromDate, req.ToDate, ct);

        if (onPermission is not null)
        {
            (DateOnly pDate, string? pStatus) = onPermission.Value;
            throw ApiException.Business(
                $"You already have a permission request on {Iso(pDate)} "
                + $"({pStatus?.ToLowerInvariant()}). Cancel that first, or choose other dates.");
        }

        // The rung, decided here rather than trusted from the payload -- a
        // request that named its own approver would let somebody route their
        // own WFH to a colleague.
        ApproverCandidate? approver = await ResolveApproverAsync(me, ct);

        if (approver is null)
        {
            throw ApiException.Business(
                "There is nobody set up to approve your work from home requests yet. "
                + "Ask HR to assign an approver.");
        }

        var request = new WfhRequestRecord
        {
            UserId = userId,
            CompanyId = me.CompanyId,
            FromDate = req.FromDate,
            ToDate = req.ToDate,
            WorkingDays = days,
            Reason = TrimToNull(req.Reason),
            Remarks = TrimToNull(req.Remarks),
            Status = "PENDING",
            RequestedTo = approver.Id
        };

        await _dal.InsertAsync(request, ct);

        // The CTO copy is not ported yet -- it needs the oversight notifier.
        await _notifications.CreateAndPushAsync(
            approver.Id,
            "Work from home request",
            $"{me.Name} asked to work from home {Iso(req.FromDate)}"
                + (req.FromDate == req.ToDate ? "" : $" to {Iso(req.ToDate)}"),
            "WFH", "/wfh", ct);

        var singleUserMap = new Dictionary<long, ApproverCandidate>
        {
            [me.Id] = me,
            [approver.Id] = approver
        };
        return ToView(request, userId, singleUserMap);
    }

    public async Task<IReadOnlyList<WfhView>> MineAsync(long userId,
                                                           CancellationToken ct = default)
    {
        var records = await _dal.FindForUserAsync(userId, ct);
        return await ToViewsAsync(records, userId, ct);
    }

    public async Task<IReadOnlyList<WfhView>> ForMeAsync(long userId,
                                                            CancellationToken ct = default)
    {
        ApproverCandidate? me = await _dal.FindCandidateAsync(userId, ct);
        bool onHrDesk = me is not null && (me.RoleCodes.Contains("IT_HR") || me.RoleCodes.Contains("CV_HR") || me.RoleCodes.Contains("IT_MGR"));
        var records = onHrDesk
            ? await _dal.FindAllAsync(ct)
            : await _dal.FindForApproverAsync(userId, ct);
        return await ToViewsAsync(records, userId, ct);
    }

    public async Task<IReadOnlyList<WfhView>> AllAsync(long viewerId, CancellationToken ct = default)
    {
        var records = await _dal.FindAllAsync(ct);
        return await ToViewsAsync(records, viewerId, ct);
    }

    public async Task<IReadOnlyList<WfhView>> ActiveOnAsync(DateOnly day, long viewerId,
                                                               CancellationToken ct = default)
    {
        var records = await _dal.FindActiveOnAsync(day, ct);
        return await ToViewsAsync(records, viewerId, ct);
    }

    public async Task<IReadOnlyList<WfhView>> ActiveBetweenAsync(DateOnly? from, DateOnly? to, long viewerId,
                                                                 CancellationToken ct = default)
    {
        DateOnly start = from ?? DateOnly.FromDateTime(DateTime.Now);
        DateOnly end = to ?? start;
        if (end < start)
        {
            (start, end) = (end, start);
        }
        var records = await _dal.FindActiveBetweenAsync(start, end, ct);
        return await ToViewsAsync(records, viewerId, ct);
    }

    private static string Iso(DateOnly d) => d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    private static string? TrimToNull(string? s) =>
        string.IsNullOrWhiteSpace(s) ? null : s.Trim();

    /// <summary>
    /// Who a request from this person goes to. Shared by the apply path and the
    /// picker, so the name shown before submitting is the name it actually
    /// reaches.
    ///
    /// The explicit team assignments are resolved BEFORE the rules run:
    /// WfhApproverRules.Resolve takes a plain predicate, so the lookup cannot be
    /// awaited inside it -- and blocking on the task there
    /// (GetAwaiter().GetResult()) is how a request thread deadlocks under load.
    /// Only the candidates actually on the rung are asked, which is a handful
    /// rather than the whole company.
    /// </summary>
    private async Task<ApproverCandidate?> ResolveApproverAsync(ApproverCandidate me,
                                                                CancellationToken ct)
    {
        IReadOnlyList<ApproverCandidate> everyone = await _dal.FindApproverCandidatesAsync(ct);

        var leadsMyTeam = new HashSet<long>();

        if (!string.IsNullOrWhiteSpace(me.DesignationTitle))
        {
            foreach (ApproverCandidate candidate in everyone.Where(WfhApproverRules.RungAbove(me)))
            {
                if (await _dal.LeadsTeamAsync(candidate.Id, me.DesignationTitle, ct))
                {
                    leadsMyTeam.Add(candidate.Id);
                }
            }
        }

        return WfhApproverRules.Resolve(me, everyone, c => leadsMyTeam.Contains(c.Id));
    }

    /// <summary>
    /// Who a work-from-home request from this person would go to.
    ///
    /// Exactly ONE approver, or none at all. The picker shows a single name
    /// rather than a choice, for the same reason the leave chain does: a
    /// request that can be addressed anywhere skips the person who knows the
    /// roster.
    /// </summary>
    public async Task<IReadOnlyList<Pixous.HrPortal.Domain.Modules.Leave.ApproverOption>>
        ApproversAsync(long userId, CancellationToken ct = default)
    {
        ApproverCandidate? me = await _dal.FindCandidateAsync(userId, ct);

        if (me is null)
        {
            return [];
        }

        ApproverCandidate? approver = await ResolveApproverAsync(me, ct);

        if (approver is null)
        {
            return [];
        }

        return
        [
            new Pixous.HrPortal.Domain.Modules.Leave.ApproverOption(
                approver.Id, approver.Name, approver.EmployeeCode,
                WfhApproverRules.RungOf(approver))
        ];
    }

    // ---- decisions ----------------------------------------------------------

    /// <summary>
    /// Approves or rejects a work-from-home request.
    ///
    /// Approval writes the attendance rows for the days covered, because an
    /// approved WFH day is a day worked and payroll reads attendance.
    /// </summary>
    public async Task<WfhView> DecideAsync(long deciderId, long id, bool approve,
                                           string? comment, CancellationToken ct = default)
    {
        WfhRequestRecord r = await _dal.FindAsync(id, ct)
            ?? throw ApiException.NotFound("Work from home request");

        if (r.Status != "PENDING")
        {
            throw ApiException.Business(
                $"That request has already been {r.Status?.ToLowerInvariant()}.");
        }

        // The ADDRESSEE decides, and nobody else.
        //
        // A widening here once let anyone on the HR desk decide a request
        // addressed to HR, so that it would not wait for a colleague who was
        // away. The visibility half of that is right and remains -- the whole
        // desk sees the queue -- but an approval signed by somebody the
        // applicant did not write to reads as their request having been handed
        // round, and reassigning it leaves a record where a silent decision
        // leaves none.
        if (deciderId == r.UserId || r.RequestedTo != deciderId)
        {
            throw ApiException.Business("That request is not yours to decide.");
        }

        string? trimmed = string.IsNullOrWhiteSpace(comment) ? null : comment.Trim();

        // The applicant is owed a reason. An approval may be silent.
        if (!approve && trimmed is null)
        {
            throw ApiException.Business("Give a reason for rejecting this request.");
        }

        DateTime now = DateTime.Now;
        string status = approve ? "APPROVED" : "REJECTED";

        await _dal.UpdateDecisionAsync(id, status, deciderId, now, trimmed, ct);

        r.Status = status;
        r.DecidedBy = deciderId;
        r.DecidedAt = now;
        r.DecisionComment = trimmed;

        if (approve)
        {
            await MarkAttendanceAsync(r, ct);
        }

        await NotifyDecisionAsync(r, deciderId, approve, ct);

        var users = await _dal.FindCandidatesByIdsAsync(
            new[] { r.UserId, deciderId, r.RequestedTo ?? 0 }.Where(x => x > 0), ct);
        return ToView(r, deciderId, users);
    }

    /// <summary>
    /// Writes a WFH attendance row for each working day covered.
    ///
    /// <para>A day that ALREADY has a row is left alone: somebody who punched
    /// in from the office that morning was at the office, and an approval
    /// arriving later must not overwrite what actually happened — nor must a
    /// re-approval create a second row for one day.</para>
    ///
    /// <para><b>Never allowed to throw.</b> The decision is already saved and is
    /// the thing that mattered; a failure here leaves attendance to be corrected
    /// by hand, which is recoverable, where losing the approval is not.</para>
    /// </summary>
    private async Task MarkAttendanceAsync(WfhRequestRecord r, CancellationToken ct)
    {
        try
        {
            var holidays = (await _dal.FindHolidaysAsync(r.FromDate, r.ToDate, ct)).ToHashSet();

            for (DateOnly d = r.FromDate; d <= r.ToDate; d = d.AddDays(1))
            {
                if (WorkCalendar.IsWeekend(d) || holidays.Contains(d))
                {
                    continue;
                }

                await _dal.InsertWfhAttendanceIfAbsentAsync(r.UserId, d, ct);
            }
        }
        catch
        {
            // See the note above: the approval stands either way.
        }
    }

    private async Task NotifyDecisionAsync(WfhRequestRecord r, long deciderId, bool approve,
                                           CancellationToken ct)
    {
        string title = approve ? "Work from home approved" : "Work from home rejected";
        string window = Describe(r.FromDate, r.ToDate);

        // Read ONCE: the CTO's copy and the applicant's copy say the same thing
        // about the same person, and looking it up twice invited them to drift.
        IReadOnlyDictionary<long, ApproverCandidate> people =
            (await _dal.FindApproverCandidatesAsync(ct)).ToDictionary(u => u.Id);

        string who = people.GetValueOrDefault(deciderId)?.Name ?? "Your approver";
        string applicant = people.GetValueOrDefault(r.UserId)?.Name ?? "Someone";

        await _oversight.NotifyCtoAsync(deciderId, title,
            $"{applicant}'s request {window} was "
            + $"{(approve ? "approved" : "rejected")} by {who}.",
            "WFH", "/leave/wfh", ct);

        await NotifyAsync(r.UserId, title,
            $"{who} {(approve ? "approved" : "rejected")} your request {window}"
            + (r.DecisionComment is null ? "" : $" — {r.DecisionComment}"), ct);
    }

    /// <summary>
    /// Withdraws a request.
    ///
    /// Only while PENDING: a decided request is a record of what was agreed,
    /// and withdrawing it afterwards would erase that rather than change it.
    /// </summary>
    public async Task<WfhView> CancelAsync(long userId, long id, CancellationToken ct = default)
    {
        WfhRequestRecord r = await _dal.FindAsync(id, ct)
            ?? throw ApiException.NotFound("Work from home request");

        if (r.UserId != userId)
        {
            throw ApiException.Business("You can only cancel a request you raised.");
        }

        if (r.Status != "PENDING")
        {
            throw ApiException.Business(
                $"That request has already been {r.Status?.ToLowerInvariant()} "
                + "and cannot be withdrawn.");
        }

        await _dal.UpdateStatusAsync(id, "CANCELLED", DateTime.Now, ct);
        r.Status = "CANCELLED";

        if (r.RequestedTo is not null)
        {
            IReadOnlyDictionary<long, ApproverCandidate> people =
                (await _dal.FindApproverCandidatesAsync(ct)).ToDictionary(u => u.Id);

            string who = people.GetValueOrDefault(userId)?.Name ?? "An employee";

            await NotifyAsync(r.RequestedTo.Value, "Work from home request withdrawn",
                $"{who} withdrew their request {Describe(r.FromDate, r.ToDate)}", ct);
        }

        var users = await _dal.FindCandidatesByIdsAsync(
            new[] { r.UserId, r.RequestedTo ?? 0 }.Where(x => x > 0), ct);
        return ToView(r, userId, users);
    }

    private async Task<IReadOnlyList<WfhView>> ToViewsAsync(
        IReadOnlyList<WfhRequestRecord> records,
        long viewerId,
        CancellationToken ct)
    {
        if (records.Count == 0) return [];

        var userIds = records
            .Select(r => r.UserId)
            .Concat(records.Where(r => r.RequestedTo is not null).Select(r => r.RequestedTo!.Value))
            .Concat(records.Where(r => r.DecidedBy is not null).Select(r => r.DecidedBy!.Value))
            .Distinct();

        IReadOnlyDictionary<long, ApproverCandidate> users = await _dal.FindCandidatesByIdsAsync(userIds, ct);

        return records.Select(r => ToView(r, viewerId, users)).ToList();
    }

    private static WfhView ToView(
        WfhRequestRecord r,
        long viewerId,
        IReadOnlyDictionary<long, ApproverCandidate> users)
    {
        users.TryGetValue(r.UserId, out ApproverCandidate? applicant);
        ApproverCandidate? approver = r.RequestedTo is not null && users.TryGetValue(r.RequestedTo.Value, out var a) ? a : null;
        ApproverCandidate? decider = r.DecidedBy is not null && users.TryGetValue(r.DecidedBy.Value, out var d) ? d : null;

        bool isPending = string.Equals(r.Status, "PENDING", StringComparison.OrdinalIgnoreCase);
        bool canAct = isPending && viewerId != r.UserId && viewerId == r.RequestedTo;
        bool canCancel = isPending && viewerId == r.UserId;

        return new WfhView(
            r.Id,
            r.UserId,
            applicant?.Name ?? "Employee",
            applicant?.EmployeeCode,
            applicant?.DepartmentTitle ?? applicant?.DesignationTitle,
            applicant?.DesignationTitle,
            applicant is not null ? WfhApproverRules.RungOf(applicant) : "Employee",
            r.FromDate,
            r.ToDate,
            r.WorkingDays,
            r.Reason,
            r.Remarks,
            r.Status ?? "PENDING",
            r.RequestedTo,
            approver?.Name,
            approver is not null ? WfhApproverRules.RungOf(approver) : null,
            r.DecidedBy,
            decider?.Name,
            r.DecidedAt,
            r.DecisionComment,
            r.CreatedAt,
            canAct,
            canCancel
        );
    }

    /// <summary>Never lets a notification failure lose the thing that was saved.</summary>
    private async Task NotifyAsync(long userId, string title, string body, CancellationToken ct)
    {
        try
        {
            await _notifications.CreateAndPushAsync(userId, title, body, "WFH", "/leave/wfh", ct);
        }
        catch
        {
            // The request stands either way, and that is what mattered.
        }
    }

    private static string Describe(DateOnly from, DateOnly to) =>
        from == to ? $"on {from:yyyy-MM-dd}" : $"from {from:yyyy-MM-dd} to {to:yyyy-MM-dd}";
}
