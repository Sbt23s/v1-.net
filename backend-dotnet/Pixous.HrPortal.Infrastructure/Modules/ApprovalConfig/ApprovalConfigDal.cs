using Dapper;
using Pixous.HrPortal.Domain.Modules.ApprovalConfig;
using Pixous.HrPortal.Infrastructure.Persistence;

namespace Pixous.HrPortal.Infrastructure.Modules.ApprovalConfig;

/// <summary>
/// Dapper access to <c>approval_recipient_config</c> and
/// <c>role_module_visibility</c>.
/// </summary>
public sealed class ApprovalConfigDal : DalBase, IApprovalConfigDal
{
    public ApprovalConfigDal(IDbConnectionFactory connectionFactory) : base(connectionFactory) { }

    private const string RecipientColumns = """
        id          AS Id,
        company_id  AS CompanyId,
        module_code AS ModuleCode,
        role_code   AS RoleCode,
        user_id     AS UserId,
        enabled     AS Enabled,
        updated_by  AS UpdatedBy,
        updated_at  AS UpdatedAt
        """;

    private const string VisibilityColumns = """
        id          AS Id,
        company_id  AS CompanyId,
        role_code   AS RoleCode,
        module_code AS ModuleCode,
        visible     AS Visible,
        updated_by  AS UpdatedBy,
        updated_at  AS UpdatedAt
        """;

    /// <summary>
    /// Everything configured for one module -- the company's own rows AND the
    /// ones with no company.
    ///
    /// The Java repository method carries a note explaining why: a single-tenant
    /// install writes NULL into company_id, and a reader that matched only on
    /// the id would find nothing. Because absent means unrestricted, that would
    /// not fail loudly -- it would silently ignore configuration somebody had
    /// just saved. Every row in this database has company_id NULL today, so a
    /// company filter here would disable the whole feature.
    /// </summary>
    public async Task<IReadOnlyList<ApprovalRecipientRow>> FindByModuleAsync(
        string moduleCode, CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<ApprovalRecipientRow>(
            new CommandDefinition(
                $"SELECT {RecipientColumns} FROM approval_recipient_config WHERE module_code = @moduleCode",
                new { moduleCode }, cancellationToken: ct)), ct)).AsList();

    public async Task<IReadOnlyList<ApprovalRecipientRow>> FindAllRecipientsAsync(
        CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<ApprovalRecipientRow>(
            new CommandDefinition($"""
                SELECT {RecipientColumns} FROM approval_recipient_config
                ORDER BY module_code ASC, role_code ASC
                """, cancellationToken: ct)), ct)).AsList();

    /// <summary>
    /// Delete then insert, in one transaction -- the Java's approach, kept.
    ///
    /// Diffing the two sets would save a handful of writes on a table of at
    /// most thirty-five rows and cost the clarity of "what is stored is what
    /// was sent". The WHERE narrows to role rows so the module's named people
    /// survive: they are a separate control on screen.
    /// </summary>
    public Task ReplaceRoleRowsAsync(string moduleCode, IReadOnlyCollection<string> roleCodes,
                                     long? actorId, CancellationToken ct = default) =>
        TransactionAsync(async (conn, tx) =>
        {
            await conn.ExecuteAsync(new CommandDefinition("""
                DELETE FROM approval_recipient_config
                WHERE module_code = @moduleCode AND role_code IS NOT NULL
                """, new { moduleCode }, tx, cancellationToken: ct));

            foreach (string role in roleCodes)
            {
                await conn.ExecuteAsync(new CommandDefinition("""
                    INSERT INTO approval_recipient_config
                        (module_code, role_code, enabled, updated_by, updated_at)
                    VALUES (@moduleCode, @role, 1, @actorId, @now)
                    """,
                    new { moduleCode, role, actorId, now = DateTime.Now },
                    tx, cancellationToken: ct));
            }

            return 0;
        }, cancellationToken: ct);

    /// <summary>The mirror of the above: person rows only, role rows untouched.</summary>
    public Task ReplacePersonRowsAsync(string moduleCode, IReadOnlyCollection<long> userIds,
                                       long? actorId, CancellationToken ct = default) =>
        TransactionAsync(async (conn, tx) =>
        {
            await conn.ExecuteAsync(new CommandDefinition("""
                DELETE FROM approval_recipient_config
                WHERE module_code = @moduleCode AND user_id IS NOT NULL
                """, new { moduleCode }, tx, cancellationToken: ct));

            foreach (long userId in userIds)
            {
                await conn.ExecuteAsync(new CommandDefinition("""
                    INSERT INTO approval_recipient_config
                        (module_code, user_id, enabled, updated_by, updated_at)
                    VALUES (@moduleCode, @userId, 1, @actorId, @now)
                    """,
                    new { moduleCode, userId, actorId, now = DateTime.Now },
                    tx, cancellationToken: ct));
            }

            return 0;
        }, cancellationToken: ct);

    public async Task<IReadOnlyList<VisibilityRow>> FindVisibilityByRolesAsync(
        IReadOnlyCollection<string> roleCodes, CancellationToken ct = default)
    {
        if (roleCodes.Count == 0)
        {
            return [];
        }

        return (await QueryAsync(conn => conn.QueryAsync<VisibilityRow>(
            new CommandDefinition(
                $"SELECT {VisibilityColumns} FROM role_module_visibility WHERE role_code IN @roleCodes",
                new { roleCodes }, cancellationToken: ct)), ct)).AsList();
    }

    public async Task<IReadOnlyList<VisibilityRow>> FindAllVisibilityAsync(
        CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<VisibilityRow>(
            new CommandDefinition($"""
                SELECT {VisibilityColumns} FROM role_module_visibility
                ORDER BY role_code ASC, module_code ASC
                """, cancellationToken: ct)), ct)).AsList();

    /// <summary>
    /// Replaces one role's rows, writing EVERY module -- the hidden ones as
    /// visible = 0 rather than as missing rows.
    ///
    /// That is deliberate and load-bearing: absence has to keep meaning "nobody
    /// has configured this role". If hiding were expressed by deleting, a role
    /// with everything hidden would be indistinguishable from one nobody had
    /// touched, and would come back showing everything.
    /// </summary>
    public Task ReplaceVisibilityAsync(string roleCode, IReadOnlyDictionary<string, bool> modules,
                                       long? actorId, CancellationToken ct = default) =>
        TransactionAsync(async (conn, tx) =>
        {
            await conn.ExecuteAsync(new CommandDefinition(
                "DELETE FROM role_module_visibility WHERE role_code = @roleCode",
                new { roleCode }, tx, cancellationToken: ct));

            foreach ((string module, bool visible) in modules)
            {
                await conn.ExecuteAsync(new CommandDefinition("""
                    INSERT INTO role_module_visibility
                        (role_code, module_code, visible, updated_by, updated_at)
                    VALUES (@roleCode, @module, @visible, @actorId, @now)
                    """,
                    new { roleCode, module, visible, actorId, now = DateTime.Now },
                    tx, cancellationToken: ct));
            }

            return 0;
        }, cancellationToken: ct);

    /// <summary>
    /// Addressable people holding any of these roles, plus the CTO.
    ///
    /// The CTO is fetched by employee code in the same statement rather than a
    /// second round trip: they are matched on the code and hold no role that
    /// would bring them back otherwise, so a roles-only query would leave them
    /// unpickable.
    ///
    /// Disabled and offboarded accounts are excluded here rather than in the
    /// BAL -- a name on this screen is somebody a request could be sent to, and
    /// neither of those can be.
    /// </summary>
    public async Task<IReadOnlyList<ApprovalCandidate>> FindCandidatesAsync(
        IReadOnlyCollection<string> roleCodes, CancellationToken ct = default)
    {
        var rows = await QueryAsync(conn => conn.QueryAsync<(long Id, string? Name,
                                                            string? EmployeeCode, bool Enabled,
                                                            string? ProfileStatus, string? RoleCode)>(
            new CommandDefinition("""
                SELECT u.id, u.name, u.employee_code, u.enabled, u.profile_status, r.code
                FROM users u
                LEFT JOIN user_roles ur ON ur.user_id = u.id
                LEFT JOIN roles r ON r.id = ur.role_id
                WHERE u.enabled = 1
                  AND (u.profile_status IS NULL OR UPPER(u.profile_status) <> 'OFFBOARDED')
                  AND (UPPER(r.code) IN @roleCodes OR UPPER(u.employee_code) = @cto)
                """,
                new { roleCodes, cto = ApprovalConfigCatalog.CtoEmployeeCode },
                cancellationToken: ct)), ct);

        return Fold(rows);
    }

    public async Task<ApprovalCandidate?> FindUserAsync(long userId, CancellationToken ct = default)
    {
        IReadOnlyList<ApprovalCandidate> found = await FindUsersAsync([userId], ct);
        return found.Count == 0 ? null : found[0];
    }

    /// <summary>
    /// Resolves several ids in ONE query rather than one per id, as the Java's
    /// findAllById does. Callers filter for addressability themselves, so the
    /// enabled and offboarded flags are carried on the result rather than
    /// applied here.
    /// </summary>
    public async Task<IReadOnlyList<ApprovalCandidate>> FindUsersAsync(
        IReadOnlyCollection<long> userIds, CancellationToken ct = default)
    {
        if (userIds.Count == 0)
        {
            return [];
        }

        var rows = await QueryAsync(conn => conn.QueryAsync<(long Id, string? Name,
                                                            string? EmployeeCode, bool Enabled,
                                                            string? ProfileStatus, string? RoleCode)>(
            new CommandDefinition("""
                SELECT u.id, u.name, u.employee_code, u.enabled, u.profile_status, r.code
                FROM users u
                LEFT JOIN user_roles ur ON ur.user_id = u.id
                LEFT JOIN roles r ON r.id = ur.role_id
                WHERE u.id IN @userIds
                """,
                new { userIds }, cancellationToken: ct)), ct);

        return Fold(rows);
    }

    /// <summary>
    /// Collapses the role join back into one candidate per person.
    ///
    /// The join returns a row per role, so somebody holding three roles arrives
    /// three times; the LEFT JOIN also means a person with no roles arrives
    /// once with a null code, which must not become a role called "".
    /// </summary>
    private static IReadOnlyList<ApprovalCandidate> Fold(
        IEnumerable<(long Id, string? Name, string? EmployeeCode, bool Enabled,
                     string? ProfileStatus, string? RoleCode)> rows)
    {
        var byId = new Dictionary<long, (ApprovalCandidate Candidate, List<string> Roles)>();

        foreach (var row in rows)
        {
            if (!byId.TryGetValue(row.Id, out var entry))
            {
                entry = (new ApprovalCandidate
                {
                    Id = row.Id,
                    Name = row.Name,
                    EmployeeCode = row.EmployeeCode,
                    Enabled = row.Enabled,
                    ProfileStatus = row.ProfileStatus
                }, []);
                byId[row.Id] = entry;
            }

            if (!string.IsNullOrWhiteSpace(row.RoleCode))
            {
                string code = row.RoleCode.Trim().ToUpperInvariant();
                if (!entry.Roles.Contains(code))
                {
                    entry.Roles.Add(code);
                }
            }
        }

        return byId.Values
                   .Select(e => e.Candidate with { RoleCodes = e.Roles })
                   .ToArray();
    }
}
