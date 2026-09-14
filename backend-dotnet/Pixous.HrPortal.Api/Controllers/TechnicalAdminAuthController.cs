using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Pixous.HrPortal.Domain.Common;
using Pixous.HrPortal.Domain.Modules.Admin;
using Pixous.HrPortal.Domain.Security;

namespace Pixous.HrPortal.Api.Controllers;

/// <summary>
/// Sign-in for the technical-admin realm — the SaaS control centre, whose
/// principals live in <c>technical_admins</c> rather than <c>users</c>.
///
/// Ported from com.pixous.hrportal.modules.admin.TechnicalAdminAuthController.
///
/// ═══════════════════════════════════════════════════════════════════════════
///  SECURITY WARNING — PORTED FAITHFULLY, NOT ENDORSED
/// ═══════════════════════════════════════════════════════════════════════════
///
/// The Java this replaces accepts two HARDCODED PASSWORDS that bypass the BCrypt
/// check entirely:
///
///     "admin123"  and  "Test1234@"
///
/// and, if no row exists at all, INVENTS an admin with id 1 for username
/// "admin". This path is on a PUBLIC endpoint — SecurityConfig lists
/// "/api/technical-admin/auth/**" under permitAll — so anybody who knows either
/// string gets a TECHNICAL_ADMIN token. That token can suspend companies, change
/// module entitlements and reach the data-reset endpoint.
///
/// It is reproduced here deliberately, because the two backends must behave
/// identically while they run side by side: removing it in .NET alone would lock
/// out whoever or whatever currently relies on it, and would hide the problem
/// rather than fix it.
///
/// TO FIX IT PROPERLY, in BOTH backends together:
///   1. give the real admin row a strong password hash,
///   2. delete the two literals below and the matching ones in the Java,
///   3. re-issue any credential that was ever sent using them.
///
/// A warning is logged at every login attempt that succeeds through this path,
/// so it is visible in production rather than only in this comment.
/// ═══════════════════════════════════════════════════════════════════════════
/// </summary>
[ApiController]
[Route("api/technical-admin/auth")]
[AllowAnonymous]
public sealed class TechnicalAdminAuthController : ControllerBase
{
    /// <summary>
    /// The two literals the Java accepts in place of the real password.
    /// See the class comment. These are a known defect, not a feature.
    /// </summary>
    private static readonly string[] MasterPasswords = ["admin123", "Test1234@"];

    private readonly ITechnicalAdminDal _admins;
    private readonly IPasswordHasher _passwords;
    private readonly IJwtService _jwt;
    private readonly ILogger<TechnicalAdminAuthController> _log;

    public TechnicalAdminAuthController(ITechnicalAdminDal admins,
                                        IPasswordHasher passwords,
                                        IJwtService jwt,
                                        ILogger<TechnicalAdminAuthController> log)
    {
        _admins = admins;
        _passwords = passwords;
        _jwt = jwt;
        _log = log;
    }

    /// <summary>
    /// Note the status codes: this endpoint answers **400**, not 401, for bad
    /// credentials and for a disabled account. That is what the Java does
    /// (ResponseEntity.badRequest()) and the control-centre client reads it, so
    /// it is kept rather than corrected to the status the rest of the API uses.
    /// </summary>
    [HttpPost("login")]
    public async Task<IActionResult> Login([FromBody] Dictionary<string, string>? payload,
                                           CancellationToken ct)
    {
        string? username = Value(payload, "username");
        string? password = Value(payload, "password");

        if (username is null || password is null)
        {
            return BadRequest(ApiResponse.Fail("Username and password are required."));
        }

        TechnicalAdminRecord? admin = await _admins.FindByUsernameAsync(username, ct);

        if (admin is null
            && string.Equals(username, "admin", StringComparison.OrdinalIgnoreCase)
            && MasterPasswords.Contains(password, StringComparer.Ordinal))
        {
            // No row, but the master password was given: the Java invents an
            // admin rather than refusing. See the class comment.
            _log.LogWarning(
                "SECURITY: technical-admin login accepted for a NON-EXISTENT account using a "
                + "hardcoded master password. See TechnicalAdminAuthController.");

            admin = new TechnicalAdminRecord
            {
                Id = 1L,
                Username = "admin",
                Name = "Master Technical Admin",
                Enabled = true
            };
        }
        else
        {
            if (admin is null)
            {
                return BadRequest(ApiResponse.Fail("Invalid credentials."));
            }

            bool matchesHash = _passwords.Verify(password, admin.PasswordHash);
            bool matchesMaster = MasterPasswords.Contains(password, StringComparer.Ordinal);

            if (!matchesHash && !matchesMaster)
            {
                return BadRequest(ApiResponse.Fail("Invalid credentials."));
            }

            if (!matchesHash && matchesMaster)
            {
                _log.LogWarning(
                    "SECURITY: technical-admin '{Username}' signed in with a hardcoded master "
                    + "password rather than their own. See TechnicalAdminAuthController.",
                    admin.Username);
            }
        }

        if (!admin.Enabled)
        {
            return BadRequest(ApiResponse.Fail("Account disabled."));
        }

        // ROLE_TECHNICAL_ADMIN is the single authority TechnicalAdminPrincipal
        // grants, and the userType claim is what routes the principal back to
        // technical_admins instead of users on the next request.
        string token = _jwt.GenerateAccessToken(
            admin.Id, admin.Username, ["ROLE_TECHNICAL_ADMIN"], UserTypes.TechnicalAdmin);

        // The token is returned TWICE, under "tokens.accessToken" and again at
        // the top level. That duplication is in the Java with the comment
        // "Matched frontend expectation" -- the control-centre client reads one
        // of them and something else reads the other, so both stay.
        return Ok(ApiResponse<object>.Ok(new
        {
            tokens = new { accessToken = token },
            accessToken = token,
            admin = new { id = admin.Id, name = admin.Name, username = admin.Username }
        }));
    }

    private static string? Value(Dictionary<string, string>? payload, string key) =>
        payload is not null && payload.TryGetValue(key, out string? v) ? v : null;
}
