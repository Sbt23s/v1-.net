namespace Pixous.HrPortal.Domain.Modules.Leave;

/// <summary>
/// Permission requests — short time off inside a working day.
/// Ported from com.pixous.hrportal.modules.leave.PermissionService.
/// </summary>
public interface IPermissionBal
{
    /// <summary>Applies for permission, after seven checks. See the implementation.</summary>
    Task<PermissionResponse> ApplyAsync(long userId, PermissionApplyRequest request,
                                         CancellationToken ct = default);

    Task<IReadOnlyList<PermissionResponse>> MineAsync(long userId,
                                                       CancellationToken ct = default);

    Task<IReadOnlyList<PermissionResponse>> PendingForAsync(long approverId,
                                                           CancellationToken ct = default);

    Task<IReadOnlyList<PermissionResponse>> ForApproverAsync(long approverId,
                                                            CancellationToken ct = default);

    Task<IReadOnlyList<PermissionResponse>> AllAsync(CancellationToken ct = default);

    Task<IReadOnlyList<ApproverOption>> ApproversAsync(long requesterId,
                                                       CancellationToken ct = default);

    Task<IReadOnlyDictionary<string, object>> AvailabilityAsync(long userId, DateOnly date,
                                                                CancellationToken ct = default);

    Task<PermissionResponse> DecideAsync(long deciderId, long id, bool approve, string? comment,
                                         CancellationToken ct = default);

    Task CancelAsync(long userId, long id, CancellationToken ct = default);
}

/// <summary>What an employee is asking for. Times are "HH:mm".</summary>
public sealed record PermissionApplyRequest
{
    public required DateOnly RequestDate { get; init; }
    public required string FromTime { get; init; }
    public required string ToTime { get; init; }
    public string? Reason { get; init; }
    public string? Priority { get; init; }
    public long? RequestedTo { get; init; }
}

/// <summary>Decision payload for a permission request.</summary>
public sealed record PermissionDecisionBody
{
    public string? Status { get; init; }
    public bool? Approve { get; init; }
    public string? Comment { get; init; }
}

/// <summary>Enriched response for permission requests matching React PermissionRow.</summary>
public sealed record PermissionResponse(
    long Id,
    long UserId,
    string? EmployeeName,
    string? EmployeeCode,
    DateOnly RequestDate,
    string? FromTime,
    string? ToTime,
    decimal Hours,
    string? Reason,
    string? Priority,
    string? Status,
    string? DecisionComment,
    DateTime? CreatedAt,
    long? RequestedTo,
    string? RequestedToName,
    string? DecidedByName,
    DateTime? DecidedAt,
    string? Team);

/// <summary>A row of <c>permission_requests</c>.</summary>
public sealed class PermissionRequestRecord
{
    public long Id { get; set; }
    public long UserId { get; set; }
    public DateOnly RequestDate { get; set; }

    /// <summary>varchar(5) in the schema -- "09:00", not a TIME column.</summary>
    public string? FromTime { get; set; }
    public string? ToTime { get; set; }

    public decimal Hours { get; set; }
    public string? Reason { get; set; }
    public string? Priority { get; set; }
    public string? Status { get; set; }
    public long? DecidedBy { get; set; }
    public DateTime? DecidedAt { get; set; }
    public string? DecisionComment { get; set; }
    public DateTime? CreatedAt { get; set; }
    public long? RequestedTo { get; set; }
}
