using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Pixous.HrPortal.Domain.Common;
using Pixous.HrPortal.Domain.Modules.Safety;
using Pixous.HrPortal.Domain.Security;

namespace Pixous.HrPortal.Api.Controllers;

/// <summary>
/// Safety incidents. Ported from SafetyIncidentController.
///
/// Any signed-in employee can report one and see their own; staff holding
/// REPORT_VIEW see all of them and resolve them.
///
/// <para>Note that <c>GET /{id}</c> carries NO permission, exactly as the Java
/// does — any signed-in user may fetch a single incident by id. Transcribed
/// rather than tightened: the reporting screen links people to their own
/// incident by id, and adding a check here would break that for the very people
/// the module is for. The anonymity rule still applies to what comes back.</para>
/// </summary>
[ApiController]
[Route("api/safety-incidents")]
[Authorize]
public sealed class SafetyController : ControllerBase
{
    private readonly ISafetyBal _bal;
    private readonly ICurrentUser _currentUser;

    public SafetyController(ISafetyBal bal, ICurrentUser currentUser)
    {
        _bal = bal;
        _currentUser = currentUser;
    }

    /// <summary>Reports a safety incident.</summary>
    [HttpPost]
    public async Task<ApiResponse<SafetyIncidentResponse>> Report(
        [FromBody] SafetyIncidentRequest request, CancellationToken ct) =>
        ApiResponse<SafetyIncidentResponse>.Ok(
            await _bal.ReportAsync(_currentUser.RequireUserId(), request, ct),
            "Incident reported successfully");

    /// <summary>The caller's own reports.</summary>
    [HttpGet("mine")]
    public async Task<ApiResponse<PageResponse<SafetyIncidentResponse>>> Mine(
        [FromQuery] int page = 0, [FromQuery] int size = 20, CancellationToken ct = default) =>
        ApiResponse<PageResponse<SafetyIncidentResponse>>.Ok(
            await _bal.MyReportsAsync(_currentUser.RequireUserId(), page, size, ct));

    /// <summary>Staff: every incident, filterable.</summary>
    [HttpGet]
    [Authorize(Policy = "REPORT_VIEW")]
    public async Task<ApiResponse<PageResponse<SafetyIncidentResponse>>> All(
        [FromQuery] string? status, [FromQuery] string? incidentType,
        [FromQuery] int page = 0, [FromQuery] int size = 20, CancellationToken ct = default) =>
        ApiResponse<PageResponse<SafetyIncidentResponse>>.Ok(
            await _bal.AllAsync(status, incidentType, page, size, ct));

    /// <summary>One incident.</summary>
    [HttpGet("{id:long}")]
    public async Task<ApiResponse<SafetyIncidentResponse>> Get(long id, CancellationToken ct) =>
        ApiResponse<SafetyIncidentResponse>.Ok(await _bal.GetAsync(id, ct));

    /// <summary>Staff: set a status and record what was done.</summary>
    [HttpPost("{id:long}/resolve")]
    [Authorize(Policy = "REPORT_VIEW")]
    public async Task<ApiResponse<SafetyIncidentResponse>> Resolve(
        long id, [FromBody] SafetyResolutionRequest request, CancellationToken ct) =>
        ApiResponse<SafetyIncidentResponse>.Ok(
            await _bal.ResolveAsync(_currentUser.RequireUserId(), id, request, ct),
            "Incident updated");
}
