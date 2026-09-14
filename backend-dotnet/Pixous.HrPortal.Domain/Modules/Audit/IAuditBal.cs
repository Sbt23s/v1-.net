namespace Pixous.HrPortal.Domain.Modules.Audit;

/// <summary>
/// Reading the audit trail. Ported from
/// com.pixous.hrportal.modules.audit.AuditController.
///
/// The writing side is <see cref="IAuditService"/>, which the payroll and admin
/// modules already use. This is the other half: what HR and the administrators
/// read back.
/// </summary>
public interface IAuditBal
{
    /// <summary>One page of the trail, newest first.</summary>
    Task<AuditPage> SearchAsync(AuditQuery query, CancellationToken ct = default);

    /// <summary>
    /// The counts above the table: how much of each kind, who is busiest, and
    /// how many actions were refused — a run of refusals is the thing worth
    /// spotting.
    /// </summary>
    Task<AuditSummary> SummaryAsync(DateTime from, DateTime to, CancellationToken ct = default);

    /// <summary>Sign-in history, newest first.</summary>
    Task<AuditPage> LoginsAsync(DateTime from, DateTime to, int page, int size,
                                CancellationToken ct = default);

    /// <summary>Everything recorded about one entity, for its history panel.</summary>
    Task<IReadOnlyList<AuditRow>> ForEntityAsync(string entityType, string entityId,
                                                 CancellationToken ct = default);
}

/// <summary>What the trail is being searched for. Every filter is optional.</summary>
public sealed record AuditQuery
{
    public DateTime? From { get; init; }
    public DateTime? To { get; init; }
    public long? UserId { get; init; }

    /// <summary>"ALL" and blank both mean no filter, as the Java treats them.</summary>
    public string? Category { get; init; }

    public string? Q { get; init; }
    public bool OnlyFailures { get; init; }
    public int Page { get; init; }
    public int Size { get; init; } = 50;
}

/// <summary>
/// A page of audit rows.
///
/// NOT the standard PageResponse: the Java builds a LinkedHashMap with
/// content / totalElements / totalPages / page / size, in that order, and the
/// client reads those names. Reusing PageResponse would rename `last` in and
/// reorder the rest.
/// </summary>
public sealed record AuditPage(
    IReadOnlyList<AuditRow> Content,
    long TotalElements,
    int TotalPages,
    int Page,
    int Size);

/// <summary>One row of the trail, in the Java's field order.</summary>
public sealed record AuditRow
{
    public long Id { get; init; }

    /// <summary>The <c>created_at</c> column, called <c>at</c> on the wire.</summary>
    public DateTime? At { get; init; }

    public long? UserId { get; init; }
    public string? Name { get; init; }
    public string? EmployeeCode { get; init; }
    public string? Roles { get; init; }
    public string? Category { get; init; }
    public string? Action { get; init; }
    public string? Summary { get; init; }
    public string? EntityType { get; init; }
    public string? EntityId { get; init; }
    public string? EntityLabel { get; init; }
    public string? Detail { get; init; }
    public string? Method { get; init; }
    public string? Path { get; init; }
    public int? Status { get; init; }
    public string? IpAddress { get; init; }
    public string? Device { get; init; }

    /// <summary>The user agent read into something a person can scan.</summary>
    public string? Client { get; init; }

    public int? DurationMs { get; init; }
    public bool Succeeded { get; init; }
}

/// <summary>The counts above the table.</summary>
public sealed record AuditSummary(
    long Total,
    long Failures,
    IReadOnlyList<AuditCount> ByCategory,
    IReadOnlyList<AuditCount> ByUser);

/// <summary>A label and how many times it appeared.</summary>
public sealed record AuditCount(string? Label, long Count);

/// <summary>
/// Turning a user agent into something a person can scan.
/// Ported from AuditController.describeClient, which is package-private and
/// static there precisely so it can be tested directly.
/// </summary>
public static class ClientDescription
{
    /// <summary>
    /// "Chrome on Windows", "Mobile app on Android", "Unknown".
    ///
    /// The ORDER of the checks is the rule, and two of them are load-bearing:
    ///
    ///   - the app markers are tested FIRST, because a mobile app's user agent
    ///     often also mentions a browser engine; and
    ///   - Edge is tested before Chrome, because Edge's agent contains
    ///     "chrome" — reverse them and every Edge user is reported as Chrome.
    ///
    /// Chromium is excluded from the Chrome arm for the same family of reason.
    /// </summary>
    public static string Describe(string? userAgent)
    {
        if (string.IsNullOrWhiteSpace(userAgent))
        {
            return "Unknown";
        }

        string ua = userAgent.ToLowerInvariant();

        string app =
            ua.Contains("okhttp") || ua.Contains("dart") || ua.Contains("reactnative")
                || ua.Contains("pixous") ? "Mobile app"
            : ua.Contains("edg/") ? "Edge"
            : ua.Contains("chrome") && !ua.Contains("chromium") ? "Chrome"
            : ua.Contains("firefox") ? "Firefox"
            : ua.Contains("safari") ? "Safari"
            : "Other";

        string os =
            ua.Contains("android") ? "Android"
            : ua.Contains("iphone") || ua.Contains("ipad") ? "iOS"
            : ua.Contains("windows") ? "Windows"
            : ua.Contains("mac os") ? "macOS"
            : ua.Contains("linux") ? "Linux"
            : "";

        return os.Length == 0 ? app : app + " on " + os;
    }
}

/// <summary>Data access for reading the audit trail.</summary>
public interface IAuditReadDal
{
    Task<(IReadOnlyList<AuditRow> Rows, long Total)> SearchAsync(AuditQuery query,
                                                                 CancellationToken ct = default);

    Task<AuditSummary> SummaryAsync(DateTime from, DateTime to, CancellationToken ct = default);

    Task<(IReadOnlyList<AuditRow> Rows, long Total)> LoginsAsync(DateTime from, DateTime to,
                                                                 int page, int size,
                                                                 CancellationToken ct = default);

    Task<IReadOnlyList<AuditRow>> ForEntityAsync(string entityType, string entityId,
                                                 CancellationToken ct = default);
}
