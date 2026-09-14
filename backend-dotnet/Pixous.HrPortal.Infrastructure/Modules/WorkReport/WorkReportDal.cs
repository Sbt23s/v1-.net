using Dapper;
using Pixous.HrPortal.Domain.Modules.WorkReport;
using Pixous.HrPortal.Infrastructure.Persistence;

namespace Pixous.HrPortal.Infrastructure.Modules.WorkReport;

/// <summary>Dapper access to <c>work_reports</c>.</summary>
public sealed class WorkReportDal : DalBase, IWorkReportDal
{
    public WorkReportDal(IDbConnectionFactory connectionFactory) : base(connectionFactory) { }

    /// <summary>
    /// The author's name and code are joined in rather than looked up per row:
    /// every list view shows them, and a per-row lookup on a report list is the
    /// same mistake the employee directory already had to undo.
    /// </summary>
    private const string Columns = """
        w.id               AS Id,
        w.user_id          AS UserId,
        w.work_date        AS WorkDate,
        w.project_name     AS ProjectName,
        w.work_hours       AS WorkHours,
        w.task_description AS TaskDescription,
        w.attachments      AS Attachments,
        w.created_at       AS CreatedAt,
        w.updated_at       AS UpdatedAt,
        w.company_id       AS CompanyId,
        u.name             AS UserName,
        u.employee_code    AS EmployeeCode,
        u.designation_title AS DesignationTitle
        """;

    public Task<long> InsertAsync(WorkReportRecord r, CancellationToken ct = default) =>
        QueryAsync(async conn =>
        {
            r.CreatedAt ??= DateTime.Now;
            r.Id = await conn.ExecuteScalarAsync<long>(new CommandDefinition("""
                INSERT INTO work_reports
                    (user_id, work_date, project_name, work_hours, task_description,
                     attachments, company_id, created_at, updated_at)
                VALUES
                    (@UserId, @WorkDate, @ProjectName, @WorkHours, @TaskDescription,
                     @Attachments, @CompanyId, @CreatedAt, @CreatedAt);
                SELECT LAST_INSERT_ID();
                """, r, cancellationToken: ct));
            return r.Id;
        }, ct);

    public Task UpdateAsync(WorkReportRecord r, CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteAsync(new CommandDefinition("""
            UPDATE work_reports SET
                work_date = @WorkDate,
                project_name = @ProjectName,
                work_hours = @WorkHours,
                task_description = @TaskDescription,
                attachments = @Attachments,
                updated_at = @UpdatedAt
            WHERE id = @Id
            """, r, cancellationToken: ct)), ct);

    public Task DeleteAsync(long id, CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteAsync(
            new CommandDefinition("DELETE FROM work_reports WHERE id = @id",
                new { id }, cancellationToken: ct)), ct);

    public Task<WorkReportRecord?> FindAsync(long id, CancellationToken ct = default) =>
        QueryAsync(conn => conn.QueryFirstOrDefaultAsync<WorkReportRecord>(
            new CommandDefinition($"""
                SELECT {Columns} FROM work_reports w
                LEFT JOIN users u ON u.id = w.user_id
                WHERE w.id = @id
                """, new { id }, cancellationToken: ct)), ct);

    public async Task<IReadOnlyList<WorkReportRecord>> FindForUserAsync(
        long userId, DateOnly? from, DateOnly? to, CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<WorkReportRecord>(
            new CommandDefinition($"""
                SELECT {Columns} FROM work_reports w
                LEFT JOIN users u ON u.id = w.user_id
                WHERE w.user_id = @userId
                  AND (@from IS NULL OR w.work_date >= @from)
                  AND (@to IS NULL OR w.work_date <= @to)
                ORDER BY w.work_date DESC, w.id DESC
                """, new { userId, from, to }, cancellationToken: ct)), ct)).AsList();

    public async Task<IReadOnlyList<WorkReportRecord>> FindAllAsync(
        DateOnly? from, DateOnly? to, CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<WorkReportRecord>(
            new CommandDefinition($"""
                SELECT {Columns} FROM work_reports w
                LEFT JOIN users u ON u.id = w.user_id
                WHERE (@from IS NULL OR w.work_date >= @from)
                  AND (@to IS NULL OR w.work_date <= @to)
                ORDER BY w.work_date DESC, w.id DESC
                """, new { from, to }, cancellationToken: ct)), ct)).AsList();

    public async Task<IReadOnlyList<WorkReportRecord>> FindAllDetailedAsync(CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<WorkReportRecord>(
            new CommandDefinition($"""
                SELECT {Columns} FROM work_reports w
                LEFT JOIN users u ON u.id = w.user_id
                ORDER BY w.work_date DESC, w.id DESC
                """, cancellationToken: ct)), ct)).AsList();

    public async Task<IReadOnlyList<long>> FindTeammateUserIdsAsync(long userId, CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<long>(
            new CommandDefinition("""
                SELECT id FROM users
                WHERE (designation_title = (SELECT designation_title FROM users WHERE id = @userId)
                       AND designation_title IS NOT NULL AND designation_title != '')
                   OR (designation_id = (SELECT designation_id FROM users WHERE id = @userId)
                       AND designation_id IS NOT NULL)
                   OR id = @userId
                """, new { userId }, cancellationToken: ct)), ct)).AsList();

    public async Task<IReadOnlyList<UnfiledUserRecord>> FindUnfiledUsersAsync(DateOnly date, CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<UnfiledUserRecord>(
            new CommandDefinition("""
                SELECT
                    u.id AS Id,
                    u.name AS Name,
                    u.employee_code AS EmployeeCode,
                    u.phone AS Phone,
                    u.designation_title AS Team
                FROM users u
                WHERE u.enabled = 1
                  AND (u.profile_status IS NULL OR u.profile_status != 'OFFBOARDED')
                  AND (u.date_of_joining IS NULL OR u.date_of_joining <= @date)
                  AND u.id NOT IN (
                      SELECT w.user_id FROM work_reports w WHERE w.work_date = @date
                  )
                  AND u.id NOT IN (
                      SELECT lr.user_id FROM leave_requests lr
                      WHERE lr.status = 'APPROVED'
                        AND lr.from_date <= @date AND lr.to_date >= @date
                  )
                ORDER BY u.name ASC
                """, new { date }, cancellationToken: ct)), ct)).AsList();

    public Task<string?> GetSystemSettingAsync(string key, CancellationToken ct = default) =>
        QueryAsync(conn => conn.QueryFirstOrDefaultAsync<string>(
            new CommandDefinition("SELECT setting_value FROM system_settings WHERE setting_key = @key LIMIT 1",
                new { key }, cancellationToken: ct)), ct);

    public Task UpsertSystemSettingAsync(string key, string value, CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteAsync(
            new CommandDefinition("""
                INSERT INTO system_settings (setting_key, setting_value)
                VALUES (@key, @value)
                ON DUPLICATE KEY UPDATE setting_value = @value
                """, new { key, value }, cancellationToken: ct)), ct);

    public async Task<bool> IsHolidayAsync(DateOnly date, CancellationToken ct = default)
    {
        int count = await QueryAsync(conn => conn.ExecuteScalarAsync<int>(
            new CommandDefinition("SELECT COUNT(*) FROM holidays WHERE holiday_date = @date",
                new { date }, cancellationToken: ct)), ct);
        return count > 0;
    }
}
