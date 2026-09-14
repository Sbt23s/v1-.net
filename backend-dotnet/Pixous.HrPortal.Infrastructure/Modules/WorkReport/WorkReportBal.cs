using Pixous.HrPortal.Domain.Common;
using Pixous.HrPortal.Domain.Modules.Notification;
using Pixous.HrPortal.Domain.Modules.WorkReport;
using Pixous.HrPortal.Infrastructure.Reporting;

namespace Pixous.HrPortal.Infrastructure.Modules.WorkReport;

/// <summary>
/// Work reports, ported from com.pixous.hrportal.modules.workreport.WorkReportService.
/// </summary>
public sealed class WorkReportBal : IWorkReportBal
{
    private const string EnabledKey = "workreport.reminder_enabled";
    private const string TimeKey = "workreport.reminder_time";
    private const string LastRunKey = "workreport.reminder_last_run";
    private const string DefaultTime = "18:30";

    private readonly IWorkReportDal _dal;
    private readonly IOversightNotifier _oversight;
    private readonly INotificationBal _notifications;
    private readonly ISmsService _sms;

    public WorkReportBal(
        IWorkReportDal dal,
        IOversightNotifier oversight,
        INotificationBal notifications,
        ISmsService sms)
    {
        _dal = dal;
        _oversight = oversight;
        _notifications = notifications;
        _sms = sms;
    }

    public async Task<WorkReportResponse> CreateAsync(long userId, WorkReportRequest req,
                                                     CancellationToken ct = default)
    {
        var report = new WorkReportRecord
        {
            UserId = userId,
            WorkDate = req.WorkDate,
            ProjectName = req.ProjectName,
            WorkHours = req.WorkHours ?? 0m,
            TaskDescription = req.TaskDescription,
            Attachments = req.Attachments
        };

        await _dal.InsertAsync(report, ct);

        WorkReportRecord? created = await _dal.FindAsync(report.Id, ct);
        WorkReportRecord resolved = created ?? report;

        string name = resolved.UserName ?? "?";
        string code = resolved.EmployeeCode ?? "?";

        await _oversight.NotifyCtoAsync(
            userId,
            "Work report logged",
            $"{name} logged {resolved.WorkHours}h on {resolved.ProjectName} ({resolved.WorkDate:yyyy-MM-dd})",
            "WORK_REPORT",
            "/work-reports",
            ct);

        return ToResponse(resolved, name, code);
    }

    public async Task<WorkReportResponse> UpdateAsync(long userId, long id, WorkReportRequest req,
                                                     CancellationToken ct = default)
    {
        WorkReportRecord existing = await RequireOwnAsync(userId, id, "edit", ct);

        existing.WorkDate = req.WorkDate;
        existing.ProjectName = req.ProjectName;
        existing.WorkHours = req.WorkHours ?? 0m;
        existing.TaskDescription = req.TaskDescription;
        existing.Attachments = req.Attachments;
        existing.UpdatedAt = DateTime.Now;

        await _dal.UpdateAsync(existing, ct);

        WorkReportRecord? updated = await _dal.FindAsync(id, ct);
        WorkReportRecord resolved = updated ?? existing;
        return ToResponse(resolved, resolved.UserName ?? "?", resolved.EmployeeCode ?? "?");
    }

    public async Task DeleteAsync(long userId, long id, CancellationToken ct = default)
    {
        await RequireOwnAsync(userId, id, "delete", ct);
        await _dal.DeleteAsync(id, ct);
    }

    public async Task<IReadOnlyList<WorkReportResponse>> MineAsync(long userId,
                                                                   CancellationToken ct = default)
    {
        IReadOnlyList<WorkReportRecord> rows = await _dal.FindForUserAsync(userId, null, null, ct);
        return rows.Select(r => ToResponse(r, r.UserName ?? "?", r.EmployeeCode ?? "?")).ToList();
    }

    public Task<IReadOnlyList<WorkReportRecord>> MineRangeAsync(long userId, DateOnly? from,
                                                                DateOnly? to,
                                                                CancellationToken ct = default) =>
        _dal.FindForUserAsync(userId, from, to, ct);

    public Task<IReadOnlyList<WorkReportRecord>> AllAsync(DateOnly? from, DateOnly? to,
                                                          CancellationToken ct = default) =>
        _dal.FindAllAsync(from, to, ct);

    public async Task<WorkReportResponse> AddAttachmentsAsync(long userId, long id,
                                                              IReadOnlyList<string> paths,
                                                              CancellationToken ct = default)
    {
        WorkReportRecord existing = await RequireOwnAsync(userId, id, "attach files to", ct);
        if (paths == null || paths.Count == 0)
        {
            throw ApiException.Business("No files were received");
        }

        List<string> current = SplitAttachments(existing.Attachments);
        foreach (string path in paths)
        {
            if (!string.IsNullOrWhiteSpace(path))
            {
                current.Add(path.Trim());
            }
        }

        existing.Attachments = current.Count > 0 ? string.Join(",", current) : null;
        existing.UpdatedAt = DateTime.Now;
        await _dal.UpdateAsync(existing, ct);

        WorkReportRecord? updated = await _dal.FindAsync(id, ct);
        WorkReportRecord resolved = updated ?? existing;
        return ToResponse(resolved, resolved.UserName ?? "?", resolved.EmployeeCode ?? "?");
    }

    public async Task<WorkReportResponse> RemoveAttachmentAsync(long userId, long id,
                                                                string path,
                                                                CancellationToken ct = default)
    {
        WorkReportRecord existing = await RequireOwnAsync(userId, id, "change the files on", ct);
        List<string> current = SplitAttachments(existing.Attachments)
            .Where(p => !string.Equals(p, path, StringComparison.Ordinal))
            .ToList();

        existing.Attachments = current.Count > 0 ? string.Join(",", current) : null;
        existing.UpdatedAt = DateTime.Now;
        await _dal.UpdateAsync(existing, ct);

        WorkReportRecord? updated = await _dal.FindAsync(id, ct);
        WorkReportRecord resolved = updated ?? existing;
        return ToResponse(resolved, resolved.UserName ?? "?", resolved.EmployeeCode ?? "?");
    }

    public async Task<IReadOnlyList<EmployeeWorkList>> MyTeamAsync(long userId, string? q,
                                                                   CancellationToken ct = default)
    {
        IReadOnlyList<long> teammateIds = await _dal.FindTeammateUserIdsAsync(userId, ct);
        HashSet<long> teamSet = new(teammateIds);

        IReadOnlyList<EmployeeWorkList> all = await EveryoneAsync(q, ct);
        return all.Where(g => teamSet.Contains(g.UserId)).ToList();
    }

    public async Task<IReadOnlyList<EmployeeWorkList>> EveryoneAsync(string? q,
                                                                     CancellationToken ct = default)
    {
        IReadOnlyList<WorkReportRecord> all = await _dal.FindAllDetailedAsync(ct);

        // Group while preserving most-recent-first ordering
        Dictionary<long, List<WorkReportRecord>> byUser = new();
        List<long> userOrder = new();

        foreach (WorkReportRecord w in all)
        {
            if (!byUser.TryGetValue(w.UserId, out List<WorkReportRecord>? list))
            {
                list = new List<WorkReportRecord>();
                byUser[w.UserId] = list;
                userOrder.Add(w.UserId);
            }
            list.Add(w);
        }

        string? needle = string.IsNullOrWhiteSpace(q) ? null : q.Trim().ToLowerInvariant();
        List<EmployeeWorkList> result = new();

        foreach (long uid in userOrder)
        {
            List<WorkReportRecord> userRows = byUser[uid];
            string name = userRows[0].UserName ?? "?";
            string code = userRows[0].EmployeeCode ?? "?";

            if (!string.IsNullOrEmpty(needle))
            {
                bool match = name.ToLowerInvariant().Contains(needle)
                             || code.ToLowerInvariant().Contains(needle);
                if (!match) continue;
            }

            List<WorkReportResponse> rows = userRows
                .Select(r => ToResponse(r, name, code))
                .ToList();

            decimal totalHours = userRows.Sum(r => r.WorkHours ?? 0m);

            result.Add(new EmployeeWorkList(uid, name, code, rows.Count, totalHours, rows));
        }

        return result;
    }

    public async Task<byte[]> ExportExcelAsync(DateOnly? from, DateOnly? to,
                                               CancellationToken ct = default)
    {
        IReadOnlyList<WorkReportRecord> all = await _dal.FindAllDetailedAsync(ct);

        List<string> headers = new()
        {
            "Date", "Employee", "Employee Code", "Team", "Project", "Hours", "Task / Module"
        };

        List<IReadOnlyList<object?>> rows = new();

        foreach (WorkReportRecord w in all)
        {
            if (from.HasValue && w.WorkDate < from.Value) continue;
            if (to.HasValue && w.WorkDate > to.Value) continue;

            rows.Add(new object?[]
            {
                w.WorkDate.ToString("yyyy-MM-dd"),
                w.UserName ?? "?",
                w.EmployeeCode ?? string.Empty,
                w.DesignationTitle ?? string.Empty,
                w.ProjectName ?? string.Empty,
                w.WorkHours ?? 0m,
                w.TaskDescription ?? string.Empty
            });
        }

        return OpenXmlWorkbookBuilder.Create("Work Reports", headers, rows);
    }

    public async Task<IReadOnlyDictionary<string, object?>> GetReminderSettingsAsync(
        CancellationToken ct = default)
    {
        string? enabledRaw = await _dal.GetSystemSettingAsync(EnabledKey, ct);
        bool enabled = enabledRaw == null || !string.Equals(enabledRaw, "false", StringComparison.OrdinalIgnoreCase);

        string? timeRaw = await _dal.GetSystemSettingAsync(TimeKey, ct);
        string time = string.IsNullOrWhiteSpace(timeRaw) ? DefaultTime : timeRaw.Trim();

        string? lastRun = await _dal.GetSystemSettingAsync(LastRunKey, ct);

        return new Dictionary<string, object?>
        {
            ["enabled"] = enabled,
            ["time"] = time,
            ["lastRun"] = string.IsNullOrWhiteSpace(lastRun) ? null : lastRun
        };
    }

    public async Task SaveReminderSettingsAsync(bool enabled, string time,
                                                CancellationToken ct = default)
    {
        if (!TimeOnly.TryParse(time, out TimeOnly parsed))
        {
            throw ApiException.Business("Give the time as HH:mm, for example 18:30.");
        }

        await _dal.UpsertSystemSettingAsync(EnabledKey, enabled.ToString().ToLowerInvariant(), ct);
        await _dal.UpsertSystemSettingAsync(TimeKey, parsed.ToString("HH:mm"), ct);
    }

    public async Task<IReadOnlyDictionary<string, object?>> GetReminderPendingAsync(
        DateOnly? date, CancellationToken ct = default)
    {
        DateOnly day = date ?? DateOnly.FromDateTime(DateTime.Today);
        bool isWeekend = day.DayOfWeek == DayOfWeek.Saturday || day.DayOfWeek == DayOfWeek.Sunday;
        bool isHoliday = await _dal.IsHolidayAsync(day, ct);
        bool isWorkingDay = !isWeekend && !isHoliday;

        IReadOnlyList<UnfiledUserRecord> missing = await _dal.FindUnfiledUsersAsync(day, ct);

        var pendingList = missing.Select(u => new Dictionary<string, object?>
        {
            ["userId"] = u.Id,
            ["name"] = u.Name,
            ["employeeCode"] = u.EmployeeCode,
            ["team"] = u.Team
        }).ToList();

        return new Dictionary<string, object?>
        {
            ["date"] = day.ToString("yyyy-MM-dd"),
            ["workingDay"] = isWorkingDay,
            ["pendingCount"] = missing.Count,
            ["pending"] = pendingList
        };
    }

    public async Task<int> SendRemindersAsync(DateOnly? date, CancellationToken ct = default)
    {
        DateOnly day = date ?? DateOnly.FromDateTime(DateTime.Today);
        IReadOnlyList<UnfiledUserRecord> missing = await _dal.FindUnfiledUsersAsync(day, ct);

        foreach (UnfiledUserRecord user in missing)
        {
            try
            {
                await _notifications.CreateAndPushAsync(
                    user.Id,
                    "Work report pending",
                    $"Your work report for {day:yyyy-MM-dd} has not been submitted yet.",
                    "WORK_REPORT",
                    "/work-reports",
                    ct);

                if (!string.IsNullOrWhiteSpace(user.Phone))
                {
                    await _sms.SendAsync(
                        user.Phone,
                        $"Pixous HR: Hi {user.Name}, your work report for {day:yyyy-MM-dd} is not submitted yet. Please fill it in the portal.",
                        ct);
                }
            }
            catch
            {
                // Silently skip individual nudge failures
            }
        }

        return missing.Count;
    }

    private async Task<WorkReportRecord> RequireOwnAsync(long userId, long id, string action,
                                                         CancellationToken ct)
    {
        WorkReportRecord report = await _dal.FindAsync(id, ct)
            ?? throw ApiException.NotFound("Work report");

        if (report.UserId != userId)
        {
            throw ApiException.Business($"You can only {action} your own work reports");
        }

        return report;
    }

    private static List<string> SplitAttachments(string? raw)
    {
        List<string> list = new();
        if (string.IsNullOrWhiteSpace(raw)) return list;
        foreach (string part in raw.Split(',', StringSplitOptions.RemoveEmptyEntries))
        {
            string trimmed = part.Trim();
            if (!string.IsNullOrEmpty(trimmed)) list.Add(trimmed);
        }
        return list;
    }

    private static WorkReportResponse ToResponse(WorkReportRecord r, string name, string code) =>
        new(r.Id, r.UserId, name, code, r.WorkDate, r.ProjectName, r.WorkHours ?? 0m,
            r.TaskDescription, r.Attachments);
}
