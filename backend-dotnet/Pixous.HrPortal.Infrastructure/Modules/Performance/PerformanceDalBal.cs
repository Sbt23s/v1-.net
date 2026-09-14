using Dapper;
using Pixous.HrPortal.Domain.Modules.Performance;
using Pixous.HrPortal.Infrastructure.Persistence;

namespace Pixous.HrPortal.Infrastructure.Modules.Performance;

/// <summary>Dapper access to <c>performance_goals</c> and <c>performance_reviews</c>.</summary>
public sealed class PerformanceDal : DalBase, IPerformanceDal
{
    public PerformanceDal(IDbConnectionFactory connectionFactory) : base(connectionFactory) { }

    private const string GoalColumns = """
        id          AS Id,
        user_id     AS UserId,
        title       AS Title,
        description AS Description,
        progress    AS Progress,
        status      AS Status,
        created_at  AS CreatedAt,
        updated_at  AS UpdatedAt
        """;

    private const string ReviewColumns = """
        id              AS Id,
        user_id         AS UserId,
        manager_id      AS ManagerId,
        review_period   AS ReviewPeriod,
        self_rating     AS SelfRating,
        self_comment    AS SelfComment,
        manager_rating  AS ManagerRating,
        manager_comment AS ManagerComment,
        status          AS Status,
        created_at      AS CreatedAt,
        updated_at      AS UpdatedAt
        """;

    /// <summary>
    /// The timestamps are written explicitly rather than left to the column
    /// defaults, because the entity sets them in Java and both columns are
    /// NOT NULL.
    /// </summary>
    public Task<long> InsertGoalAsync(PerformanceGoalRow row, CancellationToken ct = default) =>
        QueryAsync(async conn =>
        {
            row.CreatedAt ??= DateTime.Now;
            row.UpdatedAt ??= row.CreatedAt;
            row.Id = await conn.ExecuteScalarAsync<long>(new CommandDefinition("""
                INSERT INTO performance_goals
                    (user_id, title, description, progress, status, created_at, updated_at)
                VALUES (@UserId, @Title, @Description, @Progress, @Status, @CreatedAt, @UpdatedAt);
                SELECT LAST_INSERT_ID();
                """, row, cancellationToken: ct));
            return row.Id;
        }, ct);

    public async Task<IReadOnlyList<PerformanceGoalRow>> FindGoalsForAsync(
        long userId, CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<PerformanceGoalRow>(
            new CommandDefinition($"SELECT {GoalColumns} FROM performance_goals WHERE user_id = @userId",
                new { userId }, cancellationToken: ct)), ct)).AsList();

    public Task<long> InsertReviewAsync(PerformanceReviewRow row, CancellationToken ct = default) =>
        QueryAsync(async conn =>
        {
            row.CreatedAt ??= DateTime.Now;
            row.UpdatedAt ??= row.CreatedAt;
            row.Id = await conn.ExecuteScalarAsync<long>(new CommandDefinition("""
                INSERT INTO performance_reviews
                    (user_id, manager_id, review_period, status, created_at, updated_at)
                VALUES (@UserId, @ManagerId, @ReviewPeriod, @Status, @CreatedAt, @UpdatedAt);
                SELECT LAST_INSERT_ID();
                """, row, cancellationToken: ct));
            return row.Id;
        }, ct);

    public async Task<IReadOnlyList<PerformanceReviewRow>> FindReviewsForUserAsync(
        long userId, CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<PerformanceReviewRow>(
            new CommandDefinition($"SELECT {ReviewColumns} FROM performance_reviews WHERE user_id = @userId",
                new { userId }, cancellationToken: ct)), ct)).AsList();

    public async Task<IReadOnlyList<PerformanceReviewRow>> FindReviewsForManagerAsync(
        long managerId, CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<PerformanceReviewRow>(
            new CommandDefinition($"SELECT {ReviewColumns} FROM performance_reviews WHERE manager_id = @managerId",
                new { managerId }, cancellationToken: ct)), ct)).AsList();
}

/// <summary>Ported from PerformanceService.</summary>
public sealed class PerformanceBal : IPerformanceBal
{
    private readonly IPerformanceDal _dal;

    public PerformanceBal(IPerformanceDal dal)
    {
        _dal = dal;
    }

    public async Task<PerformanceGoalResponse> CreateGoalAsync(
        long userId, string title, string? description, CancellationToken ct = default)
    {
        var row = new PerformanceGoalRow
        {
            UserId = userId,
            Title = title,
            Description = description
            // Progress and Status take the entity's defaults: 0 and ACTIVE.
        };

        await _dal.InsertGoalAsync(row, ct);
        return ToResponse(row);
    }

    public async Task<IReadOnlyList<PerformanceGoalResponse>> MyGoalsAsync(
        long userId, CancellationToken ct = default) =>
        (await _dal.FindGoalsForAsync(userId, ct)).Select(ToResponse).ToArray();

    public async Task<PerformanceReviewResponse> CreateReviewAsync(
        long userId, long managerId, string period, CancellationToken ct = default)
    {
        var row = new PerformanceReviewRow
        {
            UserId = userId,
            ManagerId = managerId,
            ReviewPeriod = period
            // Status takes the entity's default: DRAFT.
        };

        await _dal.InsertReviewAsync(row, ct);
        return ToResponse(row);
    }

    public async Task<IReadOnlyList<PerformanceReviewResponse>> MyReviewsAsync(
        long userId, CancellationToken ct = default) =>
        (await _dal.FindReviewsForUserAsync(userId, ct)).Select(ToResponse).ToArray();

    public async Task<IReadOnlyList<PerformanceReviewResponse>> TeamReviewsAsync(
        long managerId, CancellationToken ct = default) =>
        (await _dal.FindReviewsForManagerAsync(managerId, ct)).Select(ToResponse).ToArray();

    private static PerformanceGoalResponse ToResponse(PerformanceGoalRow g) =>
        new(g.Id, g.UserId, g.Title, g.Description, g.Progress, g.Status,
            g.CreatedAt, g.UpdatedAt);

    private static PerformanceReviewResponse ToResponse(PerformanceReviewRow r) =>
        new(r.Id, r.UserId, r.ManagerId, r.ReviewPeriod, r.SelfRating, r.SelfComment,
            r.ManagerRating, r.ManagerComment, r.Status, r.CreatedAt, r.UpdatedAt);
}
