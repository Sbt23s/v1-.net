using Microsoft.IdentityModel.Tokens;

namespace Pixous.HrPortal.Domain.Security;

/// <summary>
/// Issues and validates stateless access tokens.
/// Ported from com.pixous.hrportal.security.JwtService.
/// </summary>
public interface IJwtService
{
    /// <summary>
    /// Issues an access token. <paramref name="userType"/> defaults to "USER";
    /// the technical-admin login passes "TECHNICAL_ADMIN", which routes the
    /// principal to a different store on the way back in.
    /// </summary>
    string GenerateAccessToken(long userId, string username, IReadOnlyList<string> roles,
                               string userType = UserTypes.User);

    /// <summary>The subject claim, which carries the user id.</summary>
    long ExtractUserId(string token);

    /// <summary>The roles claim, or an empty list when it is absent or not an array.</summary>
    IReadOnlyList<string> ExtractRoles(string token);

    /// <summary>The userType claim, defaulting to "USER" when absent.</summary>
    string ExtractUserType(string token);

    /// <summary>True when the token's signature and lifetime both check out.</summary>
    bool IsValid(string token);

    long AccessTtlSeconds { get; }

    /// <summary>
    /// The rules a bearer token is validated against. Exposed so the HTTP layer
    /// configures its authentication from the same object that issues the
    /// tokens, rather than restating the issuer, key and lifetime rules where
    /// they could drift apart.
    /// </summary>
    TokenValidationParameters ValidationParameters { get; }
}

/// <summary>
/// The two principal kinds the token can describe. A token minted before the
/// claim existed has no userType, and the filter reads those as <see cref="User"/>
/// -- the same backwards compatibility the Java filter keeps.
/// </summary>
public static class UserTypes
{
    public const string User = "USER";
    public const string TechnicalAdmin = "TECHNICAL_ADMIN";
}
