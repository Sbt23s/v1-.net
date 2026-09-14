using Pixous.HrPortal.Domain.Common;
using Pixous.HrPortal.Domain.Modules.Notification;
using Pixous.HrPortal.Domain.Modules.TaskModule;
using Pixous.HrPortal.Domain.Security;
using Pixous.HrPortal.Infrastructure.Reporting;

namespace Pixous.HrPortal.Infrastructure.Modules.TaskModule;

/// <summary>
/// Ported from TaskService, TaskChatService and TaskWorkloadService.
///
/// The judgements are in <see cref="TaskRules"/>; this fetches the rows they
/// need, writes the results back and tells people.
/// </summary>
public sealed class TaskBal : ITaskBal
{
    private readonly ITaskDal _dal;
    private readonly ICurrentUser _currentUser;
    private readonly INotificationBal _notifications;
    private readonly ISmsService _sms;
    private readonly IRealtimePublisher _realtime;

    public TaskBal(ITaskDal dal, ICurrentUser currentUser, INotificationBal notifications,
                   ISmsService sms, IRealtimePublisher realtime)
    {
        _dal = dal;
        _currentUser = currentUser;
        _notifications = notifications;
        _sms = sms;
        _realtime = realtime;
    }

    private bool IsAdmin => _currentUser.HasPermission("USER_MANAGE");
    private bool IsHr => _currentUser.HasPermission("TASK_VIEW_ALL");

    // ---- the employee's own work -------------------------------------------

    public async Task<IReadOnlyList<TaskResponse>> MineAsync(long userId,
                                                             CancellationToken ct = default)
    {
        IReadOnlyList<TaskRow> rows = await _dal.FindForAssigneeAsync(userId, ct);
        return await ToResponsesAsync(rows, ct);
    }

    public async Task<TaskResponse> CompleteAsync(long userId, long taskId,
                                                  CancellationToken ct = default)
    {
        TaskRow t = await RequireAsync(taskId, ct);

        if (t.AssignedTo != userId)
        {
            throw ApiException.Business("You can only complete tasks assigned to you");
        }

        // Already complete is a no-op rather than an error, and notably does NOT
        // re-notify -- the Java guards the whole block on this.
        if (t.Status != "COMPLETED")
        {
            t.Status = "COMPLETED";
            t.Progress = 100;
            t.CompletedAt = DateTime.Now;
            await _dal.UpdateAsync(t, ct);

            await NotifyAssignerOfCompletionAsync(t, userId, ct);
        }

        return await ToResponseAsync(t, ct);
    }

    public async Task<TaskResponse> UpdateProgressAsync(long userId, long taskId, int progress,
                                                        CancellationToken ct = default)
    {
        TaskRow t = await RequireAsync(taskId, ct);

        if (t.AssignedTo != userId)
        {
            throw ApiException.Business("You can only update tasks assigned to you");
        }

        int p = TaskRules.ClampProgress(progress);
        string implied = TaskRules.StatusForProgress(p);

        // Progress carries a status with it, so the same one-way rule applies:
        // reporting 40% on a finished task would otherwise reopen it.
        RequireForward(t, implied);

        t.Progress = p;
        t.Status = implied;
        t.CompletedAt = implied == "COMPLETED" ? t.CompletedAt ?? DateTime.Now : null;

        await _dal.UpdateAsync(t, ct);

        if (t.AssignedBy is not null)
        {
            string who = (await _dal.FindPersonAsync(userId, ct))?.Name ?? "An employee";

            await _notifications.CreateAndPushAsync(
                t.AssignedBy.Value, "Task progress updated",
                $"{who} set \"{t.Title}\" to {p}%", "TASK", "/tasks", ct);
        }

        return await ToResponseAsync(t, ct);
    }

    // ---- assigning and managing --------------------------------------------

    public async Task<TaskResponse> AssignAsync(long assignerId, TaskRequest request,
                                                CancellationToken ct = default)
    {
        TaskPerson assignee = await _dal.FindPersonAsync(request.AssignedTo, ct)
            ?? throw ApiException.NotFound("Employee");

        TaskPerson? assigner = await _dal.FindPersonAsync(assignerId, ct);

        AssignmentCheck check = TaskRules.CanAssign(
            IsAdmin, IsHr, assignee.IsTeamLeader,
            assigner?.DesignationTitle, assignee.DesignationTitle);

        if (!check.IsAllowed)
        {
            throw ApiException.Business(check.Reason!);
        }

        // A task's due date cannot be earlier than the day it is assigned.
        if (request.DueDate is not null
            && request.DueDate.Value < DateOnly.FromDateTime(DateTime.Now))
        {
            throw ApiException.Business("Due date cannot be in the past");
        }

        var t = new TaskRow
        {
            Title = request.Title.Trim(),
            Description = request.Description,
            AssignedTo = assignee.Id,
            AssignedBy = assignerId,
            DueDate = request.DueDate,
            Status = "PENDING",
            Progress = 0,
            Priority = TaskRules.NormalisePriority(request.Priority)
        };

        // Team identity travels only when this is one member of a batch.
        if (!string.IsNullOrWhiteSpace(request.TeamBatchId))
        {
            t.TeamBatchId = request.TeamBatchId.Trim();
            t.TeamName = string.IsNullOrWhiteSpace(request.TeamName)
                ? null
                : request.TeamName.Trim();
        }

        await _dal.InsertAsync(t, ct);

        await _notifications.CreateAndPushAsync(
            assignee.Id, "New task assigned", t.Title, "TASK", "/tasks", ct);

        string due = t.DueDate is not null ? $". Due: {t.DueDate:yyyy-MM-dd}" : "";

        await SmsAsync(assignee.Phone,
            $"Hi {assignee.Name}, a new task has been assigned to you: \"{t.Title}\"."
            + $" Employee ID: {assignee.EmployeeCode}{due}.", ct);

        return await ToResponseAsync(t, ct);
    }

    public async Task<TaskResponse> UpdateTaskAsync(long editorId, long taskId,
                                                    TaskUpdateRequest request,
                                                    CancellationToken ct = default)
    {
        TaskRow t = await RequireAsync(taskId, ct);

        // Admins may edit any task; everybody else only their own assignments.
        if (!IsAdmin && (t.AssignedBy is null || t.AssignedBy != editorId))
        {
            throw ApiException.Business("You can only edit tasks you assigned");
        }

        t.Title = request.Title;
        t.Description = request.Description;
        t.DueDate = request.DueDate;

        if (!string.IsNullOrWhiteSpace(request.Priority))
        {
            t.Priority = request.Priority.Trim().ToUpperInvariant();
        }

        ApplyStatus(t, request.Status);

        await _dal.UpdateAsync(t, ct);

        string editor = (await _dal.FindPersonAsync(editorId, ct))?.Name ?? "Your manager";
        string due = t.DueDate is not null ? $". Due: {t.DueDate:yyyy-MM-dd}" : "";

        // The assignee is working to this task, so tell them it changed.
        await _notifications.CreateAndPushAsync(
            t.AssignedTo, "Task updated", $"{editor} updated \"{t.Title}\"{due}",
            "TASK", "/tasks", ct);

        TaskPerson? assignee = await _dal.FindPersonAsync(t.AssignedTo, ct);
        await SmsAsync(assignee?.Phone,
            $"{editor} updated your task \"{t.Title}\"{due}.", ct);

        return await ToResponseAsync(t, ct);
    }

    /// <summary>
    /// Moves a task to a named state, keeping progress in step.
    /// A blank status leaves both alone — progress belongs to the assignee.
    /// </summary>
    private static void ApplyStatus(TaskRow t, string? status)
    {
        if (string.IsNullOrWhiteSpace(status))
        {
            return;
        }

        if (!TaskRules.TryNormaliseStatus(status, out string normalised))
        {
            throw ApiException.Business($"Unknown status: {status}");
        }

        RequireForward(t, normalised);

        t.Progress = TaskRules.ProgressFor(normalised, t.Progress);
        t.Status = normalised;

        t.CompletedAt = normalised == "COMPLETED"
            ? t.CompletedAt ?? DateTime.Now
            : null;
    }

    /// <summary>
    /// Refuses a move backwards. A task that was started was started, and one
    /// that is finished is finished; saying otherwise later is rewriting what
    /// happened.
    /// </summary>
    private static void RequireForward(TaskRow t, string target)
    {
        if (!TaskRules.IsForward(t.Status, target))
        {
            throw ApiException.Business(
                $"A task cannot go back to {TaskRules.Humanise(target)} "
                + $"once it is {TaskRules.Humanise(t.Status)}");
        }
    }

    public async Task<IReadOnlyList<EmployeeTaskGroup>> EveryoneAsync(
        string? industry, string? q, CancellationToken ct = default)
    {
        IReadOnlyList<TaskRow> all = await _dal.FindAllAsync(ct);

        IReadOnlyDictionary<long, TaskPerson> people = await _dal.FindPeopleAsync(
            all.Select(t => t.AssignedTo).Distinct().ToArray(), ct);

        // A Team Leader sees only their own team; admins and HR see everybody.
        string? scopeTitle = null;

        if (!IsAdmin && !IsHr)
        {
            long? me = _currentUser.UserId;
            string? myTeam = me is null
                ? null
                : (await _dal.FindPersonAsync(me.Value, ct))?.DesignationTitle;

            // A leader with no team recorded matches nothing rather than
            // everything -- the Java's " none " sentinel, spelled as a value
            // that cannot equal a real designation title.
            scopeTitle = string.IsNullOrWhiteSpace(myTeam) ? " none " : myTeam.Trim();
        }

        string? wantIndustry = TaskRules.NormaliseIndustry(industry);
        string? needle = string.IsNullOrWhiteSpace(q) ? null : q.Trim().ToLowerInvariant();

        // Grouped per employee while preserving most-recent-first ordering.
        var byUser = new Dictionary<long, List<TaskRow>>();
        var order = new List<long>();

        foreach (TaskRow t in all)
        {
            if (!byUser.TryGetValue(t.AssignedTo, out List<TaskRow>? list))
            {
                list = [];
                byUser[t.AssignedTo] = list;
                order.Add(t.AssignedTo);
            }

            list.Add(t);
        }

        var result = new List<EmployeeTaskGroup>();

        foreach (long userId in order)
        {
            people.TryGetValue(userId, out TaskPerson? u);

            string name = u?.Name ?? "?";
            string code = u?.EmployeeCode ?? "?";

            if (wantIndustry is not null
                && !string.Equals(wantIndustry, u?.Industry, StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            if (scopeTitle is not null && !TaskRules.SameTeam(scopeTitle, u?.DesignationTitle))
            {
                continue;
            }

            if (needle is not null
                && !name.ToLowerInvariant().Contains(needle)
                && !code.ToLowerInvariant().Contains(needle))
            {
                continue;
            }

            IReadOnlyList<TaskResponse> rows = await ToResponsesAsync(byUser[userId], ct);

            int pending = rows.Count(r => r.Status == "PENDING");

            result.Add(new EmployeeTaskGroup(userId, name, code, u?.Industry,
                                             rows.Count, pending, rows.Count - pending, rows));
        }

        return result;
    }

    public async Task<byte[]> ExportExcelAsync(string? industry, DateOnly? from, DateOnly? to, CancellationToken ct = default)
    {
        IReadOnlyList<TaskRow> all = await _dal.FindAllAsync(ct);

        var userIds = all.Select(t => t.AssignedTo)
            .Concat(all.Where(t => t.AssignedBy.HasValue).Select(t => t.AssignedBy!.Value))
            .Distinct().ToArray();

        IReadOnlyDictionary<long, TaskPerson> people = await _dal.FindPeopleAsync(userIds, ct);

        string? wantIndustry = !string.IsNullOrWhiteSpace(industry) ? industry.Trim().ToUpperInvariant() : null;

        var headers = new List<string>
        {
            "Employee", "Employee Code", "Team", "Task", "Description",
            "Status", "Priority", "Due Date", "Assigned Date", "Assigned By"
        };

        var rows = new List<IReadOnlyList<object?>>();

        foreach (TaskRow t in all)
        {
            people.TryGetValue(t.AssignedTo, out TaskPerson? u);
            string? empIndustry = u?.Industry?.Trim().ToUpperInvariant();
            if (wantIndustry is not null && !string.Equals(wantIndustry, empIndustry, StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            DateOnly? createdDate = t.CreatedAt.HasValue ? DateOnly.FromDateTime(t.CreatedAt.Value) : null;
            if (from.HasValue && (createdDate is null || createdDate.Value < from.Value)) continue;
            if (to.HasValue && (createdDate is null || createdDate.Value > to.Value)) continue;

            string teamName = !string.IsNullOrWhiteSpace(t.TeamName)
                ? t.TeamName
                : (u?.DesignationTitle ?? string.Empty);

            string? assignedByName = t.AssignedBy.HasValue && people.TryGetValue(t.AssignedBy.Value, out TaskPerson? assigner)
                ? assigner.Name
                : null;

            rows.Add(new object?[]
            {
                u?.Name ?? "?",
                u?.EmployeeCode ?? string.Empty,
                teamName,
                t.Title ?? string.Empty,
                t.Description ?? string.Empty,
                t.Status ?? string.Empty,
                t.Priority ?? string.Empty,
                t.DueDate?.ToString("yyyy-MM-dd") ?? string.Empty,
                createdDate?.ToString("yyyy-MM-dd") ?? string.Empty,
                assignedByName ?? string.Empty
            });
        }

        return OpenXmlWorkbookBuilder.Create("Tasks", headers, rows);
    }

    public async Task DeleteAsync(long taskId, CancellationToken ct = default)

    {
        _ = await RequireAsync(taskId, ct);
        await _dal.DeleteAsync(taskId, ct);
    }

    public async Task DeleteTeamBatchAsync(string batchId, CancellationToken ct = default)
    {
        IReadOnlyList<TaskRow> batch = await _dal.FindByBatchAsync(batchId, ct);

        if (batch.Count == 0)
        {
            throw ApiException.NotFound("Team task");
        }

        await _dal.DeleteBatchAsync(batchId, ct);
    }

    // ---- the conversation ---------------------------------------------------

    public async Task<IReadOnlyList<TaskMessageView>> MessagesAsync(
        long taskId, long? requesterId, CancellationToken ct = default)
    {
        TaskRow t = await RequireAsync(taskId, ct);
        await RequireCanJoinAsync(t, requesterId, ct);

        IReadOnlyList<TaskMessageRow> rows = await _dal.FindMessagesAsync(taskId, ct);

        IReadOnlyDictionary<long, TaskPerson> senders = await _dal.FindPeopleAsync(
            rows.Select(m => m.SenderId).Distinct().ToArray(), ct);

        return rows.Select(m => ToView(m, senders.GetValueOrDefault(m.SenderId))).ToArray();
    }

    public async Task<TaskMessageView> SendMessageAsync(
        long taskId, long senderId, string? content, IReadOnlyList<string>? attachmentPaths,
        CancellationToken ct = default)
    {
        TaskRow t = await RequireAsync(taskId, ct);
        await RequireCanJoinAsync(t, senderId, ct);

        string text = (content ?? "").Trim();
        bool hasFiles = attachmentPaths is { Count: > 0 };

        if (text.Length == 0 && !hasFiles)
        {
            throw ApiException.Business("Type something, or attach a file.");
        }

        var m = new TaskMessageRow
        {
            TaskId = taskId,
            SenderId = senderId,
            Content = text.Length == 0 ? null : text,
            Attachments = hasFiles ? string.Join(",", attachmentPaths!) : null,
            SentAt = DateTime.Now
        };

        await _dal.InsertMessageAsync(m, ct);

        TaskPerson? sender = await _dal.FindPersonAsync(senderId, ct);
        TaskMessageView view = ToView(m, sender);

        // Live, to anybody with the task open. A failed broadcast must not lose
        // the message, which is already saved.
        try
        {
            await _realtime.SendAsync($"/topic/tasks/{taskId}", view, ct);
        }
        catch
        {
            // Deliberately swallowed, as the Java logs and continues.
        }

        await NotifyOthersAsync(t, senderId, sender?.Name ?? "Someone",
                                text.Length == 0 ? "sent a file" : text, ct);

        return view;
    }

    public async Task<IReadOnlyDictionary<string, long>> MessageCountsAsync(
        IReadOnlyList<long>? taskIds, CancellationToken ct = default)
    {
        if (taskIds is null || taskIds.Count == 0)
        {
            return new Dictionary<string, long>();
        }

        IReadOnlyDictionary<long, long> counts = await _dal.CountMessagesAsync(taskIds, ct);

        // Keyed by id AS A STRING, which is what the Java's map produces and
        // what the badge reads.
        return counts.ToDictionary(e => e.Key.ToString(), e => e.Value);
    }

    /// <summary>
    /// Who may take part, decided by the work rather than by rank.
    /// </summary>
    private async Task RequireCanJoinAsync(TaskRow t, long? userId, CancellationToken ct)
    {
        if (userId is null)
        {
            throw ApiException.Business("Sign in first.");
        }

        TaskPerson? me = await _dal.FindPersonAsync(userId.Value, ct);

        if (me is null)
        {
            throw ApiException.Business("Sign in first.");
        }

        // Only resolved when it might matter -- the assignee's team is needed
        // solely for the Team Leader arm.
        string? assigneeTeam = me.IsTeamLeader
            ? (await _dal.FindPersonAsync(t.AssignedTo, ct))?.DesignationTitle
            : null;

        bool allowed = TaskRules.CanJoinConversation(
            userId, t.AssignedTo, t.AssignedBy, IsAdmin, IsHr, me.EmployeeCode,
            me.IsTeamLeader, me.DesignationTitle, assigneeTeam);

        if (!allowed)
        {
            throw ApiException.Business(
                "This conversation belongs to the people working on the task.");
        }
    }

    /// <summary>
    /// Tells the other side. The assignee and the assigner are both told, minus
    /// whoever just spoke — being notified of your own message is the fastest
    /// way to make people mute a feature.
    /// </summary>
    private async Task NotifyOthersAsync(TaskRow t, long senderId, string senderName,
                                         string preview, CancellationToken ct)
    {
        var recipients = new List<long>();

        if (t.AssignedTo != senderId)
        {
            recipients.Add(t.AssignedTo);
        }

        if (t.AssignedBy is not null && t.AssignedBy != senderId
            && !recipients.Contains(t.AssignedBy.Value))
        {
            recipients.Add(t.AssignedBy.Value);
        }

        foreach (long id in recipients)
        {
            try
            {
                await _notifications.CreateAndPushAsync(
                    id, $"Task: {t.Title}",
                    $"{senderName}: {TaskRules.Preview(preview)}",
                    "TASK", $"/tasks?chat={t.Id}", ct);
            }
            catch
            {
                // One failed notification must not lose the message.
            }
        }
    }

    // ---- workload -----------------------------------------------------------

    public async Task<IReadOnlyList<WorkloadRow>> WorkloadAsync(long? requesterId,
                                                                CancellationToken ct = default)
    {
        IReadOnlyList<TaskRow> open = await _dal.FindOpenAsync(ct);

        if (open.Count == 0)
        {
            return [];
        }

        IReadOnlyDictionary<long, TaskPerson> people = await _dal.FindPeopleAsync(
            open.Select(t => t.AssignedTo).Distinct().ToArray(), ct);

        IReadOnlySet<long> visible = await VisibleAssigneesAsync(requesterId, people.Values, ct);

        DateOnly today = DateOnly.FromDateTime(DateTime.Now);

        var tally = new Dictionary<long, (int Active, int Overdue, int DueSoon)>();
        var order = new List<long>();

        foreach (TaskRow t in open)
        {
            if (!visible.Contains(t.AssignedTo))
            {
                continue;
            }

            if (!tally.TryGetValue(t.AssignedTo, out var counts))
            {
                counts = (0, 0, 0);
                order.Add(t.AssignedTo);
            }

            // Every open task counts as active; the due-date buckets are extra
            // detail on top, not alternatives to it.
            counts.Active++;

            switch (TaskRules.Bucket(t.DueDate, today))
            {
                case WorkloadBucket.Overdue:
                    counts.Overdue++;
                    break;
                case WorkloadBucket.DueSoon:
                    counts.DueSoon++;
                    break;
            }

            tally[t.AssignedTo] = counts;
        }

        return order
            .Select(userId =>
            {
                var c = tally[userId];
                people.TryGetValue(userId, out TaskPerson? u);

                return new WorkloadRow(userId, u?.Name ?? "Unknown", u?.EmployeeCode,
                                       u?.DesignationTitle, c.Active, c.Overdue, c.DueSoon);
            })
            .OrderByDescending(r => r.ActiveCount)
            .ToArray();
    }

    /// <summary>Whose workload this caller is entitled to see.</summary>
    private async Task<IReadOnlySet<long>> VisibleAssigneesAsync(
        long? requesterId, IEnumerable<TaskPerson> candidates, CancellationToken ct)
    {
        TaskPerson[] all = candidates.ToArray();

        if (IsAdmin || IsHr)
        {
            return all.Select(u => u.Id).ToHashSet();
        }

        if (requesterId is null)
        {
            return new HashSet<long>();
        }

        TaskPerson? me = await _dal.FindPersonAsync(requesterId.Value, ct);

        if (me is null)
        {
            return new HashSet<long>();
        }

        if (TaskRules.IsCompanyHead(me.EmployeeCode))
        {
            return all.Select(u => u.Id).ToHashSet();
        }

        // No team recorded means they see only themselves, rather than nobody.
        if (string.IsNullOrWhiteSpace(me.DesignationTitle))
        {
            return new HashSet<long> { requesterId.Value };
        }

        return all.Where(u => TaskRules.SameTeam(me.DesignationTitle, u.DesignationTitle))
                  .Select(u => u.Id)
                  .ToHashSet();
    }

    // ---- due-date reminders -------------------------------------------------

    public async Task<ReminderSettings> ReminderSettingsAsync(CancellationToken ct = default)
    {
        string? enabled = await _dal.FindSettingAsync(ReminderRules.EnabledKey, ct);
        string? time = await _dal.FindSettingAsync(ReminderRules.TimeKey, ct);
        string? lead = await _dal.FindSettingAsync(ReminderRules.LeadDaysKey, ct);

        // Unset means ON, which is the Java's default -- a missing row must not
        // silently stop reminders that were never switched off.
        bool on = !string.Equals(enabled, "false", StringComparison.OrdinalIgnoreCase);

        TimeOnly at = ReminderRules.TryParseTime(time, out TimeOnly parsed)
            ? parsed
            : ReminderRules.DefaultTime;

        int leadDays = int.TryParse(lead, out int n) ? n : ReminderRules.DefaultLeadDays;

        return new ReminderSettings(on, at.ToString("HH:mm"), leadDays);
    }

    public async Task<ReminderSettings> SaveReminderSettingsAsync(
        bool enabled, string? time, int? leadDays, CancellationToken ct = default)
    {
        if (!ReminderRules.TryParseTime(time, out TimeOnly parsed))
        {
            throw ApiException.Business("Give the time as HH:mm, for example 09:30.");
        }

        int lead = leadDays ?? ReminderRules.DefaultLeadDays;

        if (!ReminderRules.IsValidLeadDays(lead))
        {
            throw ApiException.Business("Remind between 0 and 30 days before the due date.");
        }

        await _dal.SaveSettingAsync(ReminderRules.EnabledKey,
                                    enabled ? "true" : "false", ct);
        await _dal.SaveSettingAsync(ReminderRules.TimeKey, parsed.ToString("HH:mm"), ct);
        await _dal.SaveSettingAsync(ReminderRules.LeadDaysKey, lead.ToString(), ct);

        return await ReminderSettingsAsync(ct);
    }

    public async Task<int> RunRemindersAsync(CancellationToken ct = default)
    {
        DateOnly today = DateOnly.FromDateTime(DateTime.Now);
        ReminderSettings settings = await ReminderSettingsAsync(ct);

        IReadOnlyList<TaskRow> open = await _dal.FindOpenAsync(ct);

        IReadOnlyDictionary<long, TaskPerson> people = await _dal.FindPeopleAsync(
            open.Select(t => t.AssignedTo)
                .Concat(open.Where(t => t.AssignedBy is not null).Select(t => t.AssignedBy!.Value))
                .Distinct().ToArray(), ct);

        int sent = 0;

        foreach (TaskRow t in open)
        {
            if (t.DueDate is null || !people.TryGetValue(t.AssignedTo, out TaskPerson? assignee))
            {
                continue;
            }

            DateOnly due = t.DueDate.Value;
            ReminderKind kind = ReminderRules.KindFor(due, today, settings.LeadDays);

            // Already sent today? The day is written against the task as each
            // goes out, so a second run -- manual or after a restart -- is a
            // no-op rather than a repeat.
            bool alreadySent = kind switch
            {
                ReminderKind.Overdue => t.RemindedOverdue == today,
                ReminderKind.DueToday => t.RemindedDue == today,
                ReminderKind.DueSoon => t.RemindedBefore == today,
                _ => true
            };

            if (kind == ReminderKind.None || alreadySent)
            {
                continue;
            }

            (string title, string body) = kind switch
            {
                ReminderKind.Overdue => ("Task overdue",
                    $"\"{t.Title}\" was due on {due:yyyy-MM-dd} \u2014 "
                    + $"{ReminderRules.Days(today.DayNumber - due.DayNumber)} late."),
                ReminderKind.DueToday => ("Task due today", $"\"{t.Title}\" is due today."),
                _ => ("Task due soon",
                    $"\"{t.Title}\" is due in "
                    + $"{ReminderRules.Days(due.DayNumber - today.DayNumber)} ({due:yyyy-MM-dd}).")
            };

            await NudgeAsync(t, assignee, title, body, ct);
            await _dal.StampReminderAsync(t.Id, kind, today, ct);

            // An overdue task is the assigner's problem too, so they hear once.
            if (kind == ReminderKind.Overdue)
            {
                await AlsoTellAssignerAsync(t, assignee, people, ct);
            }

            sent++;
        }

        return sent;
    }

    /// <summary>
    /// Nudges the assignee. Never throws: one unreachable person must not stop
    /// the rest of the run.
    /// </summary>
    private async Task NudgeAsync(TaskRow task, TaskPerson assignee, string title, string body,
                                  CancellationToken ct)
    {
        try
        {
            await _notifications.CreateAndPushAsync(assignee.Id, title, body, "TASK",
                                                    $"/tasks?chat={task.Id}", ct);

            await SmsAsync(assignee.Phone, $"Hi {assignee.Name}, {body}", ct);
        }
        catch
        {
            // As the Java logs and continues.
        }
    }

    private async Task AlsoTellAssignerAsync(TaskRow task, TaskPerson assignee,
                                             IReadOnlyDictionary<long, TaskPerson> people,
                                             CancellationToken ct)
    {
        if (task.AssignedBy is null || task.AssignedBy == assignee.Id)
        {
            return;
        }

        try
        {
            await _notifications.CreateAndPushAsync(
                task.AssignedBy.Value, "Task overdue",
                $"{assignee.Name} has not finished \"{task.Title}\", "
                + $"due {task.DueDate:yyyy-MM-dd}.",
                "TASK", $"/tasks?chat={task.Id}", ct);
        }
        catch
        {
            // As above.
        }
    }

    // ---- plumbing -----------------------------------------------------------

    private async Task<TaskRow> RequireAsync(long taskId, CancellationToken ct) =>
        await _dal.FindAsync(taskId, ct) ?? throw ApiException.NotFound("Task");

    private async Task NotifyAssignerOfCompletionAsync(TaskRow t, long userId,
                                                       CancellationToken ct)
    {
        if (t.AssignedBy is null)
        {
            return;
        }

        string who = (await _dal.FindPersonAsync(userId, ct))?.Name ?? "An employee";

        await _notifications.CreateAndPushAsync(
            t.AssignedBy.Value, "Task completed", $"{who} completed: {t.Title}",
            "TASK", "/tasks", ct);

        TaskPerson? assigner = await _dal.FindPersonAsync(t.AssignedBy.Value, ct);
        await SmsAsync(assigner?.Phone, $"{who} completed the task \"{t.Title}\".", ct);
    }

    private async Task SmsAsync(string? phone, string message, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(phone))
        {
            return;
        }

        try
        {
            await _sms.SendAsync(phone, "Pixous HR: " + message, ct);
        }
        catch
        {
            // Fire and forget, as the Java has it.
        }
    }

    private async Task<IReadOnlyList<TaskResponse>> ToResponsesAsync(
        IReadOnlyList<TaskRow> rows, CancellationToken ct)
    {
        if (rows.Count == 0)
        {
            return [];
        }

        // Every person these rows mention, in one query rather than one per row.
        long[] ids = rows.Select(t => t.AssignedTo)
                         .Concat(rows.Where(t => t.AssignedBy is not null)
                                     .Select(t => t.AssignedBy!.Value))
                         .Distinct()
                         .ToArray();

        IReadOnlyDictionary<long, TaskPerson> people = await _dal.FindPeopleAsync(ids, ct);

        return rows.Select(t => Build(t, people)).ToArray();
    }

    private async Task<TaskResponse> ToResponseAsync(TaskRow t, CancellationToken ct)
    {
        long[] ids = t.AssignedBy is null ? [t.AssignedTo] : [t.AssignedTo, t.AssignedBy.Value];
        IReadOnlyDictionary<long, TaskPerson> people = await _dal.FindPeopleAsync(ids, ct);
        return Build(t, people);
    }

    private static TaskResponse Build(TaskRow t, IReadOnlyDictionary<long, TaskPerson> people)
    {
        people.TryGetValue(t.AssignedTo, out TaskPerson? assignee);

        TaskPerson? assigner = t.AssignedBy is not null
                            && people.TryGetValue(t.AssignedBy.Value, out TaskPerson? a)
            ? a
            : null;

        return new TaskResponse(
            t.Id, t.Title, t.Description, t.AssignedTo,
            assignee?.Name ?? "?", assignee?.EmployeeCode ?? "?", assignee?.Industry,
            t.AssignedBy, assigner?.Name,
            t.Status, t.Progress, t.Priority, t.DueDate, t.CreatedAt, t.CompletedAt,
            t.TeamBatchId, t.TeamName);
    }

    private static TaskMessageView ToView(TaskMessageRow m, TaskPerson? sender) =>
        new(m.Id, m.TaskId, m.SenderId, sender?.Name ?? "Unknown", sender?.EmployeeCode,
            m.Content, m.Attachments, m.SentAt);
}
