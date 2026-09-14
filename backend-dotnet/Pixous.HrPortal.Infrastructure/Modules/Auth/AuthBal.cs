using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Pixous.HrPortal.Domain.Common;
using Pixous.HrPortal.Domain.Modules.Auth;
using Pixous.HrPortal.Domain.Modules.Auth.Dto;
using Pixous.HrPortal.Domain.Modules.User;
using Pixous.HrPortal.Domain.Security;
using Pixous.HrPortal.Infrastructure.Configuration;

namespace Pixous.HrPortal.Infrastructure.Modules.Auth;

/// <summary>
/// All authentication flows, ported from com.pixous.hrportal.modules.auth.AuthService.
///
/// The ORDER of the checks in <see cref="LoginAsync"/> is part of the contract,
/// not an implementation detail. Each step's failure has its own status and its
/// own audit consequence, and moving one changes what a caller can learn and
/// what gets written on their behalf. The Java comments explaining why are kept
/// against the step they explain.
/// </summary>
public sealed class AuthBal : IAuthBal
{
    private readonly IAuthDal _dal;
    private readonly IJwtService _jwt;
    private readonly IPasswordHasher _passwords;
    private readonly IPasswordVault _vault;
    private readonly ICurrentUser _currentUser;
    private readonly IServiceProvider _services;
    private readonly AppOptions _options;
    private readonly ILogger<AuthBal> _log;

    public AuthBal(IAuthDal dal,
                   IJwtService jwt,
                   IPasswordHasher passwords,
                   IPasswordVault vault,
                   ICurrentUser currentUser,
                   IServiceProvider services,
                   IOptions<AppOptions> options,
                   ILogger<AuthBal> log)
    {
        _dal = dal;
        _jwt = jwt;
        _passwords = passwords;
        _vault = vault;
        _currentUser = currentUser;
        _services = services;
        _options = options.Value;
        _log = log;
    }

    public async Task<LoginResponse> LoginAsync(LoginRequest request, string? ip, string? userAgent,
                                                CancellationToken ct = default)
    {
        string username = request.Username?.Trim() ?? string.Empty;

        // Resolved across every tenant, deliberately. Which company someone
        // belongs to is what signing in establishes; it cannot also be a
        // precondition for finding them. Usernames are unique across all
        // tenants, so this resolves to exactly one account or none.
        UserRecord? user = await _dal.FindByUsernameAcrossTenantsAsync(username, ct);

        // Fallback: allow login by full employee name (case-insensitive) when the
        // input isn't a known username and exactly one employee has that name.
        // Existing username logins (admin, managers, ...) are unaffected.
        if (user is null && !string.IsNullOrWhiteSpace(username))
        {
            IReadOnlyList<UserRecord> byName = await _dal.FindByNameAcrossTenantsAsync(username, ct);
            if (byName.Count == 1)
            {
                user = byName[0];
            }
        }

        if (user is null)
        {
            await RecordLoginAsync(null, username, false, ip, userAgent, ct);
            throw new ApiException(ErrorCode.BadCredentials, "Invalid username or password");
        }

        // Local time, not UTC: locked_until is a naive DATETIME written in
        // Asia/Kolkata by the Java side, and comparing it against UtcNow would
        // release a lock five and a half hours early on this deployment.
        if (user.LockedUntil is not null && user.LockedUntil > DateTime.Now)
        {
            await RecordLoginAsync(user.Id, username, false, ip, userAgent, ct);
            throw new ApiException(ErrorCode.AccountLocked,
                "Account locked due to failed attempts. Try again later.");
        }

        if (!_passwords.Verify(request.Password ?? string.Empty, user.PasswordHash))
        {
            await HandleFailedAttemptAsync(user, ct);
            await RecordLoginAsync(user.Id, username, false, ip, userAgent, ct);
            throw new ApiException(ErrorCode.BadCredentials, "Invalid username or password");
        }

        // After the password check, and with no audit row: a disabled account
        // that gave the right password is a different thing from a failed
        // attempt, and Java does not record it as one.
        if (!user.Enabled)
        {
            throw new ApiException(ErrorCode.AccessDenied, "Account is disabled. Contact HR.");
        }

        // A login must not be refused for a bookkeeping gap.
        //
        // Some accounts carry no company_id: the legacy rows that predate
        // multi-tenancy, and any account written while the creator had no tenant
        // of their own. Their owner has just proved who they are, so the right
        // thing is to repair the row and let them in rather than turn them away
        // for something they cannot see or fix.
        //
        // This runs AFTER the password check, not before -- it used to write to
        // the database on behalf of anyone who merely typed a known username,
        // which is a write no unauthenticated request should be able to cause.
        // And it no longer looks for one company by name: "Pixous Technologies"
        // is not present in every deployment, and on a platform whose purpose is
        // adding tenants, a hard-coded name is a bug waiting for the next
        // company. The account's own company is preferred, and a single-tenant
        // install falls back to the only company there is.
        if (user.CompanyId is null)
        {
            IReadOnlyList<(long Id, string? CompanyName)> all = await _dal.FindAllCompaniesAsync(ct);

            long? home = all.FirstOrDefault(c => c.CompanyName == "Pixous Technologies") is { Id: > 0 } named
                ? named.Id
                : all.Count == 1 ? all[0].Id : null;

            if (home is not null)
            {
                user.CompanyId = home;
                await _dal.SetCompanyIdAsync(user.Id, home.Value, ct);
            }
            else
            {
                await RecordLoginAsync(user.Id, username, false, ip, userAgent, ct);
                throw new ApiException(ErrorCode.AccessDenied,
                    "Your account is not linked to a company. Ask an administrator to set one.");
            }
        }

        // success
        DateTime now = DateTime.Now;
        user.FailedLoginCount = 0;
        user.LockedUntil = null;
        user.LastLoginAt = now;
        await _dal.MarkLoginSucceededAsync(user.Id, now, ct);
        await RecordLoginAsync(user.Id, username, true, ip, userAgent, ct);

        return await BuildLoginResponseAsync(user, ct);
    }

    /// <summary>
    /// Counts a failed attempt and locks the account once the limit is reached.
    ///
    /// Note that the counter is RESET when the lock is applied, so the next lock
    /// takes another full run of failures rather than following immediately from
    /// the attempt after the lock expires.
    /// </summary>
    private async Task HandleFailedAttemptAsync(UserRecord user, CancellationToken ct)
    {
        int attempts = user.FailedLoginCount + 1;
        DateTime? lockedUntil = null;

        if (attempts >= _options.Security.MaxFailedLoginAttempts)
        {
            lockedUntil = DateTime.Now.AddMinutes(_options.Security.AccountLockMinutes);
            attempts = 0;
            _log.LogWarning("Account {Username} locked after repeated failures", user.Username);
        }

        user.FailedLoginCount = attempts;
        user.LockedUntil = lockedUntil;
        await _dal.UpdateFailedAttemptAsync(user.Id, attempts, lockedUntil, ct);
    }

    public async Task<TokenPair> RefreshAsync(RefreshRequest request, CancellationToken ct = default)
    {
        RefreshTokenRecord stored =
            await _dal.FindRefreshTokenAsync(request.RefreshToken ?? string.Empty, ct)
            ?? throw new ApiException(ErrorCode.TokenExpired, "Invalid refresh token");

        if (stored.Revoked || stored.ExpiresAt < DateTime.Now)
        {
            throw new ApiException(ErrorCode.TokenExpired, "Refresh token expired, please log in again");
        }

        UserRecord user = await _dal.FindByIdAsync(stored.UserId, ct)
            ?? throw ApiException.NotFound("User");

        // rotate
        await _dal.RevokeRefreshTokenAsync(stored.Id, ct);

        return await IssueTokensAsync(user, ct);
    }

    public Task LogoutAsync(long userId, CancellationToken ct = default) =>
        _dal.RevokeAllRefreshTokensForUserAsync(userId, ct);

    public async Task ChangePasswordAsync(long userId, ChangePasswordRequest request,
                                          CancellationToken ct = default)
    {
        UserRecord user = await _dal.FindByIdAsync(userId, ct)
            ?? throw ApiException.NotFound("User");

        if (!_passwords.Verify(request.OldPassword ?? string.Empty, user.PasswordHash))
        {
            throw new ApiException(ErrorCode.BadCredentials, "Current password is incorrect");
        }

        await _dal.UpdatePasswordAsync(userId, _passwords.Hash(request.NewPassword ?? string.Empty), ct);

        // force re-login elsewhere
        await _dal.RevokeAllRefreshTokensForUserAsync(userId, ct);
    }

    public async Task<AuthUser> CurrentUserAsync(long userId, CancellationToken ct = default)
    {
        UserRecord user = await _dal.FindByIdAsync(userId, ct)
            ?? throw ApiException.NotFound("User");
        return await ToAuthUserAsync(user, ct);
    }

    public Task<bool> PhoneExistsAsync(string? phone, CancellationToken ct = default) =>
        _dal.PhoneExistsAsync(phone ?? string.Empty, ct);

    public Task<bool> UsernameExistsAsync(string? username, CancellationToken ct = default) =>
        _dal.UsernameExistsAsync(username?.Trim() ?? string.Empty, ct);

    // ---- helpers ----

    private async Task<AuthUser> ToAuthUserAsync(UserRecord user, CancellationToken ct)
    {
        IReadOnlyList<string> roles = await _dal.FindRoleCodesAsync(user.Id, ct);
        IReadOnlyList<string> permissions = await _dal.FindPermissionCodesAsync(user.Id, ct);

        // Falls back to the literal "Company" when the id is null or names no
        // row -- not to null, and not to an error. The client renders this
        // directly, so an empty value would show as a blank company name.
        string companyName = "Company";
        if (user.CompanyId is not null)
        {
            companyName = await _dal.FindCompanyNameAsync(user.CompanyId.Value, ct) ?? "Company";
        }

        return new AuthUser(
            user.Id, user.EmployeeCode, user.Username, user.Name,
            user.Aadhar, user.Email, user.Phone, user.Industry,
            user.PhotoPath, companyName, roles, permissions);
    }

    private async Task<LoginResponse> BuildLoginResponseAsync(UserRecord user, CancellationToken ct)
    {
        TokenPair tokens = await IssueTokensAsync(user, ct);
        return new LoginResponse(tokens, await ToAuthUserAsync(user, ct));
    }

    private async Task<TokenPair> IssueTokensAsync(UserRecord user, CancellationToken ct)
    {
        IReadOnlyList<string> roles = await _dal.FindRoleCodesAsync(user.Id, ct);
        string access = _jwt.GenerateAccessToken(user.Id, user.Username, roles);

        // Two UUIDs joined by a hyphen, as the Java side mints it. The column
        // holds 512 characters, so the length is not a constraint; the shape is
        // kept so a token is recognisable as one of ours.
        string refreshToken = $"{Guid.NewGuid()}-{Guid.NewGuid()}";
        DateTime expiresAt = DateTime.Now.AddSeconds(_options.Jwt.RefreshTokenTtlSeconds);

        await _dal.InsertRefreshTokenAsync(user.Id, refreshToken, expiresAt, ct);

        return new TokenPair(access, refreshToken, "Bearer", _jwt.AccessTtlSeconds);
    }

    /// <summary>
    /// Writes the audit row for a sign-in attempt, and swallows any failure.
    ///
    /// The record of an attempt must never decide the outcome of the attempt.
    /// The Java side learned this from login_history.username being varchar(60):
    /// a longer name threw a data-truncation error out of the audit write, which
    /// surfaced to the person signing in as "That username is already in use."
    /// (409) on a login form. The DAL truncates every field for that reason, and
    /// this catch is the second line of defence -- a full disk or a locked table
    /// must not turn a valid sign-in into a 500.
    /// </summary>
    private async Task RecordLoginAsync(long? userId, string? username, bool success,
                                        string? ip, string? userAgent, CancellationToken ct)
    {
        try
        {
            await _dal.InsertLoginHistoryAsync(userId, username, success, ip, userAgent, ct);
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Could not write the login-history row for {Username}", username);
        }
    }

    public async Task<LoginResponse> SignupAsync(SignupRequest req, CancellationToken ct = default)
    {
        string username = req.Username?.Trim() ?? string.Empty;
        if (string.IsNullOrWhiteSpace(username))
        {
            throw ApiException.Business("Username is required");
        }
        if (await _dal.CountByUsernameAcrossTenantsAsync(username, ct) > 0)
        {
            throw ApiException.Conflict("An account with this username already exists");
        }
        if (!string.IsNullOrWhiteSpace(req.Aadhar) && await _dal.CountByAadharAcrossTenantsAsync(req.Aadhar, ct) > 0)
        {
            throw ApiException.Conflict("An account with this Aadhaar already exists");
        }
        if (!string.IsNullOrWhiteSpace(req.Phone) && await _dal.CountByPhoneAcrossTenantsAsync(req.Phone, ct) > 0)
        {
            throw ApiException.Conflict("An account with this phone already exists");
        }

        string industry = NormalizeIndustry(req.Industry);
        string defaultRole = "CIVIL".Equals(industry, StringComparison.OrdinalIgnoreCase) ? "CV_EMP" : "IT_EMP";

        long? companyId = _currentUser.CompanyId;
        if (companyId is null)
        {
            var all = await _dal.FindAllCompaniesAsync(ct);
            companyId = all.FirstOrDefault(c => c.CompanyName == "Pixous Technologies") is { Id: > 0 } named
                ? named.Id
                : all.Count == 1 ? all[0].Id : null;
        }

        string employeeCode = await GenerateEmployeeCodeAsync(ct);
        string passwordHash = _passwords.Hash(req.Password);
        string? passwordVault = _vault.Seal(req.Password);
        char? gender = !string.IsNullOrWhiteSpace(req.Gender) ? char.ToUpperInvariant(req.Gender.Trim()[0]) : null;

        long userId = await _dal.InsertUserAsync(
            companyId,
            employeeCode,
            username,
            req.Name,
            req.Dob,
            gender,
            BlankToNull(req.Aadhar),
            BlankToNull(req.Phone),
            BlankToNull(req.Email),
            passwordHash,
            passwordVault,
            BlankToNull(req.CareOf),
            BlankToNull(req.House),
            BlankToNull(req.Street),
            BlankToNull(req.Locality),
            BlankToNull(req.Vtc),
            BlankToNull(req.District),
            BlankToNull(req.State),
            BlankToNull(req.Country),
            BlankToNull(req.Pincode),
            BlankToNull(req.PostOffice),
            industry,
            req.DepartmentId,
            req.DesignationId,
            req.OfficeLocationId,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            "ACTIVE",
            true,
            DateTime.Today.ToString("yyyy-MM-dd"),
            null,
            defaultRole,
            ct);

        var user = await _dal.FindByIdAsync(userId, ct) ?? throw ApiException.NotFound("User");
        return await BuildLoginResponseAsync(user, ct);
    }

    public async Task<AuthUser> CreateEmployeeAsync(CreateEmployeeRequest req, CancellationToken ct = default)
    {
        string username = req.Username?.Trim() ?? string.Empty;
        if (string.IsNullOrWhiteSpace(username))
        {
            throw ApiException.Business("Username is required");
        }
        if (await _dal.CountByUsernameAcrossTenantsAsync(username, ct) > 0)
        {
            throw ApiException.Conflict($"Username '{username}' is already taken");
        }
        if (!string.IsNullOrWhiteSpace(req.Aadhar) && await _dal.CountByAadharAcrossTenantsAsync(req.Aadhar, ct) > 0)
        {
            throw ApiException.Conflict("An account with this Aadhaar already exists");
        }
        if (!string.IsNullOrWhiteSpace(req.Phone) && await _dal.CountByPhoneAcrossTenantsAsync(req.Phone, ct) > 0)
        {
            throw ApiException.Conflict("An account with this phone already exists");
        }

        long? targetCompanyId = _currentUser.CompanyId;
        if (targetCompanyId is null && !string.IsNullOrWhiteSpace(req.CompanyId))
        {
            var all = await _dal.FindAllCompaniesAsync(ct);
            targetCompanyId = all.FirstOrDefault(c => req.CompanyId.Equals(c.CompanyName, StringComparison.OrdinalIgnoreCase) || req.CompanyId == c.Id.ToString()) is { Id: > 0 } matched
                ? matched.Id : null;
            if (targetCompanyId is null)
            {
                throw ApiException.Business($"Invalid company ID: {req.CompanyId}");
            }
        }
        if (targetCompanyId is null)
        {
            var all = await _dal.FindAllCompaniesAsync(ct);
            targetCompanyId = all.Count == 1 ? all[0].Id : null;
        }
        if (targetCompanyId is null)
        {
            throw ApiException.Business("Company ID is required to create a user");
        }

        string industry = NormalizeIndustry(req.Industry);
        string roleCode = !string.IsNullOrWhiteSpace(req.RoleCode)
            ? req.RoleCode.Trim()
            : ("CIVIL".Equals(industry, StringComparison.OrdinalIgnoreCase) ? "CV_EMP" : "IT_EMP");

        string employeeCode = await ChooseEmployeeCodeAsync(req.EmployeeCode, ct);
        string passwordHash = _passwords.Hash(req.Password);
        string? passwordVault = _vault.Seal(req.Password);
        char? gender = !string.IsNullOrWhiteSpace(req.Gender) ? char.ToUpperInvariant(req.Gender.Trim()[0]) : null;

        string status = !string.IsNullOrWhiteSpace(req.ProfileStatus) ? req.ProfileStatus.Trim().ToUpperInvariant() : "ACTIVE";
        bool enabled = !"OFFBOARDED".Equals(status, StringComparison.OrdinalIgnoreCase);

        long userId = await _dal.InsertUserAsync(
            targetCompanyId,
            employeeCode,
            username,
            req.Name,
            req.Dob,
            gender,
            BlankToNull(req.Aadhar),
            BlankToNull(req.Phone),
            BlankToNull(req.Email),
            passwordHash,
            passwordVault,
            BlankToNull(req.CareOf),
            BlankToNull(req.House),
            BlankToNull(req.Street),
            BlankToNull(req.Locality),
            BlankToNull(req.Vtc),
            BlankToNull(req.District),
            BlankToNull(req.State),
            BlankToNull(req.Country),
            BlankToNull(req.Pincode),
            BlankToNull(req.PostOffice),
            industry,
            req.DepartmentId,
            req.DesignationId,
            req.OfficeLocationId,
            req.ReportingManagerId,
            BlankToNull(req.Pan),
            BlankToNull(req.PfNumber),
            BlankToNull(req.AlternatePhone),
            BlankToNull(req.EmergencyContact),
            BlankToNull(req.EmergencyContactRelation),
            BlankToNull(req.BloodGroup),
            BlankToNull(req.PersonalEmail),
            BlankToNull(req.DesignationTitle),
            BlankToNull(req.DepartmentTitle),
            BlankToNull(req.PositionTitle),
            status,
            enabled,
            BlankToNull(req.DateOfJoining) ?? DateTime.Today.ToString("yyyy-MM-dd"),
            BlankToNull(req.Documents),
            roleCode,
            ct);

        return await CurrentUserAsync(userId, ct);
    }

    public async Task<IReadOnlyList<BulkEmployeeResult>> CreateEmployeesBulkAsync(
        IReadOnlyList<CreateEmployeeRequest> requests, string? fileName, long? actorId, CancellationToken ct = default)
    {
        var results = new List<BulkEmployeeResult>();
        long batchId = await _dal.CreateImportBatchAsync(fileName ?? "Employee sheet", requests.Count, actorId, ct);

        foreach (var req in requests)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(req.Name))
                {
                    throw new ArgumentException("Name is required");
                }
                if (string.IsNullOrWhiteSpace(req.Username) || req.Username.Trim().Length < 3)
                {
                    throw new ArgumentException("Username must be at least 3 characters");
                }
                if (string.IsNullOrWhiteSpace(req.Password) || req.Password.Length < 8)
                {
                    throw new ArgumentException("Password must be at least 8 characters");
                }

                var created = await CreateEmployeeAsync(req, ct);
                await _dal.StampUserImportBatchAsync(created.Id, batchId, ct);
                results.Add(new BulkEmployeeResult(req.Username, req.Name, true, null));
            }
            catch (Exception ex)
            {
                results.Add(new BulkEmployeeResult(req.Username, req.Name, false, ex.Message));
            }
        }

        int ok = results.Count(r => r.Created);
        await _dal.FinishImportBatchAsync(batchId, ok, results.Count - ok, ct);
        return results;
    }

    public async Task<IReadOnlyList<Dictionary<string, object?>>> ListImportsAsync(CancellationToken ct = default)
    {
        var all = await _dal.ListImportBatchesAsync(ct);
        var list = new List<Dictionary<string, object?>>();
        foreach (var b in all)
        {
            list.Add(new Dictionary<string, object?>
            {
                ["id"] = b.Id,
                ["fileName"] = b.FileName,
                ["importedAt"] = b.ImportedAt.ToString("yyyy-MM-ddTHH:mm:ss"),
                ["importedBy"] = b.ImportedBy,
                ["totalRows"] = b.TotalRows,
                ["createdCount"] = b.CreatedCount,
                ["failedCount"] = b.FailedCount,
                ["remaining"] = b.Remaining,
                ["revertedAt"] = b.RevertedAt?.ToString("yyyy-MM-ddTHH:mm:ss")
            });
        }
        return list;
    }

    public async Task<Dictionary<string, object?>> AdoptImportAsync(
        string? fileName, IReadOnlyList<string>? identifiers, long? actorId, CancellationToken ct = default)
    {
        var wanted = (identifiers ?? Array.Empty<string>())
            .Where(s => !string.IsNullOrWhiteSpace(s))
            .Select(s => s.Trim().ToUpperInvariant())
            .Distinct()
            .ToList();

        if (wanted.Count == 0)
        {
            throw ApiException.Business("That sheet has no Emp Id values to match against.");
        }

        var allUsers = await _dal.FindAllUsersForImportAdoptAsync(ct);
        var byKey = new Dictionary<string, UserRecord>(StringComparer.OrdinalIgnoreCase);
        foreach (var u in allUsers)
        {
            if (!string.IsNullOrWhiteSpace(u.EmployeeCode))
                byKey.TryAdd(u.EmployeeCode.Trim().ToUpperInvariant(), u);
            if (!string.IsNullOrWhiteSpace(u.Username))
                byKey.TryAdd(u.Username.Trim().ToUpperInvariant(), u);
        }

        var linked = new List<Dictionary<string, object?>>();
        var alreadyLinked = new List<Dictionary<string, object?>>();
        var notFound = new List<string>();
        var toStamp = new List<UserRecord>();

        foreach (var key in wanted)
        {
            if (!byKey.TryGetValue(key, out var u))
            {
                notFound.Add(key);
            }
            else if (u.ImportBatchId is not null)
            {
                alreadyLinked.Add(new Dictionary<string, object?>
                {
                    ["userId"] = u.Id,
                    ["name"] = u.Name,
                    ["employeeCode"] = u.EmployeeCode,
                    ["reason"] = "already belongs to another sheet"
                });
            }
            else
            {
                toStamp.Add(u);
            }
        }

        if (toStamp.Count == 0)
        {
            throw ApiException.Business(
                $"None of that sheet's employees are in the directory as unclaimed accounts. {notFound.Count} Emp Id(s) matched nobody, {alreadyLinked.Count} already belong to another sheet.");
        }

        long batchId = await _dal.CreateImportBatchAsync(
            string.IsNullOrWhiteSpace(fileName) ? "Employee sheet (matched)" : fileName.Trim(),
            wanted.Count, actorId, ct);
        await _dal.FinishImportBatchAsync(batchId, toStamp.Count, 0, ct);

        foreach (var u in toStamp)
        {
            await _dal.StampUserImportBatchAsync(u.Id, batchId, ct);
            linked.Add(new Dictionary<string, object?>
            {
                ["userId"] = u.Id,
                ["name"] = u.Name,
                ["employeeCode"] = u.EmployeeCode
            });
        }

        return new Dictionary<string, object?>
        {
            ["batchId"] = batchId,
            ["fileName"] = string.IsNullOrWhiteSpace(fileName) ? "Employee sheet (matched)" : fileName.Trim(),
            ["linkedCount"] = linked.Count,
            ["linked"] = linked,
            ["alreadyLinkedCount"] = alreadyLinked.Count,
            ["alreadyLinked"] = alreadyLinked,
            ["notFoundCount"] = notFound.Count,
            ["notFound"] = notFound
        };
    }

    public async Task<Dictionary<string, object?>> PreviewImportAsync(long batchId, CancellationToken ct = default)
    {
        var batch = await _dal.FindImportBatchByIdAsync(batchId, ct)
            ?? throw ApiException.NotFound("Import");

        var members = await _dal.FindUsersByImportBatchAsync(batchId, ct);
        var reasons = await _dal.FindInUseReasonsAsync(members.Select(u => u.Id).ToList(), ct);

        var removable = new List<Dictionary<string, object?>>();
        var keeping = new List<Dictionary<string, object?>>();

        foreach (var u in members)
        {
            reasons.TryGetValue(u.Id, out string? reason);
            var row = new Dictionary<string, object?>
            {
                ["userId"] = u.Id,
                ["name"] = u.Name,
                ["employeeCode"] = u.EmployeeCode,
                ["username"] = u.Username
            };

            if (reason is null)
            {
                removable.Add(row);
            }
            else
            {
                row["reason"] = reason;
                keeping.Add(row);
            }
        }

        return new Dictionary<string, object?>
        {
            ["id"] = batch.Id,
            ["fileName"] = batch.FileName,
            ["importedAt"] = batch.ImportedAt.ToString("yyyy-MM-ddTHH:mm:ss"),
            ["removable"] = removable,
            ["keeping"] = keeping
        };
    }

    public async Task<Dictionary<string, object?>> RevertImportAsync(long batchId, long? actorId, CancellationToken ct = default)
    {
        var batch = await _dal.FindImportBatchByIdAsync(batchId, ct)
            ?? throw ApiException.NotFound("Import");

        var candidates = await _dal.FindUsersByImportBatchAsync(batchId, ct);
        if (candidates.Count == 0)
        {
            throw ApiException.Business("This import has no accounts left to remove.");
        }

        var reasons = await _dal.FindInUseReasonsAsync(candidates.Select(u => u.Id).ToList(), ct);
        var removed = new List<string>();
        var kept = new List<Dictionary<string, object?>>();

        var userBal = _services.GetRequiredService<IUserBal>();

        foreach (var u in candidates)
        {
            if (actorId.HasValue && u.Id == actorId.Value)
            {
                kept.Add(new Dictionary<string, object?>
                {
                    ["userId"] = u.Id,
                    ["name"] = u.Name,
                    ["employeeCode"] = u.EmployeeCode,
                    ["reason"] = "this is you"
                });
                continue;
            }

            if (reasons.TryGetValue(u.Id, out string? reason))
            {
                kept.Add(new Dictionary<string, object?>
                {
                    ["userId"] = u.Id,
                    ["name"] = u.Name,
                    ["employeeCode"] = u.EmployeeCode,
                    ["reason"] = reason
                });
                continue;
            }

            try
            {
                await userBal.DeleteEmployeeAsync(actorId ?? 0, u.Id, null, ct);
                removed.Add($"{u.Name} ({u.EmployeeCode})");
            }
            catch (Exception ex)
            {
                _log.LogWarning(ex, "Could not remove imported user {UserId}", u.Id);
                kept.Add(new Dictionary<string, object?>
                {
                    ["userId"] = u.Id,
                    ["name"] = u.Name,
                    ["employeeCode"] = u.EmployeeCode,
                    ["reason"] = "could not be removed"
                });
            }
        }

        await _dal.MarkImportBatchRevertedAsync(batchId, actorId, ct);

        return new Dictionary<string, object?>
        {
            ["removedCount"] = removed.Count,
            ["removed"] = removed,
            ["keptCount"] = kept.Count,
            ["kept"] = kept
        };
    }

    public async Task ForgetImportAsync(long batchId, CancellationToken ct = default)
    {
        var batch = await _dal.FindImportBatchByIdAsync(batchId, ct)
            ?? throw ApiException.NotFound("Import");

        var users = await _dal.FindUsersByImportBatchAsync(batchId, ct);
        if (users.Count > 0)
        {
            throw ApiException.Business("This import still has accounts. Remove them first, or leave the record alone.");
        }

        await _dal.DeleteImportBatchRecordAsync(batchId, ct);
    }

    private async Task<string> GenerateEmployeeCodeAsync(CancellationToken ct)
    {
        string prefix = "EMP";
        string? max = await _dal.FindMaxEmployeeCodeAcrossTenantsAsync(prefix, ct);
        int next = 1;
        if (!string.IsNullOrEmpty(max) && max.Length > prefix.Length)
        {
            if (int.TryParse(max[prefix.Length..], out int parsed))
            {
                next = parsed + 1;
            }
        }

        for (int attempt = 0; attempt < 1000; attempt++)
        {
            string candidate = prefix + (next + attempt).ToString("D4");
            if (await _dal.CountByEmployeeCodeAcrossTenantsAsync(candidate, ct) == 0)
            {
                return candidate;
            }
        }

        throw ApiException.Business("Could not allocate an employee ID. Please set one manually.");
    }

    private async Task<string> ChooseEmployeeCodeAsync(string? supplied, CancellationToken ct)
    {
        string code = supplied?.Trim().ToUpperInvariant() ?? string.Empty;
        if (string.IsNullOrEmpty(code)) return await GenerateEmployeeCodeAsync(ct);
        if (await _dal.CountByEmployeeCodeAcrossTenantsAsync(code, ct) > 0)
        {
            throw ApiException.Conflict($"Employee ID '{code}' is already in use");
        }
        return code;
    }

    private static string NormalizeIndustry(string? industry)
    {
        if (string.IsNullOrWhiteSpace(industry)) return "IT";
        string v = industry.Trim().ToUpperInvariant();
        return v switch
        {
            "CIVIL" or "INFRA" => "CIVIL",
            "IT" or "DIGITAL" => "IT",
            _ => v
        };
    }

    private static string? BlankToNull(string? s) =>
        string.IsNullOrWhiteSpace(s) ? null : s.Trim();
}
