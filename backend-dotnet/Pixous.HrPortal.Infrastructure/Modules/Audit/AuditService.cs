using Dapper;
using Microsoft.Extensions.Logging;
using Pixous.HrPortal.Domain.Modules.Audit;
using Pixous.HrPortal.Infrastructure.Persistence;

namespace Pixous.HrPortal.Infrastructure.Modules.Audit;

/// <summary>
/// Writes rows to <c>audit_log</c>. Ported from
/// com.pixous.hrportal.modules.audit.AuditService.
///
/// Every field is clipped to its column width, and every failure is swallowed.
/// Both are load-bearing: the Java learned from login_history that a write which
/// overflows its column throws out of the audit and surfaces to the caller as a
/// failure of the thing being audited.
/// </summary>
public sealed class AuditService : DalBase, IAuditService
{
    private readonly ILogger<AuditService> _log;

    public AuditService(IDbConnectionFactory connectionFactory, ILogger<AuditService> log)
        : base(connectionFactory)
    {
        _log = log;
    }

    public Task RecordChangeAsync(long? actorId, string category, string action, string summary,
                                  string? entityType, object? entityId, string? entityLabel,
                                  string? before, string? after,
                                  CancellationToken ct = default)
    {
        // The exact shape the Java writes: {"before":...,"after":...} with each
        // side either a JSON string or the literal null. Built by hand rather
        // than through a serialiser so the output matches byte for byte -- these
        // rows are read by an existing screen.
        string? detail = before is null && after is null
            ? null
            : $"{{\"before\":{Json(before)},\"after\":{Json(after)}}}";

        return WriteAsync(actorId, category, action, summary, entityType, entityId, entityLabel,
                          detail, ct);
    }

    public Task RecordAsync(long? actorId, string category, string action, string summary,
                            string? entityType = null, object? entityId = null,
                            string? entityLabel = null, CancellationToken ct = default) =>
        WriteAsync(actorId, category, action, summary, entityType, entityId, entityLabel, null, ct);

    private async Task WriteAsync(long? actorId, string? category, string action, string summary,
                                  string? entityType, object? entityId, string? entityLabel,
                                  string? detail, CancellationToken ct)
    {
        try
        {
            // The actor's name, employee code and roles are denormalised onto the
            // row, so the trail still reads correctly after the account is
            // renamed or deleted.
            string? userName = null, employeeCode = null, roles = null;

            if (actorId is not null)
            {
                var actor = await QueryAsync(conn =>
                    conn.QueryFirstOrDefaultAsync<(string? Name, string? EmployeeCode, string? Roles)>(
                        new CommandDefinition("""
                            SELECT u.name, u.employee_code,
                                   (SELECT GROUP_CONCAT(r.code)
                                    FROM user_roles ur JOIN roles r ON r.id = ur.role_id
                                    WHERE ur.user_id = u.id) AS roles
                            FROM users u WHERE u.id = @actorId
                            """,
                            new { actorId }, cancellationToken: ct)), ct);

                userName = Clip(actor.Name, 150);
                employeeCode = Clip(actor.EmployeeCode, 30);
                roles = Clip(actor.Roles, 255);
            }

            await QueryAsync(conn => conn.ExecuteAsync(new CommandDefinition("""
                INSERT INTO audit_log
                    (actor_id, user_name, employee_code, roles, category, action, summary,
                     entity_type, entity_id, entity_label, details, succeeded, created_at)
                VALUES
                    (@actorId, @userName, @employeeCode, @roles, @category, @action, @summary,
                     @entityType, @entityId, @entityLabel, @details, 1, @createdAt)
                """,
                new
                {
                    actorId,
                    userName,
                    employeeCode,
                    roles,
                    category = Clip(category ?? AuditCategory.System, 40),
                    action = Clip(action, 120),
                    summary = Clip(summary, 500),
                    entityType = Clip(entityType, 80),
                    entityId = entityId is null ? null : Clip(entityId.ToString(), 60),
                    entityLabel = Clip(entityLabel, 200),
                    details = Clip(detail, 60_000),
                    createdAt = DateTime.Now
                }, cancellationToken: ct)), ct);
        }
        catch (Exception ex)
        {
            // Deliberately swallowed. The record of an action must never decide
            // the outcome of the action.
            _log.LogWarning(ex, "Could not write an audit entry for {Category} {Action}",
                category, action);
        }
    }

    /// <summary>
    /// A JSON string literal, escaped as the Java does: backslashes and quotes
    /// escaped, newlines and carriage returns flattened to spaces so the value
    /// stays on one line.
    /// </summary>
    private static string Json(string? value) =>
        value is null
            ? "null"
            : "\"" + value.Replace("\\", "\\\\")
                          .Replace("\"", "\\\"")
                          .Replace("\n", " ")
                          .Replace("\r", " ") + "\"";

    private static string? Clip(string? value, int max) =>
        value is null ? null : value.Length <= max ? value : value[..max];
}
