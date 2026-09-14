using Pixous.HrPortal.Domain.Security;

namespace Pixous.HrPortal.Api.RealTime;

/// <summary>
/// Who a socket is, and what it may listen to.
/// </summary>
public interface IStompAuthorizer
{
    /// <summary>
    /// The principal name for a CONNECT frame's Authorization header, or null
    /// for an anonymous session. Never throws and never refuses.
    /// </summary>
    string? ResolvePrincipal(string? authorizationHeader);

    /// <summary>Whether this session may subscribe to this destination.</summary>
    bool MaySubscribe(string? principalName, string destination);
}

/// <summary>
/// The subscription rules from <c>WebSocketConfig</c>, ported literally.
/// </summary>
/// <remarks>
/// <para>The comments here are the Java ones, kept because they record why the
/// rules are shaped as they are. Both were written after a real hole: every
/// private topic used to be readable by anyone who could open a socket, so an
/// unauthenticated client that guessed <c>/topic/community/3</c> received that
/// group's chat as it was typed, and <c>/topic/notifications/12</c> delivered
/// another person's alerts. Both ids are small integers.</para>
/// </remarks>
public sealed class StompAuthorizer(IJwtReader jwt, ILogger<StompAuthorizer> log) : IStompAuthorizer
{
    /// <summary>
    /// Topics anyone may listen to, signed in or not.
    /// </summary>
    /// <remarks>
    /// The login announcement is the one genuinely public broadcast: the modal
    /// that shows it can be mid token-refresh when it subscribes, and the
    /// payload is a notice deliberately shown to everybody. Everything else
    /// carries somebody's data.
    /// </remarks>
    private static readonly string[] PublicTopics = ["/topic/global-announcement"];

    private const string NotificationPrefix = "/topic/notifications/";

    public string? ResolvePrincipal(string? authorizationHeader)
    {
        /*
         * This never refuses a connection. Chat and notifications worked before
         * anyone was named and must keep working: a missing or unreadable token
         * simply leaves the session anonymous, which costs it presence and
         * nothing else.
         */
        try
        {
            if (authorizationHeader is null) return null;
            if (!authorizationHeader.StartsWith("Bearer ", StringComparison.Ordinal)) return null;

            string token = authorizationHeader["Bearer ".Length..];
            long? userId = jwt.ReadUserId(token);

            // String.valueOf(userId) in the Java. /user/queue/** routing
            // compares against this exact string.
            return userId?.ToString();
        }
        catch (Exception ex)
        {
            log.LogDebug(ex, "Could not name a websocket session; leaving it anonymous");
            return null;
        }
    }

    public bool MaySubscribe(string? principalName, string destination)
    {
        if (string.IsNullOrEmpty(destination)) return true;
        if (PublicTopics.Contains(destination)) return true;

        // Anonymous sessions get the public topics and nothing else. Checked at
        // SUBSCRIBE rather than by refusing anonymous CONNECTs: refusing the
        // connection would also refuse the announcement modal during a token
        // refresh, and would change how every client reconnects. Withholding
        // the subscription protects the same data and leaves the connection
        // lifecycle exactly as it was.
        if (string.IsNullOrEmpty(principalName))
        {
            log.LogDebug("Refused an unauthenticated subscription to {Destination}", destination);
            return false;
        }

        // A signed-in user may only listen to their own notification stream.
        // Clients only ever ask for their own; anything else is someone reading
        // another person's alerts.
        if (destination.StartsWith(NotificationPrefix, StringComparison.Ordinal))
        {
            string requested = destination[NotificationPrefix.Length..];
            if (!string.Equals(requested, principalName, StringComparison.Ordinal))
            {
                log.LogWarning("User {Principal} tried to subscribe to notifications for {Requested}",
                    principalName, requested);
                return false;
            }
        }

        return true;
    }
}
