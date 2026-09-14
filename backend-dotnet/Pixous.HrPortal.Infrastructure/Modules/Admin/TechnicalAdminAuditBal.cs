using Dapper;
using Microsoft.Extensions.Logging;
using Pixous.HrPortal.Domain.Modules.Admin;
using Pixous.HrPortal.Domain.Security;
using Pixous.HrPortal.Infrastructure.Persistence;

namespace Pixous.HrPortal.Infrastructure.Modules.Admin;

/// <summary>
/// Dapper-backed implementation of technical audit trail and user usage analytics.
/// Ported from TechnicalAdminAuditController and TechnicalAuditService.
/// </summary>
public sealed class TechnicalAdminAuditBal : DalBase, ITechnicalAdminAuditBal
{
    private const int MaxValueLength = 500;
    private readonly ICurrentUser _currentUser;
    private readonly ILogger<TechnicalAdminAuditBal> _log;

    private const string SelectColumns = """
        id             AS Id,
        company_id     AS CompanyId,
        admin_id       AS AdminId,
        admin_username AS AdminUsername,
        action         AS Action,
        entity_type    AS EntityType,
        entity_id      AS EntityId,
        old_value      AS OldValue,
        new_value      AS NewValue,
        ip_address     AS IpAddress,
        created_at     AS CreatedAt,
        updated_at     AS UpdatedAt
        """;

    public TechnicalAdminAuditBal(
        IDbConnectionFactory connectionFactory,
        ICurrentUser currentUser,
        ILogger<TechnicalAdminAuditBal> log)
        : base(connectionFactory)
    {
        _currentUser = currentUser;
        _log = log;
    }

    public async Task<IReadOnlyList<TechnicalAuditLogRow>> GetAllLogsAsync(CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<TechnicalAuditLogRow>(
            new CommandDefinition(
                $"SELECT {SelectColumns} FROM technical_audit_logs ORDER BY created_at DESC",
                cancellationToken: ct)), ct)).AsList();

    public async Task<IReadOnlyList<TechnicalAuditLogRow>> GetCompanyLogsAsync(
        long companyId,
        CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<TechnicalAuditLogRow>(
            new CommandDefinition(
                $"SELECT {SelectColumns} FROM technical_audit_logs WHERE company_id = @companyId ORDER BY created_at DESC",
                new { companyId },
                cancellationToken: ct)), ct)).AsList();

    public async Task<UsageResponse> GetUsageAsync(long? companyId, int days, CancellationToken ct = default)
    {
        DateTime since = DateTime.UtcNow.AddDays(-Math.Max(1, days));

        var rows = (await QueryAsync(conn => conn.QueryAsync<TechnicalAuditLogRow>(
            new CommandDefinition($"""
                SELECT {SelectColumns}
                FROM technical_audit_logs
                WHERE action = 'MODULE_USE'
                  AND created_at > @since
                  AND (@companyId IS NULL OR company_id = @companyId)
                ORDER BY created_at DESC
                """,
                new { since, companyId },
                cancellationToken: ct)), ct)).AsList();

        var byPerson = new Dictionary<long, List<TechnicalAuditLogRow>>();
        foreach (var r in rows)
        {
            if (r.AdminId is null)
            {
                continue;
            }

            if (!byPerson.TryGetValue(r.AdminId.Value, out var list))
            {
                list = new List<TechnicalAuditLogRow>();
                byPerson[r.AdminId.Value] = list;
            }
            list.Add(r);
        }

        var people = new List<UsagePersonView>();
        foreach (var (userId, userRows) in byPerson)
        {
            var perModule = new Dictionary<string, long>(StringComparer.OrdinalIgnoreCase);
            var spans = new Dictionary<DateOnly, (long MinMs, long MaxMs)>();

            foreach (var r in userRows)
            {
                string module = string.IsNullOrWhiteSpace(r.EntityType) ? "OTHER" : r.EntityType;
                perModule[module] = perModule.GetValueOrDefault(module, 0L) + 1L;

                DateOnly day = DateOnly.FromDateTime(r.CreatedAt);
                long at = new DateTimeOffset(r.CreatedAt, TimeSpan.Zero).ToUnixTimeMilliseconds();

                if (spans.TryGetValue(day, out var span))
                {
                    spans[day] = (Math.Min(span.MinMs, at), Math.Max(span.MaxMs, at));
                }
                else
                {
                    spans[day] = (at, at);
                }
            }

            long activeMinutes = spans.Values.Sum(s => Math.Max(0, (s.MaxMs - s.MinMs) / 60000L));
            DateTime? first = userRows.Min(r => r.CreatedAt);
            DateTime? last = userRows.Max(r => r.CreatedAt);

            var person = new UsagePersonView
            {
                UserId = userId,
                Username = userRows[0].AdminUsername,
                CompanyId = userRows[0].CompanyId,
                Touches = userRows.Count,
                Modules = perModule,
                DaysActive = spans.Count,
                ActiveMinutes = activeMinutes,
                FirstSeen = first,
                LastSeen = last
            };
            people.Add(person);
        }

        people.Sort((a, b) => b.Touches.CompareTo(a.Touches));

        return new UsageResponse
        {
            Days = days,
            People = people,
            Note = "Usage has been recorded since this feature was deployed; earlier activity was never stored."
        };
    }

    public async Task RecordAuditAsync(
        long? companyId,
        string action,
        string entityType,
        long? entityId,
        string? oldValue,
        string? newValue,
        string? clientIp,
        CancellationToken ct = default)
    {
        try
        {
            long? adminId = _currentUser.UserId > 0 ? _currentUser.UserId : null;
            string? adminUsername = !string.IsNullOrWhiteSpace(_currentUser.Username)
                ? _currentUser.Username
                : null;

            await QueryAsync(conn => conn.ExecuteAsync(
                new CommandDefinition("""
                    INSERT INTO technical_audit_logs (
                        company_id, admin_id, admin_username, action, entity_type, entity_id,
                        old_value, new_value, ip_address, created_at, updated_at
                    ) VALUES (
                        @companyId, @adminId, @adminUsername, @action, @entityType, @entityId,
                        @oldValue, @newValue, @clientIp, NOW(), NOW()
                    )
                    """,
                    new
                    {
                        companyId,
                        adminId,
                        adminUsername,
                        action,
                        entityType,
                        entityId,
                        oldValue = TrimValue(oldValue),
                        newValue = TrimValue(newValue),
                        clientIp
                    },
                    cancellationToken: ct)), ct);
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Could not write technical audit row for {Action} on {EntityType}", action, entityType);
        }
    }

    public async Task RecordUsageAsync(
        long companyId,
        long userId,
        string username,
        string module,
        string? clientIp,
        CancellationToken ct = default)
    {
        try
        {
            await QueryAsync(conn => conn.ExecuteAsync(
                new CommandDefinition("""
                    INSERT INTO technical_audit_logs (
                        company_id, admin_id, admin_username, action, entity_type,
                        ip_address, created_at, updated_at
                    ) VALUES (
                        @companyId, @userId, @username, 'MODULE_USE', @module,
                        @clientIp, NOW(), NOW()
                    )
                    """,
                    new
                    {
                        companyId,
                        userId,
                        username,
                        module,
                        clientIp
                    },
                    cancellationToken: ct)), ct);
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Could not write usage tracking row for user {UserId} on {Module}", userId, module);
        }
    }

    private static string? TrimValue(string? value)
    {
        if (value is null)
        {
            return null;
        }
        return value.Length <= MaxValueLength ? value : value[..MaxValueLength];
    }
}
