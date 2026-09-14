namespace Pixous.HrPortal.Domain.Modules.Discipline;

/// <summary>
/// Disciplinary records. Ported from
/// com.pixous.hrportal.modules.discipline.DisciplineService.
/// </summary>
public interface IDisciplineBal
{
    Task<DisciplineRecord> CreateAsync(long reporterId, DisciplineRequest request,
                                       CancellationToken ct = default);

    Task<DisciplineView> CreateViewAsync(long reporterId, DisciplineRequest request,
                                         CancellationToken ct = default);

    Task<IReadOnlyList<DisciplineRecord>> MineAsync(long userId, CancellationToken ct = default);

    Task<IReadOnlyList<DisciplineView>> MineViewAsync(long userId, CancellationToken ct = default);

    Task<IReadOnlyList<DisciplineRecord>> AllAsync(CancellationToken ct = default);

    Task<IReadOnlyList<DisciplineView>> AllViewAsync(string? status, int page, int size,
                                                     CancellationToken ct = default);

    Task<IReadOnlyList<DisciplineView>> PendingReviewAsync(CancellationToken ct = default);

    Task<DisciplineRecord> GetAsync(long viewerId, long id, bool canManage,
                                    CancellationToken ct = default);

    Task<DisciplineView> GetViewAsync(long viewerId, long id, bool canManage,
                                      CancellationToken ct = default);

    Task<DisciplineView> UpdateAsync(long actorId, long id, UpdateDisciplineRequest request,
                                     CancellationToken ct = default);

    Task<DisciplineRecord> RespondAsync(long userId, long id, string? response,
                                        CancellationToken ct = default);

    Task<DisciplineView> RespondViewAsync(long userId, long id, string? response,
                                          CancellationToken ct = default);

    Task<DisciplineView> ReviewAsync(long ctoId, long id, ReviewDisciplineRequest request,
                                     CancellationToken ct = default);

    Task<DisciplineRecord> CancelAsync(long actorId, long id, CancellationToken ct = default);

    Task CancelDisciplineAsync(long actorId, long id, CancellationToken ct = default);
}

/// <summary>What is being recorded.</summary>
public sealed record DisciplineRequest
{
    [System.ComponentModel.DataAnnotations.Required(ErrorMessage = "employeeId is required")]
    public required long EmployeeId { get; init; }

    [System.ComponentModel.DataAnnotations.Required(ErrorMessage = "incidentDate is required")]
    public required DateOnly IncidentDate { get; init; }

    [System.ComponentModel.DataAnnotations.Required(AllowEmptyStrings = false,
        ErrorMessage = "disciplineType is required")]
    public required string DisciplineType { get; init; }
    public string? Severity { get; init; }

    [System.ComponentModel.DataAnnotations.Required(AllowEmptyStrings = false,
        ErrorMessage = "subject is required")]
    public required string Subject { get; init; }

    [System.ComponentModel.DataAnnotations.Required(AllowEmptyStrings = false,
        ErrorMessage = "description is required")]
    public required string Description { get; init; }
    public string? ActionTaken { get; init; }
    public string? Attachments { get; init; }
}

/// <summary>An edit to a discipline record.</summary>
public sealed record UpdateDisciplineRequest(
    DateOnly IncidentDate,
    string DisciplineType,
    string? Severity,
    string Subject,
    string Description,
    string? ActionTaken,
    string? Attachments,
    string? Status
);

/// <summary>The CTO review payload.</summary>
public sealed record ReviewDisciplineRequest(
    string? Remarks,
    string? Status
);

/// <summary>Wire view matching Spring Boot DisciplineDtos.View and React DisciplineRow.</summary>
public sealed record DisciplineView(
    long Id,
    string? ReferenceCode,
    long EmployeeId,
    string? EmployeeName,
    string? EmployeeCode,
    string? Department,
    long? ReportedBy,
    string? ReportedByName,
    DateOnly? IncidentDate,
    string? DisciplineType,
    string? Severity,
    string? Subject,
    string? Description,
    string? ActionTaken,
    string? Attachments,
    string? EmployeeResponse,
    DateTime? RespondedAt,
    string? CtoRemarks,
    string? ReviewedByName,
    DateTime? ReviewedAt,
    string? Status,
    DateTime? CreatedAt
);

/// <summary>A row of <c>discipline_records</c>.</summary>
public sealed class DisciplineRecord
{
    public long Id { get; set; }
    public string? ReferenceCode { get; set; }
    public long EmployeeId { get; set; }
    public long? ReportedBy { get; set; }
    public DateOnly? IncidentDate { get; set; }
    public string? DisciplineType { get; set; }
    public string? Severity { get; set; }
    public string? Subject { get; set; }
    public string? Description { get; set; }
    public string? ActionTaken { get; set; }
    public string? Attachments { get; set; }
    public string? EmployeeResponse { get; set; }
    public DateTime? RespondedAt { get; set; }
    public string? CtoRemarks { get; set; }
    public long? ReviewedBy { get; set; }
    public DateTime? ReviewedAt { get; set; }
    public string? Status { get; set; }
    public DateTime? CreatedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }

    /// <summary>Denormalised for the list views.</summary>
    public string? EmployeeName { get; set; }
    public string? EmployeeCode { get; set; }
    public string? Department { get; set; }
    public string? ReportedByName { get; set; }
    public string? ReviewedByName { get; set; }
}

/// <summary>The severities the Java normalises to; anything else falls back.</summary>
public static class DisciplineSeverities
{
    public static readonly IReadOnlySet<string> All =
        new HashSet<string>(StringComparer.Ordinal) { "LOW", "MEDIUM", "HIGH", "CRITICAL" };

    public static string Normalise(string? value, string fallback)
    {
        if (string.IsNullOrWhiteSpace(value)) return fallback;
        string up = value.Trim().ToUpperInvariant().Replace(' ', '_');
        return All.Contains(up) ? up : fallback;
    }
}

/// <summary>Data access for disciplinary records.</summary>
public interface IDisciplineDal
{
    Task<string?> FindMaxReferenceCodeAsync(string prefix, CancellationToken ct = default);
    Task<long> InsertAsync(DisciplineRecord record, CancellationToken ct = default);
    Task UpdateAsync(DisciplineRecord record, CancellationToken ct = default);
    Task<DisciplineRecord?> FindAsync(long id, CancellationToken ct = default);
    Task<IReadOnlyList<DisciplineRecord>> FindForEmployeeAsync(long employeeId,
                                                               CancellationToken ct = default);
    Task<IReadOnlyList<DisciplineRecord>> FindAllAsync(CancellationToken ct = default);
    Task<IReadOnlyList<DisciplineRecord>> FindPendingReviewAsync(CancellationToken ct = default);
    Task<IReadOnlyList<DisciplineRecord>> FilterAllAsync(string? status, int offset, int limit,
                                                         CancellationToken ct = default);
    Task<bool> SeesEveryRequestAsync(long userId, CancellationToken ct = default);
}
