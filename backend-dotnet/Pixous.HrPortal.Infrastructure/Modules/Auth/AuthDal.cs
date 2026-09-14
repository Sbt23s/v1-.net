using Dapper;
using Pixous.HrPortal.Domain.Modules.Auth;
using Pixous.HrPortal.Domain.Modules.User;
using Pixous.HrPortal.Infrastructure.Persistence;

namespace Pixous.HrPortal.Infrastructure.Modules.Auth;

/// <summary>
/// Dapper data access for the authentication flows, against the existing
/// schema. Column names are the ones Flyway built and JPA maps to; nothing here
/// creates, alters or drops anything.
///
/// Every value a caller supplies is bound as a parameter. The only text
/// interpolated into any statement in this class is the column list below,
/// which is a constant.
/// </summary>
public sealed class AuthDal : DalBase, IAuthDal
{
    public AuthDal(IDbConnectionFactory connectionFactory) : base(connectionFactory) { }

    /// <summary>
    /// The columns UserRecord maps. Listed explicitly rather than SELECT * so
    /// that a column added to this wide table later does not start arriving
    /// here unannounced, and so the aliases stay stable.
    /// </summary>
    private const string UserColumns = """
        id                 AS Id,
        company_id         AS CompanyId,
        employee_code      AS EmployeeCode,
        username           AS Username,
        name               AS Name,
        aadhar             AS Aadhar,
        phone              AS Phone,
        email              AS Email,
        industry           AS Industry,
        photo_path         AS PhotoPath,
        password_hash      AS PasswordHash,
        enabled            AS Enabled,
        failed_login_count AS FailedLoginCount,
        locked_until       AS LockedUntil,
        last_login_at      AS LastLoginAt,
        import_batch_id    AS ImportBatchId
        """;

    public Task<UserRecord?> FindByUsernameAcrossTenantsAsync(string username, CancellationToken ct = default) =>
        QueryAsync(conn => conn.QueryFirstOrDefaultAsync<UserRecord>(
            new CommandDefinition(
                $"SELECT {UserColumns} FROM users WHERE username = @username LIMIT 1",
                new { username }, cancellationToken: ct)), ct);

    /// <summary>
    /// The login fallback: match on full name when the input is not a known
    /// username. The comparison is case-insensitive, which the column's own
    /// collation already provides -- LOWER() on both sides would defeat the
    /// index for no gain.
    ///
    /// Deliberately NOT limited to one row. The caller accepts the match only
    /// when exactly one account bears the name, so it has to be able to tell
    /// one from several.
    /// </summary>
    public async Task<IReadOnlyList<UserRecord>> FindByNameAcrossTenantsAsync(
        string name, CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<UserRecord>(
            new CommandDefinition(
                $"SELECT {UserColumns} FROM users WHERE name = @name",
                new { name }, cancellationToken: ct)), ct)).AsList();

    public Task<UserRecord?> FindByIdAsync(long userId, CancellationToken ct = default) =>
        QueryAsync(conn => conn.QueryFirstOrDefaultAsync<UserRecord>(
            new CommandDefinition(
                $"SELECT {UserColumns} FROM users WHERE id = @userId",
                new { userId }, cancellationToken: ct)), ct);

    public async Task<IReadOnlyList<string>> FindRoleCodesAsync(long userId, CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<string>(
            new CommandDefinition("""
                SELECT r.code
                FROM user_roles ur
                JOIN roles r ON r.id = ur.role_id
                WHERE ur.user_id = @userId
                """,
                new { userId }, cancellationToken: ct)), ct)).AsList();

    /// <summary>
    /// The permission codes this user's roles grant.
    ///
    /// DISTINCT because two roles commonly grant the same permission, and the
    /// Java side de-duplicates the flattened stream before returning it.
    /// </summary>
    public async Task<IReadOnlyList<string>> FindPermissionCodesAsync(long userId, CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<string>(
            new CommandDefinition("""
                SELECT DISTINCT p.code
                FROM user_roles ur
                JOIN role_permissions rp ON rp.role_id = ur.role_id
                JOIN permissions p ON p.id = rp.permission_id
                WHERE ur.user_id = @userId
                """,
                new { userId }, cancellationToken: ct)), ct)).AsList();

    public Task<long?> FindCompanyIdAsync(long userId, CancellationToken ct = default) =>
        QueryAsync(conn => conn.QueryFirstOrDefaultAsync<long?>(
            new CommandDefinition(
                "SELECT company_id FROM users WHERE id = @userId",
                new { userId }, cancellationToken: ct)), ct);

    public Task<string?> FindCompanyNameAsync(long companyId, CancellationToken ct = default) =>
        QueryAsync(conn => conn.QueryFirstOrDefaultAsync<string?>(
            new CommandDefinition(
                "SELECT company_name FROM companies WHERE id = @companyId",
                new { companyId }, cancellationToken: ct)), ct);

    public async Task<IReadOnlyList<(long Id, string? CompanyName)>> FindAllCompaniesAsync(
        CancellationToken ct = default)
    {
        var rows = await QueryAsync(conn => conn.QueryAsync<(long, string?)>(
            new CommandDefinition(
                "SELECT id, company_name FROM companies ORDER BY id",
                cancellationToken: ct)), ct);
        return rows.AsList();
    }

    /// <summary>
    /// Clears the failure counters and stamps the sign-in time, in one
    /// statement. The Java side mutates the entity and saves it, which writes
    /// the same three columns.
    /// </summary>
    public Task MarkLoginSucceededAsync(long userId, DateTime lastLoginAt, CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteAsync(
            new CommandDefinition("""
                UPDATE users
                SET failed_login_count = 0,
                    locked_until = NULL,
                    last_login_at = @lastLoginAt
                WHERE id = @userId
                """,
                new { userId, lastLoginAt }, cancellationToken: ct)), ct);

    public Task UpdateFailedAttemptAsync(long userId, int failedLoginCount, DateTime? lockedUntil,
                                         CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteAsync(
            new CommandDefinition("""
                UPDATE users
                SET failed_login_count = @failedLoginCount,
                    locked_until = @lockedUntil
                WHERE id = @userId
                """,
                new { userId, failedLoginCount, lockedUntil }, cancellationToken: ct)), ct);

    public Task SetCompanyIdAsync(long userId, long companyId, CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteAsync(
            new CommandDefinition(
                "UPDATE users SET company_id = @companyId WHERE id = @userId",
                new { userId, companyId }, cancellationToken: ct)), ct);

    /// <summary>
    /// The audit row for a sign-in attempt.
    ///
    /// Every field is cut to what its column will hold. login_history.username
    /// is varchar(60), and an attempt with a longer name threw a data-truncation
    /// error out of this write -- which surfaced to the caller as "That username
    /// is already in use." (409) on a sign-in form. The record of an attempt
    /// must never decide the outcome of the attempt.
    /// </summary>
    public Task InsertLoginHistoryAsync(long? userId, string? username, bool success,
                                        string? ipAddress, string? userAgent,
                                        CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteAsync(
            new CommandDefinition("""
                INSERT INTO login_history (user_id, username, success, ip_address, user_agent, created_at)
                VALUES (@userId, @username, @success, @ipAddress, @userAgent, @createdAt)
                """,
                new
                {
                    userId,
                    username = Truncate(username, 60),
                    success,
                    ipAddress = Truncate(ipAddress, 45),
                    userAgent = Truncate(userAgent, 250),
                    createdAt = DateTime.Now
                }, cancellationToken: ct)), ct);

    public Task InsertRefreshTokenAsync(long userId, string token, DateTime expiresAt,
                                        CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteAsync(
            new CommandDefinition("""
                INSERT INTO refresh_tokens (user_id, token, expires_at, revoked, created_at)
                VALUES (@userId, @token, @expiresAt, 0, @createdAt)
                """,
                new { userId, token, expiresAt, createdAt = DateTime.Now },
                cancellationToken: ct)), ct);

    public Task<RefreshTokenRecord?> FindRefreshTokenAsync(string token, CancellationToken ct = default) =>
        QueryAsync(conn => conn.QueryFirstOrDefaultAsync<RefreshTokenRecord>(
            new CommandDefinition("""
                SELECT id AS Id, user_id AS UserId, token AS Token,
                       expires_at AS ExpiresAt, revoked AS Revoked
                FROM refresh_tokens
                WHERE token = @token
                LIMIT 1
                """,
                new { token }, cancellationToken: ct)), ct);

    public Task RevokeRefreshTokenAsync(long id, CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteAsync(
            new CommandDefinition(
                "UPDATE refresh_tokens SET revoked = 1 WHERE id = @id",
                new { id }, cancellationToken: ct)), ct);

    public Task RevokeAllRefreshTokensForUserAsync(long userId, CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteAsync(
            new CommandDefinition(
                "UPDATE refresh_tokens SET revoked = 1 WHERE user_id = @userId AND revoked = 0",
                new { userId }, cancellationToken: ct)), ct);

    public Task UpdatePasswordAsync(long userId, string passwordHash, CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteAsync(
            new CommandDefinition(
                "UPDATE users SET password_hash = @passwordHash WHERE id = @userId",
                new { userId, passwordHash }, cancellationToken: ct)), ct);

    public Task<bool> PhoneExistsAsync(string phone, CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteScalarAsync<bool>(
            new CommandDefinition(
                "SELECT EXISTS(SELECT 1 FROM users WHERE phone = @phone)",
                new { phone }, cancellationToken: ct)), ct);

    public Task<bool> UsernameExistsAsync(string username, CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteScalarAsync<bool>(
            new CommandDefinition(
                "SELECT EXISTS(SELECT 1 FROM users WHERE username = @username)",
                new { username }, cancellationToken: ct)), ct);

    public Task<long> CountByUsernameAcrossTenantsAsync(string username, CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteScalarAsync<long>(
            new CommandDefinition(
                "SELECT COUNT(*) FROM users WHERE UPPER(username) = UPPER(@username)",
                new { username }, cancellationToken: ct)), ct);

    public Task<long> CountByAadharAcrossTenantsAsync(string aadhar, CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteScalarAsync<long>(
            new CommandDefinition(
                "SELECT COUNT(*) FROM users WHERE aadhar = @aadhar",
                new { aadhar }, cancellationToken: ct)), ct);

    public Task<long> CountByPhoneAcrossTenantsAsync(string phone, CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteScalarAsync<long>(
            new CommandDefinition(
                "SELECT COUNT(*) FROM users WHERE phone = @phone",
                new { phone }, cancellationToken: ct)), ct);

    public Task<long> CountByEmployeeCodeAcrossTenantsAsync(string code, CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteScalarAsync<long>(
            new CommandDefinition(
                "SELECT COUNT(*) FROM users WHERE UPPER(employee_code) = UPPER(@code)",
                new { code }, cancellationToken: ct)), ct);

    public Task<string?> FindMaxEmployeeCodeAcrossTenantsAsync(string prefix, CancellationToken ct = default) =>
        QueryAsync(conn => conn.QueryFirstOrDefaultAsync<string?>(
            new CommandDefinition(
                "SELECT MAX(employee_code) FROM users WHERE employee_code LIKE CONCAT(@prefix, '%')",
                new { prefix }, cancellationToken: ct)), ct);

    public async Task<long> InsertUserAsync(
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
        CancellationToken ct = default)
    {
        DateTime? parsedDob = null;
        if (!string.IsNullOrWhiteSpace(dob) && DateTime.TryParse(dob, out var d))
        {
            parsedDob = d;
        }

        DateTime? parsedDoj = DateTime.Today;
        if (!string.IsNullOrWhiteSpace(dateOfJoining) && DateTime.TryParse(dateOfJoining, out var doj))
        {
            parsedDoj = doj;
        }

        return await TransactionAsync(async (conn, tx) =>
        {
            const string sql = """
                INSERT INTO users (
                    company_id, employee_code, username, name, dob, gender,
                    aadhar, phone, email, password_hash, password_vault,
                    care_of, house, street, locality, vtc, district, state, country, pincode, post_office,
                    industry, department_id, designation_id, office_location_id, reporting_manager_id,
                    pan, pf_number, alternate_phone, emergency_contact, emergency_contact_relation,
                    blood_group, personal_email, designation_title, department_title, position_title,
                    profile_status, enabled, date_of_joining, documents,
                    failed_login_count, created_at, updated_at
                ) VALUES (
                    @companyId, @employeeCode, @username, @name, @parsedDob, @gender,
                    @aadhar, @phone, @email, @passwordHash, @passwordVault,
                    @careOf, @house, @street, @locality, @vtc, @district, @state, @country, @pincode, @postOffice,
                    @industry, @departmentId, @designationId, @officeLocationId, @reportingManagerId,
                    @pan, @pfNumber, @alternatePhone, @emergencyContact, @emergencyContactRelation,
                    @bloodGroup, @personalEmail, @designationTitle, @departmentTitle, @positionTitle,
                    @profileStatus, @enabled, @parsedDoj, @documents,
                    0, NOW(), NOW()
                );
                SELECT LAST_INSERT_ID();
                """;

            long userId = await conn.ExecuteScalarAsync<long>(sql, new
            {
                companyId,
                employeeCode,
                username,
                name,
                parsedDob,
                gender = gender?.ToString(),
                aadhar,
                phone,
                email,
                passwordHash,
                passwordVault,
                careOf,
                house,
                street,
                locality,
                vtc,
                district,
                state,
                country = string.IsNullOrWhiteSpace(country) ? "India" : country,
                pincode,
                postOffice,
                industry,
                departmentId,
                designationId,
                officeLocationId,
                reportingManagerId,
                pan,
                pfNumber,
                alternatePhone,
                emergencyContact,
                emergencyContactRelation,
                bloodGroup,
                personalEmail,
                designationTitle,
                departmentTitle,
                positionTitle,
                profileStatus,
                enabled,
                parsedDoj,
                documents
            }, tx);

            if (!string.IsNullOrWhiteSpace(defaultRole))
            {
                await conn.ExecuteAsync("""
                    INSERT IGNORE INTO user_roles (user_id, role_id)
                    SELECT @userId, id FROM roles WHERE UPPER(code) = UPPER(@defaultRole) LIMIT 1
                    """, new { userId, defaultRole }, tx);
            }

            await conn.ExecuteAsync("""
                INSERT IGNORE INTO community_members (community_id, user_id, joined_at)
                SELECT id, @userId, NOW() FROM communities WHERE name = 'Company Announcements' LIMIT 1
                """, new { userId }, tx);

            return userId;
        }, ct);
    }

    public Task<long> CreateImportBatchAsync(string fileName, int totalRows, long? importedBy, CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteScalarAsync<long>(
            new CommandDefinition("""
                INSERT INTO employee_imports (file_name, imported_by, imported_at, total_rows, created_count, failed_count)
                VALUES (@fileName, @importedBy, NOW(), @totalRows, 0, 0);
                SELECT LAST_INSERT_ID();
                """,
                new { fileName = string.IsNullOrWhiteSpace(fileName) ? "Employee sheet" : fileName.Trim(), importedBy, totalRows },
                cancellationToken: ct)), ct);

    public Task FinishImportBatchAsync(long batchId, int createdCount, int failedCount, CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteAsync(
            new CommandDefinition("""
                UPDATE employee_imports
                SET created_count = @createdCount, failed_count = @failedCount
                WHERE id = @batchId
                """,
                new { batchId, createdCount, failedCount }, cancellationToken: ct)), ct);

    public Task StampUserImportBatchAsync(long userId, long batchId, CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteAsync(
            new CommandDefinition(
                "UPDATE users SET import_batch_id = @batchId WHERE id = @userId",
                new { userId, batchId }, cancellationToken: ct)), ct);

    public async Task<IReadOnlyList<EmployeeImportRecord>> ListImportBatchesAsync(CancellationToken ct = default)
    {
        var rows = await QueryAsync(conn => conn.QueryAsync<EmployeeImportRecord>(
            new CommandDefinition("""
                SELECT b.id AS Id,
                       b.file_name AS FileName,
                       b.imported_at AS ImportedAt,
                       u.name AS ImportedBy,
                       b.total_rows AS TotalRows,
                       b.created_count AS CreatedCount,
                       b.failed_count AS FailedCount,
                       (SELECT COUNT(*) FROM users WHERE import_batch_id = b.id) AS Remaining,
                       b.reverted_at AS RevertedAt
                FROM employee_imports b
                LEFT JOIN users u ON u.id = b.imported_by
                ORDER BY b.imported_at DESC
                """, cancellationToken: ct)), ct);
        return rows.AsList();
    }

    public Task<EmployeeImportRecord?> FindImportBatchByIdAsync(long batchId, CancellationToken ct = default) =>
        QueryAsync(conn => conn.QueryFirstOrDefaultAsync<EmployeeImportRecord>(
            new CommandDefinition("""
                SELECT b.id AS Id,
                       b.file_name AS FileName,
                       b.imported_at AS ImportedAt,
                       u.name AS ImportedBy,
                       b.total_rows AS TotalRows,
                       b.created_count AS CreatedCount,
                       b.failed_count AS FailedCount,
                       (SELECT COUNT(*) FROM users WHERE import_batch_id = b.id) AS Remaining,
                       b.reverted_at AS RevertedAt
                FROM employee_imports b
                LEFT JOIN users u ON u.id = b.imported_by
                WHERE b.id = @batchId
                LIMIT 1
                """,
                new { batchId }, cancellationToken: ct)), ct);

    public async Task<IReadOnlyList<UserRecord>> FindUsersByImportBatchAsync(long batchId, CancellationToken ct = default)
    {
        var rows = await QueryAsync(conn => conn.QueryAsync<UserRecord>(
            new CommandDefinition(
                $"SELECT {UserColumns} FROM users WHERE import_batch_id = @batchId",
                new { batchId }, cancellationToken: ct)), ct);
        return rows.AsList();
    }

    public async Task<IReadOnlyList<UserRecord>> FindAllUsersForImportAdoptAsync(CancellationToken ct = default)
    {
        var rows = await QueryAsync(conn => conn.QueryAsync<UserRecord>(
            new CommandDefinition(
                $"SELECT {UserColumns} FROM users",
                cancellationToken: ct)), ct);
        return rows.AsList();
    }

    public async Task<IReadOnlyDictionary<long, string>> FindInUseReasonsAsync(
        IReadOnlyList<long> userIds, CancellationToken ct = default)
    {
        var reasons = new Dictionary<long, string>();
        if (userIds == null || userIds.Count == 0) return reasons;

        var checks = new (string Table, string Column, string Reason)[]
        {
            ("attendance", "user_id", "has attendance records"),
            ("leave_requests", "user_id", "has leave requests"),
            ("payslips", "user_id", "has payslips"),
            ("permission_requests", "user_id", "has permission requests"),
            ("work_reports", "user_id", "has work reports"),
            ("community_messages", "sender_id", "has sent chat messages")
        };

        foreach (var (table, column, reason) in checks)
        {
            long colCount = await QueryAsync(conn => conn.ExecuteScalarAsync<long>(
                new CommandDefinition(
                    "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = @table AND column_name = @column",
                    new { table, column }, cancellationToken: ct)), ct);
            if (colCount == 0) continue;

            var hits = await QueryAsync(conn => conn.QueryAsync<long>(
                new CommandDefinition(
                    $"SELECT DISTINCT {column} FROM {table} WHERE {column} IN @userIds",
                    new { userIds }, cancellationToken: ct)), ct);

            foreach (long id in hits)
            {
                reasons.TryAdd(id, reason);
            }
        }

        return reasons;
    }

    public Task MarkImportBatchRevertedAsync(long batchId, long? actorId, CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteAsync(
            new CommandDefinition("""
                UPDATE employee_imports
                SET reverted_at = NOW(), reverted_by = @actorId
                WHERE id = @batchId
                """,
                new { batchId, actorId }, cancellationToken: ct)), ct);

    public Task DeleteImportBatchRecordAsync(long batchId, CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteAsync(
            new CommandDefinition(
                "DELETE FROM employee_imports WHERE id = @batchId",
                new { batchId }, cancellationToken: ct)), ct);

    /// <summary><paramref name="value"/> cut to <paramref name="max"/> characters, or null if it was null.</summary>
    private static string? Truncate(string? value, int max) =>
        value is null ? null : value.Length > max ? value[..max] : value;
}
