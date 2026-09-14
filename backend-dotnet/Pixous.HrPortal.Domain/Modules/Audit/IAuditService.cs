namespace Pixous.HrPortal.Domain.Modules.Audit;

/// <summary>
/// Writes the audit trail. Ported from
/// com.pixous.hrportal.modules.audit.AuditService.
///
/// Every method here swallows its own failures, deliberately and for the same
/// reason the login-history write does: the record of an action must never
/// decide the outcome of the action. A full disk or a locked table must not turn
/// a successful salary change into a 500 — the change happened, and losing the
/// log line is the lesser fault.
/// </summary>
public interface IAuditService
{
    /// <summary>
    /// Records an action with a before-and-after worth keeping.
    ///
    /// Called AFTER the write it describes, never before, so a failed write does
    /// not leave a log line claiming a change that did not happen.
    /// </summary>
    Task RecordChangeAsync(long? actorId, string category, string action, string summary,
                           string? entityType, object? entityId, string? entityLabel,
                           string? before, string? after,
                           CancellationToken ct = default);

    /// <summary>The short form, for a service that knows what it did and about whom.</summary>
    Task RecordAsync(long? actorId, string category, string action, string summary,
                     string? entityType = null, object? entityId = null, string? entityLabel = null,
                     CancellationToken ct = default);
}

/// <summary>The category values the Java side writes.</summary>
public static class AuditCategory
{
    public const string System = "SYSTEM";
    public const string Payroll = "PAYROLL";
    public const string User = "USER";
    public const string Attendance = "ATTENDANCE";
    public const string Leave = "LEAVE";
}
