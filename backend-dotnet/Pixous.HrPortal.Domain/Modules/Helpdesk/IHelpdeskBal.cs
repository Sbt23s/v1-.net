using Pixous.HrPortal.Domain.Common;

namespace Pixous.HrPortal.Domain.Modules.Helpdesk;

/// <summary>
/// Support tickets. Ported from
/// com.pixous.hrportal.modules.helpdesk.HelpdeskService.
/// </summary>
public interface IHelpdeskBal
{
    Task<TicketRecord> RaiseAsync(long userId, RaiseTicketRequest request,
                                  CancellationToken ct = default);

    Task<TicketResponse> RaiseTicketAsync(long userId, RaiseTicketRequest request,
                                          CancellationToken ct = default);

    Task<IReadOnlyList<TicketRecord>> MineAsync(long userId, CancellationToken ct = default);

    Task<PageResponse<TicketResponse>> MyTicketsPagedAsync(long userId, int page, int size,
                                                           CancellationToken ct = default);

    Task<IReadOnlyList<TicketRecord>> AllAsync(CancellationToken ct = default);

    Task<PageResponse<TicketResponse>> AllTicketsPagedAsync(long viewerId, string? status, int page,
                                                            int size, CancellationToken ct = default);

    Task<IReadOnlyList<TicketRecord>> AssignedToMeAsync(long agentId,
                                                        CancellationToken ct = default);

    Task<PageResponse<TicketResponse>> AgentQueuePagedAsync(long agentId, string? status, int page,
                                                            int size, CancellationToken ct = default);

    /// <summary>One ticket with its comments.</summary>
    Task<TicketDetail> GetAsync(long id, CancellationToken ct = default);

    Task<TicketResponse> GetResponseAsync(long id, CancellationToken ct = default);

    /// <summary>The raiser edits their own ticket while it is still open.</summary>
    Task<TicketResponse> UpdateOwnAsync(long userId, long id, RaiseTicketRequest request,
                                        CancellationToken ct = default);

    /// <summary>
    /// Moves a ticket along its lifecycle. Forward only, one step at a time,
    /// except that IN_PROGRESS may skip straight to RESOLVED.
    /// </summary>
    Task<TicketRecord> ChangeStatusAsync(long actorId, long id, string? status, long? assignTo,
                                         CancellationToken ct = default);

    Task<TicketResponse> ChangeStatusResponseAsync(long actorId, long id, string? status,
                                                   long? assignTo, CancellationToken ct = default);

    Task<TicketCommentRecord> CommentAsync(long authorId, long id, string comment,
                                           CancellationToken ct = default);

    Task<CommentResponse> AddCommentAsync(long authorId, long id, string comment,
                                          string? attachmentPath, CancellationToken ct = default);

    /// <summary>Only the requester may rate, and only once it is resolved.</summary>
    Task<TicketRecord> RateAsync(long userId, long id, int rating,
                                 CancellationToken ct = default);

    Task<TicketResponse> RateTicketAsync(long userId, long id, int rating,
                                         CancellationToken ct = default);

    /// <summary>Only the person who raised it may cancel it.</summary>
    Task<TicketRecord> CancelAsync(long userId, long id, CancellationToken ct = default);

    Task CancelOwnAsync(long userId, long id, CancellationToken ct = default);

    Task<IReadOnlyList<AgentView>> GetAgentsAsync(long requesterId, CancellationToken ct = default);
}

/// <summary>What somebody is asking for help with.</summary>
public sealed record RaiseTicketRequest
{
    public required string Title { get; init; }
    public string? Description { get; init; }
    public string? Type { get; init; }
    public string? Category { get; init; }

    /// <summary>CRITICAL | HIGH | MEDIUM | anything else, which gets 48 hours.</summary>
    public string? Priority { get; init; }

    public string? Attachments { get; init; }

    public long? AssignedTo { get; init; }
}

/// <summary>Recipients available to address support requests to.</summary>
public sealed record AgentView(
    long Id,
    string Name,
    string? Code,
    string? Designation
);

/// <summary>Detailed ticket response matching Spring Boot TicketResponse and React Ticket.</summary>
public sealed record TicketResponse(
    long Id,
    string? TicketCode,
    long RaisedBy,
    string? RaisedByName,
    string? RaisedByCode,
    string? Title,
    string? Description,
    string? Attachments,
    string? Type,
    string? Category,
    string? Priority,
    string? Status,
    long? AssignedTo,
    string? AssignedToName,
    DateTime? SlaDueAt,
    int? Rating,
    DateTime? ResolvedAt,
    DateTime? CreatedAt,
    IReadOnlyList<CommentResponse>? Comments
);

/// <summary>Comment row matching Spring Boot CommentResponse.</summary>
public sealed record CommentResponse(
    long Id,
    long TicketId,
    long AuthorId,
    string? AuthorName,
    string? Comment,
    string? AttachmentPath,
    DateTime? CreatedAt
);

/// <summary>A row of <c>tickets</c>.</summary>
public sealed class TicketRecord
{
    public long Id { get; set; }
    public string? TicketCode { get; set; }
    public long RaisedBy { get; set; }
    public string? Title { get; set; }
    public string? Description { get; set; }
    public string? Attachments { get; set; }
    public string? Type { get; set; }
    public string? Category { get; set; }
    public string? Priority { get; set; }
    public string? Status { get; set; }
    public long? AssignedTo { get; set; }
    public DateTime? SlaDueAt { get; set; }
    public int? Rating { get; set; }
    public DateTime? ResolvedAt { get; set; }
    public DateTime? CreatedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }
    public long? CompanyId { get; set; }

    /// <summary>Denormalised for the list views.</summary>
    public string? RaisedByName { get; set; }
    public string? RaisedByCode { get; set; }
    public string? AssignedToName { get; set; }
}

/// <summary>A row of <c>ticket_comments</c>.</summary>
public sealed class TicketCommentRecord
{
    public long Id { get; set; }
    public long TicketId { get; set; }
    public long AuthorId { get; set; }
    public string? Comment { get; set; }
    public string? AttachmentPath { get; set; }
    public DateTime? CreatedAt { get; set; }
    public string? AuthorName { get; set; }
}

/// <summary>A ticket and its conversation.</summary>
public sealed record TicketDetail(TicketRecord Ticket, IReadOnlyList<TicketCommentRecord> Comments);

/// <summary>Data access for tickets.</summary>
public interface IHelpdeskDal
{
    Task<long> CountTicketsAsync(CancellationToken ct = default);
    Task<long> InsertAsync(TicketRecord ticket, CancellationToken ct = default);
    Task UpdateAsync(TicketRecord ticket, CancellationToken ct = default);
    Task<TicketRecord?> FindAsync(long id, CancellationToken ct = default);
    Task<IReadOnlyList<TicketRecord>> FindForUserAsync(long userId, CancellationToken ct = default);
    Task<IReadOnlyList<TicketRecord>> FindAllAsync(CancellationToken ct = default);
    Task<IReadOnlyList<TicketRecord>> FindAssignedAsync(long agentId, CancellationToken ct = default);
    Task<IReadOnlyList<TicketCommentRecord>> FindCommentsAsync(long ticketId,
                                                               CancellationToken ct = default);
    Task<long> InsertCommentAsync(TicketCommentRecord comment, CancellationToken ct = default);

    Task<(IReadOnlyList<TicketRecord> Items, long Total)> FindMyTicketsPagedAsync(
        long userId, int offset, int limit, CancellationToken ct = default);

    Task<(IReadOnlyList<TicketRecord> Items, long Total)> FindAssignedPagedAsync(
        long agentId, string? status, int offset, int limit, CancellationToken ct = default);

    Task<(IReadOnlyList<TicketRecord> Items, long Total)> FindAllDeskPagedAsync(
        long viewerId, bool seesEverything, IReadOnlyList<long> deskUserIds, string? status,
        int offset, int limit, CancellationToken ct = default);

    Task<IReadOnlyList<AgentView>> FindAgentsAsync(long requesterId, CancellationToken ct = default);

    Task<string?> GetUserIndustryAsync(long userId, CancellationToken ct = default);

    Task<IReadOnlyList<long>> GetHrDeskUserIdsAsync(CancellationToken ct = default);
}
