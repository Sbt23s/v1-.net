using Dapper;
using Pixous.HrPortal.Domain.Common;
using Pixous.HrPortal.Domain.Modules.Audit;
using Pixous.HrPortal.Domain.Modules.User;
using Pixous.HrPortal.Domain.Security;
using Pixous.HrPortal.Infrastructure.Persistence;

namespace Pixous.HrPortal.Infrastructure.Modules.User;

/// <summary>
/// The employee directory, ported from
/// com.pixous.hrportal.modules.user.UserService.
/// </summary>
public sealed class UserBal : DalBase, IUserBal
{
    private readonly IPasswordVault _vault;
    private readonly IStorageService _storage;
    private readonly IPasswordHasher _hasher;
    private readonly IAuditService _audit;
    private readonly ICurrentUser _currentUser;

    public UserBal(
        IDbConnectionFactory connectionFactory,
        IPasswordVault vault,
        IStorageService storage,
        IPasswordHasher hasher,
        IAuditService audit,
        ICurrentUser currentUser)
        : base(connectionFactory)
    {
        _vault = vault;
        _storage = storage;
        _hasher = hasher;
        _audit = audit;
        _currentUser = currentUser;
    }

    /// <summary>
    /// The platform logins, which never appear in the directory. Codes rather
    /// than roles because that is what identifies them: there is no SYSTEM_ADMIN
    /// role in this schema.
    /// </summary>
    private static readonly string[] PlatformCodes = ["PIX-E100", "ADM0001", "SADM001"];

    /// <summary>
    /// The roles a desk login holds. An employee account holds none of them.
    /// </summary>
    private static readonly HashSet<string> DeskRoles = new(StringComparer.Ordinal)
    {
        "IT_HR", "IT_MGR", "SUPER_ADMIN", "COMPANY_ADMIN", "TECHNICAL_ADMIN"
    };

    private const string SummaryColumns = """
        u.id                 AS Id,
        u.employee_code      AS EmployeeCode,
        u.name               AS Name,
        u.username           AS Username,
        u.email              AS Email,
        u.phone              AS Phone,
        u.industry           AS Industry,
        u.department_id      AS DepartmentId,
        u.profile_status     AS ProfileStatus,
        u.photo_path         AS PhotoPath,
        u.dob                AS Dob,
        u.designation_id     AS DesignationId,
        u.designation_title  AS DesignationTitle,
        u.tech_stack         AS TechStack,
        u.password_vault     AS PasswordVault,
        u.company_id         AS CompanyId,
        c.company_name       AS CompanyName
        """;

    /// <summary>
    /// The filters, shared by the count and the page so the two cannot disagree
    /// about how many rows there are.
    ///
    /// The platform-account exclusion is part of it: those three logins are not
    /// staff and must not appear in a directory of employees.
    ///
    /// The status filter is deliberately narrow. Only 'ACTIVE' and 'OFFBOARDED'
    /// mean anything; any other value matches everything, exactly as the Java's
    /// chain of ORs does — it is not an error, it simply does not filter.
    /// </summary>
    private const string Filters = """
        WHERE (@q IS NULL
               OR LOWER(u.name) LIKE CONCAT('%', LOWER(@q), '%')
               OR LOWER(u.username) LIKE CONCAT('%', LOWER(@q), '%')
               OR u.aadhar LIKE CONCAT('%', @q, '%')
               OR u.employee_code LIKE CONCAT('%', @q, '%')
               OR u.phone LIKE CONCAT('%', @q, '%'))
          AND (@industry IS NULL OR u.industry = @industry)
          AND (@departmentId IS NULL OR u.department_id = @departmentId)
          AND (@designationId IS NULL OR u.designation_id = @designationId)
          AND (@designationTitle IS NULL OR u.designation_title = @designationTitle)
          AND (@joinedFrom IS NULL OR u.date_of_joining >= @joinedFrom)
          AND (@joinedTo IS NULL OR u.date_of_joining <= @joinedTo)
          AND (@roleCode IS NULL OR EXISTS (
                 SELECT 1 FROM user_roles ur2
                 JOIN roles r2 ON r2.id = ur2.role_id
                 WHERE ur2.user_id = u.id AND r2.code = @roleCode))
          AND (@status IS NULL
               OR (@status = 'OFFBOARDED' AND u.profile_status = 'OFFBOARDED')
               OR (@status = 'ACTIVE'
                   AND (u.profile_status IS NULL OR u.profile_status <> 'OFFBOARDED'))
               OR @status NOT IN ('ACTIVE', 'OFFBOARDED'))
          AND (u.employee_code IS NULL OR UPPER(u.employee_code) NOT IN @platformCodes)
        """;

    public async Task<PageResponse<UserSummary>> DirectoryAsync(UserDirectoryQuery query,
                                                                CancellationToken ct = default)
    {
        // Spring's PageRequest.of rejects these, and the handler turns that into
        // a 400. Reproduced rather than clamped.
        if (query.Page < 0)
        {
            throw new ArgumentException("Page index must not be less than zero");
        }

        if (query.Size < 1)
        {
            throw new ArgumentException("Page size must not be less than one");
        }

        var parameters = new
        {
            q = BlankToNull(query.Q),
            industry = BlankToNull(query.Industry),
            departmentId = query.DepartmentId,
            designationId = query.DesignationId,
            designationTitle = BlankToNull(query.DesignationTitle),
            roleCode = BlankToNull(query.RoleCode),
            joinedFrom = query.JoinedFrom,
            joinedTo = query.JoinedTo,
            status = BlankToNull(query.Status),
            platformCodes = PlatformCodes,
            size = query.Size,
            offset = (long)query.Page * query.Size
        };

        var rows = await QueryAsync(conn => conn.QueryAsync<UserRow>(
            new CommandDefinition($"""
                SELECT {SummaryColumns}
                FROM users u
                LEFT JOIN companies c ON c.id = u.company_id
                {Filters}
                ORDER BY u.name, u.id
                LIMIT @size OFFSET @offset
                """,
                parameters, cancellationToken: ct)), ct);

        long total = await QueryAsync(conn => conn.ExecuteScalarAsync<long>(
            new CommandDefinition($"SELECT COUNT(*) FROM users u {Filters}",
                parameters, cancellationToken: ct)), ct);

        IReadOnlyList<UserSummary> content = await ToSummariesAsync(rows.AsList(), ct);

        return PageResponse<UserSummary>.Of(content, query.Page, query.Size, total);
    }

    public async Task<UserSummary> GetByIdAsync(long userId, CancellationToken ct = default)
    {
        UserRow? row = await QueryAsync(conn => conn.QueryFirstOrDefaultAsync<UserRow>(
            new CommandDefinition($"""
                SELECT {SummaryColumns}
                FROM users u
                LEFT JOIN companies c ON c.id = u.company_id
                WHERE u.id = @userId
                """,
                new { userId }, cancellationToken: ct)), ct);

        if (row is null)
        {
            throw ApiException.NotFound("User");
        }

        return (await ToSummariesAsync([row], ct))[0];
    }

    /// <summary>
    /// Attaches roles and turns rows into summaries.
    ///
    /// The roles for the whole page are fetched in ONE query rather than one per
    /// row. A directory page asks for up to three hundred rows, and three hundred
    /// round trips against a database that allows twenty connections in total is
    /// what made listing employees take forty seconds on the Java side before its
    /// batch-fetch setting was tuned.
    /// </summary>
    private async Task<IReadOnlyList<UserSummary>> ToSummariesAsync(
        IReadOnlyList<UserRow> rows, CancellationToken ct)
    {
        if (rows.Count == 0)
        {
            return [];
        }

        long[] ids = rows.Select(r => r.Id).ToArray();

        var roleRows = await QueryAsync(conn => conn.QueryAsync<(long UserId, string Code)>(
            new CommandDefinition("""
                SELECT ur.user_id, r.code
                FROM user_roles ur
                JOIN roles r ON r.id = ur.role_id
                WHERE ur.user_id IN @ids
                """,
                new { ids }, cancellationToken: ct)), ct);

        var rolesByUser = roleRows
            .GroupBy(r => r.UserId)
            .ToDictionary(g => g.Key, g => (IReadOnlyList<string>)g.Select(r => r.Code).ToArray());

        var summaries = new List<UserSummary>(rows.Count);

        foreach (UserRow r in rows)
        {
            IReadOnlyList<string> roles =
                rolesByUser.TryGetValue(r.Id, out var found) ? found : [];

            summaries.Add(new UserSummary(
                r.Id, r.EmployeeCode, r.Name, r.Username, r.Email, r.Phone, r.Industry,
                r.DepartmentId, r.ProfileStatus, r.PhotoPath, r.Dob, roles,
                r.DesignationId, r.DesignationTitle, r.TechStack,
                _vault.Open(r.PasswordVault),
                r.CompanyId,
                // "Company Name" was once the literal value here for every user,
                // and the technical-admin directory filters its rows by matching
                // this against the company being viewed -- so nothing matched and
                // the table showed no accounts at all.
                r.CompanyName,
                Attends(r, roles)));
        }

        return summaries;
    }

    /// <summary>
    /// Whether this account turns up for work.
    ///
    /// Two signals together: an administrative role, AND no team. Both are
    /// needed, and the reason is in the data.
    ///
    /// Role alone is wrong — PIX-E001 and PIX-E058 hold IT_HR, sit on the Office
    /// Administrator team and punch in like everyone else. No team alone is wrong
    /// too: four IT_EMP accounts have no designation recorded and are perfectly
    /// ordinary employees who simply have not been assigned one.
    ///
    /// Together they describe exactly the four desk logins, none of which has a
    /// single punch between them. A new desk login is caught on its own, without
    /// a code change; giving one a team puts it back on the roll, which is the
    /// right way round.
    /// </summary>
    private static bool Attends(UserRow u, IReadOnlyList<string> roles)
    {
        bool hasTeam = u.DesignationId is not null
                    || !string.IsNullOrWhiteSpace(u.DesignationTitle);

        if (hasTeam)
        {
            return true;
        }

        return !roles.Any(DeskRoles.Contains);
    }

    private static string? BlankToNull(string? s) =>
        string.IsNullOrWhiteSpace(s) ? null : s;

    /// <summary>The raw row, before roles and the vault are resolved.</summary>
    private sealed class UserRow
    {
        public long Id { get; set; }
        public string? EmployeeCode { get; set; }
        public string? Name { get; set; }
        public string? Username { get; set; }
        public string? Email { get; set; }
        public string? Phone { get; set; }
        public string? Industry { get; set; }
        public long? DepartmentId { get; set; }
        public string? ProfileStatus { get; set; }
        public string? PhotoPath { get; set; }
        public DateOnly? Dob { get; set; }
        public long? DesignationId { get; set; }
        public string? DesignationTitle { get; set; }
        public string? TechStack { get; set; }
        public string? PasswordVault { get; set; }
        public long? CompanyId { get; set; }
        public string? CompanyName { get; set; }
    }

    // ---- the read-only views ------------------------------------------------

    /// <summary>
    /// The caller's team and its active members.
    ///
    /// The team is named from the user's own designation title, falling back to
    /// the linked designation record. Members are matched by title OR the
    /// designation id, so somebody carrying only one of the two still appears.
    /// </summary>
    public async Task<MyTeamResponse> MyTeamAsync(long userId, CancellationToken ct = default)
    {
        var me = await QueryAsync(conn => conn.QueryFirstOrDefaultAsync<
            (long Id, string? Name, string? Code, string? Title, long? DesignationId,
             string? Photo)>(
            new CommandDefinition("""
                SELECT id, name, employee_code, designation_title, designation_id, photo_path
                FROM users WHERE id = @userId
                """, new { userId }, cancellationToken: ct)), ct);

        if (me.Id == 0)
        {
            throw ApiException.NotFound("User");
        }

        string? title = me.Title;

        if (string.IsNullOrWhiteSpace(title) && me.DesignationId is not null)
        {
            title = await QueryAsync(conn => conn.ExecuteScalarAsync<string?>(
                new CommandDefinition("SELECT name FROM designations WHERE id = @id",
                    new { id = me.DesignationId }, cancellationToken: ct)), ct);
        }

        var self = new TeamMemberView(me.Id, me.Name, me.Code, me.Title, me.Photo);

        if (string.IsNullOrWhiteSpace(title))
        {
            // No team recorded at all. "My Team" with one member beats an empty
            // page that looks broken.
            return new MyTeamResponse("My Team", [self]);
        }

        var members = (await QueryAsync(conn => conn.QueryAsync<TeamMemberView>(
            new CommandDefinition("""
                SELECT id AS Id, name AS Name, employee_code AS EmployeeCode,
                       designation_title AS DesignationTitle, photo_path AS PhotoPath
                FROM users
                WHERE enabled = 1
                  AND (profile_status IS NULL OR UPPER(profile_status) <> 'OFFBOARDED')
                  AND (TRIM(LOWER(designation_title)) = TRIM(LOWER(@title))
                       OR (@designationId IS NOT NULL AND designation_id = @designationId))
                ORDER BY name
                """, new { title, designationId = me.DesignationId },
                cancellationToken: ct)), ct)).AsList();

        return new MyTeamResponse(title, members.Count == 0 ? [self] : members);
    }

    public async Task<IReadOnlyList<BankView>> ListBanksAsync(long userId,
                                                              CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<BankView>(
            new CommandDefinition("""
                -- `Primary` is backticked: PRIMARY is a reserved word in MySQL
                -- and an unquoted alias is a syntax error, not a bad column.
                SELECT id AS Id, bank_name AS BankName, branch_name AS BranchName,
                       account_number AS AccountNumber, ifsc_code AS IfscCode,
                       account_holder_name AS AccountHolderName, is_primary AS `Primary`
                FROM bank_details WHERE user_id = @userId
                ORDER BY is_primary DESC, id
                """, new { userId }, cancellationToken: ct)), ct)).AsList();

    /// <summary>
    /// The service record for everybody.
    ///
    /// Platform accounts are excluded -- they are not employees, and a service
    /// record listing them says somebody joined on the day the system was set
    /// up.
    /// </summary>
    public async Task<IReadOnlyList<EmployeeHistoryRow>> HistoryAsync(
        bool includeRelieved, CancellationToken ct = default)
    {
        IReadOnlyList<EmployeeHistoryRow> rows = await ReadHistoryAsync(null, ct);

        DateOnly today = DateOnly.FromDateTime(DateTime.Now);

        return rows
            .Where(r => includeRelieved
                     || !(r.RelievingDate is not null && r.RelievingDate.Value <= today))
            // Newest joiner first, and anybody with no joining date LAST rather
            // than first -- a missing date is not a recent one.
            .OrderByDescending(r => r.DateOfJoining ?? DateOnly.MinValue)
            .ToArray();
    }

    public async Task<EmployeeHistoryRow> HistoryForAsync(long userId,
                                                          CancellationToken ct = default)
    {
        IReadOnlyList<EmployeeHistoryRow> rows = await ReadHistoryAsync(userId, ct);

        return rows.Count > 0 ? rows[0] : throw ApiException.NotFound("No such employee.");
    }

    /// <summary>
    /// The service record, joined in one statement.
    ///
    /// The offboarding record is a LEFT JOIN rather than a lookup per employee:
    /// there are as many employees as rows on the page, and one query each is
    /// the classic N+1 on a screen built to show all of them.
    /// </summary>
    private async Task<IReadOnlyList<EmployeeHistoryRow>> ReadHistoryAsync(
        long? userId, CancellationToken ct)
    {
        var rows = await QueryAsync(conn => conn.QueryAsync<
            (long Id, string? Code, string? Name, string? Email, string? Phone,
             string? Designation, string? Department, DateOnly? Joined, DateOnly? ProbationEnd,
             string? Status, string? ProfileStatus, DateOnly? Relieved, string? Reason,
             string? Fnf, string? RoleCode)>(
            new CommandDefinition("""
                SELECT u.id, u.employee_code, u.name, u.email, u.phone,
                       u.designation_title, u.department_title,
                       u.date_of_joining, u.probation_end_date,
                       es.name AS employment_status, u.profile_status,
                       o.relieving_date, o.reason, o.fnf_status, r.code
                FROM users u
                LEFT JOIN offboarding_records o ON o.user_id = u.id
                LEFT JOIN employment_statuses es ON es.id = u.employment_status_id
                LEFT JOIN user_roles ur ON ur.user_id = u.id
                LEFT JOIN roles r ON r.id = ur.role_id
                WHERE (@userId IS NULL OR u.id = @userId)
                  AND UPPER(IFNULL(u.employee_code,'')) NOT IN ('PIX-E100','ADM0001','HR0001')
                """, new { userId }, cancellationToken: ct)), ct);

        var byId = new Dictionary<long, (EmployeeHistoryRow Row, List<string> Roles)>();

        foreach (var r in rows)
        {
            if (!byId.TryGetValue(r.Id, out var entry))
            {
                entry = (new EmployeeHistoryRow(
                    r.Id, r.Code, r.Name, r.Email, r.Phone,
                    Blank(r.Designation), Blank(r.Department), [],
                    r.Joined, r.ProbationEnd, r.Status, r.ProfileStatus,
                    r.Relieved, Blank(r.Reason), r.Fnf,
                    TenureMonths(r.Joined, r.Relieved)), []);

                byId[r.Id] = entry;
            }

            if (!string.IsNullOrWhiteSpace(r.RoleCode))
            {
                string code = r.RoleCode.Trim();

                if (!entry.Roles.Contains(code))
                {
                    entry.Roles.Add(code);
                }
            }
        }

        return byId.Values
                   .Select(e => e.Row with { Roles = e.Roles.Order(StringComparer.Ordinal).ToArray() })
                   .ToArray();
    }

    /// <summary>
    /// Months served, to the relieving date or to today. Whole months, so
    /// somebody who joined on the 30th has served a month on the 30th of the
    /// next and not the 1st.
    /// </summary>
    private static int TenureMonths(DateOnly? joined, DateOnly? relieved)
    {
        if (joined is null)
        {
            return 0;
        }

        DateOnly end = relieved ?? DateOnly.FromDateTime(DateTime.Now);

        int months = ((end.Year - joined.Value.Year) * 12) + end.Month - joined.Value.Month;

        if (end.Day < joined.Value.Day)
        {
            months--;
        }

        return Math.Max(0, months);
    }

    private static string? Blank(string? s) => string.IsNullOrWhiteSpace(s) ? null : s;

    public async Task<IReadOnlyList<TeamLeaderRow>> TeamLeadersAsync(
        CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<TeamLeaderRow>(
            new CommandDefinition("""
                SELECT t.id AS Id, t.user_id AS UserId, u.name AS Name,
                       u.employee_code AS Code, u.designation_title AS OwnTeam,
                       t.team_title AS TeamTitle
                FROM team_leader_team t
                LEFT JOIN users u ON u.id = t.user_id
                ORDER BY u.name, t.team_title
                """, cancellationToken: ct)), ct)).AsList();

    /// <summary>
    /// The teams one leader covers: their OWN designation first, then the
    /// extras. The order matters -- the first is the team they actually belong
    /// to, and the rest are ones they also cover.
    /// </summary>
    public async Task<IReadOnlyList<string>> TeamsOfAsync(long userId,
                                                          CancellationToken ct = default)
    {
        string? own = await QueryAsync(conn => conn.ExecuteScalarAsync<string?>(
            new CommandDefinition("SELECT designation_title FROM users WHERE id = @userId",
                new { userId }, cancellationToken: ct)), ct);

        var extras = (await QueryAsync(conn => conn.QueryAsync<string>(
            new CommandDefinition("""
                SELECT team_title FROM team_leader_team
                WHERE user_id = @userId ORDER BY team_title
                """, new { userId }, cancellationToken: ct)), ct)).AsList();

        var teams = new List<string>();

        if (!string.IsNullOrWhiteSpace(own))
        {
            teams.Add(own.Trim());
        }

        foreach (string t in extras)
        {
            if (!string.IsNullOrWhiteSpace(t)
                && !teams.Contains(t.Trim(), StringComparer.OrdinalIgnoreCase))
            {
                teams.Add(t.Trim());
            }
        }

        return teams;
    }

    // ---- Profile & Employee writes ----

    public async Task<ProfileResponse> GetProfileAsync(long userId, CancellationToken ct = default)
    {
        var row = await QueryAsync(conn => conn.QueryFirstOrDefaultAsync<UserProfileRow>(
            new CommandDefinition("""
                SELECT
                    u.id AS Id,
                    u.employee_code AS EmployeeCode,
                    u.username AS Username,
                    u.name AS Name,
                    u.dob AS Dob,
                    u.gender AS Gender,
                    u.aadhar AS Aadhar,
                    u.phone AS Phone,
                    u.email AS Email,
                    u.photo_path AS PhotoPath,
                    u.cover_photo_path AS CoverPhotoPath,
                    u.care_of AS CareOf,
                    u.house AS House,
                    u.street AS Street,
                    u.locality AS Locality,
                    u.vtc AS Vtc,
                    u.district AS District,
                    u.state AS State,
                    u.country AS Country,
                    u.pincode AS Pincode,
                    u.post_office AS PostOffice,
                    u.department_id AS DepartmentId,
                    u.designation_id AS DesignationId,
                    u.office_location_id AS OfficeLocationId,
                    u.reporting_manager_id AS ReportingManagerId,
                    u.industry AS Industry,
                    u.employment_type AS EmploymentType,
                    u.date_of_joining AS DateOfJoining,
                    u.probation_end_date AS ProbationEndDate,
                    u.profile_status AS ProfileStatus,
                    u.pan AS Pan,
                    u.pf_number AS PfNumber,
                    u.alternate_phone AS AlternatePhone,
                    u.emergency_contact AS EmergencyContact,
                    u.emergency_contact_relation AS EmergencyContactRelation,
                    u.blood_group AS BloodGroup,
                    u.personal_email AS PersonalEmail,
                    u.designation_title AS DesignationTitle,
                    u.department_title AS DepartmentTitle,
                    u.position_title AS PositionTitle,
                    u.documents AS Documents,
                    u.face_photo_path AS FacePhotoPath,
                    u.face_registered_at AS FaceRegisteredAt,
                    reg.name AS FaceRegisteredByName,
                    u.company_id AS CompanyId
                FROM users u
                LEFT JOIN users reg ON reg.id = u.face_registered_by
                WHERE u.id = @userId
                """, new { userId }, cancellationToken: ct)), ct);

        if (row is null)
        {
            throw ApiException.NotFound("User");
        }

        if (_currentUser.CompanyId != null && row.CompanyId != null && _currentUser.CompanyId != row.CompanyId)
        {
            throw ApiException.NotFound("User");
        }

        var roles = (await QueryAsync(conn => conn.QueryAsync<string>(
            new CommandDefinition("""
                SELECT r.code
                FROM user_roles ur
                JOIN roles r ON r.id = ur.role_id
                WHERE ur.user_id = @userId
                ORDER BY r.code
                """, new { userId }, cancellationToken: ct)), ct)).AsList();

        var permissions = (await QueryAsync(conn => conn.QueryAsync<string>(
            new CommandDefinition("""
                SELECT DISTINCT p.code
                FROM user_roles ur
                JOIN role_permissions rp ON rp.role_id = ur.role_id
                JOIN permissions p ON p.id = rp.permission_id
                WHERE ur.user_id = @userId
                ORDER BY p.code
                """, new { userId }, cancellationToken: ct)), ct)).AsList();

        var address = new AddressDto(
            row.CareOf, row.House, row.Street, row.Locality, row.Vtc,
            row.District, row.State, row.Country, row.Pincode, row.PostOffice);

        return new ProfileResponse(
            row.Id, row.EmployeeCode, row.Username, row.Name, row.Dob,
            row.Gender, row.Aadhar, row.Phone, row.Email, row.PhotoPath,
            row.CoverPhotoPath, address, row.DepartmentId, row.DesignationId,
            row.OfficeLocationId, row.ReportingManagerId, row.Industry,
            row.EmploymentType, row.DateOfJoining, row.ProbationEndDate,
            row.ProfileStatus, row.Pan, row.PfNumber, row.AlternatePhone,
            row.EmergencyContact, row.EmergencyContactRelation, row.BloodGroup,
            row.PersonalEmail, row.DesignationTitle, row.DepartmentTitle,
            row.PositionTitle, roles, permissions, row.Documents,
            row.FacePhotoPath, row.FaceRegisteredAt, row.FaceRegisteredByName);
    }

    public async Task<ProfileResponse> UpdateProfileAsync(long userId, UpdateProfileRequest request, CancellationToken ct = default)
    {
        await AssertUserAccessAsync(userId, ct);

        var updates = new List<string>();
        var p = new DynamicParameters();
        p.Add("userId", userId);

        if (request.Name != null) { updates.Add("name = @name"); p.Add("name", request.Name); }
        if (!string.IsNullOrWhiteSpace(request.Dob) && DateOnly.TryParse(request.Dob, out var d)) { updates.Add("dob = @dob"); p.Add("dob", d); }
        if (!string.IsNullOrWhiteSpace(request.Gender)) { updates.Add("gender = @gender"); p.Add("gender", char.ToUpperInvariant(request.Gender.Trim()[0]).ToString()); }
        if (request.Email != null) { updates.Add("email = @email"); p.Add("email", request.Email); }
        if (request.CareOf != null) { updates.Add("care_of = @careOf"); p.Add("careOf", request.CareOf); }
        if (request.House != null) { updates.Add("house = @house"); p.Add("house", request.House); }
        if (request.Street != null) { updates.Add("street = @street"); p.Add("street", request.Street); }
        if (request.Locality != null) { updates.Add("locality = @locality"); p.Add("locality", request.Locality); }
        if (request.Vtc != null) { updates.Add("vtc = @vtc"); p.Add("vtc", request.Vtc); }
        if (request.District != null) { updates.Add("district = @district"); p.Add("district", request.District); }
        if (request.State != null) { updates.Add("state = @state"); p.Add("state", request.State); }
        if (request.Country != null) { updates.Add("country = @country"); p.Add("country", request.Country); }
        if (request.Pincode != null) { updates.Add("pincode = @pincode"); p.Add("pincode", request.Pincode); }
        if (request.PostOffice != null) { updates.Add("post_office = @postOffice"); p.Add("postOffice", request.PostOffice); }

        if (updates.Count > 0)
        {
            string sql = $"UPDATE users SET {string.Join(", ", updates)} WHERE id = @userId";
            await QueryAsync(conn => conn.ExecuteAsync(new CommandDefinition(sql, p, cancellationToken: ct)), ct);
        }

        return await GetProfileAsync(userId, ct);
    }

    public async Task<ProfileResponse> UpdateEmployeeAsync(long userId, UpdateEmployeeRequest request, CancellationToken ct = default)
    {
        await AssertUserAccessAsync(userId, ct);

        var updates = new List<string>();
        var p = new DynamicParameters();
        p.Add("userId", userId);

        if (request.Name != null) { updates.Add("name = @name"); p.Add("name", request.Name); }
        if (!string.IsNullOrWhiteSpace(request.Dob) && DateOnly.TryParse(request.Dob, out var d)) { updates.Add("dob = @dob"); p.Add("dob", d); }
        if (!string.IsNullOrWhiteSpace(request.Gender)) { updates.Add("gender = @gender"); p.Add("gender", char.ToUpperInvariant(request.Gender.Trim()[0]).ToString()); }
        if (request.Email != null) { updates.Add("email = @email"); p.Add("email", BlankToNull(request.Email)); }
        if (request.Phone != null) { updates.Add("phone = @phone"); p.Add("phone", BlankToNull(request.Phone)); }
        if (request.Aadhar != null) { updates.Add("aadhar = @aadhar"); p.Add("aadhar", BlankToNull(request.Aadhar)); }
        if (request.Pan != null) { updates.Add("pan = @pan"); p.Add("pan", BlankToNull(request.Pan)); }
        if (request.PfNumber != null) { updates.Add("pf_number = @pfNumber"); p.Add("pfNumber", BlankToNull(request.PfNumber)); }
        if (request.AlternatePhone != null) { updates.Add("alternate_phone = @alternatePhone"); p.Add("alternatePhone", BlankToNull(request.AlternatePhone)); }
        if (request.EmergencyContact != null) { updates.Add("emergency_contact = @emergencyContact"); p.Add("emergencyContact", BlankToNull(request.EmergencyContact)); }
        if (request.EmergencyContactRelation != null) { updates.Add("emergency_contact_relation = @emergencyContactRelation"); p.Add("emergencyContactRelation", BlankToNull(request.EmergencyContactRelation)); }
        if (request.BloodGroup != null) { updates.Add("blood_group = @bloodGroup"); p.Add("bloodGroup", BlankToNull(request.BloodGroup)); }
        if (request.Documents != null) { updates.Add("documents = @documents"); p.Add("documents", BlankToNull(request.Documents)); }
        if (request.PersonalEmail != null) { updates.Add("personal_email = @personalEmail"); p.Add("personalEmail", BlankToNull(request.PersonalEmail)); }
        if (request.DesignationTitle != null) { updates.Add("designation_title = @designationTitle"); p.Add("designationTitle", BlankToNull(request.DesignationTitle)); }
        if (request.DepartmentTitle != null) { updates.Add("department_title = @departmentTitle"); p.Add("departmentTitle", BlankToNull(request.DepartmentTitle)); }
        if (request.PositionTitle != null) { updates.Add("position_title = @positionTitle"); p.Add("positionTitle", BlankToNull(request.PositionTitle)); }
        if (request.TechStack != null) { updates.Add("tech_stack = @techStack"); p.Add("techStack", BlankToNull(request.TechStack)); }
        if (request.CareOf != null) { updates.Add("care_of = @careOf"); p.Add("careOf", request.CareOf); }
        if (request.House != null) { updates.Add("house = @house"); p.Add("house", request.House); }
        if (request.Street != null) { updates.Add("street = @street"); p.Add("street", request.Street); }
        if (request.Locality != null) { updates.Add("locality = @locality"); p.Add("locality", request.Locality); }
        if (request.Vtc != null) { updates.Add("vtc = @vtc"); p.Add("vtc", request.Vtc); }
        if (request.District != null) { updates.Add("district = @district"); p.Add("district", request.District); }
        if (request.State != null) { updates.Add("state = @state"); p.Add("state", request.State); }
        if (!string.IsNullOrWhiteSpace(request.Country)) { updates.Add("country = @country"); p.Add("country", request.Country); }
        if (request.Pincode != null) { updates.Add("pincode = @pincode"); p.Add("pincode", request.Pincode); }
        if (request.PostOffice != null) { updates.Add("post_office = @postOffice"); p.Add("postOffice", request.PostOffice); }
        if (request.Industry != null) { updates.Add("industry = @industry"); p.Add("industry", request.Industry.Trim().ToUpperInvariant()); }
        if (request.DepartmentId != null) { updates.Add("department_id = @departmentId"); p.Add("departmentId", request.DepartmentId); }
        if (request.DesignationId != null) { updates.Add("designation_id = @designationId"); p.Add("designationId", request.DesignationId); }
        if (request.OfficeLocationId != null) { updates.Add("office_location_id = @officeLocationId"); p.Add("officeLocationId", request.OfficeLocationId); }
        if (request.ReportingManagerId != null) { updates.Add("reporting_manager_id = @reportingManagerId"); p.Add("reportingManagerId", request.ReportingManagerId); }
        if (request.EmploymentType != null) { updates.Add("employment_type = @employmentType"); p.Add("employmentType", request.EmploymentType); }
        if (!string.IsNullOrWhiteSpace(request.DateOfJoining) && DateOnly.TryParse(request.DateOfJoining, out var doj)) { updates.Add("date_of_joining = @dateOfJoining"); p.Add("dateOfJoining", doj); }
        if (request.ProbationEndDate != null)
        {
            DateOnly? ped = (!string.IsNullOrWhiteSpace(request.ProbationEndDate) && DateOnly.TryParse(request.ProbationEndDate, out var pDate)) ? pDate : null;
            updates.Add("probation_end_date = @probationEndDate");
            p.Add("probationEndDate", ped);
        }
        if (request.ProfileStatus != null)
        {
            string status = request.ProfileStatus.Trim().ToUpperInvariant();
            updates.Add("profile_status = @profileStatus");
            updates.Add("enabled = @enabled");
            p.Add("profileStatus", status);
            p.Add("enabled", status != "OFFBOARDED" ? 1 : 0);
        }
        if (request.EmployeeCode != null) { updates.Add("employee_code = @employeeCode"); p.Add("employeeCode", request.EmployeeCode); }

        if (updates.Count > 0)
        {
            string sql = $"UPDATE users SET {string.Join(", ", updates)} WHERE id = @userId";
            await QueryAsync(conn => conn.ExecuteAsync(new CommandDefinition(sql, p, cancellationToken: ct)), ct);
        }

        if (request.Roles != null)
        {
            var requestedRoles = request.Roles.Where(r => !string.IsNullOrWhiteSpace(r)).Select(r => r.Trim()).Distinct().ToList();
            Dictionary<string, long> roleMap = new(StringComparer.OrdinalIgnoreCase);

            if (requestedRoles.Count > 0)
            {
                var foundRoles = (await QueryAsync(conn => conn.QueryAsync<(long Id, string Code)>(
                    new CommandDefinition("SELECT id, code FROM roles WHERE code IN @requestedRoles",
                        new { requestedRoles }, cancellationToken: ct)), ct)).AsList();

                foreach (var fr in foundRoles)
                {
                    roleMap[fr.Code] = fr.Id;
                }

                if (roleMap.Count == 0)
                {
                    throw ApiException.Business("Unknown role: " + string.Join(", ", request.Roles));
                }
            }

            await TransactionAsync(async (conn, tx) =>
            {
                await conn.ExecuteAsync("DELETE FROM user_roles WHERE user_id = @userId", new { userId }, tx);
                foreach (var r in requestedRoles)
                {
                    if (roleMap.TryGetValue(r, out long roleId))
                    {
                        await conn.ExecuteAsync("INSERT INTO user_roles (user_id, role_id) VALUES (@userId, @roleId)",
                            new { userId, roleId }, tx);
                    }
                }
            }, ct);
        }

        return await GetProfileAsync(userId, ct);
    }

    public async Task SetCredentialsAsync(long userId, string? username, string? password, CancellationToken ct = default)
    {
        await AssertUserAccessAsync(userId, ct);

        bool changed = false;
        var p = new DynamicParameters();
        p.Add("userId", userId);
        var updates = new List<string>();

        if (!string.IsNullOrWhiteSpace(username))
        {
            string uname = username.Trim();
            long? other = await QueryAsync(conn => conn.ExecuteScalarAsync<long?>(
                new CommandDefinition("SELECT id FROM users WHERE username = @uname AND id <> @userId LIMIT 1",
                    new { uname, userId }, cancellationToken: ct)), ct);

            if (other.HasValue)
            {
                throw ApiException.Business($"Username \"{uname}\" is already taken");
            }

            updates.Add("username = @username");
            p.Add("username", uname);
            changed = true;
        }

        if (!string.IsNullOrWhiteSpace(password))
        {
            string pwd = password.Trim();
            if (pwd.Length < 4)
            {
                throw ApiException.Business("Password must be at least 4 characters");
            }

            updates.Add("password_hash = @hash");
            updates.Add("password_vault = @vault");
            p.Add("hash", _hasher.Hash(pwd));
            p.Add("vault", _vault.Seal(pwd));
            changed = true;
        }

        if (!changed)
        {
            throw ApiException.Business("Provide a username or password to update");
        }

        string sql = $"UPDATE users SET {string.Join(", ", updates)} WHERE id = @userId";
        await QueryAsync(conn => conn.ExecuteAsync(new CommandDefinition(sql, p, cancellationToken: ct)), ct);
    }

    public async Task<string?> GetCurrentPasswordAsync(long userId, CancellationToken ct = default)
    {
        await AssertUserAccessAsync(userId, ct);

        var user = await QueryAsync(conn => conn.QueryFirstOrDefaultAsync<(string? Vault, string? Hash, string? Name)>(
            new CommandDefinition("SELECT password_vault AS Vault, password_hash AS Hash, name AS Name FROM users WHERE id = @userId",
                new { userId }, cancellationToken: ct)), ct);

        if (!string.IsNullOrWhiteSpace(user.Vault))
        {
            string? opened = _vault.Open(user.Vault);
            if (opened != null) return opened;
        }

        if (!string.IsNullOrWhiteSpace(user.Hash))
        {
            foreach (string candidate in IssuedDefaults(user.Name))
            {
                if (_hasher.Verify(candidate, user.Hash))
                {
                    string? sealedVal = _vault.Seal(candidate);
                    await QueryAsync(conn => conn.ExecuteAsync(
                        new CommandDefinition("UPDATE users SET password_vault = @sealedVal WHERE id = @userId",
                            new { sealedVal, userId }, cancellationToken: ct)), ct);
                    return candidate;
                }
            }
        }

        return null;
    }

    private static IReadOnlyList<string> IssuedDefaults(string? name)
    {
        if (string.IsNullOrWhiteSpace(name)) return [];
        string first = new string(name.Trim().Split([' ', '\t'], StringSplitOptions.RemoveEmptyEntries)[0]
            .Where(char.IsAsciiLetter).ToArray());
        if (string.IsNullOrEmpty(first)) return [];
        string cap = char.ToUpperInvariant(first[0]) + first[1..].ToLowerInvariant();
        return [
            $"{cap}@123",
            $"{cap}@2025",
            $"{cap.ToLowerInvariant()}@123"
        ];
    }

    public async Task ClearDesignationAsync(long userId, CancellationToken ct = default)
    {
        await AssertUserAccessAsync(userId, ct);
        await QueryAsync(conn => conn.ExecuteAsync(
            new CommandDefinition("UPDATE users SET designation_id = NULL WHERE id = @userId",
                new { userId }, cancellationToken: ct)), ct);
    }

    public async Task OffboardUserAsync(long userId, OffboardingRequest request, CancellationToken ct = default)
    {
        await AssertUserAccessAsync(userId, ct);

        string? status = await QueryAsync(conn => conn.ExecuteScalarAsync<string?>(
            new CommandDefinition("SELECT profile_status FROM users WHERE id = @userId",
                new { userId }, cancellationToken: ct)), ct);

        if (string.Equals(status, "OFFBOARDED", StringComparison.OrdinalIgnoreCase))
        {
            throw new ApiException(ErrorCode.BadCredentials, "User is already offboarded");
        }

        await TransactionAsync(async (conn, tx) =>
        {
            await conn.ExecuteAsync(
                "UPDATE users SET profile_status = 'OFFBOARDED', enabled = 0 WHERE id = @userId",
                new { userId }, tx);

            await conn.ExecuteAsync("""
                INSERT INTO offboarding_records (user_id, relieving_date, reason, notes, fnf_status)
                VALUES (@userId, @relievingDate, @reason, @notes, 'PENDING')
                """,
                new
                {
                    userId,
                    relievingDate = request.RelievingDate,
                    reason = BlankToNull(request.Reason),
                    notes = BlankToNull(request.Notes)
                }, tx);
        }, ct);
    }

    public async Task DeleteEmployeeAsync(long actorId, long userId, string? confirmName, CancellationToken ct = default)
    {
        if (actorId == userId)
        {
            throw ApiException.Business("You cannot delete your own account.");
        }

        var user = await QueryAsync(conn => conn.QueryFirstOrDefaultAsync<(string? Name, string? Code)>(
            new CommandDefinition("SELECT name, employee_code FROM users WHERE id = @userId",
                new { userId }, cancellationToken: ct)), ct);

        if (user.Name is null && user.Code is null)
        {
            throw ApiException.NotFound("User");
        }

        if (confirmName != null)
        {
            string expected = (user.Name ?? "").Trim();
            if (!expected.Equals(confirmName.Trim(), StringComparison.OrdinalIgnoreCase))
            {
                throw ApiException.Business($"Type the employee's name exactly as \"{expected}\" to confirm.");
            }
        }

        long payslips = await QueryAsync(conn => conn.ExecuteScalarAsync<long>(
            new CommandDefinition("SELECT COUNT(*) FROM payslips WHERE user_id = @userId",
                new { userId }, cancellationToken: ct)), ct);

        if (payslips > 0)
        {
            throw ApiException.Business(
                $"{user.Name} has {payslips} payslip{(payslips == 1 ? "" : "s")} on record, which carry PF and ESI figures the company must keep. Offboard them instead -- that disables the account and keeps the history.");
        }

        string label = $"{user.Name} ({user.Code})";
        await _audit.RecordAsync(actorId, "USER", "EMPLOYEE_DELETED", "Permanently deleted " + label, "USER", userId, label, ct);

        await TransactionAsync(async (conn, tx) =>
        {
            async Task NullifyIfColumnExists(string table, string column)
            {
                long exists = await conn.ExecuteScalarAsync<long>(
                    "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = @table AND column_name = @column",
                    new { table, column }, tx);
                if (exists > 0)
                {
                    await conn.ExecuteAsync($"UPDATE {table} SET {column} = NULL WHERE {column} = @userId", new { userId }, tx);
                }
            }

            async Task DeleteIfTableExists(string table, string column)
            {
                long exists = await conn.ExecuteScalarAsync<long>(
                    "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = @table AND column_name = @column",
                    new { table, column }, tx);
                if (exists > 0)
                {
                    await conn.ExecuteAsync($"DELETE FROM {table} WHERE {column} = @userId", new { userId }, tx);
                }
            }

            await NullifyIfColumnExists("projects", "manager_id");
            await NullifyIfColumnExists("teams", "team_lead_id");
            await DeleteIfTableExists("community_messages", "sender_id");
            await DeleteIfTableExists("communities", "created_by");
            await NullifyIfColumnExists("tickets", "assigned_to");
            await NullifyIfColumnExists("ticket_comments", "author_id");
            await conn.ExecuteAsync("UPDATE users SET reporting_manager_id = NULL WHERE reporting_manager_id = @userId", new { userId }, tx);
            await conn.ExecuteAsync("DELETE FROM users WHERE id = @userId", new { userId }, tx);
        }, ct);
    }

    public async Task<string> UpdatePhotoAsync(long userId, Stream fileStream, string? originalFileName, string? contentType, long sizeBytes, CancellationToken ct = default)
    {
        await AssertUserAccessAsync(userId, ct);
        string path = await _storage.StoreAsync(fileStream, originalFileName, contentType, sizeBytes, "photos", ct);
        await QueryAsync(conn => conn.ExecuteAsync(
            new CommandDefinition("UPDATE users SET photo_path = @path WHERE id = @userId",
                new { path, userId }, cancellationToken: ct)), ct);
        return path;
    }

    public async Task RemovePhotoAsync(long userId, CancellationToken ct = default)
    {
        await AssertUserAccessAsync(userId, ct);
        await QueryAsync(conn => conn.ExecuteAsync(
            new CommandDefinition("UPDATE users SET photo_path = NULL WHERE id = @userId",
                new { userId }, cancellationToken: ct)), ct);
    }

    public async Task<string> UpdateCoverPhotoAsync(long userId, Stream fileStream, string? originalFileName, string? contentType, long sizeBytes, CancellationToken ct = default)
    {
        await AssertUserAccessAsync(userId, ct);
        string path = await _storage.StoreAsync(fileStream, originalFileName, contentType, sizeBytes, "covers", ct);
        await QueryAsync(conn => conn.ExecuteAsync(
            new CommandDefinition("UPDATE users SET cover_photo_path = @path WHERE id = @userId",
                new { path, userId }, cancellationToken: ct)), ct);
        return path;
    }

    public async Task RemoveCoverPhotoAsync(long userId, CancellationToken ct = default)
    {
        await AssertUserAccessAsync(userId, ct);
        await QueryAsync(conn => conn.ExecuteAsync(
            new CommandDefinition("UPDATE users SET cover_photo_path = NULL WHERE id = @userId",
                new { userId }, cancellationToken: ct)), ct);
    }

    public Task<string> StoreDocumentAsync(Stream fileStream, string? originalFileName, string? contentType, long sizeBytes, CancellationToken ct = default) =>
        _storage.StoreAsync(fileStream, originalFileName, contentType, sizeBytes, "employee-docs", ct);

    public async Task<FacePhotoResponse> SaveFacePhotoAsync(long userId, Stream fileStream, string? originalFileName, string? contentType, long sizeBytes, long? actorId, CancellationToken ct = default)
    {
        await AssertUserAccessAsync(userId, ct);
        if (fileStream == null || sizeBytes <= 0)
        {
            throw ApiException.Business("No photo was received.");
        }

        string path = await _storage.StoreAsync(fileStream, originalFileName, contentType, sizeBytes, "face-enrolment", ct);
        DateTime now = DateTime.Now;

        await QueryAsync(conn => conn.ExecuteAsync(
            new CommandDefinition("""
                UPDATE users SET
                    face_photo_path = @path,
                    face_registered_at = @now,
                    face_registered_by = @actorId
                WHERE id = @userId
                """, new { path, now, actorId, userId }, cancellationToken: ct)), ct);

        string? actorName = null;
        if (actorId.HasValue)
        {
            actorName = await QueryAsync(conn => conn.ExecuteScalarAsync<string?>(
                new CommandDefinition("SELECT name FROM users WHERE id = @actorId",
                    new { actorId = actorId.Value }, cancellationToken: ct)), ct);
        }

        return new FacePhotoResponse(path, now, actorName);
    }

    public async Task ClearFacePhotoAsync(long userId, CancellationToken ct = default)
    {
        await AssertUserAccessAsync(userId, ct);
        await QueryAsync(conn => conn.ExecuteAsync(
            new CommandDefinition("""
                UPDATE users SET
                    face_photo_path = NULL,
                    face_registered_at = NULL,
                    face_registered_by = NULL
                WHERE id = @userId
                """, new { userId }, cancellationToken: ct)), ct);
    }

    public async Task<BankResponse> AddBankAsync(long userId, BankRequest request, CancellationToken ct = default)
    {
        await AssertUserAccessAsync(userId, ct);

        return await TransactionAsync(async (conn, tx) =>
        {
            if (request.Primary == true)
            {
                await conn.ExecuteAsync("UPDATE bank_details SET is_primary = 0 WHERE user_id = @userId", new { userId }, tx);
            }

            await conn.ExecuteAsync("""
                INSERT INTO bank_details (user_id, bank_name, branch_name, account_number, ifsc_code, account_holder_name, is_primary)
                VALUES (@userId, @bankName, @branchName, @accountNumber, @ifscCode, @accountHolderName, @isPrimary)
                """,
                new
                {
                    userId,
                    bankName = BlankToNull(request.BankName),
                    branchName = BlankToNull(request.BranchName),
                    accountNumber = request.AccountNumber.Trim(),
                    ifscCode = request.IfscCode.Trim().ToUpperInvariant(),
                    accountHolderName = BlankToNull(request.AccountHolderName),
                    isPrimary = request.Primary == true ? 1 : 0
                }, tx);

            long id = await conn.ExecuteScalarAsync<long>("SELECT LAST_INSERT_ID()", transaction: tx);

            return new BankResponse(
                id, request.BankName, request.BranchName, request.AccountNumber,
                request.IfscCode.Trim().ToUpperInvariant(), request.AccountHolderName, request.Primary == true);
        }, cancellationToken: ct);
    }

    public async Task<BankResponse> UpdateBankAsync(long userId, long bankId, BankRequest request, CancellationToken ct = default)
    {
        await AssertUserAccessAsync(userId, ct);

        long exists = await QueryAsync(conn => conn.ExecuteScalarAsync<long>(
            new CommandDefinition("SELECT COUNT(*) FROM bank_details WHERE id = @bankId AND user_id = @userId",
                new { bankId, userId }, cancellationToken: ct)), ct);

        if (exists == 0)
        {
            throw ApiException.NotFound("Bank detail");
        }

        return await TransactionAsync(async (conn, tx) =>
        {
            if (request.Primary == true)
            {
                await conn.ExecuteAsync("UPDATE bank_details SET is_primary = 0 WHERE user_id = @userId", new { userId }, tx);
            }

            await conn.ExecuteAsync("""
                UPDATE bank_details SET
                    bank_name = @bankName,
                    branch_name = @branchName,
                    account_number = @accountNumber,
                    ifsc_code = @ifscCode,
                    account_holder_name = @accountHolderName,
                    is_primary = CASE WHEN @hasPrimary = 1 THEN @isPrimary ELSE is_primary END
                WHERE id = @bankId AND user_id = @userId
                """,
                new
                {
                    bankId,
                    userId,
                    bankName = BlankToNull(request.BankName),
                    branchName = BlankToNull(request.BranchName),
                    accountNumber = request.AccountNumber.Trim(),
                    ifscCode = request.IfscCode.Trim().ToUpperInvariant(),
                    accountHolderName = BlankToNull(request.AccountHolderName),
                    hasPrimary = request.Primary.HasValue ? 1 : 0,
                    isPrimary = request.Primary == true ? 1 : 0
                }, tx);

            bool isPrimary = request.Primary ?? (await conn.ExecuteScalarAsync<int>(
                "SELECT is_primary FROM bank_details WHERE id = @bankId", new { bankId }, tx) == 1);

            return new BankResponse(
                bankId, request.BankName, request.BranchName, request.AccountNumber,
                request.IfscCode.Trim().ToUpperInvariant(), request.AccountHolderName, isPrimary);
        }, cancellationToken: ct);
    }

    public async Task DeleteBankAsync(long userId, long bankId, CancellationToken ct = default)
    {
        await AssertUserAccessAsync(userId, ct);

        int affected = await QueryAsync(conn => conn.ExecuteAsync(
            new CommandDefinition("DELETE FROM bank_details WHERE id = @bankId AND user_id = @userId",
                new { bankId, userId }, cancellationToken: ct)), ct);

        if (affected == 0)
        {
            throw ApiException.NotFound("Bank detail");
        }
    }

    public async Task<TeamLeaderRow> AssignTeamAsync(long userId, string teamTitle, long? actorId, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(teamTitle))
        {
            throw ApiException.Business("Choose a team to assign.");
        }

        var u = await QueryAsync(conn => conn.QueryFirstOrDefaultAsync<(long Id, string? Name, string? Code, string? Title)>(
            new CommandDefinition("SELECT id, name, employee_code, designation_title FROM users WHERE id = @userId",
                new { userId }, cancellationToken: ct)), ct);

        if (u.Id == 0)
        {
            throw ApiException.NotFound("User");
        }

        var roles = (await QueryAsync(conn => conn.QueryAsync<string>(
            new CommandDefinition("""
                SELECT r.code
                FROM user_roles ur
                JOIN roles r ON r.id = ur.role_id
                WHERE ur.user_id = @userId
                """, new { userId }, cancellationToken: ct)), ct)).AsList();

        bool isTl = roles.Any(r => string.Equals(r, "IT_TL", StringComparison.OrdinalIgnoreCase)
                                || string.Equals(r, "CV_SUP", StringComparison.OrdinalIgnoreCase));

        if (!isTl)
        {
            throw ApiException.Business($"{u.Name} is not a Team Leader, so requests would never be routed to them.");
        }

        string trimmed = teamTitle.Trim();
        long count = await QueryAsync(conn => conn.ExecuteScalarAsync<long>(
            new CommandDefinition("SELECT COUNT(*) FROM team_leader_team WHERE user_id = @userId AND LOWER(team_title) = LOWER(@trimmed)",
                new { userId, trimmed }, cancellationToken: ct)), ct);

        if (count > 0)
        {
            throw ApiException.Business($"{u.Name} already leads {trimmed}.");
        }

        long id = await TransactionAsync(async (conn, tx) =>
        {
            await conn.ExecuteAsync("""
                INSERT INTO team_leader_team (user_id, team_title, created_by)
                VALUES (@userId, @trimmed, @actorId)
                """, new { userId, trimmed, actorId }, tx);

            return await conn.ExecuteScalarAsync<long>("SELECT LAST_INSERT_ID()", transaction: tx);
        }, cancellationToken: ct);

        return new TeamLeaderRow(id, userId, u.Name, u.Code, u.Title, trimmed);
    }

    public async Task RemoveTeamAssignmentAsync(long userId, string teamTitle, CancellationToken ct = default)
    {
        await QueryAsync(conn => conn.ExecuteAsync(
            new CommandDefinition("DELETE FROM team_leader_team WHERE user_id = @userId AND LOWER(team_title) = LOWER(@trimmed)",
                new { userId, trimmed = teamTitle.Trim() }, cancellationToken: ct)), ct);
    }

    public async Task ClearTeamAssignmentsAsync(long userId, CancellationToken ct = default)
    {
        await QueryAsync(conn => conn.ExecuteAsync(
            new CommandDefinition("DELETE FROM team_leader_team WHERE user_id = @userId",
                new { userId }, cancellationToken: ct)), ct);
    }

    private async Task AssertUserAccessAsync(long userId, CancellationToken ct)
    {
        var row = await QueryAsync(conn => conn.QueryFirstOrDefaultAsync<(long Id, long? CompanyId)>(
            new CommandDefinition("SELECT id, company_id FROM users WHERE id = @userId",
                new { userId }, cancellationToken: ct)), ct);

        if (row.Id == 0)
        {
            throw ApiException.NotFound("User");
        }

        if (_currentUser.CompanyId != null && row.CompanyId != null && _currentUser.CompanyId != row.CompanyId)
        {
            throw ApiException.NotFound("User");
        }
    }

    private sealed class UserProfileRow
    {
        public long Id { get; set; }
        public string? EmployeeCode { get; set; }
        public string? Username { get; set; }
        public string? Name { get; set; }
        public DateOnly? Dob { get; set; }
        public string? Gender { get; set; }
        public string? Aadhar { get; set; }
        public string? Phone { get; set; }
        public string? Email { get; set; }
        public string? PhotoPath { get; set; }
        public string? CoverPhotoPath { get; set; }
        public string? CareOf { get; set; }
        public string? House { get; set; }
        public string? Street { get; set; }
        public string? Locality { get; set; }
        public string? Vtc { get; set; }
        public string? District { get; set; }
        public string? State { get; set; }
        public string? Country { get; set; }
        public string? Pincode { get; set; }
        public string? PostOffice { get; set; }
        public long? DepartmentId { get; set; }
        public long? DesignationId { get; set; }
        public long? OfficeLocationId { get; set; }
        public long? ReportingManagerId { get; set; }
        public string? Industry { get; set; }
        public string? EmploymentType { get; set; }
        public DateOnly? DateOfJoining { get; set; }
        public DateOnly? ProbationEndDate { get; set; }
        public string? ProfileStatus { get; set; }
        public string? Pan { get; set; }
        public string? PfNumber { get; set; }
        public string? AlternatePhone { get; set; }
        public string? EmergencyContact { get; set; }
        public string? EmergencyContactRelation { get; set; }
        public string? BloodGroup { get; set; }
        public string? PersonalEmail { get; set; }
        public string? DesignationTitle { get; set; }
        public string? DepartmentTitle { get; set; }
        public string? PositionTitle { get; set; }
        public string? Documents { get; set; }
        public string? FacePhotoPath { get; set; }
        public DateTime? FaceRegisteredAt { get; set; }
        public string? FaceRegisteredByName { get; set; }
        public long? CompanyId { get; set; }
    }
}
