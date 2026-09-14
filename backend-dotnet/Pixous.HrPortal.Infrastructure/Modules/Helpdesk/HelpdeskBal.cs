using Pixous.HrPortal.Domain.Common;
using Pixous.HrPortal.Domain.Modules.Helpdesk;
using Pixous.HrPortal.Domain.Modules.Notification;

namespace Pixous.HrPortal.Infrastructure.Modules.Helpdesk;

/// <summary>
/// Support tickets, ported from
/// com.pixous.hrportal.modules.helpdesk.HelpdeskService.
/// </summary>
public sealed class HelpdeskBal : IHelpdeskBal
{
    private readonly IHelpdeskDal _dal;
    private readonly INotificationBal _notifications;
    private readonly IOversightNotifier _oversight;
    private readonly ISmsService _sms;

    public HelpdeskBal(
        IHelpdeskDal dal,
        INotificationBal notifications,
        IOversightNotifier oversight,
        ISmsService sms)
    {
        _dal = dal;
        _notifications = notifications;
        _oversight = oversight;
        _sms = sms;
    }

    public async Task<TicketRecord> RaiseAsync(long userId, RaiseTicketRequest req,
                                               CancellationToken ct = default)
    {
        TicketResponse res = await RaiseTicketAsync(userId, req, ct);
        return await _dal.FindAsync(res.Id, ct) ?? new TicketRecord { Id = res.Id };
    }

    public async Task<TicketResponse> RaiseTicketAsync(long userId, RaiseTicketRequest req,
                                                       CancellationToken ct = default)
    {
        DateTime now = DateTime.Now;
        long existing = await _dal.CountTicketsAsync(ct);

        string? industry = await _dal.GetUserIndustryAsync(userId, ct);
        string category = !string.IsNullOrWhiteSpace(req.Category)
            ? req.Category
            : (string.Equals(industry, "CIVIL", StringComparison.OrdinalIgnoreCase) ? "Infra" : "Digital");

        var ticket = new TicketRecord
        {
            TicketCode = HelpdeskRules.TicketCode(existing, now.Year),
            RaisedBy = userId,
            Title = req.Title,
            Description = req.Description,
            Attachments = req.Attachments?.Trim(),
            Type = string.IsNullOrWhiteSpace(req.Type) ? "IT" : req.Type.ToUpperInvariant(),
            Category = category,
            Priority = string.IsNullOrWhiteSpace(req.Priority) ? "MEDIUM" : req.Priority.ToUpperInvariant(),
            Status = "OPEN",
            AssignedTo = req.AssignedTo,
            SlaDueAt = HelpdeskRules.SlaDue(req.Priority, now),
            CreatedAt = now
        };

        await _dal.InsertAsync(ticket, ct);
        TicketRecord? saved = await _dal.FindAsync(ticket.Id, ct);
        TicketRecord resolved = saved ?? ticket;

        string raiserName = resolved.RaisedByName ?? "?";

        // Oversight copy to CTO
        await _oversight.NotifyCtoAsync(
            userId,
            $"New support request {resolved.TicketCode}",
            $"{raiserName} raised: {resolved.Title}",
            "HELPDESK",
            "/helpdesk",
            ct);

        // Notify addressee
        if (resolved.AssignedTo.HasValue && resolved.AssignedTo.Value != userId)
        {
            await _notifications.CreateAndPushAsync(
                resolved.AssignedTo.Value,
                $"New support request {resolved.TicketCode}",
                $"{raiserName} sent you a support request",
                "HELPDESK",
                "/helpdesk",
                ct);
        }

        return ToResponse(resolved, new List<CommentResponse>());
    }

    public Task<IReadOnlyList<TicketRecord>> MineAsync(long userId, CancellationToken ct = default) =>
        _dal.FindForUserAsync(userId, ct);

    public async Task<PageResponse<TicketResponse>> MyTicketsPagedAsync(long userId, int page,
                                                                        int size,
                                                                        CancellationToken ct = default)
    {
        int offset = Math.Max(0, page) * Math.Max(1, size);
        var (items, total) = await _dal.FindMyTicketsPagedAsync(userId, offset, size, ct);
        var content = items.Select(t => ToResponse(t, null)).ToList();
        return PageResponse<TicketResponse>.Of(content, page, size, total);
    }

    public Task<IReadOnlyList<TicketRecord>> AllAsync(CancellationToken ct = default) =>
        _dal.FindAllAsync(ct);

    public async Task<PageResponse<TicketResponse>> AllTicketsPagedAsync(long viewerId, string? status,
                                                                         int page, int size,
                                                                         CancellationToken ct = default)
    {
        int offset = Math.Max(0, page) * Math.Max(1, size);
        IReadOnlyList<long> hrDeskIds = await _dal.GetHrDeskUserIdsAsync(ct);
        bool isDeskMember = hrDeskIds.Contains(viewerId);

        // Desk members share queue, admins see all
        var (items, total) = await _dal.FindAllDeskPagedAsync(
            viewerId, true, hrDeskIds, status, offset, size, ct);

        var content = items.Select(t => ToResponse(t, null)).ToList();
        return PageResponse<TicketResponse>.Of(content, page, size, total);
    }

    public Task<IReadOnlyList<TicketRecord>> AssignedToMeAsync(long agentId,
                                                               CancellationToken ct = default) =>
        _dal.FindAssignedAsync(agentId, ct);

    public async Task<PageResponse<TicketResponse>> AgentQueuePagedAsync(long agentId, string? status,
                                                                         int page, int size,
                                                                         CancellationToken ct = default)
    {
        int offset = Math.Max(0, page) * Math.Max(1, size);
        var (items, total) = await _dal.FindAssignedPagedAsync(agentId, status, offset, size, ct);
        var content = items.Select(t => ToResponse(t, null)).ToList();
        return PageResponse<TicketResponse>.Of(content, page, size, total);
    }

    public async Task<TicketDetail> GetAsync(long id, CancellationToken ct = default)
    {
        TicketRecord ticket = await Require(id, ct);
        return new TicketDetail(ticket, await _dal.FindCommentsAsync(id, ct));
    }

    public async Task<TicketResponse> GetResponseAsync(long id, CancellationToken ct = default)
    {
        TicketRecord ticket = await Require(id, ct);
        IReadOnlyList<TicketCommentRecord> comments = await _dal.FindCommentsAsync(id, ct);
        var commentResponses = comments.Select(c => new CommentResponse(
            c.Id, c.TicketId, c.AuthorId, c.AuthorName, c.Comment, c.AttachmentPath, c.CreatedAt)).ToList();
        return ToResponse(ticket, commentResponses);
    }

    public async Task<TicketResponse> UpdateOwnAsync(long userId, long id, RaiseTicketRequest req,
                                                     CancellationToken ct = default)
    {
        TicketRecord t = await Require(id, ct);
        if (userId != t.RaisedBy)
        {
            throw ApiException.Business("You can only edit tickets you raised");
        }
        if (!string.Equals(t.Status, "OPEN", StringComparison.OrdinalIgnoreCase))
        {
            throw ApiException.Business(
                $"This ticket is already {t.Status?.ToLowerInvariant().Replace('_', ' ')} — add a reply instead of editing it");
        }

        t.Title = req.Title;
        t.Description = req.Description;
        if (req.Attachments != null)
        {
            t.Attachments = string.IsNullOrWhiteSpace(req.Attachments) ? null : req.Attachments.Trim();
        }
        if (!string.IsNullOrWhiteSpace(req.Type))
        {
            t.Type = req.Type.ToUpperInvariant();
        }
        if (!string.IsNullOrWhiteSpace(req.Priority))
        {
            t.Priority = req.Priority.ToUpperInvariant();
            t.SlaDueAt = HelpdeskRules.SlaDue(t.Priority, DateTime.Now);
        }
        long? prevAssigned = t.AssignedTo;
        if (req.AssignedTo.HasValue)
        {
            t.AssignedTo = req.AssignedTo.Value;
        }
        t.UpdatedAt = DateTime.Now;

        await _dal.UpdateAsync(t, ct);
        TicketRecord updated = await Require(id, ct);

        // Tell assigned agent
        if (updated.AssignedTo.HasValue && updated.AssignedTo.Value != userId)
        {
            await _notifications.CreateAndPushAsync(
                updated.AssignedTo.Value,
                $"Support request {updated.TicketCode} updated",
                $"{updated.RaisedByName ?? "Employee"} updated their support request",
                "HELPDESK",
                "/helpdesk",
                ct);
        }

        IReadOnlyList<TicketCommentRecord> comments = await _dal.FindCommentsAsync(id, ct);
        var commentResponses = comments.Select(c => new CommentResponse(
            c.Id, c.TicketId, c.AuthorId, c.AuthorName, c.Comment, c.AttachmentPath, c.CreatedAt)).ToList();
        return ToResponse(updated, commentResponses);
    }

    public async Task<TicketRecord> ChangeStatusAsync(long actorId, long id, string? status,
                                                      long? assignTo,
                                                      CancellationToken ct = default)
    {
        TicketRecord t = await Require(id, ct);

        if (actorId == t.RaisedBy)
        {
            throw ApiException.Business(
                "You raised this request, so it is not yours to decide — "
                + "the person it was sent to will handle it");
        }

        if (t.AssignedTo is not null && actorId != t.AssignedTo)
        {
            throw ApiException.Business("This request was sent to someone else to handle");
        }

        string target = status?.ToUpperInvariant() ?? string.Empty;

        if (!HelpdeskRules.ValidStatuses.Contains(target))
        {
            throw ApiException.Business($"Invalid status: {status}");
        }

        if (!HelpdeskRules.IsAllowedTransition(t.Status, target))
        {
            throw ApiException.Business($"Invalid status transition from {t.Status} to {target}");
        }

        t.Status = target;

        if (assignTo is not null)
        {
            t.AssignedTo = assignTo;
        }

        if (target is "RESOLVED" or "CLOSED")
        {
            t.ResolvedAt = DateTime.Now;
        }

        t.UpdatedAt = DateTime.Now;
        await _dal.UpdateAsync(t, ct);

        await _notifications.CreateAndPushAsync(
            t.RaisedBy,
            $"Ticket {t.TicketCode} {target.ToLowerInvariant().Replace('_', ' ')}",
            $"Your ticket status changed to {target}",
            "HELPDESK", "/helpdesk", ct);

        return await _dal.FindAsync(id, ct) ?? t;
    }

    public async Task<TicketResponse> ChangeStatusResponseAsync(long actorId, long id,
                                                               string? status, long? assignTo,
                                                               CancellationToken ct = default)
    {
        TicketRecord updated = await ChangeStatusAsync(actorId, id, status, assignTo, ct);
        IReadOnlyList<TicketCommentRecord> comments = await _dal.FindCommentsAsync(id, ct);
        var commentResponses = comments.Select(c => new CommentResponse(
            c.Id, c.TicketId, c.AuthorId, c.AuthorName, c.Comment, c.AttachmentPath, c.CreatedAt)).ToList();
        return ToResponse(updated, commentResponses);
    }

    public async Task<TicketCommentRecord> CommentAsync(long authorId, long id, string comment,
                                                        CancellationToken ct = default)
    {
        await Require(id, ct);

        var row = new TicketCommentRecord
        {
            TicketId = id,
            AuthorId = authorId,
            Comment = comment
        };

        await _dal.InsertCommentAsync(row, ct);
        return row;
    }

    public async Task<CommentResponse> AddCommentAsync(long authorId, long id, string comment,
                                                       string? attachmentPath,
                                                       CancellationToken ct = default)
    {
        TicketRecord t = await Require(id, ct);

        var row = new TicketCommentRecord
        {
            TicketId = id,
            AuthorId = authorId,
            Comment = comment,
            AttachmentPath = attachmentPath
        };

        await _dal.InsertCommentAsync(row, ct);

        // Notify other party
        long? notifyTarget = authorId == t.RaisedBy ? t.AssignedTo : t.RaisedBy;
        if (notifyTarget.HasValue && notifyTarget.Value != authorId)
        {
            await _notifications.CreateAndPushAsync(
                notifyTarget.Value,
                $"New comment on {t.TicketCode}",
                $"A new comment was posted on ticket {t.TicketCode}",
                "HELPDESK",
                "/helpdesk",
                ct);
        }

        return new CommentResponse(row.Id, id, authorId, null, comment, attachmentPath, DateTime.Now);
    }

    public async Task<TicketRecord> RateAsync(long userId, long id, int rating,
                                              CancellationToken ct = default)
    {
        TicketRecord t = await Require(id, ct);

        if (t.RaisedBy != userId)
        {
            throw ApiException.Business("Only the requester can rate this ticket");
        }

        if (t.Status is not ("RESOLVED" or "CLOSED"))
        {
            throw ApiException.Business("Only resolved tickets can be rated");
        }

        t.Rating = rating;
        t.UpdatedAt = DateTime.Now;
        await _dal.UpdateAsync(t, ct);

        return t;
    }

    public async Task<TicketResponse> RateTicketAsync(long userId, long id, int rating,
                                                      CancellationToken ct = default)
    {
        TicketRecord updated = await RateAsync(userId, id, rating, ct);
        IReadOnlyList<TicketCommentRecord> comments = await _dal.FindCommentsAsync(id, ct);
        var commentResponses = comments.Select(c => new CommentResponse(
            c.Id, c.TicketId, c.AuthorId, c.AuthorName, c.Comment, c.AttachmentPath, c.CreatedAt)).ToList();
        return ToResponse(updated, commentResponses);
    }

    public async Task<TicketRecord> CancelAsync(long userId, long id,
                                                CancellationToken ct = default)
    {
        TicketRecord t = await Require(id, ct);

        if (t.RaisedBy != userId)
        {
            throw ApiException.Business("You can only cancel tickets you raised");
        }

        if (string.Equals(t.Status, "CANCELLED", StringComparison.OrdinalIgnoreCase))
        {
            throw ApiException.Business("This ticket is already cancelled.");
        }

        if (!string.Equals(t.Status, "OPEN", StringComparison.OrdinalIgnoreCase))
        {
            throw ApiException.Business(
                $"This ticket is already {t.Status?.ToLowerInvariant().Replace('_', ' ')} "
                + "— it can no longer be cancelled.");
        }

        t.Status = "CANCELLED";
        t.UpdatedAt = DateTime.Now;
        await _dal.UpdateAsync(t, ct);

        return t;
    }

    public Task CancelOwnAsync(long userId, long id, CancellationToken ct = default) =>
        CancelAsync(userId, id, ct);

    public Task<IReadOnlyList<AgentView>> GetAgentsAsync(long requesterId,
                                                         CancellationToken ct = default) =>
        _dal.FindAgentsAsync(requesterId, ct);

    private async Task<TicketRecord> Require(long id, CancellationToken ct) =>
        await _dal.FindAsync(id, ct) ?? throw ApiException.NotFound("Ticket");

    private static TicketResponse ToResponse(TicketRecord t, IReadOnlyList<CommentResponse>? comments) =>
        new(t.Id, t.TicketCode, t.RaisedBy, t.RaisedByName, t.RaisedByCode, t.Title, t.Description,
            t.Attachments, t.Type, t.Category, t.Priority, t.Status, t.AssignedTo, t.AssignedToName,
            t.SlaDueAt, t.Rating, t.ResolvedAt, t.CreatedAt, comments);
}
