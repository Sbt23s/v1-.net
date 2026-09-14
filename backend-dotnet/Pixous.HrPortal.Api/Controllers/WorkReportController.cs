using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Pixous.HrPortal.Domain.Common;
using Pixous.HrPortal.Domain.Modules.WorkReport;
using Pixous.HrPortal.Domain.Security;

namespace Pixous.HrPortal.Api.Controllers;

/// <summary>
/// Daily work reports, ported from
/// com.pixous.hrportal.modules.workreport.WorkReportController.
/// </summary>
[ApiController]
[Route("api/work-reports")]
[Authorize]
public sealed class WorkReportController : ControllerBase
{
    private readonly IWorkReportBal _reports;
    private readonly IStorageService _storage;
    private readonly ICurrentUser _currentUser;

    public WorkReportController(
        IWorkReportBal reports,
        IStorageService storage,
        ICurrentUser currentUser)
    {
        _reports = reports;
        _storage = storage;
        _currentUser = currentUser;
    }

    [HttpGet("me")]
    public async Task<ApiResponse<IReadOnlyList<WorkReportResponse>>> Mine(CancellationToken ct) =>
        ApiResponse<IReadOnlyList<WorkReportResponse>>.Ok(
            await _reports.MineAsync(_currentUser.RequireUserId(), ct));

    [HttpPost]
    public async Task<ApiResponse<WorkReportResponse>> Create(
        [FromBody] WorkReportRequest request,
        CancellationToken ct) =>
        ApiResponse<WorkReportResponse>.Ok(
            await _reports.CreateAsync(_currentUser.RequireUserId(), request, ct),
            "Work report saved");

    [HttpPut("{id:long}")]
    public async Task<ApiResponse<WorkReportResponse>> Update(
        long id,
        [FromBody] WorkReportRequest request,
        CancellationToken ct) =>
        ApiResponse<WorkReportResponse>.Ok(
            await _reports.UpdateAsync(_currentUser.RequireUserId(), id, request, ct),
            "Work report updated");

    [HttpDelete("{id:long}")]
    public async Task<ApiResponse<object>> Delete(long id, CancellationToken ct)
    {
        await _reports.DeleteAsync(_currentUser.RequireUserId(), id, ct);
        return ApiResponse.Message("Work report deleted");
    }

    [HttpPost("{id:long}/attachments")]
    public async Task<ApiResponse<WorkReportResponse>> AddAttachments(
        long id,
        IFormFileCollection? files,
        [FromForm] List<string>? links,
        CancellationToken ct)
    {
        List<string> paths = new();

        if (files != null)
        {
            foreach (IFormFile file in files)
            {
                if (file.Length > 0)
                {
                    using Stream stream = file.OpenReadStream();
                    string path = await _storage.StoreAsync(
                        stream,
                        file.FileName,
                        file.ContentType,
                        file.Length,
                        "work-reports",
                        ct);
                    paths.Add(path);
                }
            }
        }

        if (links != null)
        {
            foreach (string link in links)
            {
                if (string.IsNullOrWhiteSpace(link)) continue;
                string trimmed = link.Trim();
                if (!trimmed.StartsWith("http://", StringComparison.OrdinalIgnoreCase)
                    && !trimmed.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
                {
                    throw ApiException.Business("A link must start with http:// or https://");
                }

                paths.Add(trimmed.Replace(",", "%2C"));
            }
        }

        int count = paths.Count;
        WorkReportResponse updated = await _reports.AddAttachmentsAsync(
            _currentUser.RequireUserId(), id, paths, ct);

        return ApiResponse<WorkReportResponse>.Ok(
            updated,
            count == 1 ? "Attached" : $"{count} items attached");
    }

    [HttpDelete("{id:long}/attachments")]
    public async Task<ApiResponse<WorkReportResponse>> RemoveAttachment(
        long id,
        [FromQuery] string path,
        CancellationToken ct) =>
        ApiResponse<WorkReportResponse>.Ok(
            await _reports.RemoveAttachmentAsync(_currentUser.RequireUserId(), id, path, ct),
            "File removed");

    [HttpGet("team")]
    public async Task<ApiResponse<IReadOnlyList<EmployeeWorkList>>> MyTeam(
        [FromQuery] string? q,
        CancellationToken ct) =>
        ApiResponse<IReadOnlyList<EmployeeWorkList>>.Ok(
            await _reports.MyTeamAsync(_currentUser.RequireUserId(), q, ct));

    [HttpGet("all")]
    [Authorize(Policy = "REPORT_VIEW,USER_MANAGE")]
    public async Task<ApiResponse<IReadOnlyList<EmployeeWorkList>>> Everyone(
        [FromQuery] string? q,
        CancellationToken ct) =>
        ApiResponse<IReadOnlyList<EmployeeWorkList>>.Ok(
            await _reports.EveryoneAsync(q, ct));

    [HttpGet("reminder/pending")]
    [Authorize(Policy = "REPORT_VIEW,USER_MANAGE")]
    public async Task<ApiResponse<IReadOnlyDictionary<string, object?>>> ReminderPending(
        [FromQuery] DateOnly? date,
        CancellationToken ct) =>
        ApiResponse<IReadOnlyDictionary<string, object?>>.Ok(
            await _reports.GetReminderPendingAsync(date, ct));

    [HttpGet("reminder/settings")]
    [Authorize(Policy = "REPORT_VIEW,USER_MANAGE")]
    public async Task<ApiResponse<IReadOnlyDictionary<string, object?>>> ReminderSettings(
        CancellationToken ct) =>
        ApiResponse<IReadOnlyDictionary<string, object?>>.Ok(
            await _reports.GetReminderSettingsAsync(ct));

    [HttpPut("reminder/settings")]
    [Authorize(Policy = "REPORT_VIEW,USER_MANAGE")]
    public async Task<ApiResponse<IReadOnlyDictionary<string, object?>>> SaveReminderSettings(
        [FromBody] ReminderSettingsRequest body,
        CancellationToken ct)
    {
        bool on = body.Enabled ?? true;
        string time = string.IsNullOrWhiteSpace(body.Time) ? "18:30" : body.Time;
        await _reports.SaveReminderSettingsAsync(on, time, ct);

        return ApiResponse<IReadOnlyDictionary<string, object?>>.Ok(
            await _reports.GetReminderSettingsAsync(ct),
            "Reminder settings saved");
    }

    [HttpPost("reminder/send")]
    [Authorize(Policy = "REPORT_VIEW,USER_MANAGE")]
    public async Task<ApiResponse<IReadOnlyDictionary<string, object?>>> SendReminders(
        [FromQuery] DateOnly? date,
        CancellationToken ct)
    {
        int sent = await _reports.SendRemindersAsync(date, ct);
        var result = new Dictionary<string, object?> { ["sent"] = sent };
        string msg = sent == 0
            ? "Everybody has filed their report"
            : $"Reminded {sent} employee(s)";

        return ApiResponse<IReadOnlyDictionary<string, object?>>.Ok(result, msg);
    }

    [HttpGet("export")]
    [Authorize(Policy = "REPORT_VIEW,USER_MANAGE")]
    public async Task<IActionResult> Export(
        [FromQuery] DateOnly? from,
        [FromQuery] DateOnly? to,
        CancellationToken ct)
    {
        byte[] bytes = await _reports.ExportExcelAsync(from, to, ct);
        return File(
            bytes,
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "work-reports.xlsx");
    }

    public sealed record ReminderSettingsRequest(bool? Enabled, string? Time);
}
