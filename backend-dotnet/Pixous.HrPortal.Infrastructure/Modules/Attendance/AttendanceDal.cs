using Dapper;
using Pixous.HrPortal.Domain.Modules.Attendance;
using Pixous.HrPortal.Infrastructure.Persistence;

namespace Pixous.HrPortal.Infrastructure.Modules.Attendance;

/// <summary>
/// Dapper data access for attendance, against the existing <c>attendance</c>
/// table. Nothing here creates, alters or drops anything.
/// </summary>
public sealed class AttendanceDal : DalBase, IAttendanceDal
{
    public AttendanceDal(IDbConnectionFactory connectionFactory) : base(connectionFactory) { }

    /// <summary>
    /// The columns AttendanceRecord maps, aliased to its property names.
    ///
    /// Listed explicitly rather than SELECT *: the table carries columns this
    /// type does not model (face_detail, out_face_score and the rest), and a
    /// column added by a later migration must not start arriving here
    /// unannounced.
    /// </summary>
    private const string Columns = """
        id                  AS Id,
        user_id             AS UserId,
        work_date           AS WorkDate,
        punch_in_at         AS PunchInAt,
        punch_out_at        AS PunchOutAt,
        mode                AS Mode,
        status              AS Status,
        in_latitude         AS InLatitude,
        in_longitude        AS InLongitude,
        out_latitude        AS OutLatitude,
        out_longitude       AS OutLongitude,
        site_id             AS SiteId,
        shift_id            AS ShiftId,
        within_geofence     AS WithinGeofence,
        geofence_exception  AS GeofenceException,
        is_late             AS IsLate,
        late_minutes        AS LateMinutes,
        worked_minutes      AS WorkedMinutes,
        overtime_minutes    AS OvertimeMinutes,
        face_verified       AS FaceVerified,
        face_photo_path     AS FacePhotoPath,
        face_score          AS FaceScore,
        face_detail         AS FaceDetail,
        out_face_verified   AS OutFaceVerified,
        out_face_photo_path AS OutFacePhotoPath,
        out_face_score      AS OutFaceScore,
        out_face_detail     AS OutFaceDetail,
        in_accuracy_m       AS InAccuracyM,
        out_accuracy_m      AS OutAccuracyM,
        in_device           AS InDevice,
        out_device          AS OutDevice,
        in_auth_method      AS InAuthMethod,
        out_auth_method     AS OutAuthMethod,
        in_area_name        AS InAreaName,
        out_area_name       AS OutAreaName,
        company_id          AS CompanyId
        """;

    public Task<AttendanceRecord?> FindByUserAndDateAsync(long userId, DateOnly workDate,
                                                          CancellationToken ct = default) =>
        QueryAsync(conn => conn.QueryFirstOrDefaultAsync<AttendanceRecord>(
            new CommandDefinition(
                $"SELECT {Columns} FROM attendance WHERE user_id = @userId AND work_date = @workDate LIMIT 1",
                new { userId, workDate }, cancellationToken: ct)), ct);

    public async Task<IReadOnlyList<AttendanceRecord>> FindByUserAndRangeAsync(
        long userId, DateOnly from, DateOnly to, CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<AttendanceRecord>(
            new CommandDefinition(
                $"""
                 SELECT {Columns} FROM attendance
                 WHERE user_id = @userId AND work_date BETWEEN @from AND @to
                 ORDER BY work_date
                 """,
                new { userId, from, to }, cancellationToken: ct)), ct)).AsList();

    /// <summary>
    /// Rows for several people on one day.
    ///
    /// An empty id list short-circuits: Dapper expands an empty IN list to
    /// "IN ()", which MySQL rejects as a syntax error, and the honest answer for
    /// "no people" is no rows rather than a 500.
    /// </summary>
    public async Task<IReadOnlyList<AttendanceRecord>> FindByUsersAndDateAsync(
        IReadOnlyCollection<long> userIds, DateOnly workDate, CancellationToken ct = default)
    {
        if (userIds.Count == 0)
        {
            return [];
        }

        return (await QueryAsync(conn => conn.QueryAsync<AttendanceRecord>(
            new CommandDefinition(
                $"""
                 SELECT {Columns} FROM attendance
                 WHERE user_id IN @userIds AND work_date = @workDate
                 """,
                new { userIds, workDate }, cancellationToken: ct)), ct)).AsList();
    }

    public async Task<IReadOnlyList<AttendanceRecord>> FindByUsersAndRangeAsync(
        IReadOnlyCollection<long> userIds, DateOnly from, DateOnly to,
        CancellationToken ct = default)
    {
        if (userIds.Count == 0)
        {
            return [];
        }

        return (await QueryAsync(conn => conn.QueryAsync<AttendanceRecord>(
            new CommandDefinition(
                $"""
                 SELECT {Columns} FROM attendance
                 WHERE user_id IN @userIds AND work_date BETWEEN @from AND @to
                 ORDER BY work_date
                 """,
                new { userIds, from, to }, cancellationToken: ct)), ct)).AsList();
    }

    public Task<long> InsertAsync(AttendanceRecord r, CancellationToken ct = default) =>
        QueryAsync(async conn =>
        {
            long id = await conn.ExecuteScalarAsync<long>(new CommandDefinition("""
                INSERT INTO attendance
                    (user_id, work_date, punch_in_at, punch_out_at, mode, status,
                     in_latitude, in_longitude, out_latitude, out_longitude,
                     site_id, shift_id, within_geofence, geofence_exception,
                     is_late, late_minutes, worked_minutes, overtime_minutes,
                     face_verified, face_photo_path, face_score, face_detail,
                     out_face_verified, out_face_photo_path, out_face_score, out_face_detail,
                     in_accuracy_m, out_accuracy_m, in_device, out_device,
                     in_auth_method, out_auth_method, in_area_name, out_area_name,
                     company_id, created_at, updated_at)
                VALUES
                    (@UserId, @WorkDate, @PunchInAt, @PunchOutAt, @Mode, @Status,
                     @InLatitude, @InLongitude, @OutLatitude, @OutLongitude,
                     @SiteId, @ShiftId, @WithinGeofence, @GeofenceException,
                     @IsLate, @LateMinutes, @WorkedMinutes, @OvertimeMinutes,
                     @FaceVerified, @FacePhotoPath, @FaceScore, @FaceDetail,
                     @OutFaceVerified, @OutFacePhotoPath, @OutFaceScore, @OutFaceDetail,
                     @InAccuracyM, @OutAccuracyM, @InDevice, @OutDevice,
                     @InAuthMethod, @OutAuthMethod, @InAreaName, @OutAreaName,
                     @CompanyId, @Now, @Now);
                SELECT LAST_INSERT_ID();
                """,
                Parameters(r), cancellationToken: ct));
            r.Id = id;
            return id;
        }, ct);

    public Task UpdateAsync(AttendanceRecord r, CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteAsync(new CommandDefinition("""
            UPDATE attendance SET
                user_id = @UserId,
                work_date = @WorkDate,
                punch_in_at = @PunchInAt,
                punch_out_at = @PunchOutAt,
                mode = @Mode,
                status = @Status,
                in_latitude = @InLatitude,
                in_longitude = @InLongitude,
                out_latitude = @OutLatitude,
                out_longitude = @OutLongitude,
                site_id = @SiteId,
                shift_id = @ShiftId,
                within_geofence = @WithinGeofence,
                geofence_exception = @GeofenceException,
                is_late = @IsLate,
                late_minutes = @LateMinutes,
                worked_minutes = @WorkedMinutes,
                overtime_minutes = @OvertimeMinutes,
                face_verified = @FaceVerified,
                face_photo_path = @FacePhotoPath,
                face_score = @FaceScore,
                face_detail = @FaceDetail,
                out_face_verified = @OutFaceVerified,
                out_face_photo_path = @OutFacePhotoPath,
                out_face_score = @OutFaceScore,
                out_face_detail = @OutFaceDetail,
                in_accuracy_m = @InAccuracyM,
                out_accuracy_m = @OutAccuracyM,
                in_device = @InDevice,
                out_device = @OutDevice,
                in_auth_method = @InAuthMethod,
                out_auth_method = @OutAuthMethod,
                in_area_name = @InAreaName,
                out_area_name = @OutAreaName,
                company_id = @CompanyId,
                updated_at = @Now
            WHERE id = @Id
            """,
            Parameters(r), cancellationToken: ct)), ct);

    /// <summary>
    /// The parameter object both writes share.
    ///
    /// created_at and updated_at are set here rather than left to the database:
    /// the columns carry no DEFAULT or ON UPDATE clause, and the Java side fills
    /// them from the application clock through @PrePersist / @PreUpdate. Local
    /// time, because every other timestamp in this table is local.
    /// </summary>
    private static object Parameters(AttendanceRecord r) => new
    {
        r.Id,
        r.UserId,
        r.WorkDate,
        r.PunchInAt,
        r.PunchOutAt,
        r.Mode,
        r.Status,
        r.InLatitude,
        r.InLongitude,
        r.OutLatitude,
        r.OutLongitude,
        r.SiteId,
        r.ShiftId,
        r.WithinGeofence,
        r.GeofenceException,
        r.IsLate,
        r.LateMinutes,
        r.WorkedMinutes,
        r.OvertimeMinutes,
        r.FaceVerified,
        r.FacePhotoPath,
        r.FaceScore,
        r.FaceDetail,
        r.OutFaceVerified,
        r.OutFacePhotoPath,
        r.OutFaceScore,
        r.OutFaceDetail,
        r.InAccuracyM,
        r.OutAccuracyM,
        r.InDevice,
        r.OutDevice,
        r.InAuthMethod,
        r.OutAuthMethod,
        r.InAreaName,
        r.OutAreaName,
        r.CompanyId,
        Now = DateTime.Now
    };

    public Task<TimeOnly?> FindShiftStartTimeAsync(long shiftId, CancellationToken ct = default) =>
        QueryAsync(conn => conn.QueryFirstOrDefaultAsync<TimeOnly?>(
            new CommandDefinition(
                "SELECT start_time FROM shifts WHERE id = @shiftId",
                new { shiftId }, cancellationToken: ct)), ct);

    public async Task<IReadOnlyList<string?>> FindApprovedPermissionFromTimesAsync(
        long userId, DateOnly day, CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<string?>(
            new CommandDefinition("""
                SELECT from_time
                FROM permission_requests
                WHERE user_id = @userId AND request_date = @day AND status = 'APPROVED'
                """,
                new { userId, day }, cancellationToken: ct)), ct)).AsList();

    public async Task<IReadOnlyList<AttendanceRecord>> FindByDateAsync(
        DateOnly workDate, CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<AttendanceRecord>(
            new CommandDefinition($"SELECT {Columns} FROM attendance WHERE work_date = @workDate",
                new { workDate }, cancellationToken: ct)), ct)).AsList();

    public async Task<IReadOnlyList<AttendancePerson>> FindActivePeopleAsync(
        CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<AttendancePerson>(
            new CommandDefinition("""
                SELECT id AS Id, name AS Name, employee_code AS EmployeeCode,
                       designation_title AS DesignationTitle, designation_id AS DesignationId
                FROM users
                WHERE enabled = 1
                  AND (profile_status IS NULL OR UPPER(profile_status) <> 'OFFBOARDED')
                ORDER BY name
                """, cancellationToken: ct)), ct)).AsList();

    /// <summary>
    /// Teammates by title OR designation id, which is the Java's
    /// findTeammatesByTitleOrDesignation. Matching on one alone loses somebody
    /// whose record carries only the other.
    /// </summary>
    public async Task<IReadOnlyList<AttendancePerson>> FindTeammatesAsync(
        string? designationTitle, long? designationId, CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<AttendancePerson>(
            new CommandDefinition("""
                SELECT id AS Id, name AS Name, employee_code AS EmployeeCode,
                       designation_title AS DesignationTitle, designation_id AS DesignationId
                FROM users
                WHERE enabled = 1
                  AND (profile_status IS NULL OR UPPER(profile_status) <> 'OFFBOARDED')
                  AND ((@designationTitle IS NOT NULL
                        AND TRIM(LOWER(designation_title)) = TRIM(LOWER(@designationTitle)))
                    OR (@designationId IS NOT NULL AND designation_id = @designationId))
                ORDER BY name
                """, new { designationTitle, designationId }, cancellationToken: ct)), ct)).AsList();

    public Task<AttendancePerson?> FindPersonAsync(long userId, CancellationToken ct = default) =>
        QueryAsync(conn => conn.QueryFirstOrDefaultAsync<AttendancePerson>(
            new CommandDefinition("""
                SELECT id AS Id, name AS Name, employee_code AS EmployeeCode,
                       designation_title AS DesignationTitle, designation_id AS DesignationId
                FROM users WHERE id = @userId
                """, new { userId }, cancellationToken: ct)), ct);

    /// <summary>
    /// Who is on APPROVED leave covering this date, inclusive at both ends.
    /// The same rule as the leave module's findOnLeave.
    /// </summary>
    public async Task<IReadOnlyList<long>> FindOnLeaveUserIdsAsync(
        DateOnly date, CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<long>(
            new CommandDefinition("""
                SELECT DISTINCT user_id FROM leave_requests
                WHERE status = 'APPROVED' AND from_date <= @date AND to_date >= @date
                """, new { date }, cancellationToken: ct)), ct)).AsList();

    public async Task<IReadOnlyList<DateOnly>> FindHolidayDatesAsync(
        DateOnly from, DateOnly to, CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<DateOnly>(
            new CommandDefinition("""
                SELECT holiday_date FROM holidays
                WHERE holiday_date BETWEEN @from AND @to
                ORDER BY holiday_date
                """, new { from, to }, cancellationToken: ct)), ct)).AsList();

    public async Task<IReadOnlyList<(DateOnly Date, decimal? Hours)>>
        FindApprovedPermissionsAsync(long userId, DateOnly from, DateOnly to,
                                     CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<(DateOnly, decimal?)>(
            new CommandDefinition("""
                SELECT request_date, hours FROM permission_requests
                WHERE user_id = @userId
                  AND UPPER(status) = 'APPROVED'
                  AND request_date BETWEEN @from AND @to
                """, new { userId, from, to }, cancellationToken: ct)), ct)).AsList();

    public Task<IReadOnlyList<IReadOnlyDictionary<string, object>>> FindDayTasksAsync(
        long userId, DateOnly date, CancellationToken ct = default) =>
        QueryAsync(async conn =>
        {
            try
            {
                var rows = (await conn.QueryAsync(new CommandDefinition("""
                    SELECT id, title, status, priority, progress, due_date AS dueDate, completed_at AS completedAt
                    FROM tasks
                    WHERE assigned_to = @userId
                      AND DATE(created_at) <= @date
                      AND (status <> 'COMPLETED'
                           OR DATE(completed_at) = @date
                           OR due_date = @date)
                    ORDER BY FIELD(status,'IN_PROGRESS','TODO','COMPLETED'), due_date
                    LIMIT 25
                    """, new { userId, date }, cancellationToken: ct))).AsList();

                var list = new List<IReadOnlyDictionary<string, object>>();
                foreach (var row in rows)
                {
                    var dict = (IDictionary<string, object>)row;
                    list.Add(new Dictionary<string, object>(dict));
                }
                return (IReadOnlyList<IReadOnlyDictionary<string, object>>)list;
            }
            catch
            {
                return [];
            }
        }, ct);

    public Task<IReadOnlyList<IReadOnlyDictionary<string, object>>> FindDayWorkReportsAsync(
        long userId, DateOnly date, CancellationToken ct = default) =>
        QueryAsync(async conn =>
        {
            try
            {
                var rows = (await conn.QueryAsync(new CommandDefinition("""
                    SELECT id, work_date AS workDate, project_name AS projectName, task_description AS description, work_hours AS hours
                    FROM work_reports
                    WHERE user_id = @userId AND work_date = @date
                    ORDER BY id DESC LIMIT 10
                    """, new { userId, date }, cancellationToken: ct))).AsList();

                var list = new List<IReadOnlyDictionary<string, object>>();
                foreach (var row in rows)
                {
                    var dict = (IDictionary<string, object>)row;
                    list.Add(new Dictionary<string, object>(dict));
                }
                return (IReadOnlyList<IReadOnlyDictionary<string, object>>)list;
            }
            catch
            {
                return [];
            }
        }, ct);

    public Task<(double TodayLate, double UsualLate, long LateToday, long InToday)> FindPaceLateMetricsAsync(
        IReadOnlyCollection<long> userIds, DateOnly from, DateOnly today, CancellationToken ct = default) =>
        QueryAsync(async conn =>
        {
            if (userIds.Count == 0) return (0, 0, 0, 0);
            var row = await conn.QueryFirstOrDefaultAsync(new CommandDefinition("""
                SELECT
                  AVG(CASE WHEN work_date = @today THEN late_minutes END)  AS today_late,
                  AVG(CASE WHEN work_date < @today THEN late_minutes END)  AS usual_late,
                  SUM(CASE WHEN work_date = @today AND is_late = 1 THEN 1 ELSE 0 END) AS late_today,
                  SUM(CASE WHEN work_date = @today AND punch_in_at IS NOT NULL THEN 1 ELSE 0 END) AS in_today
                FROM attendance
                WHERE work_date BETWEEN @from AND @today AND user_id IN @userIds
                """, new { from, today, userIds }, cancellationToken: ct));

            if (row is null) return (0, 0, 0, 0);
            IDictionary<string, object> d = (IDictionary<string, object>)row;
            double todayLate = Convert.ToDouble(d["today_late"] ?? 0);
            double usualLate = Convert.ToDouble(d["usual_late"] ?? 0);
            long lateToday = Convert.ToInt64(d["late_today"] ?? 0);
            long inToday = Convert.ToInt64(d["in_today"] ?? 0);
            return (todayLate, usualLate, lateToday, inToday);
        }, ct);

    public async Task<IReadOnlyList<(long UserId, string Name, string EmployeeCode, long Days)>> FindNoPunchOutUsersAsync(
        IReadOnlyCollection<long> userIds, DateOnly from, DateOnly yesterday, CancellationToken ct = default) =>
        userIds.Count == 0 ? [] : (await QueryAsync(conn => conn.QueryAsync<(long, string, string, long)>(
            new CommandDefinition("""
                SELECT a.user_id, u.name, u.employee_code, COUNT(*) AS days
                FROM attendance a JOIN users u ON u.id = a.user_id
                WHERE a.work_date BETWEEN @from AND @yesterday
                  AND a.punch_in_at IS NOT NULL AND a.punch_out_at IS NULL
                  AND a.user_id IN @userIds
                GROUP BY a.user_id, u.name, u.employee_code
                HAVING days >= 2 ORDER BY days DESC LIMIT 10
                """, new { from, yesterday, userIds }, cancellationToken: ct)), ct)).AsList();

    public async Task<IReadOnlyList<(DateOnly WorkDate, decimal Lat, decimal Lng, long People)>> FindSharedLocationPunchesAsync(
        IReadOnlyCollection<long> userIds, DateOnly from, DateOnly today, CancellationToken ct = default) =>
        userIds.Count == 0 ? [] : (await QueryAsync(conn => conn.QueryAsync<(DateOnly, decimal, decimal, long)>(
            new CommandDefinition("""
                SELECT a.work_date, ROUND(a.in_latitude, 4) AS lat, ROUND(a.in_longitude, 4) AS lng,
                       COUNT(DISTINCT a.user_id) AS people
                FROM attendance a
                WHERE a.work_date BETWEEN @from AND @today
                  AND a.in_latitude IS NOT NULL AND a.user_id IN @userIds
                GROUP BY a.work_date, lat, lng
                HAVING people >= 3 ORDER BY people DESC LIMIT 5
                """, new { from, today, userIds }, cancellationToken: ct)), ct)).AsList();

    public async Task<IReadOnlyList<(long UserId, string Name, string EmployeeCode, long LateDays, long Days, double AvgLate)>> FindHabitualLateUsersAsync(
        IReadOnlyCollection<long> userIds, DateOnly from, DateOnly today, CancellationToken ct = default) =>
        userIds.Count == 0 ? [] : (await QueryAsync(conn => conn.QueryAsync<(long, string, string, long, long, double)>(
            new CommandDefinition("""
                SELECT a.user_id, u.name, u.employee_code,
                       SUM(a.is_late) AS late_days, COUNT(*) AS days,
                       ROUND(AVG(NULLIF(a.late_minutes,0))) AS avg_late
                FROM attendance a JOIN users u ON u.id = a.user_id
                WHERE a.work_date BETWEEN @from AND @today
                  AND a.punch_in_at IS NOT NULL AND a.user_id IN @userIds
                GROUP BY a.user_id, u.name, u.employee_code
                HAVING days >= 5 AND late_days >= days * 0.6
                ORDER BY late_days DESC LIMIT 10
                """, new { from, today, userIds }, cancellationToken: ct)), ct)).AsList();

    public Task<(long Unverified, long Total)> FindUnverifiedPunchesRatioAsync(
        IReadOnlyCollection<long> userIds, DateOnly from, DateOnly today, CancellationToken ct = default) =>
        QueryAsync(async conn =>
        {
            if (userIds.Count == 0) return (0, 0);
            var row = await conn.QueryFirstOrDefaultAsync(new CommandDefinition("""
                SELECT SUM(CASE WHEN face_verified = 0 THEN 1 ELSE 0 END) AS unverified,
                       COUNT(*) AS total
                FROM attendance
                WHERE work_date BETWEEN @from AND @today
                  AND punch_in_at IS NOT NULL AND user_id IN @userIds
                """, new { from, today, userIds }, cancellationToken: ct));

            if (row is null) return (0, 0);
            IDictionary<string, object> d = (IDictionary<string, object>)row;
            long unv = Convert.ToInt64(d["unverified"] ?? 0);
            long tot = Convert.ToInt64(d["total"] ?? 0);
            return (unv, tot);
        }, ct);

    public async Task<IReadOnlyList<(long UserId, string Name, string EmployeeCode, DateOnly LastSeen)>> FindStoppedComingUsersAsync(
        IReadOnlyCollection<long> userIds, DateOnly cutoff, CancellationToken ct = default) =>
        userIds.Count == 0 ? [] : (await QueryAsync(conn => conn.QueryAsync<(long, string, string, DateOnly)>(
            new CommandDefinition("""
                SELECT u.id AS user_id, u.name, u.employee_code, MAX(a.work_date) AS last_seen
                FROM users u LEFT JOIN attendance a
                       ON a.user_id = u.id AND a.punch_in_at IS NOT NULL
                WHERE u.id IN @userIds AND u.enabled = 1
                GROUP BY u.id, u.name, u.employee_code
                HAVING last_seen IS NOT NULL AND last_seen < @cutoff
                ORDER BY last_seen ASC LIMIT 10
                """, new { userIds, cutoff }, cancellationToken: ct)), ct)).AsList();

    public Task<bool> CanSeeOthersAsync(long userId, CancellationToken ct = default) =>
        QueryAsync(async conn =>
        {
            var count = await conn.ExecuteScalarAsync<int>(new CommandDefinition("""
                SELECT COUNT(*) FROM user_roles ur
                JOIN role_permissions rp ON rp.role_id = ur.role_id
                JOIN permissions p ON p.id = rp.permission_id
                WHERE ur.user_id = @userId
                  AND p.code IN ('ATTENDANCE_TEAM','USER_MANAGE','EMPLOYEE_MANAGE','DASHBOARD_EXEC')
                """, new { userId }, cancellationToken: ct));
            return count > 0;
        }, ct);
}
