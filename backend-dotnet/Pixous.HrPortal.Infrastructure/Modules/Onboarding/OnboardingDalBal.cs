using Dapper;
using Pixous.HrPortal.Domain.Common;
using Pixous.HrPortal.Domain.Modules.Onboarding;
using Pixous.HrPortal.Infrastructure.Persistence;

namespace Pixous.HrPortal.Infrastructure.Modules.Onboarding;

/// <summary>Dapper access to <c>onboarding_checklists</c> and <c>onboarding_tasks</c>.</summary>
public sealed class OnboardingDal : DalBase, IOnboardingDal
{
    public OnboardingDal(IDbConnectionFactory connectionFactory) : base(connectionFactory) { }

    public Task<OnboardingChecklistRow?> FindChecklistForUserAsync(
        long userId, CancellationToken ct = default) =>
        QueryAsync(conn => conn.QueryFirstOrDefaultAsync<OnboardingChecklistRow>(
            new CommandDefinition("""
                SELECT id AS Id, user_id AS UserId, status AS Status,
                       started_at AS StartedAt, completed_at AS CompletedAt
                FROM onboarding_checklists WHERE user_id = @userId
                """, new { userId }, cancellationToken: ct)), ct);

    public async Task<IReadOnlyList<long>> FindUserIdsByStatusAsync(
        string status, CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<long>(
            new CommandDefinition(
                "SELECT user_id FROM onboarding_checklists WHERE status = @status",
                new { status }, cancellationToken: ct)), ct)).AsList();

    public Task<long> InsertChecklistAsync(OnboardingChecklistRow row,
                                           CancellationToken ct = default) =>
        QueryAsync(async conn =>
        {
            row.StartedAt ??= DateTime.Now;
            row.Id = await conn.ExecuteScalarAsync<long>(new CommandDefinition("""
                INSERT INTO onboarding_checklists (user_id, status, started_at)
                VALUES (@UserId, @Status, @StartedAt);
                SELECT LAST_INSERT_ID();
                """, row, cancellationToken: ct));
            return row.Id;
        }, ct);

    public Task CompleteChecklistAsync(long checklistId, DateTime at,
                                       CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteAsync(new CommandDefinition("""
            UPDATE onboarding_checklists SET status = @status, completed_at = @at
            WHERE id = @checklistId
            """,
            new { checklistId, status = OnboardingDefaults.Completed, at },
            cancellationToken: ct)), ct);

    /// <summary>The tasks, in the order they were created — which is the order HR works through them.</summary>
    public async Task<IReadOnlyList<OnboardingTaskRow>> FindTasksAsync(
        long checklistId, CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<OnboardingTaskRow>(
            new CommandDefinition("""
                SELECT id AS Id, checklist_id AS ChecklistId, task_name AS TaskName,
                       description AS Description, is_completed AS IsCompleted,
                       completed_at AS CompletedAt
                FROM onboarding_tasks WHERE checklist_id = @checklistId
                ORDER BY id ASC
                """, new { checklistId }, cancellationToken: ct)), ct)).AsList();

    public Task<OnboardingTaskRow?> FindTaskAsync(long taskId, CancellationToken ct = default) =>
        QueryAsync(conn => conn.QueryFirstOrDefaultAsync<OnboardingTaskRow>(
            new CommandDefinition("""
                SELECT id AS Id, checklist_id AS ChecklistId, task_name AS TaskName,
                       description AS Description, is_completed AS IsCompleted,
                       completed_at AS CompletedAt
                FROM onboarding_tasks WHERE id = @taskId
                """, new { taskId }, cancellationToken: ct)), ct);

    /// <summary>
    /// All five default tasks in ONE transaction: a checklist with three of its
    /// five tasks would be worse than no checklist, because it would look
    /// finished when it was not.
    /// </summary>
    public Task InsertTasksAsync(long checklistId, IReadOnlyList<string> taskNames,
                                 CancellationToken ct = default) =>
        TransactionAsync(async (conn, tx) =>
        {
            foreach (string name in taskNames)
            {
                await conn.ExecuteAsync(new CommandDefinition("""
                    INSERT INTO onboarding_tasks (checklist_id, task_name, is_completed)
                    VALUES (@checklistId, @name, 0)
                    """, new { checklistId, name }, tx, cancellationToken: ct));
            }

            return 0;
        }, cancellationToken: ct);

    public Task CompleteTaskAsync(long taskId, DateTime at, CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteAsync(new CommandDefinition(
            "UPDATE onboarding_tasks SET is_completed = 1, completed_at = @at WHERE id = @taskId",
            new { taskId, at }, cancellationToken: ct)), ct);
}

/// <summary>Ported from OnboardingService.</summary>
public sealed class OnboardingBal : IOnboardingBal
{
    private readonly IOnboardingDal _dal;

    public OnboardingBal(IOnboardingDal dal)
    {
        _dal = dal;
    }

    public async Task<OnboardingChecklistResponse> StartAsync(long userId,
                                                              CancellationToken ct = default)
    {
        // Refused rather than reset: restarting would discard whatever progress
        // had already been made against the existing checklist.
        if (await _dal.FindChecklistForUserAsync(userId, ct) is not null)
        {
            throw ApiException.Business("Onboarding already started for this user");
        }

        var checklist = new OnboardingChecklistRow { UserId = userId };
        await _dal.InsertChecklistAsync(checklist, ct);

        await _dal.InsertTasksAsync(checklist.Id, OnboardingDefaults.Tasks, ct);

        return await GetAsync(userId, ct);
    }

    public Task<IReadOnlyList<long>> OnboardingUserIdsAsync(CancellationToken ct = default) =>
        _dal.FindUserIdsByStatusAsync(OnboardingDefaults.InProgress, ct);

    public async Task<OnboardingChecklistResponse> GetAsync(long userId,
                                                            CancellationToken ct = default)
    {
        OnboardingChecklistRow c = await _dal.FindChecklistForUserAsync(userId, ct)
            ?? throw ApiException.NotFound("Onboarding checklist");

        IReadOnlyList<OnboardingTaskRow> tasks = await _dal.FindTasksAsync(c.Id, ct);

        return new OnboardingChecklistResponse(
            c.Id, c.UserId, c.Status, c.StartedAt, c.CompletedAt,
            tasks.Select(t => new OnboardingTaskResponse(
                t.Id, t.TaskName, t.Description, t.IsCompleted, t.CompletedAt)).ToArray());
    }

    public async Task<OnboardingChecklistResponse> CompleteTaskAsync(
        long userId, long taskId, CancellationToken ct = default)
    {
        OnboardingChecklistRow c = await _dal.FindChecklistForUserAsync(userId, ct)
            ?? throw ApiException.NotFound("Onboarding checklist");

        OnboardingTaskRow t = await _dal.FindTaskAsync(taskId, ct)
            ?? throw ApiException.NotFound("Onboarding task");

        // The task id comes from the URL, so it is checked against THIS user's
        // checklist -- otherwise one employee could tick a task on another's.
        if (t.ChecklistId != c.Id)
        {
            throw ApiException.Business("Task does not belong to user's checklist");
        }

        await _dal.CompleteTaskAsync(taskId, DateTime.Now, ct);

        // The checklist completes itself when the last task is ticked, rather
        // than waiting for somebody to declare it done. Re-read so the decision
        // is made on what is stored, not on what was in memory before the write.
        IReadOnlyList<OnboardingTaskRow> all = await _dal.FindTasksAsync(c.Id, ct);

        if (all.All(x => x.IsCompleted))
        {
            await _dal.CompleteChecklistAsync(c.Id, DateTime.Now, ct);
        }

        return await GetAsync(userId, ct);
    }
}
