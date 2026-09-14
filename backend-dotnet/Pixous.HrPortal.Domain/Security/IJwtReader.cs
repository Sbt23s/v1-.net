namespace Pixous.HrPortal.Domain.Security;

/// <summary>
/// Reads a user id out of an access token.
/// </summary>
/// <remarks>
/// Separate from the authentication middleware because the WebSocket endpoint
/// needs one thing from a token and needs it before that middleware has run:
/// the STOMP CONNECT frame arrives after the upgrade, on a request that carried
/// no Authorization header of its own. <c>JwtService.extractUserId</c> did the
/// same job on the Java side.
/// </remarks>
public interface IJwtReader
{
    /// <summary>The user id, or null when the token is absent, expired or unreadable.</summary>
    long? ReadUserId(string token);
}
