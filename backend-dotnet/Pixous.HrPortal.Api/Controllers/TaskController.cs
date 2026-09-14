using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Pixous.HrPortal.Domain.Common;
using Pixous.HrPortal.Domain.Modules.TaskModule;
using Pixous.HrPortal.Domain.Security;

namespace Pixous.HrPortal.Api.Controllers;

/// <summary>
/// Tasks. Ported from TaskController.
///
/// Three levels: an employee works their own tasks, a Team Leader assigns
/// within their team, HR assigns to Team Leaders, and an admin does anything.
/// The tiers are NOT one widening scope -- see TaskRules.CanAssign.
///
/// The conversation endpoints carry no policy: who may take part is decided by
/// the WORK, in the BAL, so no route can forget it.
/// </summary>
[ApiController]
[Route("api/tasks")]
[Authorize]
public sealed class TaskController : ControllerBase
{
    private readonly ITaskBal _bal;
    private readonly ICurrentUser _currentUser;

    public TaskController(ITaskBal bal, ICurrentUser currentUser)
    {
        _bal = bal;
        _currentUser = currentUser;
    }

    // ---- the conversation on a task ----

    [HttpGet("{id:long}/messages")]
    public async Task<ApiResponse<IReadOnlyList<TaskMessageView>>> Messages(
        long id, CancellationToken ct) =>
        ApiResponse<IReadOnlyList<TaskMessageView>>.Ok(
            await _bal.MessagesAsync(id, _currentUser.UserId, ct));

    /// <summary>
    /// Posts a message.
    ///
    /// The Java accepts files here as multipart; uploads are deferred across
    /// this migration, so this takes the text and any ALREADY-STORED paths.
    /// </summary>
    [HttpPost("{id:long}/messages")]
    public async Task<ApiResponse<TaskMessageView>> SendMessage(
        long id, [FromBody] TaskMessageRequest? body, CancellationToken ct) =>
        ApiResponse<TaskMessageView>.Ok(
            await _bal.SendMessageAsync(id, _currentUser.RequireUserId(),
                                        body?.Content, body?.Attachments, ct));

    /// <summary>How many messages each of these tasks carries — for the badge.</summary>
    [HttpGet("messages/counts")]
    public async Task<ApiResponse<IReadOnlyDictionary<string, long>>> MessageCounts(
        [FromQuery] List<long>? ids, CancellationToken ct) =>
        ApiResponse<IReadOnlyDictionary<string, long>>.Ok(
            await _bal.MessageCountsAsync(ids, ct));

    // ---- how much work each person is carrying ----

    [HttpGet("workload")]
    public async Task<ApiResponse<IReadOnlyList<WorkloadRow>>> Workload(CancellationToken ct) =>
        ApiResponse<IReadOnlyList<WorkloadRow>>.Ok(
            await _bal.WorkloadAsync(_currentUser.UserId, ct));

    // ---- due-date reminders ----

    [HttpGet("reminder/settings")]
    [Authorize(Policy = "USER_MANAGE,TASK_VIEW_ALL,TASK_ASSIGN")]
    public async Task<ApiResponse<ReminderSettings>> ReminderSettings(CancellationToken ct) =>
        ApiResponse<ReminderSettings>.Ok(await _bal.ReminderSettingsAsync(ct));

    /// <summary>
    /// Saves them. A missing "enabled" reads as ON, and a missing "time" as
    /// 09:30 -- the Java's getOrDefault behaviour, kept so a partial body from
    /// the existing screen behaves the same.
    /// </summary>
    [HttpPut("reminder/settings")]
    [Authorize(Policy = "USER_MANAGE,TASK_VIEW_ALL")]
    public async Task<ApiResponse<ReminderSettings>> SaveReminderSettings(
        [FromBody] ReminderSettingsRequest? body, CancellationToken ct) =>
        ApiResponse<ReminderSettings>.Ok(
            await _bal.SaveReminderSettingsAsync(body?.Enabled ?? true,
                                                 body?.Time ?? "09:30",
                                                 body?.LeadDays, ct),
            "Reminder settings saved");

    /// <summary>Sends today's reminders now, without waiting for the hour.</summary>
    [HttpPost("reminder/send")]
    [Authorize(Policy = "USER_MANAGE,TASK_VIEW_ALL")]
    public async Task<ApiResponse<Dictionary<string, int>>> SendReminders(CancellationToken ct)
    {
        int sent = await _bal.RunRemindersAsync(ct);

        return ApiResponse<Dictionary<string, int>>.Ok(
            new Dictionary<string, int> { ["sent"] = sent },
            sent == 0 ? "Nothing is due a reminder today" : $"Sent {sent} reminder(s)");
    }

    // ---- employee: own tasks ----

    [HttpGet("me")]
    public async Task<ApiResponse<IReadOnlyList<TaskResponse>>> Mine(CancellationToken ct) =>
        ApiResponse<IReadOnlyList<TaskResponse>>.Ok(
            await _bal.MineAsync(_currentUser.RequireUserId(), ct));

    [HttpPost("{id:long}/complete")]
    public async Task<ApiResponse<TaskResponse>> Complete(long id, CancellationToken ct) =>
        ApiResponse<TaskResponse>.Ok(
            await _bal.CompleteAsync(_currentUser.RequireUserId(), id, ct),
            "Task marked complete");

    [HttpPost("{id:long}/progress")]
    public async Task<ApiResponse<TaskResponse>> Progress(
        long id, [FromBody] Dictionary<string, int>? body, CancellationToken ct)
    {
        int progress = body is not null && body.TryGetValue("progress", out int p) ? p : 0;

        return ApiResponse<TaskResponse>.Ok(
            await _bal.UpdateProgressAsync(_currentUser.RequireUserId(), id, progress, ct),
            "Progress updated");
    }

    // ---- assigning and managing ----

    [HttpPost]
    [Authorize(Policy = "USER_MANAGE,TASK_ASSIGN")]
    public async Task<ApiResponse<TaskResponse>> Assign(
        [FromBody] TaskRequest request, CancellationToken ct) =>
        ApiResponse<TaskResponse>.Ok(
            await _bal.AssignAsync(_currentUser.RequireUserId(), request, ct), "Task assigned");

    [HttpPut("{id:long}")]
    [Authorize(Policy = "USER_MANAGE,TASK_ASSIGN")]
    public async Task<ApiResponse<TaskResponse>> Update(
        long id, [FromBody] TaskUpdateRequest request, CancellationToken ct) =>
        ApiResponse<TaskResponse>.Ok(
            await _bal.UpdateTaskAsync(_currentUser.RequireUserId(), id, request, ct),
            "Task updated");

    [HttpGet("all")]
    [Authorize(Policy = "USER_MANAGE,TASK_ASSIGN,TASK_VIEW_ALL")]
    public async Task<ApiResponse<IReadOnlyList<EmployeeTaskGroup>>> Everyone(
        [FromQuery] string? industry, [FromQuery] string? q, CancellationToken ct) =>
        ApiResponse<IReadOnlyList<EmployeeTaskGroup>>.Ok(
            await _bal.EveryoneAsync(industry, q, ct));

    [HttpGet("export")]
    [Authorize(Policy = "USER_MANAGE,TASK_VIEW_ALL")]
    public async Task<IActionResult> Export(
        [FromQuery] string? industry,
        [FromQuery] DateOnly? from,
        [FromQuery] DateOnly? to,
        CancellationToken ct)
    {
        byte[] bytes = await _bal.ExportExcelAsync(industry, from, to, ct);
        return File(
            bytes,
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "tasks-export.xlsx");
    }


    [HttpDelete("{id:long}")]
    [Authorize(Policy = "USER_MANAGE")]
    public async Task<ApiResponse<object>> Delete(long id, CancellationToken ct)
    {
        await _bal.DeleteAsync(id, ct);
        return ApiResponse<object>.MessageOnly("Task deleted");
    }

    /// <summary>Deletes a whole team assignment — every member task sharing the batch id.</summary>
    [HttpDelete("team/{batchId}")]
    [Authorize(Policy = "USER_MANAGE")]
    public async Task<ApiResponse<object>> DeleteTeamBatch(string batchId, CancellationToken ct)
    {
        await _bal.DeleteTeamBatchAsync(batchId, ct);
        return ApiResponse<object>.MessageOnly("Team task deleted");
    }
}

/// <summary>
/// The reminder settings body. Every field optional, defaulting the way the
/// Java's getOrDefault does.
/// </summary>
public sealed record ReminderSettingsRequest
{
    public bool? Enabled { get; init; }
    public string? Time { get; init; }
    public int? LeadDays { get; init; }
}

/// <summary>Posting a message to a task's conversation.</summary>
public sealed record TaskMessageRequest
{
    public string? Content { get; init; }

    /// <summary>Already-stored paths. The upload itself is deferred.</summary>
    public List<string>? Attachments { get; init; }
}
