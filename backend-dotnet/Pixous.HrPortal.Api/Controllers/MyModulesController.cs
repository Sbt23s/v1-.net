using Dapper;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Pixous.HrPortal.Domain.Common;
using Pixous.HrPortal.Domain.Security;
using Pixous.HrPortal.Infrastructure.Persistence;

namespace Pixous.HrPortal.Api.Controllers;

/// <summary>
/// Which modules the signed-in person's company has switched on, and the
/// company's branding. Ported from
/// com.pixous.hrportal.modules.admin.MyModulesController.
///
/// The portal cannot draw its first screen without both, which is why branding
/// rides along here rather than having a request of its own — a second request
/// would mean the colours arriving after the page, as a flash.
/// </summary>
[ApiController]
[Route("api/my-modules")]
[Authorize]
public sealed class MyModulesController : ControllerBase
{
    private readonly IDbConnectionFactory _connections;
    private readonly ICurrentUser _currentUser;

    public MyModulesController(IDbConnectionFactory connections, ICurrentUser currentUser)
    {
        _connections = connections;
        _currentUser = currentUser;
    }

    [HttpGet]
    public async Task<ApiResponse<object>> MyModules(CancellationToken ct)
    {
        long? companyId = _currentUser.CompanyId;

        // No company: an empty list and configured=false, rather than an error.
        // A person whose account has not been linked yet still has to be able to
        // load the portal.
        if (companyId is null)
        {
            return ApiResponse<object>.Ok(new
            {
                enabled = Array.Empty<string>(),
                configured = false,
                branding = ""
            });
        }

        using var conn = await _connections.CreateOpenConnectionAsync(ct);

        var rows = (await conn.QueryAsync<(string? ModuleCode, bool Enabled, string? FeatureFlags)>(
            new CommandDefinition("""
                SELECT module_code, enabled, feature_flags
                FROM company_modules
                WHERE company_id = @companyId
                """,
                new { companyId }, cancellationToken: ct))).AsList();

        // Branding lives in a company_modules row of its own, kept switched OFF
        // -- it is a place to store settings, not a feature anyone navigates to.
        // Which is why it is read here by code rather than falling out of the
        // enabled list below: that list only carries rows that are switched on.
        string branding = rows
            .Where(r => string.Equals(r.ModuleCode, "BRANDING", StringComparison.OrdinalIgnoreCase))
            .Select(r => r.FeatureFlags)
            .FirstOrDefault(f => !string.IsNullOrWhiteSpace(f))
            // An absent document is a normal state -- most companies have never
            // opened the branding screen -- so this is "" rather than null.
            ?? "";

        string[] enabled = rows
            .Where(r => r.Enabled)
            .Select(r => r.ModuleCode)
            .Where(code => !string.IsNullOrWhiteSpace(code))
            // Stored lower-case in places and upper-case in others; the client
            // compares against upper-case codes.
            .Select(code => code!.Trim().ToUpperInvariant())
            .Distinct(StringComparer.Ordinal)
            .ToArray();

        return ApiResponse<object>.Ok(new
        {
            enabled,
            // A company with no rows at all has never been configured, which the
            // client shows differently from one that has switched everything off.
            configured = rows.Count > 0,
            branding
        });
    }
}
