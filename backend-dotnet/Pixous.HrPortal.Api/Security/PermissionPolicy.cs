using Microsoft.AspNetCore.Authorization;

namespace Pixous.HrPortal.Api.Security;

/// <summary>
/// The ASP.NET equivalent of Spring's
/// <c>@PreAuthorize("hasAnyAuthority('A','B')")</c>.
///
/// Spring's hasAuthority matches a BARE permission code -- "USER_MANAGE" -- while
/// hasRole('X') matches "ROLE_X", because Spring prefixes the argument. Both
/// kinds live in the same authority list, and UserPrincipal puts both there: one
/// ROLE_&lt;code&gt; entry per role, plus every permission code that role grants,
/// unprefixed.
///
/// So a permission check must NOT go through the role machinery, which would
/// look for "ROLE_USER_MANAGE" and find nothing -- silently denying every
/// request it guards. This requirement matches the bare codes directly.
///
/// Usage mirrors the Java one-for-one:
///
///     @PreAuthorize("hasAuthority('USER_MANAGE')")
///     [Authorize(Policy = "USER_MANAGE")]
///
///     @PreAuthorize("hasAnyAuthority('ATTENDANCE_TEAM','USER_MANAGE')")
///     [Authorize(Policy = "ATTENDANCE_TEAM,USER_MANAGE")]
///
/// Holding ANY of the listed codes is enough, which is what hasAnyAuthority
/// means. A single code is just the one-element case.
/// </summary>
public sealed class PermissionRequirement : IAuthorizationRequirement
{
    public PermissionRequirement(IReadOnlyList<string> permissions, bool allowTechnicalAdmin)
    {
        Permissions = permissions;
        AllowTechnicalAdmin = allowTechnicalAdmin;
    }

    public IReadOnlyList<string> Permissions { get; }

    /// <summary>
    /// Whether a technical admin satisfies this policy without holding any of
    /// the codes -- the `or hasRole('TECHNICAL_ADMIN')` half of the Java guard.
    /// Opt-in per endpoint, because most guards do NOT carry that clause and
    /// granting it everywhere would widen access the Java does not.
    ///
    /// Written on the attribute as a trailing "+TECHNICAL_ADMIN":
    ///     [Authorize(Policy = "USER_MANAGE,ATTENDANCE_TEAM+TECHNICAL_ADMIN")]
    /// </summary>
    public bool AllowTechnicalAdmin { get; }
}

public sealed class PermissionHandler : AuthorizationHandler<PermissionRequirement>
{
    /// <summary>
    /// The claim the permission codes arrive in. The token carries roles and
    /// permission codes together under "roles", exactly as the Java authority
    /// list holds both.
    /// </summary>
    public const string PermissionClaimType = "roles";

    /// <summary>
    /// The role a technical admin carries. Several Java endpoints spell their
    /// guard as `hasAnyAuthority(...) or hasRole('TECHNICAL_ADMIN')` -- the
    /// employee directory and the user writes among them -- so a principal
    /// holding this role satisfies those policies without holding any permission
    /// code. It carries none: TechnicalAdminPrincipal grants exactly one
    /// authority and no permissions at all, so without this branch every such
    /// endpoint answers 403 to the very admin it was widened for.
    /// </summary>
    public const string TechnicalAdminRole = "ROLE_TECHNICAL_ADMIN";

    protected override Task HandleRequirementAsync(AuthorizationHandlerContext context,
                                                   PermissionRequirement requirement)
    {
        bool holds = context.User
            .FindAll(PermissionClaimType)
            .Any(claim => requirement.Permissions.Contains(claim.Value, StringComparer.Ordinal));

        if (!holds && requirement.AllowTechnicalAdmin && context.User.IsInRole(TechnicalAdminRole))
        {
            holds = true;
        }

        if (holds)
        {
            context.Succeed(requirement);
        }

        return Task.CompletedTask;
    }
}

/// <summary>
/// Builds a policy on demand for any comma-separated list of permission codes,
/// so a controller can name the codes inline instead of every combination being
/// registered up front. There are 29 permissions in the database and the Java
/// controllers combine them freely.
/// </summary>
public sealed class PermissionPolicyProvider : IAuthorizationPolicyProvider
{
    private readonly DefaultAuthorizationPolicyProvider _fallback;

    public PermissionPolicyProvider(Microsoft.Extensions.Options.IOptions<AuthorizationOptions> options)
    {
        _fallback = new DefaultAuthorizationPolicyProvider(options);
    }

    public Task<AuthorizationPolicy> GetDefaultPolicyAsync() => _fallback.GetDefaultPolicyAsync();

    public Task<AuthorizationPolicy?> GetFallbackPolicyAsync() => _fallback.GetFallbackPolicyAsync();

    public Task<AuthorizationPolicy?> GetPolicyAsync(string policyName)
    {
        // A policy name here is the permission list itself. Anything that does
        // not look like one is left to the default provider, so explicitly
        // registered policies keep working.
        // A trailing "+TECHNICAL_ADMIN" marks the endpoints whose Java guard
        // ends with `or hasRole('TECHNICAL_ADMIN')`.
        const string TechAdminSuffix = "+TECHNICAL_ADMIN";
        bool allowTechnicalAdmin = policyName.EndsWith(TechAdminSuffix, StringComparison.Ordinal);
        if (allowTechnicalAdmin)
        {
            policyName = policyName[..^TechAdminSuffix.Length];
        }

        string[] codes = policyName
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

        if (codes.Length == 0 || !codes.All(LooksLikePermissionCode))
        {
            return _fallback.GetPolicyAsync(policyName);
        }

        var policy = new AuthorizationPolicyBuilder()
            .RequireAuthenticatedUser()
            .AddRequirements(new PermissionRequirement(codes, allowTechnicalAdmin))
            .Build();

        return Task.FromResult<AuthorizationPolicy?>(policy);
    }

    /// <summary>
    /// Permission codes are upper snake case -- USER_MANAGE, ATTENDANCE_TEAM.
    /// Requiring that shape keeps an ordinary policy name from being mistaken
    /// for a permission and silently granted a policy nobody registered.
    /// </summary>
    private static bool LooksLikePermissionCode(string value) =>
        value.Length > 0 && value.All(c => char.IsAsciiLetterUpper(c) || char.IsAsciiDigit(c) || c == '_');
}
