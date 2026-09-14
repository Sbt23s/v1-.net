namespace Pixous.HrPortal.Domain.Modules.Wfh;

/// <summary>
/// Work from home: applying, and the views over what has been asked for.
/// Ported from com.pixous.hrportal.modules.wfh.WfhService.
/// </summary>
public interface IWfhBal
{
    /// <summary>
    /// Applies to work from home, after six checks — see the implementation.
    /// The approver is resolved here rather than taken from the payload.
    /// </summary>
    /// <summary>
    /// Who a work-from-home request from this person would go to. Exactly one
    /// approver, or none.
    /// </summary>
    Task<IReadOnlyList<Pixous.HrPortal.Domain.Modules.Leave.ApproverOption>> ApproversAsync(
        long userId, CancellationToken ct = default);

    Task<WfhView> ApplyAsync(long userId, WfhApplyRequest request,
                             CancellationToken ct = default);

    Task<IReadOnlyList<WfhView>> MineAsync(long userId, CancellationToken ct = default);

    /// <summary>Requests this person has been asked to decide.</summary>
    Task<IReadOnlyList<WfhView>> ForMeAsync(long userId, CancellationToken ct = default);

    Task<IReadOnlyList<WfhView>> AllAsync(long viewerId, CancellationToken ct = default);

    /// <summary>Who is approved to work from home on a given day.</summary>
    Task<IReadOnlyList<WfhView>> ActiveOnAsync(DateOnly day, long viewerId,
                                                CancellationToken ct = default);

    /// <summary>Who is approved to work from home in a date range.</summary>
    Task<IReadOnlyList<WfhView>> ActiveBetweenAsync(DateOnly? from, DateOnly? to, long viewerId,
                                                    CancellationToken ct = default);

    /// <summary>
    /// Approves or rejects. The addressee decides and nobody else, and an
    /// approval writes the attendance rows for the working days covered.
    /// </summary>
    Task<WfhView> DecideAsync(long deciderId, long id, bool approve, string? comment,
                              CancellationToken ct = default);

    /// <summary>Withdraws a request, while it is still pending.</summary>
    Task<WfhView> CancelAsync(long userId, long id, CancellationToken ct = default);
}

/// <summary>An approve-or-reject decision.</summary>
public sealed record WfhDecisionRequest
{
    public bool? Approve { get; init; }
    public string? Comment { get; init; }
}

/// <summary>What an employee is asking for.</summary>
public sealed record WfhApplyRequest
{
    public required DateOnly FromDate { get; init; }
    public required DateOnly ToDate { get; init; }
    public string? Reason { get; init; }
    public string? Remarks { get; init; }
}
