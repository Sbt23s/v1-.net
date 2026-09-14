using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Pixous.HrPortal.Domain.Modules.Biometric;

namespace Pixous.HrPortal.Api.Controllers;

[ApiController]
[Route("api/biometric/webhook")]
[AllowAnonymous]
public sealed class BiometricWebhookController : ControllerBase
{
    private const string HdrBatchId = "X-Hook-Batch-Id";
    private const string HdrSignature = "X-Hook-Signature";
    private const string HdrTimestamp = "X-Hook-Timestamp";

    private readonly IBiometricBal _bal;

    public BiometricWebhookController(IBiometricBal bal)
    {
        _bal = bal;
    }

    [HttpGet]
    public IActionResult Validate(
        [FromHeader(Name = HdrBatchId)] string? batchId,
        [FromHeader(Name = HdrTimestamp)] string? timestamp)
    {
        if (string.IsNullOrWhiteSpace(batchId) || string.IsNullOrWhiteSpace(timestamp))
        {
            return BadRequest("Missing validation headers");
        }

        string? signature = _bal.ValidateWebhookChallenge(batchId, timestamp);
        if (string.IsNullOrWhiteSpace(signature))
        {
            return StatusCode(503, "Not configured");
        }

        Response.Headers[HdrSignature] = signature;
        return Ok("OK");
    }

    [HttpPost]
    public async Task<IActionResult> Deliver(
        [FromHeader(Name = HdrBatchId)] string? batchId,
        [FromHeader(Name = HdrSignature)] string? signature,
        [FromHeader(Name = HdrTimestamp)] string? timestamp,
        CancellationToken ct)
    {
        using var reader = new StreamReader(Request.Body);
        string rawBody = await reader.ReadToEndAsync(ct);

        await _bal.IngestWebhookPayloadAsync(rawBody, batchId, signature, timestamp, ct);
        return Ok("OK");
    }
}
