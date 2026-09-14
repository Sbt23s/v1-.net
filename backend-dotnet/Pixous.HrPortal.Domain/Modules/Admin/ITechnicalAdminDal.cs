namespace Pixous.HrPortal.Domain.Modules.Admin;

/// <summary>
/// Data access for the technical-admin realm — the SaaS control centre, whose
/// principals live in <c>technical_admins</c> rather than <c>users</c>.
/// </summary>
public interface ITechnicalAdminDal
{
    Task<TechnicalAdminRecord?> FindByUsernameAsync(string username, CancellationToken ct = default);

    Task<TechnicalAdminRecord?> FindByIdAsync(long id, CancellationToken ct = default);
}

/// <summary>A row of <c>technical_admins</c>.</summary>
public sealed class TechnicalAdminRecord
{
    public long Id { get; set; }
    public string Username { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string? Email { get; set; }
    public string PasswordHash { get; set; } = string.Empty;
    public bool Enabled { get; set; }
    public bool MfaEnabled { get; set; }
    public int FailedLoginCount { get; set; }
    public DateTime? LockedUntil { get; set; }
    public DateTime? LastLoginAt { get; set; }
}
