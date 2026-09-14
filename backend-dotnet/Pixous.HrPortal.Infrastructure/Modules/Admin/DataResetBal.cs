using System.Data;
using Dapper;
using Microsoft.Extensions.Logging;
using Pixous.HrPortal.Domain.Common;
using Pixous.HrPortal.Domain.Modules.Admin;
using Pixous.HrPortal.Domain.Modules.Audit;
using Pixous.HrPortal.Infrastructure.Persistence;

namespace Pixous.HrPortal.Infrastructure.Modules.Admin;

/// <summary>
/// Clears operational data, area by area. Ported from
/// com.pixous.hrportal.modules.admin.DataResetService.
///
/// Every table name below was checked against the live schema before it was
/// written. That is not a formality: a typo in a DELETE is not a compile error,
/// and the first symptom of one would be data that is still there when somebody
/// has been told it is gone — or worse, data gone that nobody asked to remove.
///
/// The delete ORDER within an area matters too. Children go before parents, or
/// a foreign key refuses the delete half way through and leaves the area part
/// cleared.
/// </summary>
public sealed class DataResetBal : DalBase, IDataResetBal
{
    private readonly IAuditService _audit;
    private readonly ILogger<DataResetBal> _log;

    public DataResetBal(IDbConnectionFactory connectionFactory,
                        IAuditService audit,
                        ILogger<DataResetBal> log)
        : base(connectionFactory)
    {
        _audit = audit;
        _log = log;
    }

    /// <summary>
    /// The table whose row count represents each area, and the tables the area
    /// clears in the order they must be cleared.
    ///
    /// Where the Java counts several repositories for one area (PAYROLL), the
    /// same several are summed here.
    /// </summary>
    private static readonly Dictionary<string, (string[] CountTables, string[] DeleteInOrder)> Plan =
        new()
        {
            ["ATTENDANCE"] = (["attendance"], ["attendance"]),

            // The allocation is HR's decision and stays; only what has been spent
            // against it goes back to zero, or every balance would read as used
            // up with no request left to explain it. That reset is handled
            // separately below, not by a DELETE.
            ["LEAVE"] = (["leave_requests"], ["leave_requests"]),

            ["PERMISSION"] = (["permission_requests"], ["permission_requests"]),
            ["WORK_REPORTS"] = (["work_reports"], ["work_reports"]),

            // A task's discussion points at the task.
            ["TASKS"] = (["tasks"], ["task_messages", "tasks"]),

            // Payslips point at a run, so runs go last. Bank details are not
            // touched -- see the area's "keeps" text.
            ["PAYROLL"] = (["payslips", "payslip_requests", "salary_months", "salary_structures"],
                           ["payslip_requests", "payslips", "payroll_runs",
                            "salary_months", "salary_structures"]),

            // Reactions, reads and votes all point at a message. The rooms
            // themselves and who is in them stay.
            ["CHAT"] = (["community_messages"],
                        ["community_message_reactions", "community_message_reads",
                         "community_poll_votes", "community_messages"]),

            ["HELPDESK"] = (["tickets"], ["ticket_comments", "tickets"]),
            ["COMPLAINTS"] = (["complaints_needs"], ["complaints_needs"]),
            ["DISCIPLINE"] = (["discipline_records"], ["discipline_records"]),
            ["APPRECIATION"] = (["appreciation_letters"], ["appreciation_letters"]),

            // ta_expenses, not expense_claims: the Java uses taExpenseRepository,
            // and in this database ta_expenses holds the rows while
            // expense_claims is empty.
            ["CLAIMS"] = (["ta_expenses"], ["ta_expenses"]),

            ["NOTIFICATIONS"] = (["notifications"], ["notifications"]),

            // Who is holding what. The asset inventory itself stays.
            ["ASSET_ALLOCATIONS"] = (["asset_allocations"], ["asset_allocations"]),

            ["PERFORMANCE"] = (["performance_reviews"],
                               ["performance_reviews", "performance_goals"]),
            ["SAFETY"] = (["safety_incidents"], ["safety_incidents"]),
            ["ONBOARDING"] = (["onboarding_checklists"],
                              ["onboarding_tasks", "onboarding_checklists"]),

            // company_events, not holidays: public holidays stay, because those
            // are not events.
            ["CALENDAR_EVENTS"] = (["company_events"], ["company_events"]),

            ["LOGIN_HISTORY"] = (["login_history"], ["login_history"])
        };

    public async Task<IReadOnlyList<DataResetPreview>> PreviewAsync(CancellationToken ct = default)
    {
        var previews = new List<DataResetPreview>(DataResetArea.All.Count);

        foreach (DataResetArea area in DataResetArea.All)
        {
            previews.Add(new DataResetPreview(
                area.Name, area.Clears, area.Keeps, await CountAsync(area.Name, ct)));
        }

        return previews;
    }

    public async Task<DataResetResult> ResetAsync(IReadOnlyCollection<string>? areaNames,
                                                  string? confirmation, long? actorId,
                                                  CancellationToken ct = default)
    {
        // Checked here rather than only in the browser, so nothing can be
        // emptied by a stray request. Ordinal comparison: "reset" is not RESET.
        if (!string.Equals(confirmation, "RESET", StringComparison.Ordinal))
        {
            throw ApiException.Business("Type RESET to confirm.");
        }

        if (areaNames is null || areaNames.Count == 0)
        {
            throw ApiException.Business("Choose at least one thing to clear.");
        }

        // Every name is resolved BEFORE anything is deleted, so one unknown area
        // does not leave the others half cleared.
        var areas = new List<DataResetArea>();
        foreach (string name in areaNames)
        {
            DataResetArea area = DataResetArea.Parse(name)
                ?? throw ApiException.Business($"There is nothing called {name}.");

            if (!areas.Contains(area))
            {
                areas.Add(area);
            }
        }

        var cleared = new Dictionary<string, long>();

        foreach (DataResetArea area in areas)
        {
            long before = await CountAsync(area.Name, ct);
            await ClearAsync(area.Name, ct);
            cleared[area.Name] = before;

            _log.LogWarning("Data reset: {Area} cleared ({Rows} rows) by user {ActorId}",
                area.Name, before, actorId);
        }

        long total = cleared.Values.Sum();

        await _audit.RecordAsync(actorId, AuditCategory.System, "DATA_RESET",
            $"Cleared {total} record(s) from: {string.Join(", ", cleared.Keys)}",
            "DATA_RESET", null, null, ct);

        return new DataResetResult(cleared, total);
    }

    private Task<long> CountAsync(string areaName, CancellationToken ct)
    {
        if (!Plan.TryGetValue(areaName, out var plan))
        {
            return Task.FromResult(0L);
        }

        // The table names are constants in Plan above -- no caller-supplied value
        // reaches this SQL.
        string sql = string.Join(" + ", plan.CountTables.Select(t => $"(SELECT COUNT(*) FROM {t})"));

        return QueryAsync(conn => conn.ExecuteScalarAsync<long>(
            new CommandDefinition($"SELECT {sql}", cancellationToken: ct)), ct);
    }

    /// <summary>
    /// Clears one area inside a transaction, so an area either goes completely
    /// or not at all. The Java method is @Transactional for the same reason.
    /// </summary>
    private Task ClearAsync(string areaName, CancellationToken ct)
    {
        if (!Plan.TryGetValue(areaName, out var plan))
        {
            return Task.CompletedTask;
        }

        return TransactionAsync<object?>(async (conn, tx) =>
        {
            foreach (string table in plan.DeleteInOrder)
            {
                await conn.ExecuteAsync(new CommandDefinition(
                    $"DELETE FROM {table}", transaction: tx, cancellationToken: ct));
            }

            if (areaName == "LEAVE")
            {
                // The allocation stays; only the spent count goes back to zero.
                await conn.ExecuteAsync(new CommandDefinition(
                    "UPDATE leave_balances SET used = 0",
                    transaction: tx, cancellationToken: ct));
            }

            return null;
        }, IsolationLevel.ReadCommitted, ct);
    }
}
