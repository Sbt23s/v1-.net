using Dapper;
using Pixous.HrPortal.Domain.Modules.Expense;
using Pixous.HrPortal.Infrastructure.Persistence;

namespace Pixous.HrPortal.Infrastructure.Modules.Expense;

/// <summary>
/// Dapper access to <c>ta_expenses</c>.
/// </summary>
public sealed class ExpenseDal : DalBase, IExpenseDal
{
    public ExpenseDal(IDbConnectionFactory connectionFactory) : base(connectionFactory) { }

    private const string Columns = """
        e.id                AS Id,
        e.user_id           AS UserId,
        e.date              AS Date,
        e.location          AS Location,
        e.starting_km       AS StartingKm,
        e.ending_km         AS EndingKm,
        e.total_km          AS TotalKm,
        e.hills_km          AS HillsKm,
        e.plains_km         AS PlainsKm,
        e.total_amount      AS TotalAmount,
        e.bus_fare          AS BusFare,
        e.others            AS Others,
        e.gross_total       AS GrossTotal,
        e.remarks           AS Remarks,
        e.status            AS Status,
        e.category          AS Category,
        e.petrol_slip_path  AS PetrolSlipPath,
        e.photos            AS Photos,
        e.decision_comment  AS DecisionComment,
        e.decided_by        AS DecidedBy,
        e.decided_at        AS DecidedAt,
        e.created_at        AS CreatedAt,
        e.updated_at        AS UpdatedAt,
        u.name              AS UserName,
        u.employee_code     AS EmployeeCode,
        u.designation_title AS DesignationTitle
        """;

    private const string From = """
        FROM ta_expenses e
        LEFT JOIN users u ON u.id = e.user_id
        """;

    public Task<long> InsertAsync(ExpenseRecord e, CancellationToken ct = default) =>
        QueryAsync(async conn =>
        {
            e.CreatedAt ??= DateTime.Now;
            e.Id = await conn.ExecuteScalarAsync<long>(new CommandDefinition("""
                INSERT INTO ta_expenses
                    (user_id, date, location, starting_km, ending_km, total_km, hills_km,
                     plains_km, total_amount, bus_fare, others, gross_total, remarks, status,
                     category, petrol_slip_path, photos, created_at, updated_at, created_by)
                VALUES
                    (@UserId, @Date, @Location, @StartingKm, @EndingKm, @TotalKm, @HillsKm,
                     @PlainsKm, @TotalAmount, @BusFare, @Others, @GrossTotal, @Remarks, @Status,
                     @Category, @PetrolSlipPath, @Photos, @CreatedAt, @CreatedAt, @UserId);
                SELECT LAST_INSERT_ID();
                """, e, cancellationToken: ct));
            return e.Id;
        }, ct);

    public Task UpdateAsync(ExpenseRecord e, CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteAsync(new CommandDefinition("""
            UPDATE ta_expenses SET
                date = @Date,
                location = @Location,
                starting_km = @StartingKm,
                ending_km = @EndingKm,
                total_km = @TotalKm,
                hills_km = @HillsKm,
                plains_km = @PlainsKm,
                total_amount = @TotalAmount,
                bus_fare = @BusFare,
                others = @Others,
                gross_total = @GrossTotal,
                remarks = @Remarks,
                status = @Status,
                category = @Category,
                petrol_slip_path = @PetrolSlipPath,
                photos = @Photos,
                decision_comment = @DecisionComment,
                decided_by = @DecidedBy,
                decided_at = @DecidedAt,
                updated_at = @UpdatedAt,
                updated_by = @UpdatedBy
            WHERE id = @Id
            """,
            new
            {
                e.Id, e.Date, e.Location, e.StartingKm, e.EndingKm, e.TotalKm, e.HillsKm,
                e.PlainsKm, e.TotalAmount, e.BusFare, e.Others, e.GrossTotal, e.Remarks,
                e.Status, e.Category, e.PetrolSlipPath, e.Photos, e.DecisionComment,
                e.DecidedBy, e.DecidedAt,
                UpdatedAt = e.UpdatedAt ?? DateTime.Now,
                UpdatedBy = e.DecidedBy
            }, cancellationToken: ct)), ct);

    public Task<ExpenseRecord?> FindAsync(long id, CancellationToken ct = default) =>
        QueryAsync(conn => conn.QueryFirstOrDefaultAsync<ExpenseRecord>(
            new CommandDefinition($"SELECT {Columns} {From} WHERE e.id = @id",
                new { id }, cancellationToken: ct)), ct);

    public async Task<IReadOnlyList<ExpenseRecord>> FindForUserAsync(
        long userId, CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<ExpenseRecord>(
            new CommandDefinition(
                $"SELECT {Columns} {From} WHERE e.user_id = @userId ORDER BY e.date DESC, e.id DESC",
                new { userId }, cancellationToken: ct)), ct)).AsList();

    public async Task<IReadOnlyList<ExpenseRecord>> FindAllAsync(CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<ExpenseRecord>(
            new CommandDefinition($"SELECT {Columns} {From} ORDER BY e.date DESC, e.id DESC",
                cancellationToken: ct)), ct)).AsList();

    public async Task<IReadOnlyList<ExpenseRecord>> FindForTeamAsync(
        IReadOnlyList<long> userIds, CancellationToken ct = default)
    {
        if (userIds == null || userIds.Count == 0) return new List<ExpenseRecord>();
        return (await QueryAsync(conn => conn.QueryAsync<ExpenseRecord>(
            new CommandDefinition(
                $"SELECT {Columns} {From} WHERE e.user_id IN @userIds ORDER BY e.date DESC, e.id DESC",
                new { userIds }, cancellationToken: ct)), ct)).AsList();
    }

    public async Task<IReadOnlyList<long>> FindTeammateIdsAsync(long userId, CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<long>(
            new CommandDefinition("""
                SELECT id FROM users
                WHERE (designation_title = (SELECT designation_title FROM users WHERE id = @userId)
                       AND designation_title IS NOT NULL AND designation_title != '')
                   OR (designation_id = (SELECT designation_id FROM users WHERE id = @userId)
                       AND designation_id IS NOT NULL)
                   OR id = @userId
                """, new { userId }, cancellationToken: ct)), ct)).AsList();

    public Task DeleteAsync(long id, CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteAsync(new CommandDefinition(
            "DELETE FROM ta_expenses WHERE id = @id", new { id }, cancellationToken: ct)), ct);
}
