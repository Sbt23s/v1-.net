using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Pixous.HrPortal.Domain.Modules.Community;
using Pixous.HrPortal.Domain.Security;

namespace Pixous.HrPortal.Api.Controllers;

/// <summary>
/// WebRTC call signalling, ICE servers, and call history logging.
/// Ported from CallController.java.
/// </summary>
[ApiController]
[Route("api/calls")]
[Authorize]
public sealed class CallController : ControllerBase
{
    private readonly ICallBal _callBal;
    private readonly ICurrentUser _currentUser;

    public CallController(ICallBal callBal, ICurrentUser currentUser)
    {
        _callBal = callBal;
        _currentUser = currentUser;
    }

    [HttpGet("ice-servers")]
    public async Task<IReadOnlyDictionary<string, object>> IceServers(CancellationToken ct) =>
        await _callBal.GetIceServersAsync(ct);

    [HttpPost("signal")]
    public async Task<IActionResult> Signal([FromBody] CallSignalRequest request, CancellationToken ct)
    {
        await _callBal.SendSignalAsync(request, _currentUser.RequireUserId(), ct);
        return Ok();
    }

    [HttpPost("log")]
    public async Task<IActionResult> Log([FromBody] CallLogRequest request, CancellationToken ct)
    {
        await _callBal.LogCallAsync(request, _currentUser.RequireUserId(), ct);
        return Ok();
    }
}
