using System.Security.Claims;
using Pixous.HrPortal.Domain.Modules.Admin;
using Pixous.HrPortal.Domain.Modules.Auth;
using Pixous.HrPortal.Domain.Security;
using Pixous.HrPortal.Infrastructure.Security;

namespace Pixous.HrPortal.Api.Security;

/// <summary>
/// Loads the signed-in user's permissions from the database and adds them to the
/// principal, once per request.
///
/// This is the piece that makes the authorization checks behave like Spring's,
/// and it is not an optimisation detail -- getting it wrong silently changes who
/// can do what.
///
/// The access token carries only ROLE CODES:
///
///     {"sub":"6","roles":["SUPER_ADMIN"],"userType":"USER", ...}
///
/// Spring never reads permissions from the token either. JwtAuthenticationFilter
/// takes the subject, loads the user, and UserPrincipal builds the authority
/// list from the database on every request: one "ROLE_&lt;code&gt;" per role, plus
/// every permission code those roles grant, unprefixed. hasAuthority('X') then
/// matches the bare code.
///
/// So the permissions MUST be resolved per request rather than trusted from the
/// token, and that has a consequence worth stating plainly: a permission removed
/// from a role stops working immediately, for sessions already signed in. Had
/// this read the token instead, a revoked permission would keep working for the
/// remaining life of that token -- up to four hours -- which is a security
/// regression that no test of a happy path would have caught.
///
/// Roles keep their ROLE_ prefix here so ClaimsPrincipal.IsInRole works; the
/// permission codes are added bare, under the same claim type the token uses, so
/// PermissionRequirement finds both in one place.
/// </summary>
public sealed class PrincipalEnricher
{
    private readonly RequestDelegate _next;

    public PrincipalEnricher(RequestDelegate next)
    {
        _next = next;
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

        // Which store the subject belongs to. The Java filter branches the same
        // way: a TECHNICAL_ADMIN token resolves against technical_admins, and
        // anything else -- including a token minted before the claim existed --
        // resolves against users.
        string userType = principal.FindFirst("userType")?.Value ?? UserTypes.User;

        if (userType == UserTypes.TechnicalAdmin)
        {
            await EnrichTechnicalAdminAsync(context, admins, userId);
            return;
        }

        var identity = new ClaimsIdentity();

        // Bare permission codes, for hasAuthority-style checks.
        foreach (string permission in await dal.FindPermissionCodesAsync(userId, context.RequestAborted))
        {
            identity.AddClaim(new Claim(PermissionHandler.PermissionClaimType, permission));
        }

        // ROLE_-prefixed role codes, for IsInRole. The token already carries the
        // bare codes under the same claim type, which is what the role-code
        // readers expect, so both spellings end up present -- exactly as Spring's
        // authority list holds both.
        foreach (string role in await dal.FindRoleCodesAsync(userId, context.RequestAborted))
        {
            identity.AddClaim(new Claim(ClaimTypes.Role, CurrentUser.RolePrefix + role));
        }

        // The company id is not in the token either, and SecurityUtils reads it
        // off the principal. Resolved here so a tenant reassignment takes effect
        // at once, like the permissions above.
        long? companyId = await dal.FindCompanyIdAsync(userId, context.RequestAborted);
        if (companyId is not null)
        {
            identity.AddClaim(new Claim(CurrentUser.CompanyIdClaim, companyId.Value.ToString()));
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
        TechnicalAdminRecord? admin = await admins.FindByIdAsync(adminId, context.RequestAborted);

        if (admin is not null && admin.Enabled)
        {
            var identity = new ClaimsIdentity();
            identity.AddClaim(new Claim(ClaimTypes.Role, "ROLE_TECHNICAL_ADMIN"));
            context.User.AddIdentity(identity);
        }

        await _next(context);
    }
}
