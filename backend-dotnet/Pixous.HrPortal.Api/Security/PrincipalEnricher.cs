using System.Security.Claims;
using Pixous.HrPortal.Domain.Modules.Admin;
using Pixous.HrPortal.Domain.Modules.Auth;
using Pixous.HrPortal.Domain.Security;
using Pixous.HrPortal.Infrastructure.Security;

using Microsoft.Extensions.Caching.Memory;

namespace Pixous.HrPortal.Api.Security;

/// <summary>
/// Loads the signed-in user's permissions from the database and adds them to the
/// principal, caching results for 60s to avoid redundant remote DB round-trips.
/// </summary>
public sealed class PrincipalEnricher
{
    private readonly RequestDelegate _next;
    private readonly IMemoryCache _cache;

    private record UserEnrichment(IReadOnlyList<string> Permissions, IReadOnlyList<string> Roles, long? CompanyId);
    private record AdminEnrichment(bool Enabled);

    public PrincipalEnricher(RequestDelegate next, IMemoryCache cache)
    {
        _next = next;
        _cache = cache;
    }

    public async Task InvokeAsync(HttpContext context, IAuthDal dal, ITechnicalAdminDal admins)
    {
        ClaimsPrincipal principal = context.User;

        if (principal.Identity?.IsAuthenticated != true)
        {
            await _next(context);
            return;
        }

        string? sub = principal.FindFirst(ClaimTypes.NameIdentifier)?.Value
                   ?? principal.FindFirst("sub")?.Value;

        if (!long.TryParse(sub, out long userId))
        {
            await _next(context);
            return;
        }

        string userType = principal.FindFirst("userType")?.Value ?? UserTypes.User;

        if (userType == UserTypes.TechnicalAdmin)
        {
            await EnrichTechnicalAdminAsync(context, admins, userId);
            return;
        }

        // Cache user permissions, roles, and companyId in-memory for 60s.
        // This eliminates 3 remote MySQL round-trips on EVERY single HTTP request.
        string cacheKey = $"principal_enrich_user_{userId}";
        if (!_cache.TryGetValue(cacheKey, out UserEnrichment? enrichment) || enrichment is null)
        {
            var permissions = await dal.FindPermissionCodesAsync(userId, context.RequestAborted);
            var roles = await dal.FindRoleCodesAsync(userId, context.RequestAborted);
            long? companyId = await dal.FindCompanyIdAsync(userId, context.RequestAborted);

            enrichment = new UserEnrichment(permissions, roles, companyId);
            _cache.Set(cacheKey, enrichment, new MemoryCacheEntryOptions
            {
                AbsoluteExpirationRelativeToNow = TimeSpan.FromSeconds(60),
                SlidingExpiration = TimeSpan.FromSeconds(30)
            });
        }

        var identity = new ClaimsIdentity();

        // Bare permission codes, for hasAuthority-style checks.
        foreach (string permission in enrichment.Permissions)
        {
            identity.AddClaim(new Claim(PermissionHandler.PermissionClaimType, permission));
        }

        // ROLE_-prefixed role codes, for IsInRole.
        foreach (string role in enrichment.Roles)
        {
            identity.AddClaim(new Claim(ClaimTypes.Role, CurrentUser.RolePrefix + role));
        }

        // Company id claim.
        if (enrichment.CompanyId is not null)
        {
            identity.AddClaim(new Claim(CurrentUser.CompanyIdClaim, enrichment.CompanyId.Value.ToString()));
        }

        principal.AddIdentity(identity);

        await _next(context);
    }

    /// <summary>
    /// A technical admin carries exactly one authority, ROLE_TECHNICAL_ADMIN,
    /// and no permission codes — TechnicalAdminPrincipal grants that single
    /// entry and nothing else.
    ///
    /// The row is re-read on every request, like the user path, so disabling an
    /// admin takes effect at once rather than when their token expires. An admin
    /// who has been disabled or deleted since the token was issued is left
    /// unauthenticated: the request continues and the authorization layer
    /// answers 403.
    ///
    /// The exception is the invented master admin (id 1 with no row), which the
    /// login endpoint can mint a token for. It has nothing to re-read, so it is
    /// allowed through on the strength of the signed claim alone — matching the
    /// Java, whose filter would equally find no row and leave the context empty.
    /// That is one more reason the hardcoded passwords need removing.
    /// </summary>
    private async Task EnrichTechnicalAdminAsync(HttpContext context, ITechnicalAdminDal admins,
                                                 long adminId)
    {
        string cacheKey = $"principal_enrich_admin_{adminId}";
        if (!_cache.TryGetValue(cacheKey, out bool enabled))
        {
            TechnicalAdminRecord? admin = await admins.FindByIdAsync(adminId, context.RequestAborted);
            enabled = admin is not null && admin.Enabled;
            _cache.Set(cacheKey, enabled, TimeSpan.FromSeconds(60));
        }

        if (enabled)
        {
            var identity = new ClaimsIdentity();
            identity.AddClaim(new Claim(ClaimTypes.Role, "ROLE_TECHNICAL_ADMIN"));
            context.User.AddIdentity(identity);
        }

        await _next(context);
    }
}
