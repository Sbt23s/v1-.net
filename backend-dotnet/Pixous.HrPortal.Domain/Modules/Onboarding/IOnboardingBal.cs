namespace Pixous.HrPortal.Domain.Modules.Onboarding;

/// <summary>
/// The joining checklist. Ported from
/// com.pixous.hrportal.modules.onboarding.OnboardingService.
///
/// One checklist per person, with five fixed tasks created when HR starts it.
/// The checklist completes itself when the last task is ticked, rather than
/// waiting for somebody to declare it done.
/// </summary>
public interface IOnboardingBal
{
    /// <summary>
    /// Starts somebody's onboarding, creating the checklist and its tasks.
    /// Refuses if one already exists — restarting would discard whatever
    /// progress had been made.
    /// </summary>
    Task<OnboardingChecklistResponse> StartAsync(long userId, CancellationToken ct = default);

    /// <summary>
    /// Ids of employees currently in onboarding, used to scope announcement
    /// channels.
    /// </summary>
    Task<IReadOnlyList<long>> OnboardingUserIdsAsync(CancellationToken ct = default);

    Task<OnboardingChecklistResponse> GetAsync(long userId, CancellationToken ct = default);

    /// <summary>
    /// Ticks a task. Completes the whole checklist when it was the last one
    /// outstanding.
    /// </summary>
    Task<OnboardingChecklistResponse> CompleteTaskAsync(long userId, long taskId,
                                                        CancellationToken ct = default);
}

/// <summary>The tasks every new joiner starts with, in order.</summary>
public static class OnboardingDefaults
{
    public static readonly IReadOnlyList<string> Tasks =
    [
        "Document Collection",
        "Bank Details",
        "IT Asset Assignment",
        "Team Introduction",
        "Security Training"
    ];

    /// <summary>A checklist starts IN_PROGRESS and ends COMPLETED.</summary>
    public const string InProgress = "IN_PROGRESS";
    public const string Completed = "COMPLETED";
}

/// <summary>A checklist and its tasks.</summary>
public sealed record OnboardingChecklistResponse(
    long Id,
    long UserId,
    string? Status,
    DateTime? StartedAt,
    DateTime? CompletedAt,
    IReadOnlyList<OnboardingTaskResponse> Tasks);

/// <summary>
/// One task.
///
/// The wire name is <c>isCompleted</c>, not <c>completed</c>: the Java record
/// component is called that, and a client reading <c>completed</c> would find
/// nothing.
/// </summary>
public sealed record OnboardingTaskResponse(
    long Id,
    string? TaskName,
    string? Description,
    bool IsCompleted,
    DateTime? CompletedAt);

/// <summary>A row of <c>onboarding_checklists</c>.</summary>
public sealed class OnboardingChecklistRow
{
    public long Id { get; set; }
    public long UserId { get; set; }
    public string Status { get; set; } = OnboardingDefaults.InProgress;
    public DateTime? StartedAt { get; set; }
    public DateTime? CompletedAt { get; set; }
}

/// <summary>A row of <c>onboarding_tasks</c>.</summary>
public sealed class OnboardingTaskRow
{
    public long Id { get; set; }
    public long ChecklistId { get; set; }
    public string? TaskName { get; set; }
    public string? Description { get; set; }
    public bool IsCompleted { get; set; }
    public DateTime? CompletedAt { get; set; }
}

/// <summary>Data access for onboarding.</summary>
public interface IOnboardingDal
{
    Task<OnboardingChecklistRow?> FindChecklistForUserAsync(long userId,
                                                            CancellationToken ct = default);

    Task<IReadOnlyList<long>> FindUserIdsByStatusAsync(string status,
                                                       CancellationToken ct = default);

    Task<long> InsertChecklistAsync(OnboardingChecklistRow row, CancellationToken ct = default);

    Task CompleteChecklistAsync(long checklistId, DateTime at, CancellationToken ct = default);

    Task<IReadOnlyList<OnboardingTaskRow>> FindTasksAsync(long checklistId,
                                                          CancellationToken ct = default);

    Task<OnboardingTaskRow?> FindTaskAsync(long taskId, CancellationToken ct = default);

    Task InsertTasksAsync(long checklistId, IReadOnlyList<string> taskNames,
                          CancellationToken ct = default);

    Task CompleteTaskAsync(long taskId, DateTime at, CancellationToken ct = default);
}
