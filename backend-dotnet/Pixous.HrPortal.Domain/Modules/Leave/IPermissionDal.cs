namespace Pixous.HrPortal.Domain.Modules.Leave;

/// <summary>Data access for permission requests.</summary>
public interface IPermissionDal
{
    /// <summary>
    /// Live permissions on a day — PENDING or APPROVED. A rejected or cancelled
    /// one never consumed the day.
    /// </summary>
    Task<IReadOnlyList<PermissionRequestRecord>> FindLiveOnDateAsync(
        long userId, DateOnly date, CancellationToken ct = default);

    /// <summary>Live LEAVE covering the day, which blocks a permission.</summary>
    Task<(DateOnly From, DateOnly To, string? Status)?> FindOverlappingLeaveAsync(
        long userId, DateOnly date, CancellationToken ct = default);

    Task<long> InsertAsync(PermissionRequestRecord request, CancellationToken ct = default);

    Task<PermissionRequestRecord?> FindByIdAsync(long id, CancellationToken ct = default);

    Task<PermissionResponse?> FindViewByIdAsync(long id, CancellationToken ct = default);

    Task<IReadOnlyList<PermissionResponse>> FindForUserAsync(long userId,
                                                            CancellationToken ct = default);

    Task<IReadOnlyList<PermissionResponse>> FindPendingAsync(long approverId, bool seesWholeQueue,
                                                            CancellationToken ct = default);

    Task<IReadOnlyList<PermissionResponse>> FindForApproverAsync(long approverId, bool seesWholeQueue,
                                                                CancellationToken ct = default);

    Task<IReadOnlyList<PermissionResponse>> FindAllAsync(CancellationToken ct = default);

    Task UpdateDecisionAsync(long id, string status, long deciderId, DateTime decidedAt,
                             string? comment, CancellationToken ct = default);

    Task CancelAsync(long id, DateTime decidedAt, CancellationToken ct = default);
}
