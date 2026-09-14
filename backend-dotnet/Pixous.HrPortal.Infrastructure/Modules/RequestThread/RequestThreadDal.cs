using Dapper;
using Pixous.HrPortal.Domain.Modules.RequestThread;
using Pixous.HrPortal.Infrastructure.Persistence;

namespace Pixous.HrPortal.Infrastructure.Modules.RequestThread;

/// <summary>
/// Dapper access to <c>request_comments</c>, <c>request_attachments</c> and the
/// two request tables they hang off.
/// </summary>
public sealed class RequestThreadDal : DalBase, IRequestThreadDal
{
    public RequestThreadDal(IDbConnectionFactory connectionFactory) : base(connectionFactory) { }

    private const string CommentColumns = """
        id              AS Id,
        request_type    AS RequestType,
        request_id      AS RequestId,
        author_id       AS AuthorId,
        message         AS Message,
        attachment_path AS AttachmentPath,
        created_at      AS CreatedAt
        """;

    private const string AttachmentColumns = """
        id           AS Id,
        request_type AS RequestType,
        request_id   AS RequestId,
        file_path    AS FilePath,
        file_name    AS FileName,
        content_type AS ContentType,
        file_size    AS FileSize,
        uploaded_by  AS UploadedBy,
        uploaded_at  AS UploadedAt
        """;

    /// <summary>
    /// The request a thread hangs off.
    ///
    /// The two tables do not share a shape: leave has from_date/to_date and a
    /// leave type, a permission has one request_date and a pair of times. Both
    /// are selected into the same row here, with the absent columns read as
    /// NULL, so the caller has one type to reason about.
    /// </summary>
    public Task<ThreadRequestRow?> FindRequestAsync(string kind, long id,
                                                    CancellationToken ct = default) =>
        kind == RequestKinds.Leave
            ? QueryAsync(conn => conn.QueryFirstOrDefaultAsync<ThreadRequestRow>(
                new CommandDefinition("""
                    SELECT id            AS Id,
                           user_id       AS UserId,
                           requested_to  AS RequestedTo,
                           status        AS Status,
                           reason        AS Reason,
                           from_date     AS FromDate,
                           to_date       AS ToDate,
                           leave_type_id AS LeaveTypeId,
                           NULL          AS FromTime,
                           NULL          AS ToTime,
                           created_at    AS CreatedAt
                    FROM leave_requests WHERE id = @id
                    """, new { id }, cancellationToken: ct)), ct)
            : QueryAsync(conn => conn.QueryFirstOrDefaultAsync<ThreadRequestRow>(
                new CommandDefinition("""
                    SELECT id           AS Id,
                           user_id      AS UserId,
                           requested_to AS RequestedTo,
                           status       AS Status,
                           reason       AS Reason,
                           request_date AS FromDate,
                           request_date AS ToDate,
                           NULL         AS LeaveTypeId,
                           from_time    AS FromTime,
                           to_time      AS ToTime,
                           created_at   AS CreatedAt
                    FROM permission_requests WHERE id = @id
                    """, new { id }, cancellationToken: ct)), ct);

    public async Task<IReadOnlyList<RequestAttachmentRow>> FindAttachmentsAsync(
        string kind, long requestId, CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<RequestAttachmentRow>(
            new CommandDefinition($"""
                SELECT {AttachmentColumns} FROM request_attachments
                WHERE request_type = @kind AND request_id = @requestId
                ORDER BY uploaded_at ASC, id ASC
                """, new { kind, requestId }, cancellationToken: ct)), ct)).AsList();

    public Task<RequestAttachmentRow?> FindAttachmentAsync(long attachmentId,
                                                           CancellationToken ct = default) =>
        QueryAsync(conn => conn.QueryFirstOrDefaultAsync<RequestAttachmentRow>(
            new CommandDefinition($"SELECT {AttachmentColumns} FROM request_attachments WHERE id = @attachmentId",
                new { attachmentId }, cancellationToken: ct)), ct);

    public Task<long> CountAttachmentsAsync(string kind, long requestId,
                                            CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteScalarAsync<long>(
            new CommandDefinition("""
                SELECT COUNT(*) FROM request_attachments
                WHERE request_type = @kind AND request_id = @requestId
                """, new { kind, requestId }, cancellationToken: ct)), ct);

    public Task<long> InsertAttachmentAsync(RequestAttachmentRow row,
                                            CancellationToken ct = default) =>
        QueryAsync(async conn =>
        {
            row.UploadedAt ??= DateTime.Now;
            row.Id = await conn.ExecuteScalarAsync<long>(new CommandDefinition("""
                INSERT INTO request_attachments
                    (request_type, request_id, file_path, file_name, content_type,
                     file_size, uploaded_by, uploaded_at)
                VALUES
                    (@RequestType, @RequestId, @FilePath, @FileName, @ContentType,
                     @FileSize, @UploadedBy, @UploadedAt);
                SELECT LAST_INSERT_ID();
                """, row, cancellationToken: ct));
            return row.Id;
        }, ct);

    public Task DeleteAttachmentAsync(long attachmentId, CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteAsync(
            new CommandDefinition("DELETE FROM request_attachments WHERE id = @attachmentId",
                new { attachmentId }, cancellationToken: ct)), ct);

    /// <summary>The thread, in the order it was written.</summary>
    public async Task<IReadOnlyList<RequestCommentRow>> FindCommentsAsync(
        string kind, long requestId, CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<RequestCommentRow>(
            new CommandDefinition($"""
                SELECT {CommentColumns} FROM request_comments
                WHERE request_type = @kind AND request_id = @requestId
                ORDER BY created_at ASC, id ASC
                """, new { kind, requestId }, cancellationToken: ct)), ct)).AsList();

    public Task<long> InsertCommentAsync(RequestCommentRow row, CancellationToken ct = default) =>
        QueryAsync(async conn =>
        {
            row.CreatedAt ??= DateTime.Now;
            row.Id = await conn.ExecuteScalarAsync<long>(new CommandDefinition("""
                INSERT INTO request_comments
                    (request_type, request_id, author_id, message, attachment_path, created_at)
                VALUES
                    (@RequestType, @RequestId, @AuthorId, @Message, @AttachmentPath, @CreatedAt);
                SELECT LAST_INSERT_ID();
                """, row, cancellationToken: ct));
            return row.Id;
        }, ct);

    /// <summary>
    /// The inbox query, transcribed from the Java's @Query.
    ///
    /// `author_id <> @userId` is the part worth naming: a list of things said
    /// to you should not be half your own voice. The subquery is the access
    /// check as well as the filter -- it only returns comments on requests
    /// where this person is one of the two sides, so no separate check is
    /// needed afterwards.
    /// </summary>
    public async Task<IReadOnlyList<RequestCommentRow>> FindInboxCommentsAsync(
        string kind, long userId, CancellationToken ct = default)
    {
        string table = kind == RequestKinds.Leave ? "leave_requests" : "permission_requests";

        return (await QueryAsync(conn => conn.QueryAsync<RequestCommentRow>(
            new CommandDefinition($"""
                SELECT {CommentColumns} FROM request_comments c
                WHERE c.request_type = @kind
                  AND c.author_id <> @userId
                  AND c.request_id IN (
                      SELECT r.id FROM {table} r
                      WHERE r.user_id = @userId OR r.requested_to = @userId)
                ORDER BY c.created_at DESC
                """, new { kind, userId }, cancellationToken: ct)), ct)).AsList();
    }

    /// <summary>
    /// Names and codes in ONE query. The Java resolves these one user at a time
    /// through findById inside a loop; a thread of twenty comments is twenty
    /// round trips for what is one statement.
    /// </summary>
    public async Task<IReadOnlyDictionary<long, (string? Name, string? Code)>>
        FindUserLabelsAsync(IReadOnlyCollection<long> userIds, CancellationToken ct = default)
    {
        if (userIds.Count == 0)
        {
            return new Dictionary<long, (string?, string?)>();
        }

        var rows = await QueryAsync(conn => conn.QueryAsync<(long Id, string? Name, string? Code)>(
            new CommandDefinition(
                "SELECT id, name, employee_code FROM users WHERE id IN @userIds",
                new { userIds }, cancellationToken: ct)), ct);

        var map = new Dictionary<long, (string? Name, string? Code)>();
        foreach ((long id, string? name, string? code) in rows)
        {
            map[id] = (name, code);
        }

        return map;
    }

    public Task<string?> FindLeaveTypeNameAsync(long leaveTypeId, CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteScalarAsync<string?>(
            new CommandDefinition("SELECT name FROM leave_types WHERE id = @leaveTypeId",
                new { leaveTypeId }, cancellationToken: ct)), ct);
}
