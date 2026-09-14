using Dapper;
using Pixous.HrPortal.Domain.Modules.Appreciation;
using Pixous.HrPortal.Infrastructure.Persistence;

namespace Pixous.HrPortal.Infrastructure.Modules.Appreciation;

/// <summary>Dapper access to <c>appreciation_letters</c>.</summary>
public sealed class AppreciationDal : DalBase, IAppreciationDal
{
    public AppreciationDal(IDbConnectionFactory connectionFactory) : base(connectionFactory) { }

    private const string Columns = """
        a.id             AS Id,
        a.reference_code AS ReferenceCode,
        a.employee_id    AS EmployeeId,
        a.issued_by      AS IssuedBy,
        a.letter_date    AS LetterDate,
        a.achievement    AS Achievement,
        a.message        AS Message,
        a.template       AS Template,
        a.status         AS Status,
        a.viewed_at      AS ViewedAt,
        a.downloaded_at  AS DownloadedAt,
        a.created_at     AS CreatedAt,
        a.updated_at     AS UpdatedAt,
        e.name           AS EmployeeName,
        i.name           AS IssuedByName,
        e.designation_title AS EmployeeDesignation,
        i.designation_title AS IssuedByDesignation
        """;


    private const string From = """
        FROM appreciation_letters a
        LEFT JOIN users e ON e.id = a.employee_id
        LEFT JOIN users i ON i.id = a.issued_by
        """;

    public Task<string?> FindMaxReferenceCodeAsync(string prefix, CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteScalarAsync<string?>(
            new CommandDefinition("""
                SELECT MAX(reference_code) FROM appreciation_letters
                WHERE reference_code LIKE CONCAT(@prefix, '%')
                """,
                new { prefix }, cancellationToken: ct)), ct);

    public Task<long> InsertAsync(AppreciationRecord a, CancellationToken ct = default) =>
        QueryAsync(async conn =>
        {
            a.CreatedAt ??= DateTime.Now;
            a.Id = await conn.ExecuteScalarAsync<long>(new CommandDefinition("""
                INSERT INTO appreciation_letters
                    (reference_code, employee_id, issued_by, letter_date, achievement,
                     message, template, status, created_at, updated_at)
                VALUES
                    (@ReferenceCode, @EmployeeId, @IssuedBy, @LetterDate, @Achievement,
                     @Message, @Template, @Status, @CreatedAt, @CreatedAt);
                SELECT LAST_INSERT_ID();
                """, a, cancellationToken: ct));
            return a.Id;
        }, ct);

    public Task UpdateAsync(AppreciationRecord a, CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteAsync(new CommandDefinition("""
            UPDATE appreciation_letters SET
                letter_date = @LetterDate,
                achievement = @Achievement,
                message = @Message,
                template = @Template,
                status = @Status,
                viewed_at = @ViewedAt,
                downloaded_at = @DownloadedAt,
                updated_at = @UpdatedAt
            WHERE id = @Id
            """, a, cancellationToken: ct)), ct);

    public Task DeleteAsync(long id, CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteAsync(
            new CommandDefinition("DELETE FROM appreciation_letters WHERE id = @id",
                new { id }, cancellationToken: ct)), ct);

    public Task<AppreciationRecord?> FindAsync(long id, CancellationToken ct = default) =>
        QueryAsync(conn => conn.QueryFirstOrDefaultAsync<AppreciationRecord>(
            new CommandDefinition($"SELECT {Columns} {From} WHERE a.id = @id",
                new { id }, cancellationToken: ct)), ct);

    public async Task<IReadOnlyList<AppreciationRecord>> FindForEmployeeAsync(
        long employeeId, CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<AppreciationRecord>(
            new CommandDefinition(
                $"SELECT {Columns} {From} WHERE a.employee_id = @employeeId ORDER BY a.id DESC",
                new { employeeId }, cancellationToken: ct)), ct)).AsList();

    public async Task<IReadOnlyList<AppreciationRecord>> FindAllAsync(CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<AppreciationRecord>(
            new CommandDefinition($"SELECT {Columns} {From} ORDER BY a.id DESC",
                cancellationToken: ct)), ct)).AsList();
}
