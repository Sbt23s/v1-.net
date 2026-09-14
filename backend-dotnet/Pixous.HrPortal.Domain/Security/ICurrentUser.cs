namespace Pixous.HrPortal.Domain.Security;

/// <summary>
/// The signed-in principal for the request being handled.
/// Ported from com.pixous.hrportal.security.SecurityUtils, which reads the same
/// information out of Spring's SecurityContextHolder.
///
/// BAL classes take this rather than reading HttpContext, so business rules
/// stay testable and no service layer depends on ASP.NET types.
/// </summary>
public interface ICurrentUser
{
    /// <summary>The signed-in user's id, or null when the request is anonymous.</summary>
    long? UserId { get; }

    /// <summary>The username claim, or null when the request is anonymous.</summary>
    string? Username { get; }

    /// <summary>"USER" or "TECHNICAL_ADMIN"; null when anonymous.</summary>
    string? UserType { get; }

    /// <summary>Role names, without any framework prefix. Empty when anonymous.</summary>
    IReadOnlyList<string> Roles { get; }

    /// <summary>
    /// The company this principal belongs to, or null.
    ///
    /// Mirrors SecurityUtils.currentCompanyId(), which reads it off the
    /// principal rather than the token -- the claim is not in the JWT, so this
    /// is resolved per request alongside the permissions.
    /// </summary>
    long? CompanyId { get; }

    bool IsAuthenticated { get; }

    /// <summary>
    /// The signed-in user's id, or a thrown ApiException when the request is
    /// anonymous. For the many service methods that cannot proceed without one
    /// and would otherwise each repeat the same null check.
    /// </summary>
    long RequireUserId();

    bool IsInRole(string role);

    /// <summary>
    /// Whether the principal holds a bare permission code, such as
    /// "USER_MANAGE".
    ///
    /// Mirrors SecurityUtils.hasAuthority. Most authorisation is declared on the
    /// endpoint with [Authorize(Policy = ...)], but a few rules are decided in
    /// the business layer because they depend on the record being read -- a
    /// request thread is readable by the two people it concerns OR by whoever
    /// oversees the process, and only the last of those is a permission.
    ///
    /// Permission codes and ROLE_-prefixed roles share one claim type, as they
    /// share one authority list in Spring, so this deliberately matches the
    /// BARE code and never the prefixed form.
    /// </summary>
    bool HasPermission(string permissionCode);
}

public static class CurrentUserExtensions
{
    public static bool HasAnyPermission(this ICurrentUser user, params string[] permissions)
    {
        foreach (string permission in permissions)
        {
            if (user.HasPermission(permission)) return true;
        }
        return false;
    }
}
