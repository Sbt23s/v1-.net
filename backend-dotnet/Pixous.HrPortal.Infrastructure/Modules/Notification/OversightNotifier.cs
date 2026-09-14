using Dapper;
using Microsoft.Extensions.Logging;
using Pixous.HrPortal.Domain.Modules.Notification;
using Pixous.HrPortal.Infrastructure.Persistence;

namespace Pixous.HrPortal.Infrastructure.Modules.Notification;

/// <summary>
/// Ported from com.pixous.hrportal.modules.notification.OversightNotifier.
/// </summary>
public sealed class OversightNotifier : DalBase, IOversightNotifier
{
    private readonly INotificationBal _notifications;
    private readonly ILogger<OversightNotifier> _log;

    public OversightNotifier(IDbConnectionFactory connectionFactory,
                             INotificationBal notifications,
                             ILogger<OversightNotifier> log)
        : base(connectionFactory)
    {
        _notifications = notifications;
        _log = log;
    }

    public async Task NotifyCtoAsync(long? actorId, string title, string body, string type,
                                     string link, CancellationToken ct = default)
    {
        try
        {
            long? cto = await QueryAsync(conn => conn.ExecuteScalarAsync<long?>(
                new CommandDefinition(
                    "SELECT id FROM users WHERE UPPER(employee_code) = @code LIMIT 1",
                    new { code = OversightAccounts.CtoCode }, cancellationToken: ct)), ct);

            if (cto is null)
            {
                return;
            }

            // Not to the person who just did it. The CTO approves requests too,
            // and being notified of one's own decision is noise that teaches
            // people to ignore the bell.
            if (actorId is not null && cto.Value == actorId.Value)
            {
                return;
            }

            await _notifications.CreateAndPushAsync(cto.Value, title, body, type, link, ct);
        }
        catch (Exception e)
        {
            // A notification is a courtesy alongside the thing that actually
            // happened. A leave request must not fail because the CTO's account
            // could not be read.
            _log.LogDebug(e, "Could not send the oversight copy of {Title}", title);
        }
    }
}
