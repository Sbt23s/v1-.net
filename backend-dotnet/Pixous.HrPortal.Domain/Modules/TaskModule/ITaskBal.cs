using System.ComponentModel.DataAnnotations;

namespace Pixous.HrPortal.Domain.Modules.TaskModule;

/// <summary>
/// Tasks: assigning them, working them, and the conversation on each one.
/// Ported from com.pixous.hrportal.modules.task — TaskService, TaskChatService
/// and TaskWorkloadService, which sit behind one controller.
///
/// The judgements live in <see cref="TaskRules"/>; what is here is the work of
/// fetching rows, writing them back and telling people.
/// </summary>
public interface ITaskBal
{
    // ---- the employee's own work ----

    Task<IReadOnlyList<TaskResponse>> MineAsync(long userId, CancellationToken ct = default);

    /// <summary>Marks a task done. Only its assignee may.</summary>
    Task<TaskResponse> CompleteAsync(long userId, long taskId, CancellationToken ct = default);

    /// <summary>
    /// The assignee reports how far along they are. The percentage carries a
    /// status with it, so the one-way rule applies here too.
    /// </summary>
    Task<TaskResponse> UpdateProgressAsync(long userId, long taskId, int progress,
                                           CancellationToken ct = default);

    // ---- assigning and managing ----

    Task<TaskResponse> AssignAsync(long assignerId, TaskRequest request,
                                   CancellationToken ct = default);

    /// <summary>
    /// The assigner corrects a task they raised — title, details, due date,
    /// priority. Progress and status stay with the assignee unless a status is
    /// given, and then the one-way rule applies.
    /// </summary>
    Task<TaskResponse> UpdateTaskAsync(long editorId, long taskId, TaskUpdateRequest request,
                                       CancellationToken ct = default);

    /// <summary>Everybody's tasks, grouped per employee, newest first.</summary>
    Task<IReadOnlyList<EmployeeTaskGroup>> EveryoneAsync(string? industry, string? q,
                                                         CancellationToken ct = default);

    /// <summary>Export tasks to Excel sheet.</summary>
    Task<byte[]> ExportExcelAsync(string? industry, DateOnly? from, DateOnly? to,
                                  CancellationToken ct = default);

    Task DeleteAsync(long taskId, CancellationToken ct = default);


    /// <summary>Deletes every member task belonging to one team assignment.</summary>
    Task DeleteTeamBatchAsync(string batchId, CancellationToken ct = default);

    // ---- the conversation ----

    Task<IReadOnlyList<TaskMessageView>> MessagesAsync(long taskId, long? requesterId,
                                                       CancellationToken ct = default);

    Task<TaskMessageView> SendMessageAsync(long taskId, long senderId, string? content,
                                           IReadOnlyList<string>? attachmentPaths,
                                           CancellationToken ct = default);

    /// <summary>How many messages each of these tasks carries, for the badge.</summary>
    Task<IReadOnlyDictionary<string, long>> MessageCountsAsync(IReadOnlyList<long>? taskIds,
                                                               CancellationToken ct = default);

    // ---- workload ----

    /// <summary>
    /// One row per person carrying open work, heaviest first — so whoever is
    /// about to assign something can see who is already buried.
    /// </summary>
    Task<IReadOnlyList<WorkloadRow>> WorkloadAsync(long? requesterId,
                                                   CancellationToken ct = default);

    // ---- due-date reminders ----

    /// <summary>Whether reminders go out, at what time, and how far ahead.</summary>
    Task<ReminderSettings> ReminderSettingsAsync(CancellationToken ct = default);

    /// <summary>Saves those settings. The time must be HH:mm and the lead 0–30 days.</summary>
    Task<ReminderSettings> SaveReminderSettingsAsync(bool enabled, string? time, int? leadDays,
                                                     CancellationToken ct = default);

    /// <summary>
    /// Sends today's reminders now, without waiting for the hour.
    ///
    /// Safe to call twice: the day is written against each task as it is sent,
    /// so a second call the same day does nothing. Returns how many went out.
    /// </summary>
    Task<int> RunRemindersAsync(CancellationToken ct = default);
}

/// <summary>The due-date reminder settings.</summary>
public sealed record ReminderSettings(bool Enabled, string Time, int LeadDays);

/// <summary>
/// The reminder rules, which decide what is due a nudge today.
///
/// Three kinds, and each is sent at most once a day because the day it went out
/// is written against the task — a restart or a second manual run cannot repeat
/// one.
/// </summary>
public static class ReminderRules
{
    public const string EnabledKey = "task.reminder_enabled";
    public const string TimeKey = "task.reminder_time";
    public const string LeadDaysKey = "task.reminder_lead_days";

    public static readonly TimeOnly DefaultTime = new(9, 30);
    public const int DefaultLeadDays = 1;

    /// <summary>What, if anything, this task is due today.</summary>
    public static ReminderKind KindFor(DateOnly due, DateOnly today, int leadDays)
    {
        if (due < today)
        {
            return ReminderKind.Overdue;
        }

        if (due == today)
        {
            return ReminderKind.DueToday;
        }

        // "Soon" is whatever the lead days say, so an administrator can widen it.
        return due <= today.AddDays(leadDays) ? ReminderKind.DueSoon : ReminderKind.None;
    }

    /// <summary>A time as HH:mm. Anything else is refused rather than defaulted.</summary>
    public static bool TryParseTime(string? raw, out TimeOnly time) =>
        TimeOnly.TryParseExact((raw ?? "").Trim(), "HH:mm", out time);

    /// <summary>Between 0 and 30 days before the due date.</summary>
    public static bool IsValidLeadDays(int leadDays) => leadDays is >= 0 and <= 30;

    /// <summary>"1 day" or "3 days" — the Java pluralises inline.</summary>
    public static string Days(long n) => n + (n == 1 ? " day" : " days");
}

/// <summary>Which nudge a task is due.</summary>
public enum ReminderKind
{
    None,
    DueSoon,
    DueToday,
    Overdue
}

/// <summary>What is being assigned.</summary>
public sealed record TaskRequest
{
    [Required(AllowEmptyStrings = false, ErrorMessage = "Give the task a title")]
    public required string Title { get; init; }

    public string? Description { get; init; }

    [Required(ErrorMessage = "Choose who the task is for")]
    public required long AssignedTo { get; init; }

    public DateOnly? DueDate { get; init; }

    /// <summary>LOW | MEDIUM | HIGH — anything else becomes MEDIUM.</summary>
    public string? Priority { get; init; }

    /// <summary>Set when this is one member's copy of a team assignment.</summary>
    public string? TeamBatchId { get; init; }

    public string? TeamName { get; init; }
}

/// <summary>An edit by whoever assigned the task.</summary>
public sealed record TaskUpdateRequest
{
    public string? Title { get; init; }
    public string? Description { get; init; }
    public DateOnly? DueDate { get; init; }
    public string? Priority { get; init; }

    /// <summary>Optional. When given, the one-way rule applies.</summary>
    public string? Status { get; init; }
}

/// <summary>A task, as the client sees it.</summary>
public sealed record TaskResponse(
    long Id,
    string? Title,
    string? Description,
    long AssignedTo,
    string? AssignedToName,
    string? AssignedToCode,
    string? Industry,
    long? AssignedBy,
    string? AssignedByName,
    string? Status,
    int Progress,
    string? Priority,
    DateOnly? DueDate,
    DateTime? CreatedAt,
    DateTime? CompletedAt,
    string? TeamBatchId,
    string? TeamName);

/// <summary>One employee's tasks, with their counts.</summary>
public sealed record EmployeeTaskGroup(
    long UserId,
    string Name,
    string EmployeeCode,
    string? Industry,
    int Total,
    int Pending,
    int Completed,
    IReadOnlyList<TaskResponse> Tasks);

/// <summary>
/// One message in a task's conversation.
///
/// A LinkedHashMap in the Java; a record here, with the same field names in the
/// same order so the wire shape is unchanged.
/// </summary>
public sealed record TaskMessageView(
    long Id,
    long TaskId,
    long SenderId,
    string SenderName,
    string? SenderCode,
    string? Content,

    /// <summary>Comma-separated stored paths, as the column holds them.</summary>
    string? Attachments,

    DateTime? SentAt);

/// <summary>How much open work one person is carrying.</summary>
public sealed record WorkloadRow(
    long UserId,
    string Name,
    string? EmployeeCode,
    string? Team,
    int ActiveCount,
    int OverdueCount,
    int DueSoonCount);

/// <summary>A row of <c>tasks</c>.</summary>
public sealed class TaskRow
{
    public long Id { get; set; }
    public string? Title { get; set; }
    public string? Description { get; set; }
    public long AssignedTo { get; set; }
    public long? AssignedBy { get; set; }
    public string? Status { get; set; }
    public DateOnly? DueDate { get; set; }
    public DateTime? CreatedAt { get; set; }
    public DateTime? CompletedAt { get; set; }

    /// <summary>
    /// The day each kind of reminder was last sent, so none repeats.
    /// </summary>
    public DateOnly? RemindedBefore { get; set; }
    public DateOnly? RemindedDue { get; set; }
    public DateOnly? RemindedOverdue { get; set; }

    public string? TeamBatchId { get; set; }
    public string? TeamName { get; set; }
    public int Progress { get; set; }
    public string? Priority { get; set; }
    public long? CompanyId { get; set; }
}

/// <summary>A row of <c>task_messages</c>.</summary>
public sealed class TaskMessageRow
{
    public long Id { get; set; }
    public long TaskId { get; set; }
    public long SenderId { get; set; }
    public string? Content { get; set; }
    public string? Attachments { get; set; }
    public DateTime? SentAt { get; set; }
}

/// <summary>A person, as the task module needs them.</summary>
public sealed record TaskPerson(
    long Id,
    string? Name,
    string? EmployeeCode,
    string? Industry,
    string? DesignationTitle,
    string? Phone)
{
    /// <summary>The role codes this person holds, upper-cased.</summary>
    public IReadOnlyList<string> RoleCodes { get; init; } = [];

    public bool IsTeamLeader =>
        RoleCodes.Contains(TaskRules.TeamLeaderRole, StringComparer.OrdinalIgnoreCase);
}

/// <summary>Data access for tasks.</summary>
public interface ITaskDal
{
    Task<TaskRow?> FindAsync(long taskId, CancellationToken ct = default);
    Task<long> InsertAsync(TaskRow row, CancellationToken ct = default);
    Task UpdateAsync(TaskRow row, CancellationToken ct = default);
    Task DeleteAsync(long taskId, CancellationToken ct = default);

    Task<IReadOnlyList<TaskRow>> FindByBatchAsync(string batchId, CancellationToken ct = default);
    Task DeleteBatchAsync(string batchId, CancellationToken ct = default);

    Task<IReadOnlyList<TaskRow>> FindForAssigneeAsync(long userId, CancellationToken ct = default);
    Task<IReadOnlyList<TaskRow>> FindAllAsync(CancellationToken ct = default);

    /// <summary>Everything not COMPLETED, for the workload count.</summary>
    Task<IReadOnlyList<TaskRow>> FindOpenAsync(CancellationToken ct = default);

    Task<IReadOnlyList<TaskMessageRow>> FindMessagesAsync(long taskId,
                                                          CancellationToken ct = default);

    Task<IReadOnlyDictionary<long, long>> CountMessagesAsync(IReadOnlyCollection<long> taskIds,
                                                             CancellationToken ct = default);

    Task<long> InsertMessageAsync(TaskMessageRow row, CancellationToken ct = default);

    Task<TaskPerson?> FindPersonAsync(long userId, CancellationToken ct = default);

    /// <summary>Several people in one query, with their roles folded in.</summary>
    Task<IReadOnlyDictionary<long, TaskPerson>> FindPeopleAsync(
        IReadOnlyCollection<long> userIds, CancellationToken ct = default);

    /// <summary>Records that a reminder of this kind went out today.</summary>
    Task StampReminderAsync(long taskId, ReminderKind kind, DateOnly on,
                            CancellationToken ct = default);

    Task<string?> FindSettingAsync(string key, CancellationToken ct = default);

    Task SaveSettingAsync(string key, string value, CancellationToken ct = default);
}
