using Pixous.HrPortal.Domain.Common;

namespace Pixous.HrPortal.Domain.Modules.User;

/// <summary>
/// The employee directory and profile reads.
/// Ported from com.pixous.hrportal.modules.user.UserService.
///
/// Twenty-six modules depend on this module. What is ported here is the read
/// side — the directory, one profile, and the caller's own profile. The writes
/// (photo and cover upload, document upload, credentials, offboarding, bank
/// details, the employee import) are listed at the bottom of the migration notes
/// as still outstanding.
/// </summary>
public interface IUserBal
{
    /// <summary>
    /// The employee directory: paged, searchable, filterable. Sorted by name.
    /// </summary>
    Task<PageResponse<UserSummary>> DirectoryAsync(UserDirectoryQuery query,
                                                   CancellationToken ct = default);

    /// <summary>One employee's profile, or a not-found error.</summary>
    Task<UserSummary> GetByIdAsync(long userId, CancellationToken ct = default);

    // ---- the read-only views ----

    /// <summary>
    /// The caller's team (their designation) and its active members.
    ///
    /// Matched by title OR the designation id, so somebody carrying only a
    /// title still appears -- consistent with the Teams page. Somebody whose
    /// team matches nobody sees themselves rather than an empty page.
    /// </summary>
    Task<MyTeamResponse> MyTeamAsync(long userId, CancellationToken ct = default);

    /// <summary>One person's bank accounts.</summary>
    Task<IReadOnlyList<BankView>> ListBanksAsync(long userId, CancellationToken ct = default);

    /// <summary>
    /// The service record for everybody.
    ///
    /// Platform accounts are left out -- they are not employees. Newest joiner
    /// first, with anybody lacking a joining date LAST rather than first: a
    /// missing date is not a recent one.
    /// </summary>
    Task<IReadOnlyList<EmployeeHistoryRow>> HistoryAsync(bool includeRelieved,
                                                          CancellationToken ct = default);

    /// <summary>One person's service record.</summary>
    Task<EmployeeHistoryRow> HistoryForAsync(long userId, CancellationToken ct = default);

    /// <summary>Every extra team assignment, with the leader named.</summary>
    Task<IReadOnlyList<TeamLeaderRow>> TeamLeadersAsync(CancellationToken ct = default);

    /// <summary>The teams one leader covers: their own designation first, then the extras assigned to them.</summary>
    Task<IReadOnlyList<string>> TeamsOfAsync(long userId, CancellationToken ct = default);

    // ---- Profile & Employee writes ----

    Task<ProfileResponse> GetProfileAsync(long userId, CancellationToken ct = default);
    Task<ProfileResponse> UpdateProfileAsync(long userId, UpdateProfileRequest request, CancellationToken ct = default);
    Task<string> UpdatePhotoAsync(long userId, Stream fileStream, string? originalFileName, string? contentType, long sizeBytes, CancellationToken ct = default);
    Task RemovePhotoAsync(long userId, CancellationToken ct = default);
    Task<string> UpdateCoverPhotoAsync(long userId, Stream fileStream, string? originalFileName, string? contentType, long sizeBytes, CancellationToken ct = default);
    Task RemoveCoverPhotoAsync(long userId, CancellationToken ct = default);
    Task<string> StoreDocumentAsync(Stream fileStream, string? originalFileName, string? contentType, long sizeBytes, CancellationToken ct = default);
    Task<ProfileResponse> UpdateEmployeeAsync(long userId, UpdateEmployeeRequest request, CancellationToken ct = default);
    Task SetCredentialsAsync(long userId, string? username, string? password, CancellationToken ct = default);
    Task ClearDesignationAsync(long userId, CancellationToken ct = default);
    Task OffboardUserAsync(long userId, OffboardingRequest request, CancellationToken ct = default);
    Task<string?> GetCurrentPasswordAsync(long userId, CancellationToken ct = default);
    Task<FacePhotoResponse> SaveFacePhotoAsync(long userId, Stream fileStream, string? originalFileName, string? contentType, long sizeBytes, long? actorId, CancellationToken ct = default);
    Task ClearFacePhotoAsync(long userId, CancellationToken ct = default);
    Task<BankResponse> AddBankAsync(long userId, BankRequest request, CancellationToken ct = default);
    Task<BankResponse> UpdateBankAsync(long userId, long bankId, BankRequest request, CancellationToken ct = default);
    Task DeleteBankAsync(long userId, long bankId, CancellationToken ct = default);
    Task DeleteEmployeeAsync(long actorId, long userId, string? confirmName, CancellationToken ct = default);

    // ---- Team Leader extra assignments ----

    Task<TeamLeaderRow> AssignTeamAsync(long userId, string teamTitle, long? actorId, CancellationToken ct = default);
    Task RemoveTeamAssignmentAsync(long userId, string teamTitle, CancellationToken ct = default);
    Task ClearTeamAssignmentsAsync(long userId, CancellationToken ct = default);
}

/// <summary>
/// What the directory was asked for. Every filter is optional, so a call that
/// sends none of them behaves exactly as it always did.
/// </summary>
public sealed record UserDirectoryQuery
{
    public string? Q { get; init; }
    public string? Industry { get; init; }
    public long? DepartmentId { get; init; }
    public long? DesignationId { get; init; }
    public string? DesignationTitle { get; init; }
    public string? RoleCode { get; init; }
    public DateOnly? JoinedFrom { get; init; }
    public DateOnly? JoinedTo { get; init; }

    /// <summary>ACTIVE or OFFBOARDED. Anything else is ignored, as in the Java.</summary>
    public string? Status { get; init; }

    public int Page { get; init; }
    public int Size { get; init; } = 20;
}

/// <summary>
/// Compact row used in employee directory tables.
/// Field order follows the Java record, because that is the JSON order.
/// </summary>
public sealed record UserSummary(
    long Id,
    string? EmployeeCode,
    string? Name,

    /// <summary>Login name. The password hash is never exposed.</summary>
    string? Username,

    string? Email,
    string? Phone,
    string? Industry,
    long? DepartmentId,
    string? ProfileStatus,
    string? PhotoPath,
    DateOnly? Dob,
    IReadOnlyList<string> Roles,
    long? DesignationId,
    string? DesignationTitle,
    string? TechStack,

    /// <summary>
    /// The readable-back password, decrypted from the vault. Null when nothing
    /// is stored or the value predates the current secret. This is a product
    /// requirement — HR reads passwords off the employee record — and it is only
    /// ever populated for callers who already hold USER_MANAGE or
    /// EMPLOYEE_MANAGE.
    /// </summary>
    string? Password,

    long? CompanyId,
    string? CompanyName,

    /// <summary>
    /// Whether this account is somebody who turns up for work. False for the
    /// desk logins — the HR inbox, the company admin and the platform accounts.
    /// </summary>
    bool Employee);

/// <summary>The caller's team and its active members.</summary>
public sealed record MyTeamResponse(string TeamName, IReadOnlyList<TeamMemberView> Members);

/// <summary>Enough of a teammate to list them.</summary>
public sealed record TeamMemberView(
    long Id,
    string? Name,
    string? EmployeeCode,
    string? DesignationTitle,
    string? PhotoPath);

/// <summary>One bank account.</summary>
public sealed record BankView(
    long Id,
    string? BankName,
    string? BranchName,
    string? AccountNumber,
    string? IfscCode,
    string? AccountHolderName,

    /// <summary>Serialised as "primary" — the Java record component is named that.</summary>
    bool Primary);

/// <summary>
/// One employee's service record: when they joined, what changed, and when they
/// left.
///
/// A different question from the directory, which says who is here NOW. This
/// says what has happened, and it deliberately outlives the employment.
/// </summary>
public sealed record EmployeeHistoryRow(
    long Id,
    string? EmployeeCode,
    string? Name,
    string? Email,
    string? Phone,
    string? DesignationTitle,
    string? DepartmentTitle,
    IReadOnlyList<string> Roles,
    DateOnly? DateOfJoining,
    DateOnly? ProbationEndDate,
    string? EmploymentStatus,
    string? ProfileStatus,
    DateOnly? RelievingDate,
    string? RelievingReason,
    string? FnfStatus,

    /// <summary>Months served, to the relieving date or to today.</summary>
    int TenureMonths);

/// <summary>A team leader and one team they cover.</summary>
public sealed record TeamLeaderRow(
    long Id,
    long UserId,
    string? Name,
    string? Code,

    /// <summary>Their own designation.</summary>
    string? OwnTeam,

    /// <summary>The extra team this row assigns them.</summary>
    string? TeamTitle);
