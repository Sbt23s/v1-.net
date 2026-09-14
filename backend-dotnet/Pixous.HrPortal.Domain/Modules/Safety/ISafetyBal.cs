using System.ComponentModel.DataAnnotations;
using Pixous.HrPortal.Domain.Common;

namespace Pixous.HrPortal.Domain.Modules.Safety;

/// <summary>
/// Safety incidents. Ported from
/// com.pixous.hrportal.modules.safety.SafetyIncidentService.
///
/// Any signed-in employee may report one and see their own; staff holding
/// REPORT_VIEW see all of them and resolve them.
///
/// <para><b>Anonymity is a display rule, not a storage one.</b> An incident
/// reported anonymously still records who reported it — the row has to be
/// answerable if it turns into something serious — but every view of it shows
/// "Anonymous" instead of their name. That distinction is the module's one real
/// trap: reading the raw column anywhere a person can see it undoes the
/// promise the reporting screen made.</para>
/// </summary>
public interface ISafetyBal
{
    /// <summary>Reports an incident. Notifies everybody holding REPORT_VIEW.</summary>
    Task<SafetyIncidentResponse> ReportAsync(long userId, SafetyIncidentRequest request,
                                             CancellationToken ct = default);

    /// <summary>The caller's own reports, newest first.</summary>
    Task<PageResponse<SafetyIncidentResponse>> MyReportsAsync(long userId, int page, int size,
                                                              CancellationToken ct = default);

    /// <summary>Every incident, optionally narrowed by status and type. Staff only.</summary>
    Task<PageResponse<SafetyIncidentResponse>> AllAsync(string? status, string? incidentType,
                                                        int page, int size,
                                                        CancellationToken ct = default);

    Task<SafetyIncidentResponse> GetAsync(long id, CancellationToken ct = default);

    /// <summary>Sets a status and optionally records what was done. Staff only.</summary>
    Task<SafetyIncidentResponse> ResolveAsync(long staffId, long id,
                                              SafetyResolutionRequest request,
                                              CancellationToken ct = default);
}

/// <summary>The vocabularies, and how an unrecognised value is handled.</summary>
public static class SafetyVocabulary
{
    public static readonly IReadOnlySet<string> IncidentTypes =
        new HashSet<string>(StringComparer.Ordinal)
        {
            "NEAR_MISS", "MINOR_INJURY", "MAJOR_INJURY", "PROPERTY_DAMAGE", "ENV_HAZARD"
        };

    public static readonly IReadOnlySet<string> Severities =
        new HashSet<string>(StringComparer.Ordinal) { "LOW", "MEDIUM", "HIGH", "CRITICAL" };

    public static readonly IReadOnlySet<string> Statuses =
        new HashSet<string>(StringComparer.Ordinal)
        {
            "OPEN", "INVESTIGATING", "RESOLVED", "CLOSED"
        };

    /// <summary>
    /// Upper-cases and checks against a vocabulary, FALLING BACK rather than
    /// refusing.
    ///
    /// That is deliberate on the reporting path and worth naming: somebody is
    /// telling us about an injury, and rejecting the whole report because a
    /// dropdown sent an unrecognised type would lose the report. A wrong
    /// category can be corrected later; a refused submission is gone.
    ///
    /// The STATUS on the staff path is the opposite — see
    /// <see cref="IsValidStatus"/> — because there a wrong value would silently
    /// misfile an incident somebody is acting on.
    /// </summary>
    public static string Normalise(string? value, IReadOnlySet<string> allowed, string fallback)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return fallback;
        }

        string upper = value.Trim().ToUpperInvariant();
        return allowed.Contains(upper) ? upper : fallback;
    }

    /// <summary>
    /// A status is validated rather than defaulted: staff are acting on the
    /// incident, and quietly filing it under the wrong state would be worse
    /// than telling them the value was wrong.
    /// </summary>
    public static bool IsValidStatus(string? status) =>
        status is not null && Statuses.Contains(status.Trim().ToUpperInvariant());

    /// <summary>
    /// Both endings stamp the resolution time; anything else CLEARS it.
    ///
    /// The clear matters: moving an incident back to INVESTIGATING after it was
    /// resolved must not leave a resolved-at time hanging on an open incident.
    /// </summary>
    public static bool IsFinished(string status) => status is "RESOLVED" or "CLOSED";

    /// <summary>"near miss" from "NEAR_MISS", for a notification people read.</summary>
    public static string Humanise(string? code) =>
        (code ?? "").ToLowerInvariant().Replace('_', ' ');
}

/// <summary>What an employee submits.</summary>
public sealed record SafetyIncidentRequest
{
    /// <summary>NEAR_MISS | MINOR_INJURY | MAJOR_INJURY | PROPERTY_DAMAGE | ENV_HAZARD.</summary>
    public string? IncidentType { get; init; }

    [Required(AllowEmptyStrings = false, ErrorMessage = "Please describe the incident")]
    public required string Description { get; init; }

    public string? Zone { get; init; }

    /// <summary>Hides the reporter's name from every view. The row still records it.</summary>
    public bool Anonymous { get; init; }

    /// <summary>ISO date-time string, optional. When the incident occurred.</summary>
    public string? OccurredAt { get; init; }

    /// <summary>LOW | MEDIUM | HIGH | CRITICAL — defaults to MEDIUM.</summary>
    public string? Severity { get; init; }
}

/// <summary>A staff action: set a status, optionally record what was done.</summary>
public sealed record SafetyResolutionRequest
{
    [Required(AllowEmptyStrings = false, ErrorMessage = "Status is required")]
    public required string Status { get; init; }

    public string? ResolutionNotes { get; init; }
}

/// <summary>What clients see. Names are resolved; anonymity is applied here.</summary>
public sealed record SafetyIncidentResponse(
    long Id,
    string? ReferenceCode,
    long? ReportedBy,

    /// <summary>"Anonymous" when the report was anonymous, whatever the row says.</summary>
    string? ReportedByName,

    long? SiteId,
    string? IncidentType,
    string? Description,
    string? Zone,
    bool Anonymous,
    string? Status,
    string? Severity,
    DateTime? OccurredAt,
    long? ResolvedBy,
    string? ResolvedByName,
    string? ResolutionNotes,
    DateTime? ResolvedAt,
    DateTime? CreatedAt);

/// <summary>A row of <c>safety_incidents</c>.</summary>
public sealed class SafetyIncidentRow
{
    public long Id { get; set; }
    public string? ReferenceCode { get; set; }
    public long? ReportedBy { get; set; }
    public long? SiteId { get; set; }
    public string? IncidentType { get; set; }
    public string? Severity { get; set; }
    public string? Description { get; set; }
    public string? Zone { get; set; }
    public bool Anonymous { get; set; }
    public string? Status { get; set; }
    public long? ResolvedBy { get; set; }
    public DateTime? ResolvedAt { get; set; }
    public string? ResolutionNotes { get; set; }
    public DateTime? OccurredAt { get; set; }
    public DateTime? CreatedAt { get; set; }
    public long? CompanyId { get; set; }
}

/// <summary>Data access for safety incidents.</summary>
public interface ISafetyDal
{
    Task<long> InsertAsync(SafetyIncidentRow row, CancellationToken ct = default);
    Task UpdateAsync(SafetyIncidentRow row, CancellationToken ct = default);
    Task<SafetyIncidentRow?> FindAsync(long id, CancellationToken ct = default);

    Task<(IReadOnlyList<SafetyIncidentRow> Rows, long Total)> FindForReporterAsync(
        long reportedBy, int page, int size, CancellationToken ct = default);

    Task<(IReadOnlyList<SafetyIncidentRow> Rows, long Total)> FilterAllAsync(
        string? status, string? incidentType, int page, int size, CancellationToken ct = default);

    /// <summary>How many rows exist, for the reference code.</summary>
    Task<long> CountAsync(CancellationToken ct = default);

    /// <summary>Everybody holding a permission, for the notification fan-out.</summary>
    Task<IReadOnlyList<(long Id, string? Name, string? Phone)>> FindHoldersOfAsync(
        string permissionCode, CancellationToken ct = default);

    Task<(string? Name, string? Phone)?> FindUserAsync(long userId, CancellationToken ct = default);
}
