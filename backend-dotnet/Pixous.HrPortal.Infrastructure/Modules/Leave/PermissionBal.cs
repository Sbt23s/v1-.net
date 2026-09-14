using System.Globalization;
using Pixous.HrPortal.Domain.Common;
using Pixous.HrPortal.Domain.Modules.Leave;
using Pixous.HrPortal.Domain.Modules.Notification;
using Pixous.HrPortal.Domain.Modules.Wfh;
using Pixous.HrPortal.Domain.Security;

namespace Pixous.HrPortal.Infrastructure.Modules.Leave;

/// <summary>
/// Permission requests, ported from
/// com.pixous.hrportal.modules.leave.PermissionService.
/// </summary>
public sealed class PermissionBal : IPermissionBal
{
    private readonly IPermissionDal _dal;
    private readonly IWfhDal _people;
    private readonly INotificationBal _notifications;
    private readonly IOversightNotifier _oversight;
    private readonly ICurrentUser _currentUser;

    public PermissionBal(IPermissionDal dal,
                         IWfhDal people,
                         INotificationBal notifications,
                         IOversightNotifier oversight,
                         ICurrentUser currentUser)
    {
        _dal = dal;
        _people = people;
        _notifications = notifications;
        _oversight = oversight;
        _currentUser = currentUser;
    }

    public async Task<PermissionResponse> ApplyAsync(long userId,
                                                     PermissionApplyRequest req,
                                                     CancellationToken ct = default)
    {
        // 1. The times have to be times.
        if (!PermissionRules.TryParseTime(req.FromTime, out TimeOnly from)
            || !PermissionRules.TryParseTime(req.ToTime, out TimeOnly to))
        {
            throw ApiException.Business("Invalid time — use HH:mm");
        }

        // 2. And they have to run forwards. Equal is not allowed either: zero
        //    minutes off is not a request.
        if (to <= from)
        {
            throw ApiException.Business("End time must be after start time");
        }

        // 3. A permission on a Saturday or Sunday is a mistake, not a request.
        if (WorkCalendar.IsWeekend(req.RequestDate))
        {
            throw ApiException.Business(
                $"Permission cannot be taken on a {req.RequestDate.DayOfWeek}. "
                + "Saturdays and Sundays are not working days.");
        }

        // 4. One permission per person per day.
        IReadOnlyList<PermissionRequestRecord> sameDay =
            await _dal.FindLiveOnDateAsync(userId, req.RequestDate, ct);

        if (sameDay.Count > 0)
        {
            PermissionRequestRecord existing = sameDay[0];
            throw ApiException.Business(
                $"You already have a permission on {Iso(req.RequestDate)} from "
                + $"{existing.FromTime} to {existing.ToTime} "
                + $"({existing.Status?.ToLowerInvariant()}). "
                + "Only one permission per day is allowed. "
                + "Cancel that request first, or choose another date.");
        }

        // 5. Permission is time off inside the working day.
        if (from < PermissionRules.WorkDayStart || to > PermissionRules.WorkDayEnd)
        {
            throw ApiException.Business("Permission can only be taken between 9:00 AM and 6:00 PM.");
        }

        // 6. Two hours is the most in one day.
        long minutes = (long)(to - from).TotalMinutes;
        if (minutes > PermissionRules.MaxPermissionMinutes)
        {
            throw ApiException.Business(
                "Permission is limited to 2 hours a day. That range is "
                + PermissionRules.DescribeMinutes(minutes) + " — apply for leave instead.");
        }

        // 7. Leave already booked on the day.
        var onLeave = await _dal.FindOverlappingLeaveAsync(userId, req.RequestDate, ct);
        if (onLeave is not null)
        {
            throw ApiException.Business(
                $"You already have leave on {Iso(req.RequestDate)} "
                + $"({onLeave.Value.Status?.ToLowerInvariant()}). "
                + "Permission cannot be taken on a day already booked as leave.");
        }

        var request = new PermissionRequestRecord
        {
            UserId = userId,
            RequestDate = req.RequestDate,
            FromTime = from.ToString("HH\\:mm", CultureInfo.InvariantCulture),
            ToTime = to.ToString("HH\\:mm", CultureInfo.InvariantCulture),
            Hours = PermissionRules.HoursBetween(from, to),
            Reason = req.Reason,
            Priority = string.IsNullOrWhiteSpace(req.Priority) ? "MEDIUM" : req.Priority,
            RequestedTo = req.RequestedTo,
            Status = "PENDING"
        };

        await _dal.InsertAsync(request, ct);

        if (req.RequestedTo is not null)
        {
            ApproverCandidate? applicant = await _people.FindCandidateAsync(userId, ct);
            string applicantName = applicant?.Name ?? "Someone";
            string detail = $"{applicantName} requested {request.Hours}h permission on {Iso(req.RequestDate)} ({req.FromTime}–{req.ToTime})";

            await _notifications.CreateAndPushAsync(
                req.RequestedTo.Value, "New permission request", detail, "PERMISSION", "/leave/permissions", ct);

            await _oversight.NotifyCtoAsync(
                userId, "New permission request", detail, "PERMISSION", "/leave/permissions", ct);
        }

        return (await _dal.FindViewByIdAsync(request.Id, ct))!;
    }

    public Task<IReadOnlyList<PermissionResponse>> MineAsync(long userId,
                                                            CancellationToken ct = default) =>
        _dal.FindForUserAsync(userId, ct);

    public async Task<IReadOnlyList<PermissionResponse>> PendingForAsync(long approverId,
                                                                        CancellationToken ct = default)
    {
        ApproverCandidate? me = await _people.FindCandidateAsync(approverId, ct);
        bool seesWhole = SeesWholeQueue(me);
        return await _dal.FindPendingAsync(approverId, seesWhole, ct);
    }

    public async Task<IReadOnlyList<PermissionResponse>> ForApproverAsync(long approverId,
                                                                         CancellationToken ct = default)
    {
        ApproverCandidate? me = await _people.FindCandidateAsync(approverId, ct);
        bool seesWhole = SeesWholeQueue(me);
        return await _dal.FindForApproverAsync(approverId, seesWhole, ct);
    }

    public Task<IReadOnlyList<PermissionResponse>> AllAsync(CancellationToken ct = default) =>
        _dal.FindAllAsync(ct);

    public async Task<IReadOnlyList<ApproverOption>> ApproversAsync(long requesterId,
                                                                   CancellationToken ct = default)
    {
        ApproverCandidate? me = await _people.FindCandidateAsync(requesterId, ct);
        if (me is null) return [];

        bool iAmHr = WfhApproverRules.HasAnyRole(me, LeaveApproverRules.HrRoles);
        bool iAmTl = WfhApproverRules.HasAnyRole(me, LeaveApproverRules.TeamLeaderRoles);

        var allCandidates = await _people.FindApproverCandidatesAsync(ct);

        IEnumerable<ApproverCandidate> pool;

        if (iAmHr)
        {
            pool = allCandidates.Where(u => u.Id != requesterId && LeaveApproverRules.IsCto(u));
        }
        else if (iAmTl)
        {
            var hrPool = allCandidates.Where(u => u.Id != requesterId && WfhApproverRules.HasAnyRole(u, LeaveApproverRules.RealHrRoles)).ToList();
            if (hrPool.Count > 0)
            {
                pool = hrPool;
            }
            else
            {
                pool = allCandidates.Where(u => u.Id != requesterId && WfhApproverRules.HasAnyRole(u, LeaveApproverRules.HrRoles));
            }
        }
        else
        {
            var tlPool = allCandidates.Where(u => u.Id != requesterId
                && WfhApproverRules.HasAnyRole(u, LeaveApproverRules.TeamLeaderRoles)
                && LeaveRules.SameTeam(me.DesignationTitle, u.DesignationTitle)).ToList();

            if (tlPool.Count == 0)
            {
                tlPool = allCandidates.Where(u => u.Id != requesterId
                    && WfhApproverRules.HasAnyRole(u, LeaveApproverRules.TeamLeaderRoles)).ToList();
            }

            pool = tlPool;
        }

        return pool.Select(u =>
        {
            string name = u.Name ?? "?";
            if (LeaveApproverRules.IsCto(u) && (string.IsNullOrWhiteSpace(name) || name.Equals("CEO", StringComparison.OrdinalIgnoreCase) || name.Equals("CTO", StringComparison.OrdinalIgnoreCase)))
            {
                name = LeaveApproverRules.CtoDisplayName;
            }

            string role;
            if (LeaveApproverRules.IsCto(u)) role = "CTO";
            else if (WfhApproverRules.HasAnyRole(u, LeaveApproverRules.HrRoles)) role = "HR";
            else if (WfhApproverRules.HasAnyRole(u, LeaveApproverRules.TeamLeaderRoles)) role = "TL";
            else role = "Approver";

            return new ApproverOption(u.Id, name, u.EmployeeCode, role);
        }).ToList();
    }

    public async Task<IReadOnlyDictionary<string, object>> AvailabilityAsync(
        long userId, DateOnly date, CancellationToken ct = default)
    {
        var outDict = new Dictionary<string, object>
        {
            ["date"] = Iso(date)
        };

        if (WorkCalendar.IsWeekend(date))
        {
            outDict["available"] = false;
            outDict["reason"] = $"{date.DayOfWeek}s are not working days — permission can only be taken on a working day.";
            return outDict;
        }

        var onLeave = await _dal.FindOverlappingLeaveAsync(userId, date, ct);
        if (onLeave is not null)
        {
            outDict["available"] = false;
            outDict["reason"] = $"You have already applied for leave on this date ({onLeave.Value.Status?.ToLowerInvariant()}). Permission cannot be taken on a day already booked as leave.";
            return outDict;
        }

        var sameDay = await _dal.FindLiveOnDateAsync(userId, date, ct);
        if (sameDay.Count > 0)
        {
            var existing = sameDay[0];
            outDict["available"] = false;
            outDict["reason"] = $"You already have a permission on this date, {existing.FromTime} to {existing.ToTime} ({existing.Status?.ToLowerInvariant()}). Only one permission per day is allowed.";
            return outDict;
        }

        outDict["available"] = true;
        return outDict;
    }

    public async Task<PermissionResponse> DecideAsync(
        long deciderId, long id, bool approve, string? comment, CancellationToken ct = default)
    {
        PermissionRequestRecord p = await _dal.FindByIdAsync(id, ct)
            ?? throw ApiException.NotFound("Permission request");

        if (p.UserId == deciderId)
        {
            throw ApiException.Business("You cannot approve or reject your own permission request");
        }

        if (p.RequestedTo is null || p.RequestedTo != deciderId)
        {
            throw ApiException.Business("Only the approver this request was sent to can approve or reject it.");
        }

        if (!approve && string.IsNullOrWhiteSpace(comment))
        {
            throw ApiException.Business("A reason is required to reject a permission request");
        }

        DateOnly today = DateOnly.FromDateTime(DateTime.Now);
        if (p.Status == "PENDING" && p.RequestDate < today)
        {
            throw ApiException.Business($"This request was for {Iso(p.RequestDate)} and is now overdue — it can no longer be approved or rejected");
        }

        string status = approve ? "APPROVED" : "REJECTED";
        DateTime now = DateTime.Now;

        await _dal.UpdateDecisionAsync(id, status, deciderId, now, comment, ct);

        string verb = approve ? "approved" : "rejected";
        string detail = $"Your permission request for {Iso(p.RequestDate)} was {verb}"
            + (!string.IsNullOrWhiteSpace(comment) ? $": {comment}" : ".");

        await _notifications.CreateAndPushAsync(
            p.UserId, $"Permission {verb}", detail, "PERMISSION", "/leave/permissions", ct);

        ApproverCandidate? applicant = await _people.FindCandidateAsync(p.UserId, ct);
        ApproverCandidate? decider = await _people.FindCandidateAsync(deciderId, ct);

        string applicantName = applicant?.Name ?? "Someone";
        string deciderName = decider?.Name ?? "their approver";

        await _oversight.NotifyCtoAsync(
            deciderId, $"Permission {verb}",
            $"{applicantName}'s permission for {Iso(p.RequestDate)} was {verb} by {deciderName}.",
            "PERMISSION", "/leave/permissions", ct);

        return (await _dal.FindViewByIdAsync(id, ct))!;
    }

    public async Task CancelAsync(long userId, long id, CancellationToken ct = default)
    {
        PermissionRequestRecord p = await _dal.FindByIdAsync(id, ct)
            ?? throw ApiException.NotFound("Permission request");

        if (p.UserId != userId)
        {
            throw ApiException.Business("Not your request");
        }

        if (p.Status != "PENDING")
        {
            throw ApiException.Business("Only pending requests can be cancelled");
        }

        DateTime now = DateTime.Now;
        await _dal.CancelAsync(id, now, ct);

        if (p.RequestedTo is not null)
        {
            ApproverCandidate? applicant = await _people.FindCandidateAsync(userId, ct);
            string who = applicant?.Name ?? "An employee";

            await _notifications.CreateAndPushAsync(
                p.RequestedTo.Value, "Permission request cancelled",
                $"{who} withdrew their permission request for {Iso(p.RequestDate)}",
                "PERMISSION", "/leave/permissions", ct);
        }
    }

    private bool SeesWholeQueue(ApproverCandidate? me) =>
        _currentUser.HasPermission("USER_MANAGE")
        || (me is not null && (
            WfhApproverRules.HasAnyRole(me, LeaveApproverRules.HrRoles)
            || WfhApproverRules.HasAnyRole(me, "SUPER_ADMIN", "COMPANY_ADMIN")));

    private static string Iso(DateOnly d) => d.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
}

