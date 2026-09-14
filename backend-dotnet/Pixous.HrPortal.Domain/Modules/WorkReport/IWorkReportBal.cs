namespace Pixous.HrPortal.Domain.Modules.WorkReport;

/// <summary>
/// Daily work reports — what somebody did with their day.
/// Ported from com.pixous.hrportal.modules.workreport.WorkReportService.
/// </summary>
public interface IWorkReportBal
{
    Task<WorkReportResponse> CreateAsync(long userId, WorkReportRequest request,
                                         CancellationToken ct = default);

    /// <summary>
    /// Edits a report. Only its author may: "You can only edit your own work
    /// reports". An administrator is not given an override here — the report is
    /// somebody's account of their own day.
    /// </summary>
    Task<WorkReportResponse> UpdateAsync(long userId, long id, WorkReportRequest request,
                                         CancellationToken ct = default);

    Task DeleteAsync(long userId, long id, CancellationToken ct = default);

    Task<IReadOnlyList<WorkReportResponse>> MineAsync(long userId,
                                                      CancellationToken ct = default);

    Task<IReadOnlyList<WorkReportRecord>> MineRangeAsync(long userId, DateOnly? from, DateOnly? to,
                                                         CancellationToken ct = default);

    Task<IReadOnlyList<WorkReportRecord>> AllAsync(DateOnly? from, DateOnly? to,
                                                   CancellationToken ct = default);

    Task<WorkReportResponse> AddAttachmentsAsync(long userId, long id, IReadOnlyList<string> paths,
                                                 CancellationToken ct = default);

    Task<WorkReportResponse> RemoveAttachmentAsync(long userId, long id, string path,
                                                    CancellationToken ct = default);

    Task<IReadOnlyList<EmployeeWorkList>> MyTeamAsync(long userId, string? q,
                                                      CancellationToken ct = default);

    Task<IReadOnlyList<EmployeeWorkList>> EveryoneAsync(string? q,
                                                        CancellationToken ct = default);

    Task<byte[]> ExportExcelAsync(DateOnly? from, DateOnly? to,
                                  CancellationToken ct = default);

    Task<IReadOnlyDictionary<string, object?>> GetReminderPendingAsync(DateOnly? date,
                                                                      CancellationToken ct = default);

    Task<IReadOnlyDictionary<string, object?>> GetReminderSettingsAsync(CancellationToken ct = default);

    Task SaveReminderSettingsAsync(bool enabled, string time,
                                   CancellationToken ct = default);

    Task<int> SendRemindersAsync(DateOnly? date,
                                 CancellationToken ct = default);
}

/// <summary>What is being logged.</summary>
public sealed record WorkReportRequest
{
    public required DateOnly WorkDate { get; init; }
    public string? ProjectName { get; init; }
    public decimal? WorkHours { get; init; }
    public string? TaskDescription { get; init; }
    public string? Attachments { get; init; }
}

/// <summary>Wire contract matching Spring Boot WorkReportResponse and React WorkReport.</summary>
public sealed record WorkReportResponse(
    long Id,
    long UserId,
    string EmployeeName,
    string EmployeeCode,
    DateOnly WorkDate,
    string? ProjectName,
    decimal WorkHours,
    string? TaskDescription,
    string? Attachments
);

/// <summary>Grouped work report rows for one employee in the HR/Admin overview.</summary>
public sealed record EmployeeWorkList(
    long UserId,
    string EmployeeName,
    string EmployeeCode,
    int TotalRows,
    decimal TotalHours,
    IReadOnlyList<WorkReportResponse> Rows
);

/// <summary>Employee who has not submitted their work report for a given date.</summary>
public sealed class UnfiledUserRecord
{
    public long Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? EmployeeCode { get; set; }
    public string? Phone { get; set; }
    public string? Team { get; set; }
}

/// <summary>A row of <c>work_reports</c>.</summary>
public sealed class WorkReportRecord
{
    public long Id { get; set; }
    public long UserId { get; set; }
    public DateOnly WorkDate { get; set; }
    public string? ProjectName { get; set; }
    public decimal? WorkHours { get; set; }
    public string? TaskDescription { get; set; }

    /// <summary>A stored path list, as the Java keeps it — text, not a table.</summary>
    public string? Attachments { get; set; }

    public DateTime? CreatedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }
    public long? CompanyId { get; set; }

    /// <summary>Denormalised for the list views, which show who logged it.</summary>
    public string? UserName { get; set; }
    public string? EmployeeCode { get; set; }
    public string? DesignationTitle { get; set; }
}

/// <summary>Data access for work reports.</summary>
public interface IWorkReportDal
{
    Task<long> InsertAsync(WorkReportRecord report, CancellationToken ct = default);
    Task UpdateAsync(WorkReportRecord report, CancellationToken ct = default);
    Task DeleteAsync(long id, CancellationToken ct = default);
    Task<WorkReportRecord?> FindAsync(long id, CancellationToken ct = default);

    Task<IReadOnlyList<WorkReportRecord>> FindForUserAsync(long userId, DateOnly? from, DateOnly? to,
                                                           CancellationToken ct = default);

    Task<IReadOnlyList<WorkReportRecord>> FindAllAsync(DateOnly? from, DateOnly? to,
                                                       CancellationToken ct = default);

    Task<IReadOnlyList<WorkReportRecord>> FindAllDetailedAsync(CancellationToken ct = default);

    Task<IReadOnlyList<long>> FindTeammateUserIdsAsync(long userId, CancellationToken ct = default);

    Task<IReadOnlyList<UnfiledUserRecord>> FindUnfiledUsersAsync(DateOnly date, CancellationToken ct = default);

    Task<string?> GetSystemSettingAsync(string key, CancellationToken ct = default);

    Task UpsertSystemSettingAsync(string key, string value, CancellationToken ct = default);

    Task<bool> IsHolidayAsync(DateOnly date, CancellationToken ct = default);
}
