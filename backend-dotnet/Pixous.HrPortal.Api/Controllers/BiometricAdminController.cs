using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Pixous.HrPortal.Domain.Common;
using Pixous.HrPortal.Domain.Modules.Biometric;

namespace Pixous.HrPortal.Api.Controllers;

[ApiController]
[Route("api/biometric/admin")]
[Authorize(Policy = "USER_MANAGE")]
public sealed class BiometricAdminController : ControllerBase
{
    private readonly IBiometricBal _bal;

    public BiometricAdminController(IBiometricBal bal)
    {
        _bal = bal;
    }

    [HttpGet("status")]
    public async Task<ActionResult<ApiResponse<BiometricStatusResponse>>> Status(CancellationToken ct)
    {
        var status = await _bal.GetStatusAsync(ct);
        return Ok(ApiResponse<BiometricStatusResponse>.Ok(status));
    }

    [HttpPost("webhook/register")]
    public async Task<ActionResult<ApiResponse<object>>> RegisterWebhook([FromQuery] string callbackUrl, CancellationToken ct)
    {
        var result = await _bal.RegisterWebhookAsync(callbackUrl, ct);
        return Ok(ApiResponse<object>.Ok(result, "Hikvision will now push punches here. Present a face at a terminal to confirm."));
    }

    [HttpGet("webhook")]
    public async Task<ActionResult<ApiResponse<object?>>> ReadWebhook(CancellationToken ct)
    {
        var config = await _bal.GetWebhookConfigAsync(ct);
        return Ok(ApiResponse<object?>.Ok(config));
    }

    [HttpPost("webhook/unregister")]
    public async Task<ActionResult<ApiResponse<object>>> UnregisterWebhook(CancellationToken ct)
    {
        await _bal.UnregisterWebhookAsync(ct);
        return Ok(ApiResponse.Message("Hikvision will no longer push punches here."));
    }

    [HttpGet("people")]
    public async Task<ActionResult<ApiResponse<IReadOnlyList<PersonMappingRow>>>> People(CancellationToken ct)
    {
        var people = await _bal.GetPeopleMappingsAsync(ct);
        return Ok(ApiResponse<IReadOnlyList<PersonMappingRow>>.Ok(people));
    }

    [HttpPost("people/{hikPersonId}/match")]
    public async Task<ActionResult<ApiResponse<object>>> Match(
        [FromRoute] string hikPersonId,
        [FromQuery] long? userId,
        CancellationToken ct)
    {
        await _bal.MatchPersonAsync(hikPersonId, userId, ct);
        return Ok(ApiResponse.Message(userId == null ? "Unmatched." : "Matched."));
    }

    [HttpPost("backfill")]
    public async Task<ActionResult<ApiResponse<BiometricBackfillResult>>> Backfill(
        [FromQuery] DateOnly from,
        [FromQuery] DateOnly to,
        CancellationToken ct)
    {
        var result = await _bal.BackfillAsync(from, to, ct);
        return Ok(ApiResponse<BiometricBackfillResult>.Ok(result, result.Summary()));
    }

    [HttpPost("sync")]
    public async Task<ActionResult<ApiResponse<BiometricSyncResult>>> Sync(CancellationToken ct)
    {
        var result = await _bal.SyncAsync(ct);
        return Ok(ApiResponse<BiometricSyncResult>.Ok(result, result.Summary()));
    }

    [HttpPost("sync-enrolment")]
    public async Task<ActionResult<ApiResponse<int>>> SyncEnrolment(CancellationToken ct)
    {
        int updated = await _bal.SyncEnrolmentAsync(ct);
        return Ok(ApiResponse<int>.Ok(updated, $"Refreshed {updated} people"));
    }
}
