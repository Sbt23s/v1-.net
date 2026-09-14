using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Pixous.HrPortal.Domain.Common;
using Pixous.HrPortal.Domain.Modules.Announcement;
using Pixous.HrPortal.Domain.Security;

namespace Pixous.HrPortal.Api.Controllers;

/// <summary>
/// What employees see at sign-in. Read only, and the only announcement endpoint
/// an ordinary user can reach.
/// Ported from GlobalLoginAnnouncementController.
/// </summary>
[ApiController]
[Route("api/global-announcements")]
[Authorize]
public sealed class AnnouncementController : ControllerBase
{
    private readonly IAnnouncementBal _bal;
    private readonly ICurrentUser _currentUser;

    public AnnouncementController(IAnnouncementBal bal, ICurrentUser currentUser)
    {
        _bal = bal;
        _currentUser = currentUser;
    }

    /// <summary>
    /// The announcement for this caller, or <c>data: null</c> when there is
    /// none — a null payload, not a 404. The login popup treats an empty body
    /// as "nothing to show", and a 404 would surface as an error instead.
    /// </summary>
    [HttpGet("active")]
    public async Task<ApiResponse<AnnouncementRecord?>> Active(CancellationToken ct)
    {
        // The FIRST role, falling back to "Employee" -- the Java walks the
        // authorities and breaks on the first ROLE_ prefixed one. A user with
        // several roles is therefore targeted by whichever the principal lists
        // first, not by their most senior.
        string role = _currentUser.Roles.FirstOrDefault() ?? "Employee";

        return ApiResponse<AnnouncementRecord?>.Ok(await _bal.ActiveForRoleAsync(role, ct));
    }
}

/// <summary>
/// Managing the announcement: list, publish, retire.
///
/// Technical administrator only. The Java carries a class-level
/// @PreAuthorize("hasRole('TECHNICAL_ADMIN')") with a comment explaining why:
/// the /api/tech-admin/** prefix was listed as public in the security chain, so
/// before that annotation anyone who found the URL could publish onto every
/// user's login screen. The guard is the only thing protecting this path, so it
/// is reproduced at the class level here for the same reason.
/// </summary>
[ApiController]
[Route("api/tech-admin/global-announcements")]
[Authorize(Roles = "ROLE_TECHNICAL_ADMIN")]
public sealed class TechAdminAnnouncementController : ControllerBase
{
    private readonly IAnnouncementBal _bal;
    private readonly ICurrentUser _currentUser;

    public TechAdminAnnouncementController(IAnnouncementBal bal, ICurrentUser currentUser)
    {
        _bal = bal;
        _currentUser = currentUser;
    }

    [HttpGet]
    public async Task<ApiResponse<IReadOnlyList<AnnouncementRecord>>> ListAll(CancellationToken ct) =>
        ApiResponse<IReadOnlyList<AnnouncementRecord>>.Ok(await _bal.ListAllAsync(ct));

    [HttpPost]
    public async Task<ApiResponse<AnnouncementRecord>> CreateAndPublish(
        IFormFile? file,
        [FromForm] string mediaType,
        [FromForm] string? title,
        [FromForm] string? description,
        [FromForm] string? targetRoles,
        [FromForm] int? durationSeconds,
        [FromForm] bool? publishImmediately,
        IFormFile? effectFile,
        [FromForm] bool? effectEnabled,
        CancellationToken ct)
    {
        using Stream? fileStream = file?.OpenReadStream();
        using Stream? effectStream = effectFile?.OpenReadStream();

        long? createdBy = _currentUser.UserId > 0 ? _currentUser.UserId : null;
        string? createdByName = !string.IsNullOrWhiteSpace(_currentUser.Username) ? _currentUser.Username : "Tech Admin";

        AnnouncementRecord result = await _bal.CreateAndPublishAsync(
            mediaType,
            title,
            description,
            targetRoles,
            durationSeconds,
            publishImmediately,
            fileStream,
            file?.FileName,
            file?.ContentType,
            file?.Length,
            effectStream,
            effectFile?.FileName,
            effectFile?.ContentType,
            effectFile?.Length,
            effectEnabled,
            createdBy,
            createdByName,
            ct);

        return ApiResponse<AnnouncementRecord>.Ok(result);
    }

    /// <summary>
    /// Publish or retire. The body is a bare map and a missing "status" means
    /// INACTIVE, as the Java's getOrDefault does.
    /// </summary>
    [HttpPut("{id:long}/status")]
    public async Task<ApiResponse<AnnouncementRecord>> UpdateStatus(
        long id, [FromBody] Dictionary<string, string>? body, CancellationToken ct)
    {
        string status = body is not null && body.TryGetValue("status", out string? s)
            ? s
            : "INACTIVE";

        return ApiResponse<AnnouncementRecord>.Ok(await _bal.UpdateStatusAsync(id, status, ct));
    }

    /// <summary>Soft delete. Answers <c>{"deleted": true}</c>, as the Java does.</summary>
    [HttpDelete("{id:long}")]
    public async Task<ApiResponse<Dictionary<string, bool>>> Delete(long id, CancellationToken ct)
    {
        await _bal.DeleteAsync(id, ct);
        return ApiResponse<Dictionary<string, bool>>.Ok(new Dictionary<string, bool> { ["deleted"] = true });
    }
}
