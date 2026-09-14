using System.ComponentModel.DataAnnotations;

namespace Pixous.HrPortal.Domain.Modules.RequestThread;

/// <summary>
/// Files and conversation on a leave or permission request. Ported from
/// com.pixous.hrportal.modules.requestthread.RequestThreadService.
///
/// One set of routes serves both kinds, because the records differ only in what
/// they hang off and two sets would mean two of every future change.
///
/// <para><b>Who may look.</b> Three people have business with a request:
/// whoever raised it, whoever it was addressed to, and whoever oversees the
/// process. Everybody else has none — a leave request often says why somebody
/// is unwell — so the check is made in ONE place and every entry point goes
/// through it rather than each deciding for itself.</para>
///
/// <para>Deliberately not "anyone with LEAVE_APPROVE". A Team Leader holds that
/// and may approve their own team; it does not follow that they may read the
/// medical certificate of somebody in another team.</para>
/// </summary>
public interface IRequestThreadBal
{
    /// <summary>Files attached to this request.</summary>
    Task<IReadOnlyList<AttachmentView>> ListAttachmentsAsync(string? type, long id,
                                                             CancellationToken ct = default);

    /// <summary>Attaches a file to this request.</summary>
    Task<AttachmentView> AttachAsync(string? type, long id, Stream stream, string? originalFileName,
                                    string? contentType, long sizeBytes, long userId,
                                    CancellationToken ct = default);


    /// <summary>The conversation about this request, oldest first.</summary>
    Task<IReadOnlyList<CommentView>> ListCommentsAsync(string? type, long id,
                                                       CancellationToken ct = default);

    /// <summary>
    /// Every comment written to this person, across every request.
    ///
    /// The notification tells them something was said; this is where they read
    /// it. Their own comments are excluded — a list of things said to you
    /// should not be half your own voice.
    /// </summary>
    Task<IReadOnlyList<InboxComment>> InboxAsync(long? userId, CancellationToken ct = default);

    /// <summary>
    /// What this request is, for somebody arriving from a notification.
    /// Behind the same access check as the thread, so it cannot become a way to
    /// read a request whose conversation you could not open.
    /// </summary>
    Task<RequestSummary> SummaryAsync(string? type, long id, CancellationToken ct = default);

    /// <summary>Says something about this request.</summary>
    Task<CommentView> CommentAsync(string? type, long id, CommentRequest request,
                                   CancellationToken ct = default);

    /// <summary>
    /// Removes a file. Only the person who uploaded it may do so — an approver
    /// deleting the evidence they were sent is not something this allows, even
    /// by accident.
    /// </summary>
    Task DeleteAttachmentAsync(long attachmentId, CancellationToken ct = default);
}

/// <summary>The two kinds of request a thread can hang off.</summary>
public static class RequestKinds
{
    public const string Leave = "LEAVE";
    public const string Permission = "PERMISSION";

    /// <summary>
    /// Upper-cases and validates. Anything else is refused rather than quietly
    /// treated as one of the two — a typo must not read another table.
    /// </summary>
    public static bool TryNormalise(string? type, out string kind)
    {
        kind = (type ?? "").Trim().ToUpperInvariant();
        return kind is Leave or Permission;
    }
}

/// <summary>
/// What may be attached.
///
/// An ALLOW-list rather than a block-list: the question is what a medical
/// certificate or a photograph of a document can be, and the answer is short.
/// Anything else — an archive, a script, an executable — has no business on a
/// leave request whatever it claims to be.
/// </summary>
public static class AttachmentRules
{
    /// <summary>A request may not become an unbounded file store.</summary>
    public const int MaxFilesPerRequest = 10;

    public const long MaxFileBytes = 10L * 1024 * 1024;

    public static readonly IReadOnlySet<string> AllowedTypes =
        new HashSet<string>(StringComparer.Ordinal)
        {
            "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif",
            "application/pdf",
            "application/msword",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        };

    public static bool IsAllowed(string? contentType) =>
        contentType is not null && AllowedTypes.Contains(contentType.ToLowerInvariant());

    /// <summary>
    /// Whether to render this inline. An image goes in an img tag; a PDF gets a
    /// download rather than being squeezed into one.
    /// </summary>
    public static bool IsImage(string? contentType) =>
        contentType is not null
        && contentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase);

    /// <summary>
    /// The uploader's filename, for display only.
    ///
    /// The last segment only: a browser may send a path, and the name is never
    /// used to build one — the stored path is whatever storage gave back.
    /// </summary>
    public static string SafeName(string? original)
    {
        if (string.IsNullOrWhiteSpace(original))
        {
            return "attachment";
        }

        string based = original.Replace('\\', '/');
        based = based[(based.LastIndexOf('/') + 1)..].Trim();

        if (based.Length == 0)
        {
            return "attachment";
        }

        return based.Length <= 255 ? based : based[^255..];
    }

    /// <summary>
    /// A one-line preview of a comment, for the notification body.
    /// Whitespace collapsed, then cut with an ellipsis at 90 characters.
    /// </summary>
    public static string Preview(string message)
    {
        string one = System.Text.RegularExpressions.Regex.Replace(message, @"\s+", " ").Trim();
        return one.Length <= 90 ? one : one[..89] + "…";
    }
}

/// <summary>A file, as the client sees it.</summary>
public sealed record AttachmentView(
    long Id,
    string? FileName,
    string? ContentType,
    long? FileSize,

    /// <summary>Serialised as "image" — the Java record component is named that.</summary>
    bool Image,

    /// <summary>The stored path, which the client fetches through /api/files.</summary>
    string? Url,

    string? UploadedByName,
    DateTime? UploadedAt);

/// <summary>One message in the thread.</summary>
public sealed record CommentView(
    long Id,
    long? AuthorId,
    string? AuthorName,
    string? AuthorCode,
    string? Message,
    string? AttachmentUrl,
    DateTime? CreatedAt);

/// <summary>
/// What the request is, for a page opened straight from a notification.
///
/// A notification that lands somebody on a bare conversation with no idea which
/// request it belongs to is only half a link.
/// </summary>
public sealed record RequestSummary(
    string Type,
    long Id,
    string Reference,
    string? EmployeeName,
    string? EmployeeCode,
    string? RequestedToName,
    string? Status,

    /// <summary>
    /// The leave type's name, or — for a permission, which is hours within one
    /// day — the time window, because that is the detail that matters there.
    /// </summary>
    string? Detail,

    DateOnly? FromDate,
    DateOnly? ToDate,
    string? Reason,
    DateTime? CreatedAt);

/// <summary>One comment with enough around it to read on its own, for the inbox.</summary>
public sealed record InboxComment(
    long Id,
    string RequestType,
    long RequestId,
    string Reference,
    string? AuthorName,
    string? AuthorCode,
    string? Message,
    string? AttachmentUrl,

    /// <summary>Whose request it is, which is not always the author.</summary>
    string? EmployeeName,

    string? Status,
    DateOnly? FromDate,
    DateOnly? ToDate,
    DateTime? CreatedAt);

/// <summary>Posting a message.</summary>
public sealed record CommentRequest
{
    [Required(AllowEmptyStrings = false, ErrorMessage = "Write something before sending")]
    [StringLength(4000, ErrorMessage = "That message is too long")]
    public required string Message { get; init; }

    /// <summary>An already-uploaded path, from the upload endpoint. Optional.</summary>
    public string? AttachmentPath { get; init; }
}

/// <summary>Who a request belongs to and who it was sent to.</summary>
public readonly record struct RequestOwner(long? RaisedBy, long? RequestedTo);

/// <summary>A row of <c>request_comments</c>.</summary>
public sealed class RequestCommentRow
{
    public long Id { get; set; }
    public string RequestType { get; set; } = "";
    public long RequestId { get; set; }
    public long? AuthorId { get; set; }
    public string? Message { get; set; }
    public string? AttachmentPath { get; set; }
    public DateTime? CreatedAt { get; set; }
}

/// <summary>A row of <c>request_attachments</c>.</summary>
public sealed class RequestAttachmentRow
{
    public long Id { get; set; }
    public string RequestType { get; set; } = "";
    public long RequestId { get; set; }
    public string? FilePath { get; set; }
    public string? FileName { get; set; }
    public string? ContentType { get; set; }
    public long? FileSize { get; set; }
    public long? UploadedBy { get; set; }
    public DateTime? UploadedAt { get; set; }
}

/// <summary>The leave or permission request a thread hangs off.</summary>
public sealed class ThreadRequestRow
{
    public long Id { get; set; }
    public long? UserId { get; set; }
    public long? RequestedTo { get; set; }
    public string? Status { get; set; }
    public string? Reason { get; set; }
    public DateOnly? FromDate { get; set; }
    public DateOnly? ToDate { get; set; }
    public long? LeaveTypeId { get; set; }

    /// <summary>Permission only: the hours within the day.</summary>
    public string? FromTime { get; set; }
    public string? ToTime { get; set; }

    public DateTime? CreatedAt { get; set; }
}

/// <summary>Data access for request threads.</summary>
public interface IRequestThreadDal
{
    Task<ThreadRequestRow?> FindRequestAsync(string kind, long id, CancellationToken ct = default);

    Task<IReadOnlyList<RequestAttachmentRow>> FindAttachmentsAsync(string kind, long requestId,
                                                                    CancellationToken ct = default);

    Task<RequestAttachmentRow?> FindAttachmentAsync(long attachmentId,
                                                     CancellationToken ct = default);

    Task<long> CountAttachmentsAsync(string kind, long requestId, CancellationToken ct = default);

    Task<long> InsertAttachmentAsync(RequestAttachmentRow row, CancellationToken ct = default);

    Task DeleteAttachmentAsync(long attachmentId, CancellationToken ct = default);

    Task<IReadOnlyList<RequestCommentRow>> FindCommentsAsync(string kind, long requestId,
                                                              CancellationToken ct = default);

    Task<long> InsertCommentAsync(RequestCommentRow row, CancellationToken ct = default);

    /// <summary>
    /// Comments on requests of this kind where the reader is one of the two
    /// sides, with their OWN comments excluded. Newest first.
    ///
    /// Leave and permission are two tables with no common parent, so this is
    /// asked once per kind rather than as one clever union across unrelated
    /// entities.
    /// </summary>
    Task<IReadOnlyList<RequestCommentRow>> FindInboxCommentsAsync(string kind, long userId,
                                                                   CancellationToken ct = default);

    /// <summary>Names and codes for a set of users, resolved in one query.</summary>
    Task<IReadOnlyDictionary<long, (string? Name, string? Code)>> FindUserLabelsAsync(
        IReadOnlyCollection<long> userIds, CancellationToken ct = default);

    Task<string?> FindLeaveTypeNameAsync(long leaveTypeId, CancellationToken ct = default);
}
