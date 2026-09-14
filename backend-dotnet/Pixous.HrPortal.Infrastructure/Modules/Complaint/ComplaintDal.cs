using Dapper;
using Pixous.HrPortal.Domain.Modules.Complaint;
using Pixous.HrPortal.Infrastructure.Persistence;

namespace Pixous.HrPortal.Infrastructure.Modules.Complaint;

/// <summary>Dapper access to <c>complaints_needs</c>.</summary>
public sealed class ComplaintDal : DalBase, IComplaintDal
{
    public ComplaintDal(IDbConnectionFactory connectionFactory) : base(connectionFactory) { }

    /// <summary>Oversight, by employee code — the same two the other modules use.</summary>
    private static readonly string[] OversightCodes = ["PIX-E100", "ADM0001"];

    private const string Columns = """
        c.id             AS Id,
        c.reference_code AS ReferenceCode,
        c.raised_by      AS RaisedBy,
        c.requested_to   AS RequestedTo,
        c.kind           AS Kind,
        c.category       AS Category,
        c.subject        AS Subject,
        c.description    AS Description,
        c.priority       AS Priority,
        c.status         AS Status,
        c.hr_response    AS HrResponse,
        c.handled_by     AS HandledBy,
        c.resolved_at    AS ResolvedAt,
        c.created_at     AS CreatedAt,
        c.updated_at     AS UpdatedAt,
        c.company_id     AS CompanyId,
        r.name           AS RaisedByName,
        t.name           AS RequestedToName
        """;

    private const string From = """
        FROM complaints_needs c
        LEFT JOIN users r ON r.id = c.raised_by
        LEFT JOIN users t ON t.id = c.requested_to
        """;

    public Task<string?> FindMaxReferenceCodeAsync(string prefix, CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteScalarAsync<string?>(
            new CommandDefinition("""
                SELECT MAX(reference_code) FROM complaints_needs
                WHERE reference_code LIKE CONCAT(@prefix, '%')
                """,
                new { prefix }, cancellationToken: ct)), ct);

    public Task<long> InsertAsync(ComplaintRecord c, CancellationToken ct = default) =>
        QueryAsync(async conn =>
        {
            c.CreatedAt ??= DateTime.Now;
            c.Id = await conn.ExecuteScalarAsync<long>(new CommandDefinition("""
                INSERT INTO complaints_needs
                    (reference_code, raised_by, requested_to, kind, category, subject,
                     description, priority, status, company_id, created_at, updated_at)
                VALUES
                    (@ReferenceCode, @RaisedBy, @RequestedTo, @Kind, @Category, @Subject,
                     @Description, @Priority, @Status, @CompanyId, @CreatedAt, @CreatedAt);
                SELECT LAST_INSERT_ID();
                """, c, cancellationToken: ct));
            return c.Id;
        }, ct);

    public Task UpdateAsync(ComplaintRecord c, CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteAsync(new CommandDefinition("""
            UPDATE complaints_needs SET
                kind = @Kind,
                category = @Category,
                subject = @Subject,
                description = @Description,
                priority = @Priority,
                status = @Status,
                hr_response = @HrResponse,
                handled_by = @HandledBy,
                resolved_at = @ResolvedAt,
                updated_at = @UpdatedAt
            WHERE id = @Id
            """, c, cancellationToken: ct)), ct);

    public Task<ComplaintRecord?> FindAsync(long id, CancellationToken ct = default) =>
        QueryAsync(conn => conn.QueryFirstOrDefaultAsync<ComplaintRecord>(
            new CommandDefinition($"SELECT {Columns} {From} WHERE c.id = @id",
                new { id }, cancellationToken: ct)), ct);

    public async Task<IReadOnlyList<ComplaintRecord>> FindForUserAsync(
        long userId, CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<ComplaintRecord>(
            new CommandDefinition(
                $"SELECT {Columns} {From} WHERE c.raised_by = @userId ORDER BY c.id DESC",
                new { userId }, cancellationToken: ct)), ct)).AsList();

    public async Task<IReadOnlyList<ComplaintRecord>> FindAllAsync(CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<ComplaintRecord>(
            new CommandDefinition($"SELECT {Columns} {From} ORDER BY c.id DESC",
                cancellationToken: ct)), ct)).AsList();

    public Task<bool> SeesEveryRequestAsync(long userId, CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteScalarAsync<bool>(
            new CommandDefinition("""
                SELECT EXISTS(
                    SELECT 1 FROM users
                    WHERE id = @userId AND UPPER(employee_code) IN @codes)
                """,
                new { userId, codes = OversightCodes }, cancellationToken: ct)), ct);

    public Task<string?> FindUserNameAsync(long userId, CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteScalarAsync<string?>(
            new CommandDefinition("SELECT name FROM users WHERE id = @userId",
                new { userId }, cancellationToken: ct)), ct);

    public async Task<IReadOnlyList<ComplaintRecipientView>> FindRecipientsAsync(long userId, CancellationToken ct = default) =>
        await QueryAsync(async conn =>
        {
            var map = new Dictionary<long, ComplaintRecipientView>();

            // 1. CTO
            var cto = await conn.QueryFirstOrDefaultAsync<ComplaintRecipientView>(
                new CommandDefinition("""
                    SELECT u.id, u.name, u.employee_code AS Code, 'CTO' AS Role
                    FROM users u
                    LEFT JOIN user_roles ur ON ur.user_id = u.id
                    LEFT JOIN roles r ON r.id = ur.role_id
                    WHERE u.enabled = 1 AND (r.code IN ('IT_CTO', 'CTO') OR u.designation_title = 'CTO')
                    LIMIT 1
                    """, cancellationToken: ct));
            if (cto is not null && cto.Id != userId)
            {
                map[cto.Id] = cto;
            }

            // 2. System Admin
            var admin = await conn.QueryFirstOrDefaultAsync<ComplaintRecipientView>(
                new CommandDefinition("""
                    SELECT u.id, CONCAT('System Admin (', u.employee_code, ')') AS Name, u.employee_code AS Code, 'Admin' AS Role
                    FROM users u
                    INNER JOIN user_roles ur ON ur.user_id = u.id
                    INNER JOIN role_permissions rp ON rp.role_id = ur.role_id
                    INNER JOIN permissions p ON p.id = rp.permission_id
                    WHERE u.enabled = 1 AND p.code = 'USER_MANAGE' AND u.id <> @userId
                    LIMIT 1
                    """, new { userId }, cancellationToken: ct));
            if (admin is not null)
            {
                map.TryAdd(admin.Id, admin);
            }

            // 3. HR Desk Members
            var hrMembers = await conn.QueryAsync<ComplaintRecipientView>(
                new CommandDefinition("""
                    SELECT u.id, CONCAT(u.name, ' (HR)') AS Name, u.employee_code AS Code, 'HR' AS Role
                    FROM users u
                    INNER JOIN user_roles ur ON ur.user_id = u.id
                    INNER JOIN roles r ON r.id = ur.role_id
                    WHERE u.enabled = 1 AND r.code IN ('IT_HR', 'HR_EXEC', 'SUPER_ADMIN', 'COMPANY_ADMIN') AND u.id <> @userId
                    ORDER BY u.name ASC
                    """, new { userId }, cancellationToken: ct));
            foreach (var m in hrMembers)
            {
                map.TryAdd(m.Id, m);
            }

            // 4. Configured recipients from approval_recipients
            var configured = await conn.QueryAsync<ComplaintRecipientView>(
                new CommandDefinition("""
                    SELECT u.id, u.name, u.employee_code AS Code, 'HR' AS Role
                    FROM approval_recipients ar
                    INNER JOIN users u ON u.id = ar.user_id
                    WHERE ar.request_type = 'COMPLAINT' AND u.enabled = 1 AND u.id <> @userId
                    """, new { userId }, cancellationToken: ct));
            foreach (var c in configured)
            {
                map.TryAdd(c.Id, c);
            }

            return (IReadOnlyList<ComplaintRecipientView>)map.Values.ToList();
        }, ct);
}

