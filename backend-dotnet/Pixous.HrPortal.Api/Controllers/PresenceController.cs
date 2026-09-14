using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Pixous.HrPortal.Domain.Modules.Presence;

namespace Pixous.HrPortal.Api.Controllers;

/// <summary>
/// Who is online. Ported from PresenceController.
/// </summary>
[ApiController]
[Route("api/presence")]
[Authorize]
public sealed class PresenceController : ControllerBase
{
    private readonly IPresenceBal _bal;

    public PresenceController(IPresenceBal bal)
    {
        _bal = bal;
    }

    /// <summary>
    /// Who is online now, and when everybody was last seen. The live updates
    /// arrive on <c>/topic/presence</c>; this is the starting picture.
    ///
    /// Answers the snapshot BARE, not wrapped in ApiResponse — the Java returns
    /// ResponseEntity&lt;Map&gt; here rather than the envelope every other
    /// endpoint uses, and the client reads the two keys directly.
    /// </summary>
    [HttpGet]
    public async Task<PresenceSnapshot> Snapshot(CancellationToken ct) =>
        await _bal.SnapshotAsync(ct);
}
