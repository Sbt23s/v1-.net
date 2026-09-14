namespace Pixous.HrPortal.Domain.Modules.Performance;

/// <summary>
/// Goals and review cycles. Ported from
/// com.pixous.hrportal.modules.performance.PerformanceService.
///
/// The simplest module in the application: two tables, no workflow beyond a
/// status column, and no notifications. Ported as it stands rather than filled
/// out — the rating and comment columns exist and nothing in the Java writes
/// them yet, which is a gap in the product, not in this port.
/// </summary>
public interface IPerformanceBal
{
    Task<PerformanceGoalResponse> CreateGoalAsync(long userId, string title, string? description,
                                                  CancellationToken ct = default);

    Task<IReadOnlyList<PerformanceGoalResponse>> MyGoalsAsync(long userId,
                                                              CancellationToken ct = default);

    /// <summary>Opens a review cycle for somebody. The caller becomes its manager.</summary>
    Task<PerformanceReviewResponse> CreateReviewAsync(long userId, long managerId, string period,
                                                      CancellationToken ct = default);

    Task<IReadOnlyList<PerformanceReviewResponse>> MyReviewsAsync(long userId,
                                                                  CancellationToken ct = default);

    /// <summary>Reviews this manager owns.</summary>
    Task<IReadOnlyList<PerformanceReviewResponse>> TeamReviewsAsync(long managerId,
                                                                    CancellationToken ct = default);
}

/// <summary>A goal, as the client sees it.</summary>
public sealed record PerformanceGoalResponse(
    long Id,
    long UserId,
    string? Title,
    string? Description,

    /// <summary>0 to 100.</summary>
    int Progress,

    /// <summary>ACTIVE | COMPLETED | CANCELLED.</summary>
    string? Status,

    DateTime? CreatedAt,
    DateTime? UpdatedAt);

/// <summary>A review cycle.</summary>
public sealed record PerformanceReviewResponse(
    long Id,
    long UserId,
    long ManagerId,
    string? ReviewPeriod,
    int? SelfRating,
    string? SelfComment,
    int? ManagerRating,
    string? ManagerComment,

    /// <summary>DRAFT | SUBMITTED | REVIEWED.</summary>
    string? Status,

    DateTime? CreatedAt,
    DateTime? UpdatedAt);

/// <summary>A row of <c>performance_goals</c>.</summary>
public sealed class PerformanceGoalRow
{
    public long Id { get; set; }
    public long UserId { get; set; }
    public string? Title { get; set; }
    public string? Description { get; set; }

    /// <summary>Defaults to 0, as the entity field does.</summary>
    public int Progress { get; set; }

    /// <summary>Defaults to ACTIVE, as the entity field does.</summary>
    public string Status { get; set; } = "ACTIVE";

    public DateTime? CreatedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }
}

/// <summary>A row of <c>performance_reviews</c>.</summary>
public sealed class PerformanceReviewRow
{
    public long Id { get; set; }
    public long UserId { get; set; }
    public long ManagerId { get; set; }
    public string? ReviewPeriod { get; set; }
    public int? SelfRating { get; set; }
    public string? SelfComment { get; set; }
    public int? ManagerRating { get; set; }
    public string? ManagerComment { get; set; }

    /// <summary>Defaults to DRAFT, as the entity field does.</summary>
    public string Status { get; set; } = "DRAFT";

    public DateTime? CreatedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }
}

/// <summary>Data access for performance.</summary>
public interface IPerformanceDal
{
    Task<long> InsertGoalAsync(PerformanceGoalRow row, CancellationToken ct = default);
    Task<IReadOnlyList<PerformanceGoalRow>> FindGoalsForAsync(long userId,
                                                              CancellationToken ct = default);

    Task<long> InsertReviewAsync(PerformanceReviewRow row, CancellationToken ct = default);
    Task<IReadOnlyList<PerformanceReviewRow>> FindReviewsForUserAsync(
        long userId, CancellationToken ct = default);
    Task<IReadOnlyList<PerformanceReviewRow>> FindReviewsForManagerAsync(
        long managerId, CancellationToken ct = default);
}
