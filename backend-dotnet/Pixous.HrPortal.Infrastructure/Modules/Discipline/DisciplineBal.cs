using Pixous.HrPortal.Domain.Common;
using Pixous.HrPortal.Domain.Modules.Discipline;
using Pixous.HrPortal.Domain.Modules.Notification;

namespace Pixous.HrPortal.Infrastructure.Modules.Discipline;

/// <summary>
/// Disciplinary records, ported from
/// com.pixous.hrportal.modules.discipline.DisciplineService.
/// </summary>
public sealed class DisciplineBal : IDisciplineBal
{
    private static readonly HashSet<string> Statuses = new(StringComparer.OrdinalIgnoreCase)
    {
        "OPEN", "UNDER_REVIEW", "RESOLVED", "CLOSED", "CANCELLED"
    };

    private readonly IDisciplineDal _dal;
    private readonly INotificationBal _notifications;
    private readonly IOversightNotifier _oversight;

    public DisciplineBal(
        IDisciplineDal dal,
        INotificationBal notifications,
        IOversightNotifier oversight)
    {
        _dal = dal;
        _notifications = notifications;
        _oversight = oversight;
    }

    public async Task<DisciplineRecord> CreateAsync(long reporterId, DisciplineRequest req,
                                                    CancellationToken ct = default)
    {
        DisciplineView view = await CreateViewAsync(reporterId, req, ct);
        return await Require(view.Id, ct);
    }

    public async Task<DisciplineView> CreateViewAsync(long reporterId, DisciplineRequest req,
                                                      CancellationToken ct = default)
    {
        if (await _dal.SeesEveryRequestAsync(reporterId, ct))
        {
            throw ApiException.Business("Discipline records are raised by HR. Yours is the review.");
        }

        if (req.EmployeeId == reporterId)
        {
            throw ApiException.Business("A discipline record cannot be raised about yourself.");
        }

        var record = new DisciplineRecord
        {
            ReferenceCode = await NextCodeAsync(ct),
            EmployeeId = req.EmployeeId,
            ReportedBy = reporterId,
            IncidentDate = req.IncidentDate,
            DisciplineType = req.DisciplineType.Trim(),
            Severity = DisciplineSeverities.Normalise(req.Severity, "MEDIUM"),
            Subject = req.Subject.Trim(),
            Description = req.Description.Trim(),
            ActionTaken = TrimToNull(req.ActionTaken),
            Attachments = TrimToNull(req.Attachments),
            Status = "OPEN"
        };

        await _dal.InsertAsync(record, ct);
        DisciplineRecord created = await Require(record.Id, ct);

        // Tell the employee a record was opened
        await _notifications.CreateAndPushAsync(
            created.EmployeeId,
            $"Discipline record {created.ReferenceCode}",
            $"A discipline record ({created.DisciplineType}) was logged regarding: {created.Subject}",
            "DISCIPLINE",
            "/discipline",
            ct);

        // Oversight copy to CTO
        await _oversight.NotifyCtoAsync(
            reporterId,
            $"Discipline record {created.ReferenceCode}",
            $"{created.ReportedByName ?? "HR"} raised a discipline record for {created.EmployeeName ?? "an employee"}.",
            "DISCIPLINE",
            "/discipline",
            ct);

        return ToView(created);
    }

    public Task<IReadOnlyList<DisciplineRecord>> MineAsync(long userId,
                                                           CancellationToken ct = default) =>
        _dal.FindForEmployeeAsync(userId, ct);

    public async Task<IReadOnlyList<DisciplineView>> MineViewAsync(long userId,
                                                                   CancellationToken ct = default)
    {
        IReadOnlyList<DisciplineRecord> list = await _dal.FindForEmployeeAsync(userId, ct);
        return list.Select(ToView).ToList();
    }

    public Task<IReadOnlyList<DisciplineRecord>> AllAsync(CancellationToken ct = default) =>
        _dal.FindAllAsync(ct);

    public async Task<IReadOnlyList<DisciplineView>> AllViewAsync(string? status, int page, int size,
                                                                  CancellationToken ct = default)
    {
        int offset = Math.Max(0, page) * Math.Max(1, size);
        IReadOnlyList<DisciplineRecord> list = await _dal.FilterAllAsync(status, offset, size, ct);
        return list.Select(ToView).ToList();
    }

    public async Task<IReadOnlyList<DisciplineView>> PendingReviewAsync(CancellationToken ct = default)
    {
        IReadOnlyList<DisciplineRecord> list = await _dal.FindPendingReviewAsync(ct);
        return list.Select(ToView).ToList();
    }

    public async Task<DisciplineRecord> GetAsync(long viewerId, long id, bool canManage,
                                                 CancellationToken ct = default)
    {
        DisciplineRecord d = await Require(id, ct);

        bool allowed = d.EmployeeId == viewerId
                    || d.ReportedBy == viewerId
                    || canManage
                    || await _dal.SeesEveryRequestAsync(viewerId, ct);

        if (!allowed)
        {
            throw ApiException.Business("That record is not yours to read.");
        }

        return d;
    }

    public async Task<DisciplineView> GetViewAsync(long viewerId, long id, bool canManage,
                                                  CancellationToken ct = default)
    {
        DisciplineRecord d = await GetAsync(viewerId, id, canManage, ct);
        return ToView(d);
    }

    public async Task<DisciplineView> UpdateAsync(long actorId, long id, UpdateDisciplineRequest req,
                                                 CancellationToken ct = default)
    {
        if (await _dal.SeesEveryRequestAsync(actorId, ct))
        {
            throw ApiException.Business("A discipline record is edited by HR. Yours is the review.");
        }

        DisciplineRecord d = await Require(id, ct);
        if (string.Equals(d.Status, "CLOSED", StringComparison.OrdinalIgnoreCase)
            || string.Equals(d.Status, "CANCELLED", StringComparison.OrdinalIgnoreCase))
        {
            throw ApiException.Business(
                $"This record is {d.Status?.ToLowerInvariant()} and can no longer be edited.");
        }

        d.IncidentDate = req.IncidentDate;
        d.DisciplineType = req.DisciplineType.Trim();
        d.Severity = DisciplineSeverities.Normalise(req.Severity, d.Severity ?? "MEDIUM");
        d.Subject = req.Subject.Trim();
        d.Description = req.Description.Trim();
        d.ActionTaken = TrimToNull(req.ActionTaken);
        if (req.Attachments != null)
        {
            d.Attachments = TrimToNull(req.Attachments);
        }
        if (!string.IsNullOrWhiteSpace(req.Status) && Statuses.Contains(req.Status.Trim()))
        {
            d.Status = req.Status.Trim().ToUpperInvariant();
        }
        d.UpdatedAt = DateTime.Now;

        await _dal.UpdateAsync(d, ct);
        DisciplineRecord updated = await Require(id, ct);

        await _notifications.CreateAndPushAsync(
            updated.EmployeeId,
            "Discipline record updated",
            $"{updated.ReferenceCode} was updated.",
            "DISCIPLINE",
            "/discipline",
            ct);

        return ToView(updated);
    }

    public async Task<DisciplineRecord> RespondAsync(long userId, long id, string? response,
                                                     CancellationToken ct = default)
    {
        DisciplineView v = await RespondViewAsync(userId, id, response, ct);
        return await Require(v.Id, ct);
    }

    public async Task<DisciplineView> RespondViewAsync(long userId, long id, string? response,
                                                       CancellationToken ct = default)
    {
        DisciplineRecord d = await Require(id, ct);

        if (d.EmployeeId != userId)
        {
            throw ApiException.Business("You can only respond to a record about yourself.");
        }

        if (string.Equals(d.Status, "CANCELLED", StringComparison.OrdinalIgnoreCase))
        {
            throw ApiException.Business("This record was withdrawn, so there is nothing to answer.");
        }

        d.EmployeeResponse = TrimToNull(response);
        d.RespondedAt = DateTime.Now;
        if (string.Equals(d.Status, "OPEN", StringComparison.OrdinalIgnoreCase))
        {
            d.Status = "UNDER_REVIEW";
        }
        d.UpdatedAt = DateTime.Now;

        await _dal.UpdateAsync(d, ct);
        DisciplineRecord saved = await Require(id, ct);

        string who = saved.EmployeeName ?? "Employee";
        if (saved.ReportedBy.HasValue)
        {
            await _notifications.CreateAndPushAsync(
                saved.ReportedBy.Value,
                $"Response to {saved.ReferenceCode}",
                $"{who} responded to the discipline record.",
                "DISCIPLINE",
                "/discipline",
                ct);
        }

        await _oversight.NotifyCtoAsync(
            userId,
            $"Response to {saved.ReferenceCode}",
            $"{who} responded to their discipline record.",
            "DISCIPLINE",
            "/discipline",
            ct);

        return ToView(saved);
    }

    public async Task<DisciplineView> ReviewAsync(long ctoId, long id, ReviewDisciplineRequest req,
                                                  CancellationToken ct = default)
    {
        DisciplineRecord d = await Require(id, ct);

        if (string.Equals(d.Status, "CANCELLED", StringComparison.OrdinalIgnoreCase))
        {
            throw ApiException.Business("This record was withdrawn and cannot be reviewed.");
        }

        if (string.Equals(d.Status, "CLOSED", StringComparison.OrdinalIgnoreCase))
        {
            throw ApiException.Business("This record is closed. Reopen it before reviewing again.");
        }

        string? remarks = TrimToNull(req.Remarks);
        if (remarks != null)
        {
            d.CtoRemarks = remarks;
            d.ReviewedBy = ctoId;
            d.ReviewedAt = DateTime.Now;
        }

        if (!string.IsNullOrWhiteSpace(req.Status) && Statuses.Contains(req.Status.Trim()))
        {
            d.Status = req.Status.Trim().ToUpperInvariant();
        }
        d.UpdatedAt = DateTime.Now;

        await _dal.UpdateAsync(d, ct);
        DisciplineRecord saved = await Require(id, ct);

        if (remarks != null)
        {
            await _notifications.CreateAndPushAsync(
                saved.EmployeeId,
                $"CTO review on {saved.ReferenceCode}",
                $"The CTO reviewed this record: \"{remarks}\"",
                "DISCIPLINE",
                "/discipline",
                ct);
        }

        return ToView(saved);
    }

    public async Task<DisciplineRecord> CancelAsync(long actorId, long id,
                                                    CancellationToken ct = default)
    {
        await CancelDisciplineAsync(actorId, id, ct);
        return await Require(id, ct);
    }

    public async Task CancelDisciplineAsync(long actorId, long id, CancellationToken ct = default)
    {
        if (await _dal.SeesEveryRequestAsync(actorId, ct))
        {
            throw ApiException.Business("A discipline record is withdrawn by HR. Yours is the review.");
        }

        DisciplineRecord d = await Require(id, ct);

        if (string.Equals(d.Status, "CANCELLED", StringComparison.OrdinalIgnoreCase))
        {
            throw ApiException.Business("This record is already cancelled.");
        }

        if (string.Equals(d.Status, "CLOSED", StringComparison.OrdinalIgnoreCase))
        {
            throw ApiException.Business("A closed record can no longer be cancelled.");
        }

        d.Status = "CANCELLED";
        d.UpdatedAt = DateTime.Now;

        await _dal.UpdateAsync(d, ct);
        DisciplineRecord saved = await Require(id, ct);

        await _notifications.CreateAndPushAsync(
            saved.EmployeeId,
            "Discipline record withdrawn",
            $"{saved.ReferenceCode} was withdrawn.",
            "DISCIPLINE",
            "/discipline",
            ct);

        await _oversight.NotifyCtoAsync(
            actorId,
            "Discipline record withdrawn",
            $"{saved.ReferenceCode} for {saved.EmployeeName ?? "an employee"} was withdrawn.",
            "DISCIPLINE",
            "/discipline",
            ct);
    }

    private async Task<string> NextCodeAsync(CancellationToken ct)
    {
        string prefix = $"DSP-{DateTime.Now.Year}-";
        string? max = await _dal.FindMaxReferenceCodeAsync(prefix, ct);

        long next = 1;
        if (max is not null && max.Length > prefix.Length
            && long.TryParse(max[prefix.Length..], out long parsed))
        {
            next = parsed + 1;
        }

        return prefix + next.ToString("00000");
    }

    private static string? TrimToNull(string? s) =>
        string.IsNullOrWhiteSpace(s) ? null : s.Trim();

    private async Task<DisciplineRecord> Require(long id, CancellationToken ct) =>
        await _dal.FindAsync(id, ct) ?? throw ApiException.NotFound("Discipline record");

    private static DisciplineView ToView(DisciplineRecord d) =>
        new(d.Id, d.ReferenceCode, d.EmployeeId, d.EmployeeName, d.EmployeeCode, d.Department,
            d.ReportedBy, d.ReportedByName, d.IncidentDate, d.DisciplineType, d.Severity,
            d.Subject, d.Description, d.ActionTaken, d.Attachments, d.EmployeeResponse,
            d.RespondedAt, d.CtoRemarks, d.ReviewedByName, d.ReviewedAt, d.Status, d.CreatedAt);
}
