using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Pixous.HrPortal.Domain.Common;
using Pixous.HrPortal.Domain.Modules.Audit;

namespace Pixous.HrPortal.Api.Controllers;

/// <summary>
/// Reading the audit trail, ported from
/// com.pixous.hrportal.modules.audit.AuditController.
///
/// The permission is on the CLASS in the Java, not on each method, so every
/// endpoint here needs USER_MANAGE or EMPLOYEE_MANAGE.
/// </summary>
[ApiController]
[Route("api/audit")]
[Authorize(Policy = "USER_MANAGE,EMPLOYEE_MANAGE")]
public sealed class AuditController : ControllerBase
{
    private readonly IAuditBal _audit;

    public AuditController(IAuditBal audit)
    {
        _audit = audit;
    }

    /// <summary>
    /// The default window is the last 30 days when no dates are given -- the
    /// trail is large and an unbounded read of it is not what the screen wants.
    /// </summary>
    private static (DateTime From, DateTime To) Window(DateTime? from, DateTime? to)
    {
        DateTime end = to ?? DateTime.Now;
        DateTime start = from ?? end.AddDays(-30);
        return (start, end);
    }

    [HttpGet]
    public async Task<ApiResponse<AuditPage>> List(
        [FromQuery] DateTime? from, [FromQuery] DateTime? to,
        [FromQuery] long? userId, [FromQuery] string? category, [FromQuery] string? q,
        [FromQuery] bool onlyFailures = false,
        [FromQuery] int page = 0, [FromQuery] int size = 50,
        CancellationToken ct = default)
    {
        (DateTime start, DateTime end) = Window(from, to);

        return ApiResponse<AuditPage>.Ok(await _audit.SearchAsync(new AuditQuery
        {
            From = start,
            To = end,
            UserId = userId,
            Category = category,
            Q = q,
            OnlyFailures = onlyFailures,
            Page = page,
            Size = size
        }, ct));
    }

    [HttpGet("summary")]
    public async Task<ApiResponse<AuditSummary>> Summary(
        [FromQuery] DateTime? from, [FromQuery] DateTime? to, CancellationToken ct)
    {
        (DateTime start, DateTime end) = Window(from, to);
        return ApiResponse<AuditSummary>.Ok(await _audit.SummaryAsync(start, end, ct));
    }

    [HttpGet("logins")]
    public async Task<ApiResponse<AuditPage>> Logins(
        [FromQuery] DateTime? from, [FromQuery] DateTime? to,
        [FromQuery] int page = 0, [FromQuery] int size = 50, CancellationToken ct = default)
    {
        (DateTime start, DateTime end) = Window(from, to);
        return ApiResponse<AuditPage>.Ok(await _audit.LoginsAsync(start, end, page, size, ct));
    }

    [HttpGet("entity")]
    public async Task<ApiResponse<IReadOnlyList<AuditRow>>> ForEntity(
        [FromQuery] string entityType, [FromQuery] string entityId, CancellationToken ct) =>
        ApiResponse<IReadOnlyList<AuditRow>>.Ok(
            await _audit.ForEntityAsync(entityType, entityId, ct));
}
