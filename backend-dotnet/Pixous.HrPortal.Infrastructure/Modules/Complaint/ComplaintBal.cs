using Pixous.HrPortal.Domain.Common;
using Pixous.HrPortal.Domain.Modules.Complaint;
using Pixous.HrPortal.Domain.Modules.Notification;

namespace Pixous.HrPortal.Infrastructure.Modules.Complaint;

/// <summary>
/// Complaints and needs, ported from
/// com.pixous.hrportal.modules.complaint.ComplaintService.
///
/// The routing rule is the module: a complaint addressed to a particular desk is
/// theirs to answer, one addressed to nobody is open to any desk, and oversight
/// answers anything — which is what <c>seesEveryRequest</c> means everywhere
/// else in this codebase.
/// </summary>
public sealed class ComplaintBal : IComplaintBal
{
    private readonly IComplaintDal _dal;
    private readonly INotificationBal _notifications;

    public ComplaintBal(IComplaintDal dal, INotificationBal notifications)
    {
        _dal = dal;
        _notifications = notifications;
    }

    public async Task<ComplaintRecord> RaiseAsync(long userId, ComplaintRequest req,
                                                  CancellationToken ct = default)
    {
        var complaint = new ComplaintRecord
        {
            ReferenceCode = await NextCodeAsync(ct),
            RaisedBy = userId,
            RequestedTo = req.RequestedTo,
            Kind = string.IsNullOrWhiteSpace(req.Kind) ? "COMPLAINT" : req.Kind.Trim().ToUpperInvariant(),
            Category = req.Category,
            Subject = req.Subject.Trim(),
            Description = req.Description.Trim(),
            Priority = string.IsNullOrWhiteSpace(req.Priority) ? "MEDIUM" : req.Priority,
            Status = "OPEN"
        };

        await _dal.InsertAsync(complaint, ct);

        if (complaint.RequestedTo is not null)
        {
            await _notifications.CreateAndPushAsync(
                complaint.RequestedTo.Value,
                "New complaint",
                $"{complaint.ReferenceCode}: {complaint.Subject}",
                "COMPLAINT", "/complaints", ct);
        }

        return await _dal.FindAsync(complaint.Id, ct) ?? complaint;
    }

    public Task<IReadOnlyList<ComplaintRecord>> MineAsync(long userId,
                                                          CancellationToken ct = default) =>
        _dal.FindForUserAsync(userId, ct);

    public Task<IReadOnlyList<ComplaintRecord>> AllAsync(CancellationToken ct = default) =>
        _dal.FindAllAsync(ct);

    public async Task<ComplaintRecord> GetAsync(long id, CancellationToken ct = default) =>
        await _dal.FindAsync(id, ct) ?? throw ApiException.NotFound("Complaint");

    public async Task<ComplaintRecord> RespondAsync(long staffId, long id, string? status,
                                                    string? response,
                                                    CancellationToken ct = default)
    {
        ComplaintRecord c = await GetAsync(id, ct);

        // Addressed to a desk: theirs to answer. Addressed to nobody: open to
        // any desk. Oversight answers anything.
        bool mine = staffId == c.RequestedTo;
        bool unaddressed = c.RequestedTo is null;

        if (!mine && !unaddressed && !await _dal.SeesEveryRequestAsync(staffId, ct))
        {
            string? name = await _dal.FindUserNameAsync(c.RequestedTo!.Value, ct);
            throw ApiException.Business(
                $"This was addressed to {name ?? "someone else"}. Only they can respond to it.");
        }

        string normalised = status?.ToUpperInvariant() ?? string.Empty;

        if (!ComplaintStatuses.Valid.Contains(normalised))
        {
            throw ApiException.Business($"Invalid status: {status}");
        }

        c.Status = normalised;

        if (!string.IsNullOrWhiteSpace(response))
        {
            c.HrResponse = response;
            c.HandledBy = staffId;
        }

        // Both endings stamp the resolution time -- a rejected complaint is as
        // finished as a resolved one.
        if (normalised is "RESOLVED" or "REJECTED")
        {
            c.ResolvedAt = DateTime.Now;
        }

        c.UpdatedAt = DateTime.Now;
        await _dal.UpdateAsync(c, ct);

        await _notifications.CreateAndPushAsync(
            c.RaisedBy,
            $"Complaint {c.ReferenceCode} {normalised.ToLowerInvariant().Replace('_', ' ')}",
            c.HrResponse ?? $"Your complaint is now {normalised}.",
            "COMPLAINT", "/complaints", ct);

        return await _dal.FindAsync(id, ct) ?? c;
    }

    public async Task<ComplaintRecord> CancelAsync(long userId, long id,
                                                   CancellationToken ct = default)
    {
        ComplaintRecord c = await GetAsync(id, ct);

        if (c.RaisedBy != userId)
        {
            throw ApiException.Business("You can only cancel complaints you raised");
        }

        if (string.Equals(c.Status, "CANCELLED", StringComparison.OrdinalIgnoreCase))
        {
            throw ApiException.Business("This complaint is already cancelled.");
        }

        // Once a desk has started on it, withdrawing would discard their work.
        if (!string.Equals(c.Status, "OPEN", StringComparison.OrdinalIgnoreCase))
        {
            throw ApiException.Business(
                $"This complaint is already {c.Status?.ToLowerInvariant().Replace('_', ' ')} "
                + "— it can no longer be cancelled.");
        }

        c.Status = "CANCELLED";
        c.UpdatedAt = DateTime.Now;
        await _dal.UpdateAsync(c, ct);

        return c;
    }

    /// <summary>
    /// <c>CN-{year}-{00001}</c>, counted from the highest existing code — the
    /// same reason as discipline and appreciation.
    /// </summary>
    private async Task<string> NextCodeAsync(CancellationToken ct)
    {
        string prefix = $"CN-{DateTime.Now.Year}-";
        string? max = await _dal.FindMaxReferenceCodeAsync(prefix, ct);

        long next = 1;
        if (max is not null && max.Length > prefix.Length
            && long.TryParse(max[prefix.Length..], out long parsed))
        {
            next = parsed + 1;
        }

        return prefix + next.ToString("00000");
    }

    public Task<IReadOnlyList<ComplaintRecipientView>> RecipientsAsync(long userId, CancellationToken ct = default) =>
        _dal.FindRecipientsAsync(userId, ct);
}

