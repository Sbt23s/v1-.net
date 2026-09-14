using Dapper;
using Pixous.HrPortal.Domain.Modules.Discipline;
using Pixous.HrPortal.Infrastructure.Persistence;

namespace Pixous.HrPortal.Infrastructure.Modules.Discipline;

/// <summary>Dapper access to <c>discipline_records</c>.</summary>
public sealed class DisciplineDal : DalBase, IDisciplineDal
{
    public DisciplineDal(IDbConnectionFactory connectionFactory) : base(connectionFactory) { }

    private static readonly string[] OversightCodes = ["PIX-E100", "ADM0001"];

    private const string Columns = """
        d.id                AS Id,
        d.reference_code    AS ReferenceCode,
        d.employee_id       AS EmployeeId,
        d.reported_by       AS ReportedBy,
        d.incident_date     AS IncidentDate,
        d.discipline_type   AS DisciplineType,
        d.severity          AS Severity,
        d.subject           AS Subject,
        d.description       AS Description,
        d.action_taken      AS ActionTaken,
        d.attachments       AS Attachments,
        d.employee_response AS EmployeeResponse,
        d.responded_at      AS RespondedAt,
        d.cto_remarks       AS CtoRemarks,
        d.reviewed_by       AS ReviewedBy,
        d.reviewed_at       AS ReviewedAt,
        d.status            AS Status,
        d.created_at        AS CreatedAt,
        d.updated_at        AS UpdatedAt,
        e.name              AS EmployeeName,
        e.employee_code     AS EmployeeCode,
        e.designation_title AS Department,
        r.name              AS ReportedByName,
        rv.name             AS ReviewedByName
        """;

    private const string From = """
        FROM discipline_records d
        LEFT JOIN users e ON e.id = d.employee_id
        LEFT JOIN users r ON r.id = d.reported_by
        LEFT JOIN users rv ON rv.id = d.reviewed_by
        """;

    public Task<string?> FindMaxReferenceCodeAsync(string prefix, CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteScalarAsync<string?>(
            new CommandDefinition("""
                SELECT MAX(reference_code) FROM discipline_records
                WHERE reference_code LIKE CONCAT(@prefix, '%')
                """,
                new { prefix }, cancellationToken: ct)), ct);

    public Task<long> InsertAsync(DisciplineRecord d, CancellationToken ct = default) =>
        QueryAsync(async conn =>
        {
            d.CreatedAt ??= DateTime.Now;
            d.Id = await conn.ExecuteScalarAsync<long>(new CommandDefinition("""
                INSERT INTO discipline_records
                    (reference_code, employee_id, reported_by, incident_date, discipline_type,
                     severity, subject, description, action_taken, attachments, status,
                     created_at, updated_at)
                VALUES
                    (@ReferenceCode, @EmployeeId, @ReportedBy, @IncidentDate, @DisciplineType,
                     @Severity, @Subject, @Description, @ActionTaken, @Attachments, @Status,
                     @CreatedAt, @CreatedAt);
                SELECT LAST_INSERT_ID();
                """, d, cancellationToken: ct));
            return d.Id;
        }, ct);

    public Task UpdateAsync(DisciplineRecord d, CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteAsync(new CommandDefinition("""
            UPDATE discipline_records SET
                incident_date = @IncidentDate,
                discipline_type = @DisciplineType,
                severity = @Severity,
                subject = @Subject,
                description = @Description,
                action_taken = @ActionTaken,
                attachments = @Attachments,
                employee_response = @EmployeeResponse,
                responded_at = @RespondedAt,
                cto_remarks = @CtoRemarks,
                reviewed_by = @ReviewedBy,
                reviewed_at = @ReviewedAt,
                status = @Status,
                updated_at = @UpdatedAt
            WHERE id = @Id
            """, d, cancellationToken: ct)), ct);

    public Task<DisciplineRecord?> FindAsync(long id, CancellationToken ct = default) =>
        QueryAsync(conn => conn.QueryFirstOrDefaultAsync<DisciplineRecord>(
            new CommandDefinition($"SELECT {Columns} {From} WHERE d.id = @id",
                new { id }, cancellationToken: ct)), ct);

    public async Task<IReadOnlyList<DisciplineRecord>> FindForEmployeeAsync(
        long employeeId, CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<DisciplineRecord>(
            new CommandDefinition(
                $"SELECT {Columns} {From} WHERE d.employee_id = @employeeId ORDER BY d.incident_date DESC, d.id DESC",
                new { employeeId }, cancellationToken: ct)), ct)).AsList();

    public async Task<IReadOnlyList<DisciplineRecord>> FindAllAsync(CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<DisciplineRecord>(
            new CommandDefinition($"SELECT {Columns} {From} ORDER BY d.incident_date DESC, d.id DESC",
                cancellationToken: ct)), ct)).AsList();

    public async Task<IReadOnlyList<DisciplineRecord>> FindPendingReviewAsync(CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<DisciplineRecord>(
            new CommandDefinition(
                $"SELECT {Columns} {From} WHERE d.status <> 'CANCELLED' ORDER BY d.incident_date DESC, d.id DESC",
                cancellationToken: ct)), ct)).AsList();

    public async Task<IReadOnlyList<DisciplineRecord>> FilterAllAsync(
        string? status, int offset, int limit, CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<DisciplineRecord>(
            new CommandDefinition($"""
                SELECT {Columns} {From}
                WHERE (@status IS NULL OR d.status = @status)
                ORDER BY d.incident_date DESC, d.id DESC
                LIMIT @limit OFFSET @offset
                """, new { status, limit, offset }, cancellationToken: ct)), ct)).AsList();

    public Task<bool> SeesEveryRequestAsync(long userId, CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteScalarAsync<bool>(
            new CommandDefinition("""
                SELECT EXISTS(
                    SELECT 1 FROM users
                    WHERE id = @userId AND UPPER(employee_code) IN @codes)
                """,
                new { userId, codes = OversightCodes }, cancellationToken: ct)), ct);
}
