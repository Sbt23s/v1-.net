namespace Pixous.HrPortal.Domain.Modules.Attendance;

/// <summary>
/// Data access for attendance. Reads and writes the one row per person per day
/// that the punch flows share, plus the few lookups the late/overtime rules and
/// the early-punch-out rule depend on.
/// </summary>
public interface IAttendanceDal
{
    /// <summary>
    /// The row for this person on this day, or null. The unique key is
    /// (user_id, work_date), so this is at most one row.
    /// </summary>
    Task<AttendanceRecord?> FindByUserAndDateAsync(long userId, DateOnly workDate,
                                                   CancellationToken ct = default);

    /// <summary>Rows for this person across an inclusive date range, oldest first.</summary>
    Task<IReadOnlyList<AttendanceRecord>> FindByUserAndRangeAsync(
        long userId, DateOnly from, DateOnly to, CancellationToken ct = default);

    /// <summary>Rows for several people on one day.</summary>
    Task<IReadOnlyList<AttendanceRecord>> FindByUsersAndDateAsync(
        IReadOnlyCollection<long> userIds, DateOnly workDate, CancellationToken ct = default);

    /// <summary>Rows for several people across an inclusive date range.</summary>
    Task<IReadOnlyList<AttendanceRecord>> FindByUsersAndRangeAsync(
        IReadOnlyCollection<long> userIds, DateOnly from, DateOnly to,
        CancellationToken ct = default);

    /// <summary>Inserts a new row and returns its generated id.</summary>
    Task<long> InsertAsync(AttendanceRecord record, CancellationToken ct = default);

    /// <summary>Updates every mutable column of an existing row.</summary>
    Task UpdateAsync(AttendanceRecord record, CancellationToken ct = default);

    /// <summary>
    /// The shift's start time, or null when the shift is unknown or carries
    /// none. The late rule falls back to the configured office start.
    /// </summary>
    Task<TimeOnly?> FindShiftStartTimeAsync(long shiftId, CancellationToken ct = default);

    /// <summary>
    /// The <c>from_time</c> of every APPROVED permission this person holds for
    /// this day, as stored -- the strings are parsed by the rule itself, which
    /// ignores any it cannot read rather than treating them as midnight.
    ///
    /// Only APPROVED counts. A pending request is a question nobody has
    /// answered yet, and treating it as a yes would make approval pointless.
    /// </summary>
    Task<IReadOnlyList<string?>> FindApprovedPermissionFromTimesAsync(
        long userId, DateOnly day, CancellationToken ct = default);

    /// <summary>Every attendance row for one date, whoever it belongs to.</summary>
    Task<IReadOnlyList<AttendanceRecord>> FindByDateAsync(DateOnly workDate,
                                                          CancellationToken ct = default);

    /// <summary>Enabled, non-offboarded people, for the absent-today list.</summary>
    Task<IReadOnlyList<AttendancePerson>> FindActivePeopleAsync(CancellationToken ct = default);

    /// <summary>
    /// The caller's teammates, by designation title or designation id.
    ///
    /// Both, because the two are not always in step: a title is what people
    /// carry day to day and the id is the master-list entry, and matching on
    /// one alone loses somebody whose record only has the other.
    /// </summary>
    Task<IReadOnlyList<AttendancePerson>> FindTeammatesAsync(string? designationTitle,
                                                             long? designationId,
                                                             CancellationToken ct = default);

    Task<AttendancePerson?> FindPersonAsync(long userId, CancellationToken ct = default);

    /// <summary>User ids on approved leave covering a date.</summary>
    Task<IReadOnlyList<long>> FindOnLeaveUserIdsAsync(DateOnly date,
                                                      CancellationToken ct = default);

    /// <summary>Holiday dates in a range, so they are not counted as working days.</summary>
    Task<IReadOnlyList<DateOnly>> FindHolidayDatesAsync(DateOnly from, DateOnly to,
                                                        CancellationToken ct = default);

    /// <summary>Approved permissions in a range: the date and the hours.</summary>
    Task<IReadOnlyList<(DateOnly Date, decimal? Hours)>> FindApprovedPermissionsAsync(
        long userId, DateOnly from, DateOnly to, CancellationToken ct = default);

    Task<IReadOnlyList<IReadOnlyDictionary<string, object>>> FindDayTasksAsync(
        long userId, DateOnly date, CancellationToken ct = default);

    Task<IReadOnlyList<IReadOnlyDictionary<string, object>>> FindDayWorkReportsAsync(
        long userId, DateOnly date, CancellationToken ct = default);

    Task<(double TodayLate, double UsualLate, long LateToday, long InToday)> FindPaceLateMetricsAsync(
        IReadOnlyCollection<long> userIds, DateOnly from, DateOnly today, CancellationToken ct = default);

    Task<IReadOnlyList<(long UserId, string Name, string EmployeeCode, long Days)>> FindNoPunchOutUsersAsync(
        IReadOnlyCollection<long> userIds, DateOnly from, DateOnly yesterday, CancellationToken ct = default);

    Task<IReadOnlyList<(DateOnly WorkDate, decimal Lat, decimal Lng, long People)>> FindSharedLocationPunchesAsync(
        IReadOnlyCollection<long> userIds, DateOnly from, DateOnly today, CancellationToken ct = default);

    Task<IReadOnlyList<(long UserId, string Name, string EmployeeCode, long LateDays, long Days, double AvgLate)>> FindHabitualLateUsersAsync(
        IReadOnlyCollection<long> userIds, DateOnly from, DateOnly today, CancellationToken ct = default);

    Task<(long Unverified, long Total)> FindUnverifiedPunchesRatioAsync(
        IReadOnlyCollection<long> userIds, DateOnly from, DateOnly today, CancellationToken ct = default);

    Task<IReadOnlyList<(long UserId, string Name, string EmployeeCode, DateOnly LastSeen)>> FindStoppedComingUsersAsync(
        IReadOnlyCollection<long> userIds, DateOnly cutoff, CancellationToken ct = default);

    /// <summary>
    /// True for HR, admin, and anyone holding ATTENDANCE_TEAM, USER_MANAGE,
    /// EMPLOYEE_MANAGE or DASHBOARD_EXEC permissions.
    /// </summary>
    Task<bool> CanSeeOthersAsync(long userId, CancellationToken ct = default);
}

/// <summary>A person as the attendance reads need them.</summary>
public sealed record AttendancePerson(
    long Id,
    string? Name,
    string? EmployeeCode,
    string? DesignationTitle,
    long? DesignationId);
