using Pixous.HrPortal.Domain.Common;
using Pixous.HrPortal.Domain.Modules.Notification;
using Pixous.HrPortal.Domain.Modules.RequestThread;
using Pixous.HrPortal.Domain.Security;

namespace Pixous.HrPortal.Infrastructure.Modules.RequestThread;

/// <summary>
/// Ported from RequestThreadService.
///
/// The access rule is the module. It lives in <see cref="RequireAccessAsync"/>
/// and every entry point calls it, so no route can forget it -- which is why
/// the controller carries no authorisation attributes of its own.
/// </summary>
public sealed class RequestThreadBal : IRequestThreadBal
{
    private readonly IRequestThreadDal _dal;
    private readonly ICurrentUser _currentUser;
    private readonly INotificationBal _notifications;
    private readonly IStorageService _storage;

    public RequestThreadBal(IRequestThreadDal dal, ICurrentUser currentUser,
                            INotificationBal notifications, IStorageService storage)
    {
        _dal = dal;
        _currentUser = currentUser;
        _notifications = notifications;
        _storage = storage;
    }


    // ---- reads -------------------------------------------------------------

    public async Task<IReadOnlyList<AttachmentView>> ListAttachmentsAsync(
        string? type, long id, CancellationToken ct = default)
    {
        string kind = Normalise(type);
        await RequireAccessAsync(kind, id, ct);

        IReadOnlyList<RequestAttachmentRow> rows = await _dal.FindAttachmentsAsync(kind, id, ct);

        IReadOnlyDictionary<long, (string? Name, string? Code)> people =
            await LabelsAsync(rows.Select(r => r.UploadedBy), ct);

        return rows.Select(a => new AttachmentView(
            a.Id,
            a.FileName,
            a.ContentType,
            a.FileSize,
            AttachmentRules.IsImage(a.ContentType),
            a.FilePath,
            // "User" rather than null when the uploader has gone: the Java's
            // fallback, and a name column that reads "User" is better than one
            // that reads nothing.
            Name(people, a.UploadedBy) ?? "User",
            a.UploadedAt)).ToArray();
    }

    public async Task<AttachmentView> AttachAsync(
        string? type, long id, Stream stream, string? originalFileName,
        string? contentType, long sizeBytes, long userId,
        CancellationToken ct = default)
    {
        string kind = Normalise(type);
        await RequireAccessAsync(kind, id, ct);

        if (stream is null || sizeBytes <= 0)
        {
            throw ApiException.Business("There is nothing to upload — the file came through empty.");
        }

        if (sizeBytes > AttachmentRules.MaxFileBytes)
        {
            throw ApiException.Business("That file is larger than 10 MB. A photograph taken on a phone can usually be sent at a smaller size.");
        }

        if (!AttachmentRules.IsAllowed(contentType))
        {
            throw ApiException.Business("Only photographs, PDFs and Word documents can be attached.");
        }

        long count = await _dal.CountAttachmentsAsync(kind, id, ct);
        if (count >= AttachmentRules.MaxFilesPerRequest)
        {
            throw ApiException.Business($"A request can carry {AttachmentRules.MaxFilesPerRequest} files at most.");
        }

        string stored = await _storage.StoreAsync(stream, originalFileName, contentType, sizeBytes, "request-attachments", ct);

        var row = new RequestAttachmentRow
        {
            RequestType = kind,
            RequestId = id,
            FilePath = stored,
            FileName = AttachmentRules.SafeName(originalFileName),
            ContentType = contentType?.ToLowerInvariant(),
            FileSize = sizeBytes,
            UploadedBy = userId,
            UploadedAt = DateTime.Now
        };

        row.Id = await _dal.InsertAttachmentAsync(row, ct);

        IReadOnlyDictionary<long, (string? Name, string? Code)> people =
            await LabelsAsync([userId], ct);

        return new AttachmentView(
            row.Id,
            row.FileName,
            row.ContentType,
            row.FileSize,
            AttachmentRules.IsImage(row.ContentType),
            row.FilePath,
            Name(people, userId) ?? "User",
            row.UploadedAt);
    }

    public async Task<IReadOnlyList<CommentView>> ListCommentsAsync(

        string? type, long id, CancellationToken ct = default)
    {
        string kind = Normalise(type);
        await RequireAccessAsync(kind, id, ct);

        IReadOnlyList<RequestCommentRow> rows = await _dal.FindCommentsAsync(kind, id, ct);

        IReadOnlyDictionary<long, (string? Name, string? Code)> people =
            await LabelsAsync(rows.Select(r => r.AuthorId), ct);

        return rows.Select(c => new CommentView(
            c.Id, c.AuthorId,
            Name(people, c.AuthorId) ?? "User",
            Code(people, c.AuthorId),
            c.Message, c.AttachmentPath, c.CreatedAt)).ToArray();
    }

    public async Task<IReadOnlyList<InboxComment>> InboxAsync(long? userId,
                                                              CancellationToken ct = default)
    {
        // Signed out is an empty inbox, not an error -- the Java returns
        // List.of() rather than throwing.
        if (userId is null)
        {
            return [];
        }

        var inbox = new List<InboxComment>();

        foreach (string kind in new[] { RequestKinds.Leave, RequestKinds.Permission })
        {
            IReadOnlyList<RequestCommentRow> comments =
                await _dal.FindInboxCommentsAsync(kind, userId.Value, ct);

            foreach (RequestCommentRow c in comments)
            {
                // The request may have gone since the comment was written; the
                // Java's ifPresent drops the comment rather than failing the
                // whole inbox, and so does this.
                ThreadRequestRow? r = await _dal.FindRequestAsync(kind, c.RequestId, ct);

                if (r is null)
                {
                    continue;
                }

                IReadOnlyDictionary<long, (string? Name, string? Code)> people =
                    await LabelsAsync([c.AuthorId, r.UserId], ct);

                inbox.Add(new InboxComment(
                    c.Id, kind, r.Id, Reference(kind, r.Id),
                    Name(people, c.AuthorId), Code(people, c.AuthorId),
                    c.Message, c.AttachmentPath,
                    Name(people, r.UserId), r.Status,
                    r.FromDate, r.ToDate, c.CreatedAt));
            }
        }

        // Newest first ACROSS both kinds. Each query is already sorted, but two
        // sorted lists concatenated are not one sorted list.
        return inbox.OrderByDescending(c => c.CreatedAt ?? DateTime.MinValue).ToArray();
    }

    public async Task<RequestSummary> SummaryAsync(string? type, long id,
                                                   CancellationToken ct = default)
    {
        string kind = Normalise(type);
        await RequireAccessAsync(kind, id, ct);

        ThreadRequestRow r = await _dal.FindRequestAsync(kind, id, ct)
            ?? throw NotFound(kind);

        IReadOnlyDictionary<long, (string? Name, string? Code)> people =
            await LabelsAsync([r.UserId, r.RequestedTo], ct);

        string? detail;

        if (kind == RequestKinds.Leave)
        {
            detail = r.LeaveTypeId is null
                ? null
                : await _dal.FindLeaveTypeNameAsync(r.LeaveTypeId.Value, ct);
        }
        else
        {
            // A permission is hours within one day, so the WINDOW is the detail
            // that matters rather than a type. Built exactly as the Java does,
            // including the en dash and the empty-string handling.
            detail = (r.FromTime ?? "") + (r.ToTime is null ? "" : " – " + r.ToTime);
        }

        return new RequestSummary(
            kind, r.Id, Reference(kind, r.Id),
            Name(people, r.UserId), Code(people, r.UserId),
            Name(people, r.RequestedTo), r.Status,
            detail, r.FromDate, r.ToDate, r.Reason, r.CreatedAt);
    }

    // ---- writes ------------------------------------------------------------

    public async Task<CommentView> CommentAsync(string? type, long id, CommentRequest request,
                                                CancellationToken ct = default)
    {
        string kind = Normalise(type);
        RequestOwner owner = await RequireAccessAsync(kind, id, ct);

        long? me = _currentUser.UserId;

        var row = new RequestCommentRow
        {
            RequestType = kind,
            RequestId = id,
            AuthorId = me,
            Message = request.Message.Trim(),
            AttachmentPath = string.IsNullOrWhiteSpace(request.AttachmentPath)
                ? null
                : request.AttachmentPath.Trim()
        };

        await _dal.InsertCommentAsync(row, ct);

        await NotifyOtherPartyAsync(kind, id, owner, row, ct);

        IReadOnlyDictionary<long, (string? Name, string? Code)> people =
            await LabelsAsync([me], ct);

        return new CommentView(row.Id, me, Name(people, me) ?? "User", Code(people, me),
                               row.Message, row.AttachmentPath, row.CreatedAt);
    }

    public async Task DeleteAttachmentAsync(long attachmentId, CancellationToken ct = default)
    {
        RequestAttachmentRow a = await _dal.FindAttachmentAsync(attachmentId, ct)
            ?? throw ApiException.NotFound("Attachment");

        // Only the person who uploaded it may remove it.
        //
        // An approver deleting the evidence they were sent is not something
        // this should allow, even by accident -- and an administrator who
        // genuinely needs a file gone can remove it at the storage layer, where
        // the act is deliberate rather than a button beside a thumbnail.
        if (a.UploadedBy != _currentUser.UserId)
        {
            throw ApiException.Business("You can only remove a file you uploaded.");
        }

        await _dal.DeleteAttachmentAsync(attachmentId, ct);
    }

    // ---- internals ---------------------------------------------------------

    private static string Normalise(string? type)
    {
        if (!RequestKinds.TryNormalise(type, out string kind))
        {
            throw ApiException.Business($"Unknown request type: {type}");
        }

        return kind;
    }

    /// <summary>
    /// The access rule, in one place.
    ///
    /// Three people have business with a request: whoever raised it, whoever it
    /// was addressed to, and whoever oversees the process. Everybody else has
    /// none, and a leave request often says why somebody is unwell.
    ///
    /// Oversight is USER_MANAGE and deliberately NOT LEAVE_APPROVE: a Team
    /// Leader holds that and may approve their own team, but it does not follow
    /// that they may read the medical certificate of somebody in another team.
    /// </summary>
    private async Task<RequestOwner> RequireAccessAsync(string kind, long id, CancellationToken ct)
    {
        ThreadRequestRow r = await _dal.FindRequestAsync(kind, id, ct) ?? throw NotFound(kind);

        var owner = new RequestOwner(r.UserId, r.RequestedTo);
        long? me = _currentUser.UserId;

        bool mine = me is not null && me == owner.RaisedBy;
        bool addressedToMe = me is not null && me == owner.RequestedTo;
        bool oversees = _currentUser.HasPermission("USER_MANAGE");

        if (!mine && !addressedToMe && !oversees)
        {
            throw ApiException.Business("This request is not yours to read.");
        }

        return owner;
    }

    private static ApiException NotFound(string kind) =>
        ApiException.NotFound(kind == RequestKinds.Leave ? "Leave request" : "Permission request");

    /// <summary>LV-12 or PR-7, as the Java builds them.</summary>
    private static string Reference(string kind, long id) =>
        (kind == RequestKinds.Leave ? "LV-" : "PR-") + id;

    private Task<IReadOnlyDictionary<long, (string? Name, string? Code)>> LabelsAsync(
        IEnumerable<long?> userIds, CancellationToken ct) =>
        _dal.FindUserLabelsAsync(
            userIds.Where(i => i is not null).Select(i => i!.Value).Distinct().ToArray(), ct);

    private static string? Name(IReadOnlyDictionary<long, (string? Name, string? Code)> people,
                                long? userId) =>
        userId is not null && people.TryGetValue(userId.Value, out var p) ? p.Name : null;

    private static string? Code(IReadOnlyDictionary<long, (string? Name, string? Code)> people,
                                long? userId) =>
        userId is not null && people.TryGetValue(userId.Value, out var p) ? p.Code : null;

    /// <summary>
    /// Tells the other side that something was said.
    ///
    /// The applicant hears from the approver and the approver hears from the
    /// applicant; nobody is told about their own message. A failure to notify
    /// must NOT lose the comment, so this never throws -- the message is
    /// already saved and is the thing that mattered.
    /// </summary>
    private async Task NotifyOtherPartyAsync(string kind, long id, RequestOwner owner,
                                             RequestCommentRow c, CancellationToken ct)
    {
        try
        {
            long? author = c.AuthorId;
            long? other = author == owner.RaisedBy ? owner.RequestedTo : owner.RaisedBy;

            if (other is null || other == author)
            {
                return;
            }

            IReadOnlyDictionary<long, (string? Name, string? Code)> people =
                await LabelsAsync([author], ct);

            string who = Name(people, author) ?? "Someone";
            string label = kind == RequestKinds.Leave ? "leave" : "permission";

            // The COMMENT, not the screen the approver happens to use.
            //
            // The Java carries a long note here: this used to point at
            // /leave/approvals for every leave comment, which is an
            // approver-only page -- so when the approver commented, the
            // applicant was sent to a screen they are not allowed to open and
            // got "Restricted" instead of the message somebody had just written
            // to them. Half the notifications were a dead end by construction.
            string link = $"/requests/{kind.ToLowerInvariant()}/{id}/thread";

            await _notifications.CreateAndPushAsync(
                other.Value,
                $"New comment on a {label} request",
                $"{who}: {AttachmentRules.Preview(c.Message ?? "")}",
                "LEAVE", link, ct);
        }
        catch
        {
            // See the note above: the comment is saved either way.
        }
    }
}
