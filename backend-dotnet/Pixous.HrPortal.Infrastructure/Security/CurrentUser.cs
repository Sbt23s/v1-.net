using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Pixous.HrPortal.Domain.Common;
using Pixous.HrPortal.Domain.Security;

namespace Pixous.HrPortal.Infrastructure.Security;

/// <summary>
/// Reads the signed-in principal out of the current request.
/// Ported from com.pixous.hrportal.security.SecurityUtils.
///
/// The authority scheme is the one UserPrincipal builds, and it is two schemes
/// at once: each role contributes BOTH a "ROLE_&lt;code&gt;" authority (what
/// hasRole checks, since Spring prefixes the argument) AND every permission
/// code that role grants, bare (what hasAuthority checks). So a Technical Admin
/// carries "ROLE_TECHNICAL_ADMIN" while a permission carries plain
/// "USER_MANAGE" with no prefix.
///
/// Getting that backwards silently grants or denies the wrong things, so the
/// prefix handling is kept explicit here rather than left to framework defaults.
/// </summary>
public sealed class CurrentUser : ICurrentUser
{
    /// <summary>The prefix Spring Security puts in front of a role code.</summary>
    public const string RolePrefix = "ROLE_";

    private readonly IHttpContextAccessor _accessor;

    public CurrentUser(IHttpContextAccessor accessor)
    {
        _accessor = accessor;
    }

    private ClaimsPrincipal? Principal => _accessor.HttpContext?.User;

    public bool IsAuthenticated => Principal?.Identity?.IsAuthenticated == true;

    public long? UserId
    {
        get
        {
            string? sub = Principal?.FindFirst(ClaimTypes.NameIdentifier)?.Value
                       ?? Principal?.FindFirst("sub")?.Value;
            return long.TryParse(sub, out long id) ? id : null;
        }
    }

    public string? Username => Principal?.FindFirst("username")?.Value;

    /// <summary>
    /// Added to the principal per request by PrincipalEnricher, because the
    /// token does not carry it. Null for a technical admin, who belongs to no
    /// company.
    /// </summary>
    public long? CompanyId
    {
        get
        {
            string? value = Principal?.FindFirst(CompanyIdClaim)?.Value;
            return long.TryParse(value, out long id) ? id : null;
        }
    }

    /// <summary>The claim PrincipalEnricher writes the company id into.</summary>
    public const string CompanyIdClaim = "companyId";

    public string? UserType => IsAuthenticated
        ? Principal?.FindFirst("userType")?.Value ?? UserTypes.User
        : null;

    /// <summary>
    /// Role codes with the ROLE_ prefix stripped, so a caller asking for
    /// "TECHNICAL_ADMIN" gets it under the name it has in the database rather
    /// than the framework's decorated form.
    /// </summary>
    public IReadOnlyList<string> Roles =>
        Principal?.FindAll(ClaimTypes.Role)
                  .Select(c => c.Value)
                  .Where(v => v.StartsWith(RolePrefix, StringComparison.Ordinal))
                  .Select(v => v[RolePrefix.Length..])
                  .ToArray()
        ?? [];

    public long RequireUserId() =>
        UserId ?? throw new ApiException(ErrorCode.Unauthenticated, "Not authenticated");

    /// <summary>
    /// True when the principal holds this bare permission code.
    ///
    /// The claim type is shared with the roles, so the ROLE_-prefixed entries
    /// are skipped: a permission is always the bare code, and matching a
    /// prefixed value here would let a role named like a permission stand in
    /// for one.
    /// </summary>
    public bool HasPermission(string permissionCode) =>
        Principal?.FindAll(PermissionClaimType)
                  .Any(c => !c.Value.StartsWith(RolePrefix, StringComparison.Ordinal)
                         && string.Equals(c.Value, permissionCode, StringComparison.Ordinal))
        ?? false;

    /// <summary>
    /// The claim both permissions and roles are written into -- "roles", which
    /// is also what the bearer options use as the role claim type.
    /// </summary>
    public const string PermissionClaimType = "roles";

    /// <summary>
    /// True when the principal holds this role. Accepts the code either bare or
    /// already prefixed, because both spellings appear in the Java call sites.
    /// </summary>
    public bool IsInRole(string role)
    {
        if (Principal is null)
        {
            return false;
        }

        string prefixed = role.StartsWith(RolePrefix, StringComparison.Ordinal)
            ? role
            : RolePrefix + role;

        return Principal.IsInRole(prefixed);
    }
}
