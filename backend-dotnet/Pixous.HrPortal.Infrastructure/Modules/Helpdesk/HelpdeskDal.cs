using Dapper;
using Pixous.HrPortal.Domain.Modules.Helpdesk;
using Pixous.HrPortal.Infrastructure.Persistence;

namespace Pixous.HrPortal.Infrastructure.Modules.Helpdesk;

/// <summary>Dapper access to <c>tickets</c> and <c>ticket_comments</c>.</summary>
public sealed class HelpdeskDal : DalBase, IHelpdeskDal
{
    public HelpdeskDal(IDbConnectionFactory connectionFactory) : base(connectionFactory) { }

    private const string Columns = """
        t.id          AS Id,
        t.ticket_code AS TicketCode,
        t.raised_by   AS RaisedBy,
        t.title       AS Title,
        t.description AS Description,
        t.attachments AS Attachments,
        t.type        AS Type,
        t.category    AS Category,
        t.priority    AS Priority,
        t.status      AS Status,
        t.assigned_to AS AssignedTo,
        t.sla_due_at  AS SlaDueAt,
        t.rating      AS Rating,
        t.resolved_at AS ResolvedAt,
        t.created_at  AS CreatedAt,
        t.updated_at  AS UpdatedAt,
        t.company_id  AS CompanyId,
        r.name        AS RaisedByName,
        r.employee_code AS RaisedByCode,
        a.name        AS AssignedToName
        """;

    private const string From = """
        FROM tickets t
        LEFT JOIN users r ON r.id = t.raised_by
        LEFT JOIN users a ON a.id = t.assigned_to
        """;

    public Task<long> CountTicketsAsync(CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteScalarAsync<long>(
            new CommandDefinition("SELECT COUNT(*) FROM tickets", cancellationToken: ct)), ct);

    public Task<long> InsertAsync(TicketRecord t, CancellationToken ct = default) =>
        QueryAsync(async conn =>
        {
            t.CreatedAt ??= DateTime.Now;
            t.Id = await conn.ExecuteScalarAsync<long>(new CommandDefinition("""
                INSERT INTO tickets
                    (ticket_code, raised_by, title, description, attachments, type, category,
                     priority, status, assigned_to, sla_due_at, company_id, created_at, updated_at)
                VALUES
                    (@TicketCode, @RaisedBy, @Title, @Description, @Attachments, @Type, @Category,
                     @Priority, @Status, @AssignedTo, @SlaDueAt, @CompanyId, @CreatedAt, @CreatedAt);
                SELECT LAST_INSERT_ID();
                """, t, cancellationToken: ct));
            return t.Id;
        }, ct);

    public Task UpdateAsync(TicketRecord t, CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteAsync(new CommandDefinition("""
            UPDATE tickets SET
                title = @Title,
                description = @Description,
                attachments = @Attachments,
                type = @Type,
                category = @Category,
                priority = @Priority,
                status = @Status,
                assigned_to = @AssignedTo,
                sla_due_at = @SlaDueAt,
                rating = @Rating,
                resolved_at = @ResolvedAt,
                updated_at = @UpdatedAt
            WHERE id = @Id
            """, t, cancellationToken: ct)), ct);

    public Task<TicketRecord?> FindAsync(long id, CancellationToken ct = default) =>
        QueryAsync(conn => conn.QueryFirstOrDefaultAsync<TicketRecord>(
            new CommandDefinition($"SELECT {Columns} {From} WHERE t.id = @id",
                new { id }, cancellationToken: ct)), ct);

    public async Task<IReadOnlyList<TicketRecord>> FindForUserAsync(
        long userId, CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<TicketRecord>(
            new CommandDefinition(
                $"SELECT {Columns} {From} WHERE t.raised_by = @userId ORDER BY t.id DESC",
                new { userId }, cancellationToken: ct)), ct)).AsList();

    public async Task<IReadOnlyList<TicketRecord>> FindAllAsync(CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<TicketRecord>(
            new CommandDefinition($"SELECT {Columns} {From} ORDER BY t.id DESC",
                cancellationToken: ct)), ct)).AsList();

    public async Task<IReadOnlyList<TicketRecord>> FindAssignedAsync(
        long agentId, CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<TicketRecord>(
            new CommandDefinition(
                $"SELECT {Columns} {From} WHERE t.assigned_to = @agentId ORDER BY t.id DESC",
                new { agentId }, cancellationToken: ct)), ct)).AsList();

    public async Task<IReadOnlyList<TicketCommentRecord>> FindCommentsAsync(
        long ticketId, CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<TicketCommentRecord>(
            new CommandDefinition("""
                SELECT c.id AS Id, c.ticket_id AS TicketId, c.author_id AS AuthorId,
                       c.comment AS Comment, c.attachment_path AS AttachmentPath,
                       c.created_at AS CreatedAt, u.name AS AuthorName
                FROM ticket_comments c
                LEFT JOIN users u ON u.id = c.author_id
                WHERE c.ticket_id = @ticketId
                ORDER BY c.created_at, c.id
                """,
                new { ticketId }, cancellationToken: ct)), ct)).AsList();

    public Task<long> InsertCommentAsync(TicketCommentRecord c, CancellationToken ct = default) =>
        QueryAsync(async conn =>
        {
            c.CreatedAt ??= DateTime.Now;
            c.Id = await conn.ExecuteScalarAsync<long>(new CommandDefinition("""
                INSERT INTO ticket_comments
                    (ticket_id, author_id, comment, attachment_path, created_at)
                VALUES (@TicketId, @AuthorId, @Comment, @AttachmentPath, @CreatedAt);
                SELECT LAST_INSERT_ID();
                """, c, cancellationToken: ct));
            return c.Id;
        }, ct);

    public async Task<(IReadOnlyList<TicketRecord> Items, long Total)> FindMyTicketsPagedAsync(
        long userId, int offset, int limit, CancellationToken ct = default) =>
        await QueryAsync(async conn =>
        {
            long total = await conn.ExecuteScalarAsync<long>(new CommandDefinition(
                "SELECT COUNT(*) FROM tickets WHERE raised_by = @userId",
                new { userId }, cancellationToken: ct));

            var items = (await conn.QueryAsync<TicketRecord>(new CommandDefinition($"""
                SELECT {Columns} {From}
                WHERE t.raised_by = @userId
                ORDER BY t.created_at DESC, t.id DESC
                LIMIT @limit OFFSET @offset
                """, new { userId, limit, offset }, cancellationToken: ct))).AsList();

            return (items, total);
        }, ct);

    public async Task<(IReadOnlyList<TicketRecord> Items, long Total)> FindAssignedPagedAsync(
        long agentId, string? status, int offset, int limit, CancellationToken ct = default) =>
        await QueryAsync(async conn =>
        {
            string where = "WHERE t.assigned_to = @agentId" +
                           (string.IsNullOrWhiteSpace(status) ? "" : " AND t.status = @status");

            long total = await conn.ExecuteScalarAsync<long>(new CommandDefinition(
                $"SELECT COUNT(*) FROM tickets t {where}",
                new { agentId, status }, cancellationToken: ct));

            var items = (await conn.QueryAsync<TicketRecord>(new CommandDefinition($"""
                SELECT {Columns} {From}
                {where}
                ORDER BY t.created_at DESC, t.id DESC
                LIMIT @limit OFFSET @offset
                """, new { agentId, status, limit, offset }, cancellationToken: ct))).AsList();

            return (items, total);
        }, ct);

    public async Task<(IReadOnlyList<TicketRecord> Items, long Total)> FindAllDeskPagedAsync(
        long viewerId, bool seesEverything, IReadOnlyList<long> deskUserIds, string? status,
        int offset, int limit, CancellationToken ct = default) =>
        await QueryAsync(async conn =>
        {
            string statusClause = string.IsNullOrWhiteSpace(status) ? "" : " AND t.status = @status";
            string where;

            if (seesEverything)
            {
                where = string.IsNullOrWhiteSpace(status) ? "" : "WHERE t.status = @status";
            }
            else
            {
                where = $"WHERE (t.assigned_to IN @deskUserIds OR t.raised_by = @viewerId){statusClause}";
            }

            long total = await conn.ExecuteScalarAsync<long>(new CommandDefinition(
                $"SELECT COUNT(*) FROM tickets t {where}",
                new { viewerId, deskUserIds, status }, cancellationToken: ct));

            var items = (await conn.QueryAsync<TicketRecord>(new CommandDefinition($"""
                SELECT {Columns} {From}
                {where}
                ORDER BY t.created_at DESC, t.id DESC
                LIMIT @limit OFFSET @offset
                """, new { viewerId, deskUserIds, status, limit, offset }, cancellationToken: ct))).AsList();

            return (items, total);
        }, ct);

    public async Task<IReadOnlyList<AgentView>> FindAgentsAsync(long requesterId, CancellationToken ct = default) =>
        await QueryAsync(async conn =>
        {
            Dictionary<long, AgentView> map = new();

            // 1. CTO Elamaran Subramanian (PIX-E100)
            var cto = await conn.QueryFirstOrDefaultAsync<UserAgentRow>(new CommandDefinition("""
                SELECT id AS Id, name AS Name, employee_code AS EmployeeCode
                FROM users
                WHERE UPPER(employee_code) = 'PIX-E100' AND enabled = 1
                LIMIT 1
                """, cancellationToken: ct));

            if (cto != null && cto.Id != requesterId)
            {
                map[cto.Id] = new AgentView(
                    cto.Id,
                    $"CTO ({cto.EmployeeCode})",
                    cto.EmployeeCode ?? "",
                    "CTO");
            }

            // 2. System Admin (USER_MANAGE)
            var sysAdmin = await conn.QueryFirstOrDefaultAsync<UserAgentRow>(new CommandDefinition("""
                SELECT u.id AS Id, u.name AS Name, u.employee_code AS EmployeeCode
                FROM users u
                JOIN user_roles ur ON ur.user_id = u.id
                JOIN role_permissions rp ON rp.role_id = ur.role_id
                JOIN permissions p ON p.id = rp.permission_id
                WHERE p.code = 'USER_MANAGE' AND u.enabled = 1
                  AND UPPER(u.employee_code) != 'PIX-E100' AND u.id != @requesterId
                LIMIT 1
                """, new { requesterId }, cancellationToken: ct));

            if (sysAdmin != null && !map.ContainsKey(sysAdmin.Id))
            {
                map[sysAdmin.Id] = new AgentView(
                    sysAdmin.Id,
                    $"System Admin ({sysAdmin.EmployeeCode})",
                    sysAdmin.EmployeeCode ?? "",
                    "System Admin");
            }

            // Check if requester is HR
            int isRequesterHr = await conn.ExecuteScalarAsync<int>(new CommandDefinition("""
                SELECT COUNT(*) FROM user_roles ur
                JOIN roles r ON r.id = ur.role_id
                WHERE ur.user_id = @requesterId AND r.code IN ('IT_HR', 'CV_HR', 'IT_MGR')
                """, new { requesterId }, cancellationToken: ct));

            if (isRequesterHr == 0)
            {
                // 3. For employees and Team Leaders: HR desk members sorted by name
                var hrList = await conn.QueryAsync<dynamic>(new CommandDefinition("""
                    SELECT DISTINCT u.id, u.name, u.employee_code AS EmployeeCode
                    FROM users u
                    JOIN user_roles ur ON ur.user_id = u.id
                    JOIN roles r ON r.id = ur.role_id
                    WHERE r.code IN ('IT_HR', 'CV_HR', 'IT_MGR') AND u.enabled = 1 AND u.id != @requesterId
                    ORDER BY u.name ASC
                    """, new { requesterId }, cancellationToken: ct));

                foreach (var hr in hrList)
                {
                    long hrId = (long)hr.id;
                    if (!map.ContainsKey(hrId))
                    {
                        map[hrId] = new AgentView(
                            hrId,
                            $"{hr.name} (HR)",
                            (string?)hr.EmployeeCode,
                            "HR");
                    }
                }
            }

            return (IReadOnlyList<AgentView>)map.Values.ToList();
        }, ct);

    public Task<string?> GetUserIndustryAsync(long userId, CancellationToken ct = default) =>
        QueryAsync(conn => conn.QueryFirstOrDefaultAsync<string>(
            new CommandDefinition("SELECT industry FROM users WHERE id = @userId LIMIT 1",
                new { userId }, cancellationToken: ct)), ct);

    public async Task<IReadOnlyList<long>> GetHrDeskUserIdsAsync(CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<long>(
            new CommandDefinition("""
                SELECT DISTINCT u.id FROM users u
                JOIN user_roles ur ON ur.user_id = u.id
                JOIN roles r ON r.id = ur.role_id
                WHERE r.code IN ('IT_HR', 'CV_HR', 'IT_MGR') AND u.enabled = 1
                """, cancellationToken: ct)), ct)).AsList();

    private sealed record UserAgentRow(long Id, string? Name, string? EmployeeCode);
}
