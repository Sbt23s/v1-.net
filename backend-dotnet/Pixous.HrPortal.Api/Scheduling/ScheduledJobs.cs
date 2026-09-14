using Pixous.HrPortal.Domain.Common;
using Pixous.HrPortal.Domain.Modules.Dashboard;
using Pixous.HrPortal.Domain.Modules.Notification;
using Pixous.HrPortal.Domain.Modules.TaskModule;

namespace Pixous.HrPortal.Api.Scheduling;

/// <summary>
/// The background clock, replacing Spring's <c>@Scheduled</c>.
///
/// <para>Spring schedules each job with its own cron expression on a shared
/// scheduler thread. ASP.NET has no direct equivalent, so this is one hosted
/// service that wakes on a fixed tick and asks each job whether its time has
/// come — which is also how two of the Java jobs already work, and for the
/// reason their comments give: <i>the time is a setting somebody can change
/// while the application is running and a cron expression is fixed when it
/// starts</i>.</para>
///
/// <para><b>Each job runs in its own scope.</b> A hosted service is a singleton
/// and the BALs are scoped, so resolving them directly would either fail or
/// quietly hold one database connection for the life of the process.</para>
///
/// <para><b>One failing job must not stop the others</b>, and must not stop the
/// clock. Every run is wrapped, exactly as each Java job wraps its own body.</para>
/// </summary>
public sealed class ScheduledJobs : BackgroundService
{
    /// <summary>
    /// How often the clock wakes. Matches the Java's five-minute tick for the
    /// reminder jobs; the daily jobs check the hour themselves.
    /// </summary>
    private static readonly TimeSpan Tick = TimeSpan.FromMinutes(5);

    private readonly IServiceScopeFactory _scopes;
    private readonly ILogger<ScheduledJobs> _log;

    /// <summary>
    /// The last date each daily job ran, so a job fixed to an hour runs ONCE
    /// that day however many ticks fall inside the hour.
    /// </summary>
    private readonly Dictionary<string, DateOnly> _lastRun = [];

    public ScheduledJobs(IServiceScopeFactory scopes, ILogger<ScheduledJobs> log)
    {
        _scopes = scopes;
        _log = log;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _log.LogInformation("Scheduled jobs started; ticking every {Minutes} minutes",
                            Tick.TotalMinutes);

        // A short delay before the first tick so startup is not competing with a
        // job for the connection pool.
        try
        {
            await Task.Delay(TimeSpan.FromSeconds(30), stoppingToken);
        }
        catch (OperationCanceledException)
        {
            return;
        }

        using PeriodicTimer timer = new(Tick);

        do
        {
            await RunDueJobsAsync(stoppingToken);
        }
        while (await SafeWaitAsync(timer, stoppingToken));

        _log.LogInformation("Scheduled jobs stopped");
    }

    /// <summary>Waits for the next tick, treating shutdown as a clean stop.</summary>
    private static async Task<bool> SafeWaitAsync(PeriodicTimer timer, CancellationToken ct)
    {
        try
        {
            return await timer.WaitForNextTickAsync(ct);
        }
        catch (OperationCanceledException)
        {
            return false;
        }
    }

    private async Task RunDueJobsAsync(CancellationToken ct)
    {
        DateTime now = DateTime.Now;

        // ---- every five minutes, gated on a stored time ----
        //
        // The job itself decides whether its configured hour has arrived and
        // whether each task was already reminded today, so calling it on every
        // tick is safe by design -- the Java relies on exactly that.
        await RunAsync("task-reminders", ct, async scope =>
        {
            var tasks = scope.ServiceProvider.GetRequiredService<ITaskBal>();

            ReminderSettings settings = await tasks.ReminderSettingsAsync(ct);

            if (!settings.Enabled)
            {
                return;
            }

            // Before the configured time, there is nothing to do yet.
            if (!TimeOnly.TryParseExact(settings.Time, "HH:mm", out TimeOnly at)
                || TimeOnly.FromDateTime(now) < at)
            {
                return;
            }

            int sent = await tasks.RunRemindersAsync(ct);

            if (sent > 0)
            {
                _log.LogInformation("Task reminders sent: {Count}", sent);
            }
        });

        // ---- once a day, at 09:00: today's birthdays and anniversaries ----
        if (IsDueDaily("celebrations", 9, now))
        {
            await RunAsync("celebrations", ct, scope => NotifyCelebrationsAsync(scope, ct));
        }
    }

    /// <summary>
    /// Tells each celebrant's OWN COLLEAGUES about their day.
    ///
    /// <para>The company scoping is the whole point and is easy to get wrong.
    /// This job runs on a timer, so there is no signed-in user and the tenant
    /// filter is inactive — every query sees every company at once. That is what
    /// lets one pass cover them all, and it is also how one company's birthdays
    /// ended up announced inside another's portal.</para>
    ///
    /// <para>The celebration itself carries no company, so it is taken from the
    /// celebrant's own row, which is the authority on it. A celebrant with no
    /// company is SKIPPED rather than announced to everybody — there is no
    /// audience that can be established as theirs.</para>
    /// </summary>
    private async Task NotifyCelebrationsAsync(IServiceScope scope, CancellationToken ct)
    {
        var dashboard = scope.ServiceProvider.GetRequiredService<IDashboardBal>();
        var notifications = scope.ServiceProvider.GetRequiredService<INotificationBal>();
        var sms = scope.ServiceProvider.GetRequiredService<ISmsService>();
        var dal = scope.ServiceProvider.GetRequiredService<IDashboardDal>();

        // The card looks 60 days ahead; only today's belong in this notice.
        IReadOnlyList<Celebration> todays =
            (await dashboard.CelebrationsAsync(null, ct)).Where(c => c.DaysUntil == 0).ToArray();

        if (todays.Count == 0)
        {
            return;
        }

        DashboardUser[] active = (await dal.FindEnabledUsersAsync(ct))
            .Where(u => !OrgInsightRules.IsGone(u.ProfileStatus))
            .ToArray();

        foreach (Celebration c in todays)
        {
            DashboardUser? celebrant = active.FirstOrDefault(u => u.Id == c.UserId);

            // No company on the celebrant means no audience that is theirs.
            if (celebrant?.CompanyId is null)
            {
                continue;
            }

            DashboardUser[] audience = active
                .Where(u => u.CompanyId == celebrant.CompanyId && u.Id != c.UserId)
                .ToArray();

            if (audience.Length == 0)
            {
                continue;
            }

            // The DATE, not the word "today".
            //
            // A notification is written once and read for weeks. These used to
            // say "is today", so a fortnight later the bell still announced a
            // birthday that had passed -- in the present tense. Naming the day
            // is true on the day and true a month later.
            string when = c.Date.ToString("d MMM");
            string team = c.Team is not null ? $" ({c.Team})" : "";

            bool birthday = c.Type == "BIRTHDAY";

            string title = birthday ? $"\U0001F382 Birthday on {when}"
                                    : $"\U0001F389 Work anniversary on {when}";

            string body = birthday
                ? $"{c.Name}'s birthday is on {when}{team} \u2014 wish them well!"
                : $"{c.Name} completes {c.Years} year{(c.Years == 1 ? "" : "s")} "
                  + $"with the company on {when}{team}!";

            foreach (DashboardUser u in audience)
            {
                await notifications.CreateAndPushAsync(u.Id, title, body, "CELEBRATION", "/", ct);
            }

            await sms.SendBulkAsync(audience.Select(u => u.Phone), "Pixous HR: " + body, ct);
        }
    }

    /// <summary>
    /// Runs one job in its own scope, swallowing whatever it throws.
    ///
    /// A job that fails must not take the clock down with it — the next tick
    /// should still happen, and the other jobs should still run.
    /// </summary>
    private async Task RunAsync(string name, CancellationToken ct,
                                Func<IServiceScope, Task> body)
    {
        try
        {
            using IServiceScope scope = _scopes.CreateScope();
            await body(scope);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            // Shutdown, not a failure.
        }
        catch (Exception e)
        {
            _log.LogError(e, "Scheduled job {Job} failed", name);
        }
    }

    /// <summary>
    /// Whether a once-a-day job should run now: the hour has arrived and it has
    /// not already run today.
    ///
    /// The record is in memory, so a restart after the hour runs the job a
    /// second time that day. The Java has the same exposure -- a restart
    /// re-arms its cron too -- and the jobs that matter guard themselves
    /// (task reminders stamp each task). Recorded rather than hidden.
    /// </summary>
    private bool IsDueDaily(string job, int hour, DateTime now)
    {
        if (now.Hour < hour)
        {
            return false;
        }

        DateOnly today = DateOnly.FromDateTime(now);

        if (_lastRun.TryGetValue(job, out DateOnly last) && last == today)
        {
            return false;
        }

        _lastRun[job] = today;
        return true;
    }
}
