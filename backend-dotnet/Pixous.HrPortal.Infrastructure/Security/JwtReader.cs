using System.IdentityModel.Tokens.Jwt;
using System.Text;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Microsoft.IdentityModel.Tokens;
using Pixous.HrPortal.Domain.Security;

namespace Pixous.HrPortal.Infrastructure.Security;

/// <summary>
/// Validates an access token and reads the user id, for callers that need it
/// outside the authentication middleware — the WebSocket CONNECT frame being
/// the one that matters.
/// </summary>
/// <remarks>
/// <para>Same secret, same algorithm and same claim as
/// <c>JwtService.extractUserId</c>: HMAC-SHA over the UTF-8 bytes of
/// <c>app.jwt.secret</c>, with the id in <c>sub</c>.</para>
///
/// <para>Both backends run during the migration and both read the same tokens,
/// so a browser signed in against Java must be accepted here without signing in
/// again. That is only true while the secret and the claim shape match exactly,
/// which is why neither is "improved" on the way across.</para>
/// </remarks>
public sealed class JwtReader : IJwtReader
{
    private readonly TokenValidationParameters _parameters;
    private readonly ILogger<JwtReader> _log;
    private readonly JwtSecurityTokenHandler _handler = new();

    public JwtReader(IConfiguration config, ILogger<JwtReader> log)
    {
        _log = log;

        string secret = config["App:Jwt:Secret"]
            ?? config["APP_JWT_SECRET"]
            ?? throw new InvalidOperationException(
                "App:Jwt:Secret is not set. The Java side took this from APP_JWT_SECRET and "
                + "refused to start without it, deliberately -- a default here would mean "
                + "running with a publicly known signing key.");

        _parameters = new TokenValidationParameters
        {
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(secret)),

            /*
             * Issuer and audience are not validated, matching the Java parser.
             *
             * JwtService writes an issuer and never checks it on the way back
             * in -- verifyWith(key) validates the signature and the expiry and
             * nothing else. Turning issuer validation on here would reject
             * every token issued by the Java backend that is still in a
             * browser, which during the migration is all of them.
             */
            ValidateIssuer = false,
            ValidateAudience = false,

            ValidateLifetime = true,
            /*
             * No clock skew. The .NET default is five minutes, which would keep
             * accepting an access token for five minutes after it expired --
             * the Java parser allowed none, and a 15-minute token with a
             * 5-minute grace is a third longer than intended.
             */
            ClockSkew = TimeSpan.Zero
        };
    }

    public long? ReadUserId(string token)
    {
        try
        {
            _handler.ValidateToken(token, _parameters, out var validated);
            string? sub = (validated as JwtSecurityToken)?.Subject;
            return long.TryParse(sub, out var id) ? id : null;
        }
        catch (SecurityTokenException ex)
        {
            // Expired, tampered with, or signed by something else. Not an
            // error: the caller treats it as an anonymous session, which is
            // what the Java did too.
            _log.LogDebug(ex, "Rejected a token");
            return null;
        }
        catch (ArgumentException ex)
        {
            // Not a JWT at all.
            _log.LogDebug(ex, "Malformed token");
            return null;
        }
    }
}
