using System.Collections.Concurrent;
using Pixous.HrPortal.Domain.Modules.Admin;
using Pixous.HrPortal.Domain.Security;

namespace Pixous.HrPortal.Api.Middleware;

/// <summary>
/// Records module usage for tenant employees, throttled to at most once per person
/// per module per 10 minutes.
/// Ported from com.pixous.hrportal.modules.admin.UsageTracker.
/// </summary>
public sealed class UsageTrackerMiddleware
{
    private const long ThrottleMs = 10 * 60 * 1000L;
    private const int MaxTracked = 20_000;

    private static readonly ConcurrentDictionary<string, long> LastWrite = new();

    private readonly RequestDelegate _next;

    public UsageTrackerMiddleware(RequestDelegate next)
    {
        _next = next;
    }

    public async Task InvokeAsync(
        HttpContext context,
        ICurrentUser currentUser,
        ITechnicalAdminAuditBal auditBal)
    {
        try
        {
            RecordUsageIfEligible(context, currentUser, auditBal);
        }
        catch
        {
            // Bookkeeping must never fail or slow down the request.
        }

        await _next(context);
    }

    private static void RecordUsageIfEligible(
        HttpContext context,
        ICurrentUser currentUser,
        ITechnicalAdminAuditBal auditBal)
    {
        if (!HttpMethods.IsGet(context.Request.Method))
        {
            return;
        }

        string? module = ModuleFor(context.Request.Path.Value);
        if (module is null)
        {
            return;
        }

        // Only authenticated tenant employees have a companyId.
        // Technical admins have no companyId and their actions are recorded separately.
        long? companyId = currentUser.CompanyId;
        long? userId = currentUser.UserId;
        if (companyId is null || userId is null or <= 0)
        {
            return;
        }

        string username = currentUser.Username ?? string.Empty;
        string key = $"{userId.Value}|{module}";
        long now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

        if (LastWrite.TryGetValue(key, out long previous) && now - previous < ThrottleMs)
        {
            return;
        }

        if (LastWrite.Count > MaxTracked)
        {
            LastWrite.Clear();
        }

        LastWrite[key] = now;

        string? clientIp = GetClientIp(context);
        long targetUserId = userId.Value;
        long targetCompanyId = companyId.Value;

        // Fire-and-forget record usage in background task
        _ = Task.Run(async () =>
        {
            try
            {
                await auditBal.RecordUsageAsync(targetCompanyId, targetUserId, username, module, clientIp);
            }
            catch
            {
                // Ignored
            }
        });
    }

    private static string? ModuleFor(string? path)
    {
        if (string.IsNullOrEmpty(path))
        {
            return null;
        }

        if (path.StartsWith("/api/attendance", StringComparison.OrdinalIgnoreCase)) return "ATTENDANCE";
        if (path.StartsWith("/api/leave", StringComparison.OrdinalIgnoreCase)
            || path.StartsWith("/api/permissions", StringComparison.OrdinalIgnoreCase)) return "LEAVE";
        if (path.StartsWith("/api/payroll", StringComparison.OrdinalIgnoreCase)
            || path.StartsWith("/api/payslips", StringComparison.OrdinalIgnoreCase)) return "PAYROLL";
        if (path.StartsWith("/api/tasks", StringComparison.OrdinalIgnoreCase)) return "TASKS";
        if (path.StartsWith("/api/work-reports", StringComparison.OrdinalIgnoreCase)
            || path.StartsWith("/api/reports", StringComparison.OrdinalIgnoreCase)) return "REPORTS";
        if (path.StartsWith("/api/ta-expenses", StringComparison.OrdinalIgnoreCase)
            || path.StartsWith("/api/expenses", StringComparison.OrdinalIgnoreCase)) return "EXPENSES";
        if (path.StartsWith("/api/assets", StringComparison.OrdinalIgnoreCase)) return "ASSETS";
        if (path.StartsWith("/api/helpdesk", StringComparison.OrdinalIgnoreCase)
            || path.StartsWith("/api/complaints", StringComparison.OrdinalIgnoreCase)) return "HELPDESK";
        if (path.StartsWith("/api/chat", StringComparison.OrdinalIgnoreCase)
            || path.StartsWith("/api/calls", StringComparison.OrdinalIgnoreCase)) return "CHAT";
        if (path.StartsWith("/api/calendar", StringComparison.OrdinalIgnoreCase)
            || path.StartsWith("/api/holidays", StringComparison.OrdinalIgnoreCase)) return "CALENDAR";
        if (path.StartsWith("/api/teams", StringComparison.OrdinalIgnoreCase)) return "TEAMS";
        if (path.StartsWith("/api/documents", StringComparison.OrdinalIgnoreCase)) return "DOCUMENTS";
        if (path.StartsWith("/api/projects", StringComparison.OrdinalIgnoreCase)) return "PROJECTS";
        if (path.StartsWith("/api/communities", StringComparison.OrdinalIgnoreCase)) return "COMMUNITIES";
        if (path.StartsWith("/api/dashboard", StringComparison.OrdinalIgnoreCase)) return "DASHBOARD";

        return null;
    }

    private static string? GetClientIp(HttpContext context)
    {
        string? forwarded = context.Request.Headers["X-Forwarded-For"].FirstOrDefault();
        if (!string.IsNullOrWhiteSpace(forwarded))
        {
            return forwarded.Split(',')[0].Trim();
        }
        return context.Connection.RemoteIpAddress?.ToString();
    }
}
