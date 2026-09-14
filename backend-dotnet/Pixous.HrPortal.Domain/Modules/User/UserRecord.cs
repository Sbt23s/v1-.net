namespace Pixous.HrPortal.Domain.Modules.User;

/// <summary>
/// A row of the <c>users</c> table, carrying the columns the auth flows read
/// and write. Ported from com.pixous.hrportal.modules.user.User, which maps
/// many more columns -- the rest are added as the modules that need them are.
///
/// A mutable class rather than a record: the login flow updates counters and
/// timestamps on it before saving, exactly as the JPA entity does.
/// </summary>
public sealed class UserRecord
{
    public long Id { get; set; }
    public long? CompanyId { get; set; }
    public string? EmployeeCode { get; set; }
    public string Username { get; set; } = string.Empty;
    public string? Name { get; set; }
    public string? Aadhar { get; set; }
    public string? Phone { get; set; }
    public string? Email { get; set; }
    public string? Industry { get; set; }
    public string? PhotoPath { get; set; }

    /// <summary>The BCrypt hash. Never leaves the backend.</summary>
    public string PasswordHash { get; set; } = string.Empty;

    public bool Enabled { get; set; }
    public int FailedLoginCount { get; set; }

    /// <summary>
    /// When set and in the future, the account is locked. Compared against
    /// local time, because the column is a naive DATETIME written in
    /// Asia/Kolkata by the Java side.
    /// </summary>
    public DateTime? LockedUntil { get; set; }

    public DateTime? LastLoginAt { get; set; }
    public long? ImportBatchId { get; set; }
}

/// <summary>A role code with the permission codes it grants.</summary>
public sealed class RoleRecord
{
    public long Id { get; set; }
    public string Code { get; set; } = string.Empty;
    public string? Name { get; set; }
}
