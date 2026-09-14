using Pixous.HrPortal.Domain.Modules.User;

namespace Pixous.HrPortal.Domain.Modules.Auth;

/// <summary>
/// Data access for the authentication flows.
///
/// The "across tenants" naming is carried over from the Java repository and is
/// not decoration. Which company someone belongs to is what signing in
/// establishes, so it cannot also be a precondition for finding them: the
/// derived JPA queries carry a tenant filter that would narrow the lookup to
/// the company already in context, making an account from any other tenant
/// indistinguishable from one that does not exist. Usernames are unique across
/// all tenants, so these resolve to exactly one row or none.
/// </summary>
public interface IAuthDal
{
    /// <summary>The account with this username, ignoring any tenant scoping.</summary>
    Task<UserRecord?> FindByUsernameAcrossTenantsAsync(string username, CancellationToken ct = default);

    /// <summary>
    /// Accounts whose full name matches, case-insensitively. The login fallback
    /// uses this and accepts the match only when exactly one row comes back.
    /// </summary>
    Task<IReadOnlyList<UserRecord>> FindByNameAcrossTenantsAsync(string name, CancellationToken ct = default);

    Task<UserRecord?> FindByIdAsync(long userId, CancellationToken ct = default);

    /// <summary>Role codes held by this user.</summary>
    Task<IReadOnlyList<string>> FindRoleCodesAsync(long userId, CancellationToken ct = default);

    /// <summary>Distinct permission codes granted by this user's roles.</summary>
    Task<IReadOnlyList<string>> FindPermissionCodesAsync(long userId, CancellationToken ct = default);

    /// <summary>The company this user belongs to, or null.</summary>
    Task<long?> FindCompanyIdAsync(long userId, CancellationToken ct = default);

    /// <summary>The company's display name, or null when the id names no row.</summary>
    Task<string?> FindCompanyNameAsync(long companyId, CancellationToken ct = default);

    /// <summary>Every company, used by the login repair path for its single-tenant fallback.</summary>
    Task<IReadOnlyList<(long Id, string? CompanyName)>> FindAllCompaniesAsync(CancellationToken ct = default);

    /// <summary>Counters and timestamps written after a successful sign-in.</summary>
    Task MarkLoginSucceededAsync(long userId, DateTime lastLoginAt, CancellationToken ct = default);

    /// <summary>The failed-attempt counter, and the lock that follows it.</summary>
    Task UpdateFailedAttemptAsync(long userId, int failedLoginCount, DateTime? lockedUntil,
                                  CancellationToken ct = default);

    /// <summary>Repairs a row whose company_id is null once its owner has proved who they are.</summary>
    Task SetCompanyIdAsync(long userId, long companyId, CancellationToken ct = default);

    /// <summary>
    /// Writes the audit row for a sign-in attempt. This must never decide the
    /// outcome of the attempt -- see the note on the BAL's RecordLogin.
    /// </summary>
    Task InsertLoginHistoryAsync(long? userId, string? username, bool success,
                                 string? ipAddress, string? userAgent,
                                 CancellationToken ct = default);

    Task InsertRefreshTokenAsync(long userId, string token, DateTime expiresAt,
                                 CancellationToken ct = default);

    Task<RefreshTokenRecord?> FindRefreshTokenAsync(string token, CancellationToken ct = default);

    Task RevokeRefreshTokenAsync(long id, CancellationToken ct = default);

    Task RevokeAllRefreshTokensForUserAsync(long userId, CancellationToken ct = default);

    Task UpdatePasswordAsync(long userId, string passwordHash, CancellationToken ct = default);

    Task<bool> PhoneExistsAsync(string phone, CancellationToken ct = default);

    Task<bool> UsernameExistsAsync(string username, CancellationToken ct = default);

    Task<long> CountByUsernameAcrossTenantsAsync(string username, CancellationToken ct = default);
    Task<long> CountByAadharAcrossTenantsAsync(string aadhar, CancellationToken ct = default);
    Task<long> CountByPhoneAcrossTenantsAsync(string phone, CancellationToken ct = default);
    Task<long> CountByEmployeeCodeAcrossTenantsAsync(string code, CancellationToken ct = default);
    Task<string?> FindMaxEmployeeCodeAcrossTenantsAsync(string prefix, CancellationToken ct = default);

    Task<long> InsertUserAsync(
        long? companyId,
        string employeeCode,
        string username,
        string name,
        string? dob,
        char? gender,
        string? aadhar,
        string? phone,
        string? email,
        string passwordHash,
        string? passwordVault,
        string? careOf,
        string? house,
        string? street,
        string? locality,
        string? vtc,
        string? district,
        string? state,
        string? country,
        string? pincode,
        string? postOffice,
        string industry,
        long? departmentId,
        long? designationId,
        long? officeLocationId,
        long? reportingManagerId,
        string? pan,
        string? pfNumber,
        string? alternatePhone,
        string? emergencyContact,
        string? emergencyContactRelation,
        string? bloodGroup,
        string? personalEmail,
        string? designationTitle,
        string? departmentTitle,
        string? positionTitle,
        string profileStatus,
        bool enabled,
        string? dateOfJoining,
        string? documents,
        string defaultRole,
        CancellationToken ct = default);

    Task<long> CreateImportBatchAsync(string fileName, int totalRows, long? importedBy, CancellationToken ct = default);
    Task FinishImportBatchAsync(long batchId, int createdCount, int failedCount, CancellationToken ct = default);
    Task StampUserImportBatchAsync(long userId, long batchId, CancellationToken ct = default);
    Task<IReadOnlyList<EmployeeImportRecord>> ListImportBatchesAsync(CancellationToken ct = default);
    Task<EmployeeImportRecord?> FindImportBatchByIdAsync(long batchId, CancellationToken ct = default);
    Task<IReadOnlyList<UserRecord>> FindUsersByImportBatchAsync(long batchId, CancellationToken ct = default);
    Task<IReadOnlyDictionary<long, string>> FindInUseReasonsAsync(IReadOnlyList<long> userIds, CancellationToken ct = default);
    Task MarkImportBatchRevertedAsync(long batchId, long? actorId, CancellationToken ct = default);
    Task DeleteImportBatchRecordAsync(long batchId, CancellationToken ct = default);
    Task<IReadOnlyList<UserRecord>> FindAllUsersForImportAdoptAsync(CancellationToken ct = default);
}

/// <summary>A row of <c>employee_imports</c>.</summary>
public sealed class EmployeeImportRecord
{
    public long Id { get; set; }
    public string FileName { get; set; } = string.Empty;
    public DateTime ImportedAt { get; set; }
    public string? ImportedBy { get; set; }
    public int TotalRows { get; set; }
    public int CreatedCount { get; set; }
    public int FailedCount { get; set; }
    public int Remaining { get; set; }
    public DateTime? RevertedAt { get; set; }
}

/// <summary>A row of <c>refresh_tokens</c>.</summary>
public sealed class RefreshTokenRecord
{
    public long Id { get; set; }
    public long UserId { get; set; }
    public string Token { get; set; } = string.Empty;
    public DateTime ExpiresAt { get; set; }
    public bool Revoked { get; set; }
}

