using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;
using Pixous.HrPortal.Domain.Security;
using Pixous.HrPortal.Infrastructure.Configuration;

namespace Pixous.HrPortal.Infrastructure.Security;

/// <summary>
/// Issues and validates stateless access tokens, producing exactly the tokens
/// com.pixous.hrportal.security.JwtService produces with jjwt 0.12.x.
///
/// Wire compatibility is the whole point of this class: a token minted by the
/// Java backend must be accepted here and vice versa, so that the two can run
/// side by side during the migration and a signed-in user is not logged out by
/// a cutover. That fixes three things which are otherwise free choices:
///
///   1. HS256 over the UTF-8 bytes of the configured secret, which is what
///      Keys.hmacShaKeyFor does.
///   2. The claim set: sub, iss, username, roles, userType, iat, exp -- and no
///      others. jjwt writes no "jti" or "nbf" unless asked, so neither does this.
///   3. "roles" as a JSON ARRAY of strings. .NET's JwtSecurityTokenHandler
///      writes one claim per value, which turns a single-role array into a bare
///      string and breaks any consumer that indexes it. The payload is therefore
///      assembled by hand below rather than through a ClaimsIdentity.
/// </summary>
public sealed class JwtService : IJwtService
{
    private readonly SymmetricSecurityKey _key;
    private readonly string _issuer;

    public long AccessTtlSeconds { get; }

    public JwtService(IOptions<AppOptions> options)
    {
        JwtOptions jwt = options.Value.Jwt;

        if (string.IsNullOrWhiteSpace(jwt.Secret))
        {
            // The Java config has no fallback for this value on purpose: the app
            // must fail to start rather than run with a publicly-known signing
            // key. Same here.
            throw new InvalidOperationException(
                "App:Jwt:Secret is not configured. Supply it via the APP_JWT_SECRET " +
                "environment variable or user-secrets; it must never be committed.");
        }

        byte[] secretBytes = Encoding.UTF8.GetBytes(jwt.Secret);

        // HS256 needs at least 256 bits of key. jjwt's Keys.hmacShaKeyFor throws
        // on a shorter one, so a secret that works against the Java backend is
        // always long enough -- but a fresh deployment can be configured with a
        // short one, and the failure that follows is an opaque signing error at
        // the first login rather than anything pointing here.
        if (secretBytes.Length < 32)
        {
            throw new InvalidOperationException(
                $"App:Jwt:Secret must be at least 32 bytes for HS256; it is {secretBytes.Length}.");
        }

        _key = new SymmetricSecurityKey(secretBytes);
        _issuer = jwt.Issuer;
        AccessTtlSeconds = jwt.AccessTokenTtlSeconds;
    }

    /// <summary>The validation rules the bearer middleware uses, kept beside the issuing rules.</summary>
    public TokenValidationParameters ValidationParameters => new()
    {
        ValidateIssuerSigningKey = true,
        IssuerSigningKey = _key,
        ValidateIssuer = true,
        ValidIssuer = _issuer,
        // jjwt writes no "aud" claim, so there is nothing to validate against.
        ValidateAudience = false,
        ValidateLifetime = true,
        // Default is five minutes of leeway, which would keep an expired token
        // working past the four-hour session boundary the client is built around.
        ClockSkew = TimeSpan.Zero,
        // Keep "sub" as "sub" instead of remapping it to the .NET name claim.
        NameClaimType = JwtRegisteredClaimNames.Sub
    };

    public string GenerateAccessToken(long userId, string username, IReadOnlyList<string> roles,
                                      string userType = UserTypes.User)
    {
        long issuedAt = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        long expires = issuedAt + AccessTtlSeconds;

        var header = new JwtHeader(new SigningCredentials(_key, SecurityAlgorithms.HmacSha256));

        // Built as a dictionary rather than from claims so "roles" stays a JSON
        // array even when it holds a single value. See the class comment.
        var payload = new JwtPayload
        {
            { JwtRegisteredClaimNames.Sub, userId.ToString() },
            { JwtRegisteredClaimNames.Iss, _issuer },
            { "username", username },
            { "roles", roles.ToArray() },
            { "userType", userType },
            { JwtRegisteredClaimNames.Iat, issuedAt },
            { JwtRegisteredClaimNames.Exp, expires }
        };

        return new JwtSecurityTokenHandler().WriteToken(new JwtSecurityToken(header, payload));
    }

    public long ExtractUserId(string token) => long.Parse(Parse(token).Subject);

    public IReadOnlyList<string> ExtractRoles(string token)
    {
        JwtPayload payload = Parse(token).Payload;
        if (!payload.TryGetValue("roles", out object? raw) || raw is null)
        {
            return [];
        }

        // The claim arrives as a JsonElement when the token was parsed from the
        // wire, and as the original array when it was just built.
        return raw switch
        {
            JsonElement { ValueKind: JsonValueKind.Array } element =>
                element.EnumerateArray().Select(e => e.ToString()).ToArray(),
            IEnumerable<string> strings => strings.ToArray(),
            System.Collections.IEnumerable sequence and not string =>
                sequence.Cast<object?>().Select(v => v?.ToString() ?? string.Empty).ToArray(),
            _ => []
        };
    }

    public string ExtractUserType(string token)
    {
        JwtPayload payload = Parse(token).Payload;
        // Default to USER if the claim is missing, for backwards compatibility
        // with tokens minted before it existed.
        return payload.TryGetValue("userType", out object? value) && value is not null
            ? value.ToString() ?? UserTypes.User
            : UserTypes.User;
    }

    public bool IsValid(string token)
    {
        try
        {
            new JwtSecurityTokenHandler().ValidateToken(token, ValidationParameters, out _);
            return true;
        }
        catch
        {
            // Java's isValid catches every exception and answers false; an
            // invalid token is an unauthenticated request, not a server fault.
            return false;
        }
    }

    /// <summary>
    /// Reads a token that has already been validated. This does NOT check the
    /// signature on its own, so it is only ever called on a token that came
    /// through <see cref="IsValid"/> or the bearer middleware first.
    /// </summary>
    private static JwtSecurityToken Parse(string token) =>
        new JwtSecurityTokenHandler().ReadJwtToken(token);
}
