using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Pixous.HrPortal.Domain.Common;
using Pixous.HrPortal.Domain.Modules.Appreciation;
using Pixous.HrPortal.Domain.Security;

namespace Pixous.HrPortal.Api.Controllers;

/// <summary>
/// Appreciation letters, ported from
/// com.pixous.hrportal.modules.appreciation.AppreciationController.
///
/// Not yet ported: the PDF endpoint and /downloaded. The PDF needs the renderer.
/// </summary>
[ApiController]
[Route("api/appreciation")]
[Authorize]
public sealed class AppreciationController : ControllerBase
{
    private static readonly string[] IssuePermissions =
        ["USER_MANAGE", "COMPLAINT_MANAGE", "DASHBOARD_EXEC"];

    private readonly IAppreciationBal _letters;
    private readonly ICurrentUser _currentUser;

    public AppreciationController(IAppreciationBal letters, ICurrentUser currentUser)
    {
        _letters = letters;
        _currentUser = currentUser;
    }

    /// <summary>
    /// Whether the caller issues letters, which widens what they may READ.
    /// Passed into the service, which has no view of the request claims.
    /// </summary>
    private bool CanIssue() =>
        User.FindAll("roles").Any(c => IssuePermissions.Contains(c.Value, StringComparer.Ordinal));

    [HttpPost]
    [Authorize(Policy = "USER_MANAGE,COMPLAINT_MANAGE,DASHBOARD_EXEC")]
    public async Task<ApiResponse<AppreciationRecord>> Create(
        [FromBody] AppreciationRequest request, CancellationToken ct) =>
        ApiResponse<AppreciationRecord>.Ok(
            await _letters.CreateAsync(_currentUser.RequireUserId(), request, ct));

    [HttpGet]
    [Authorize(Policy = "USER_MANAGE,COMPLAINT_MANAGE,DASHBOARD_EXEC")]
    public async Task<ApiResponse<IReadOnlyList<AppreciationRecord>>> All(CancellationToken ct) =>
        ApiResponse<IReadOnlyList<AppreciationRecord>>.Ok(await _letters.AllAsync(ct));

    /// <summary>Letters addressed to the caller. No permission needed.</summary>
    [HttpGet("mine")]
    public async Task<ApiResponse<IReadOnlyList<AppreciationRecord>>> Mine(CancellationToken ct) =>
        ApiResponse<IReadOnlyList<AppreciationRecord>>.Ok(
            await _letters.MineAsync(_currentUser.RequireUserId(), ct));

    [HttpGet("{id:long}")]
    public async Task<ApiResponse<AppreciationRecord>> Get(long id, CancellationToken ct) =>
        ApiResponse<AppreciationRecord>.Ok(
            await _letters.GetAsync(_currentUser.RequireUserId(), id, CanIssue(), ct));

    [HttpPost("{id:long}/send")]
    [Authorize(Policy = "USER_MANAGE,COMPLAINT_MANAGE,DASHBOARD_EXEC")]
    public async Task<ApiResponse<AppreciationRecord>> Send(long id, CancellationToken ct) =>
        ApiResponse<AppreciationRecord>.Ok(
            await _letters.SendAsync(_currentUser.RequireUserId(), id, ct));

    [HttpGet("{id:long}/pdf")]
    public async Task<IActionResult> Pdf(long id, CancellationToken ct)
    {
        byte[] bytes = await _letters.GetPdfAsync(_currentUser.RequireUserId(), id, CanIssue(), ct);
        return File(bytes, "application/pdf", $"Appreciation-{id}.pdf");
    }

    /// <summary>Recorded when the employee downloads their own letter.</summary>
    [HttpPost("{id:long}/downloaded")]
    public async Task<ApiResponse<object>> MarkDownloaded(long id, CancellationToken ct)
    {
        await _letters.MarkDownloadedAsync(_currentUser.RequireUserId(), id, ct);
        return ApiResponse.Message("Recorded");
    }

    [HttpDelete("{id:long}")]
    [Authorize(Policy = "USER_MANAGE,COMPLAINT_MANAGE,DASHBOARD_EXEC")]
    public async Task<ApiResponse<object>> Delete(long id, CancellationToken ct)
    {
        await _letters.DeleteAsync(id, ct);
        return ApiResponse.Message("Letter deleted");
    }
}

