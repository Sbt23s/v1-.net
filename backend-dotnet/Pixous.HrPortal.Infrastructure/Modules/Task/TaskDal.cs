using Dapper;
using Pixous.HrPortal.Domain.Modules.TaskModule;
using Pixous.HrPortal.Infrastructure.Persistence;

namespace Pixous.HrPortal.Infrastructure.Modules.TaskModule;

/// <summary>Dapper access to <c>tasks</c> and <c>task_messages</c>.</summary>
public sealed class TaskDal : DalBase, ITaskDal
{
    public TaskDal(IDbConnectionFactory connectionFactory) : base(connectionFactory) { }

    private const string Columns = """
        id            AS Id,
        title         AS Title,
        description   AS Description,
        assigned_to   AS AssignedTo,
        assigned_by   AS AssignedBy,
        status        AS Status,
        due_date      AS DueDate,
        created_at    AS CreatedAt,
        completed_at  AS CompletedAt,
        reminded_before  AS RemindedBefore,
        reminded_due     AS RemindedDue,
        reminded_overdue AS RemindedOverdue,
        team_batch_id AS TeamBatchId,
        team_name     AS TeamName,
        progress      AS Progress,
        priority      AS Priority,
        company_id    AS CompanyId
        """;

    private const string MessageColumns = """
        id         AS Id,
        task_id    AS TaskId,
        sender_id  AS SenderId,
        content    AS Content,
        attachments AS Attachments,
        sent_at    AS SentAt
        """;

    public Task<TaskRow?> FindAsync(long taskId, CancellationToken ct = default) =>
        QueryAsync(conn => conn.QueryFirstOrDefaultAsync<TaskRow>(
            new CommandDefinition($"SELECT {Columns} FROM tasks WHERE id = @taskId",
                new { taskId }, cancellationToken: ct)), ct);

    public Task<long> InsertAsync(TaskRow row, CancellationToken ct = default) =>
        QueryAsync(async conn =>
        {
            row.CreatedAt ??= DateTime.Now;
            row.Id = await conn.ExecuteScalarAsync<long>(new CommandDefinition("""
                INSERT INTO tasks
                    (title, description, assigned_to, assigned_by, status, due_date,
                     created_at, team_batch_id, team_name, progress, priority, company_id)
                VALUES
                    (@Title, @Description, @AssignedTo, @AssignedBy, @Status, @DueDate,
                     @CreatedAt, @TeamBatchId, @TeamName, @Progress, @Priority, @CompanyId);
                SELECT LAST_INSERT_ID();
                """, row, cancellationToken: ct));
            return row.Id;
        }, ct);

    /// <summary>
    /// created_at and the reminder stamps are left alone: an edit changes the
    /// work, not when it was raised, and rewriting a reminder date would make
    /// the scheduler send it again.
    /// </summary>
    public Task UpdateAsync(TaskRow row, CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteAsync(new CommandDefinition("""
            UPDATE tasks SET
                title        = @Title,
                description  = @Description,
                status       = @Status,
                due_date     = @DueDate,
                completed_at = @CompletedAt,
                progress     = @Progress,
                priority     = @Priority
            WHERE id = @Id
            """, row, cancellationToken: ct)), ct);

    public Task DeleteAsync(long taskId, CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteAsync(
            new CommandDefinition("DELETE FROM tasks WHERE id = @taskId",
                new { taskId }, cancellationToken: ct)), ct);

    public async Task<IReadOnlyList<TaskRow>> FindByBatchAsync(string batchId,
                                                               CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<TaskRow>(
            new CommandDefinition($"SELECT {Columns} FROM tasks WHERE team_batch_id = @batchId",
                new { batchId }, cancellationToken: ct)), ct)).AsList();

    public Task DeleteBatchAsync(string batchId, CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteAsync(
            new CommandDefinition("DELETE FROM tasks WHERE team_batch_id = @batchId",
                new { batchId }, cancellationToken: ct)), ct);

    public async Task<IReadOnlyList<TaskRow>> FindForAssigneeAsync(
        long userId, CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<TaskRow>(
            new CommandDefinition($"""
                SELECT {Columns} FROM tasks WHERE assigned_to = @userId
                ORDER BY created_at DESC, id DESC
                """, new { userId }, cancellationToken: ct)), ct)).AsList();

    public async Task<IReadOnlyList<TaskRow>> FindAllAsync(CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<TaskRow>(
            new CommandDefinition($"SELECT {Columns} FROM tasks ORDER BY created_at DESC, id DESC",
                cancellationToken: ct)), ct)).AsList();

    public async Task<IReadOnlyList<TaskRow>> FindOpenAsync(CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<TaskRow>(
            new CommandDefinition($"SELECT {Columns} FROM tasks WHERE status <> 'COMPLETED'",
                cancellationToken: ct)), ct)).AsList();

    public async Task<IReadOnlyList<TaskMessageRow>> FindMessagesAsync(
        long taskId, CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<TaskMessageRow>(
            new CommandDefinition($"""
                SELECT {MessageColumns} FROM task_messages WHERE task_id = @taskId
                ORDER BY sent_at ASC, id ASC
                """, new { taskId }, cancellationToken: ct)), ct)).AsList();

    /// <summary>
    /// Counted in SQL rather than by fetching every message and tallying in
    /// memory, which is what the Java does — the badge needs a number, not the
    /// conversations.
    /// </summary>
    public async Task<IReadOnlyDictionary<long, long>> CountMessagesAsync(
        IReadOnlyCollection<long> taskIds, CancellationToken ct = default)
    {
        if (taskIds.Count == 0)
        {
            return new Dictionary<long, long>();
        }

        var rows = await QueryAsync(conn => conn.QueryAsync<(long TaskId, long Count)>(
            new CommandDefinition("""
                SELECT task_id, COUNT(*) FROM task_messages
                WHERE task_id IN @taskIds GROUP BY task_id
                """, new { taskIds }, cancellationToken: ct)), ct);

        var map = new Dictionary<long, long>();
        foreach ((long taskId, long count) in rows)
        {
            map[taskId] = count;
        }

        return map;
    }

    public Task<long> InsertMessageAsync(TaskMessageRow row, CancellationToken ct = default) =>
        QueryAsync(async conn =>
        {
            row.SentAt ??= DateTime.Now;
            row.Id = await conn.ExecuteScalarAsync<long>(new CommandDefinition("""
                INSERT INTO task_messages (task_id, sender_id, content, attachments, sent_at)
                VALUES (@TaskId, @SenderId, @Content, @Attachments, @SentAt);
                SELECT LAST_INSERT_ID();
                """, row, cancellationToken: ct));
            return row.Id;
        }, ct);

    public async Task<TaskPerson?> FindPersonAsync(long userId, CancellationToken ct = default)
    {
        IReadOnlyDictionary<long, TaskPerson> found = await FindPeopleAsync([userId], ct);
        return found.TryGetValue(userId, out TaskPerson? person) ? person : null;
    }

    /// <summary>
    /// People with their role codes, folded from the join so somebody holding
    /// three roles arrives once rather than three times.
    /// </summary>
    /// <summary>
    /// Records that a reminder went out today. Written as its own statement
    /// rather than through UpdateAsync, which deliberately leaves these columns
    /// alone -- an edit to a task must not make the scheduler resend.
    /// </summary>
    public Task StampReminderAsync(long taskId, ReminderKind kind, DateOnly on,
                                   CancellationToken ct = default)
    {
        string column = kind switch
        {
            ReminderKind.Overdue => "reminded_overdue",
            ReminderKind.DueToday => "reminded_due",
            ReminderKind.DueSoon => "reminded_before",
            _ => throw new ArgumentOutOfRangeException(nameof(kind))
        };

        // The column name comes from the enum above and never from a caller, so
        // there is nothing here a request could reach.
        return QueryAsync(conn => conn.ExecuteAsync(
            new CommandDefinition($"UPDATE tasks SET {column} = @on WHERE id = @taskId",
                new { taskId, on }, cancellationToken: ct)), ct);
    }

    public Task<string?> FindSettingAsync(string key, CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteScalarAsync<string?>(
            new CommandDefinition(
                "SELECT setting_value FROM system_settings WHERE setting_key = @key LIMIT 1",
                new { key }, cancellationToken: ct)), ct);

    /// <summary>
    /// Upserts by key, which is the table's PRIMARY KEY. company_id is left as
    /// the row has it -- these settings are per-installation here, and
    /// rewriting it would move the row between companies.
    /// </summary>
    public Task SaveSettingAsync(string key, string value, CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteAsync(new CommandDefinition(
            "INSERT INTO system_settings (setting_key, setting_value, updated_at) "
            + "VALUES (@key, @value, @now) "
            + "ON DUPLICATE KEY UPDATE setting_value = @value, updated_at = @now",
            new { key, value, now = DateTime.Now }, cancellationToken: ct)), ct);

    public async Task<IReadOnlyDictionary<long, TaskPerson>> FindPeopleAsync(
        IReadOnlyCollection<long> userIds, CancellationToken ct = default)
    {
        if (userIds.Count == 0)
        {
            return new Dictionary<long, TaskPerson>();
        }

        var rows = await QueryAsync(conn => conn.QueryAsync<(long Id, string? Name,
                                                            string? EmployeeCode, string? Industry,
                                                            string? DesignationTitle, string? Phone,
                                                            string? RoleCode)>(
            new CommandDefinition("""
                SELECT u.id, u.name, u.employee_code, u.industry, u.designation_title, u.phone,
                       r.code
                FROM users u
                LEFT JOIN user_roles ur ON ur.user_id = u.id
                LEFT JOIN roles r ON r.id = ur.role_id
                WHERE u.id IN @userIds
                """, new { userIds }, cancellationToken: ct)), ct);

        var byId = new Dictionary<long, (TaskPerson Person, List<string> Roles)>();

        foreach (var row in rows)
        {
            if (!byId.TryGetValue(row.Id, out var entry))
            {
                entry = (new TaskPerson(row.Id, row.Name, row.EmployeeCode, row.Industry,
                                        row.DesignationTitle, row.Phone), []);
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

        return byId.ToDictionary(e => e.Key, e => e.Value.Person with { RoleCodes = e.Value.Roles });
    }
}
