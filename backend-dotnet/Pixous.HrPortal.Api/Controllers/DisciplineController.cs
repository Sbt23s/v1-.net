using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Pixous.HrPortal.Domain.Common;
using Pixous.HrPortal.Domain.Modules.Discipline;
using Pixous.HrPortal.Domain.Security;

namespace Pixous.HrPortal.Api.Controllers;

/// <summary>
/// Disciplinary records, ported from
/// com.pixous.hrportal.modules.discipline.DisciplineController.
/// </summary>
[ApiController]
[Route("api/discipline")]
[Authorize]
public sealed class DisciplineController : ControllerBase
{
    private static readonly string[] ManagePermissions = ["USER_MANAGE", "COMPLAINT_MANAGE"];

    private readonly IDisciplineBal _discipline;
    private readonly IStorageService _storage;
    private readonly ICurrentUser _currentUser;

    public DisciplineController(
        IDisciplineBal discipline,
        IStorageService storage,
        ICurrentUser currentUser)
    {
        _discipline = discipline;
        _storage = storage;
        _currentUser = currentUser;
    }

    /// <summary>
    /// Whether the caller manages records, which widens what they may READ.
    /// Passed into the service rather than checked there, because the service
    /// has no view of the request's claims.
    /// </summary>
    private bool CanManage() =>
        User.FindAll("roles").Any(c => ManagePermissions.Contains(c.Value, StringComparer.Ordinal));

    [HttpPost]
    [Authorize(Policy = "USER_MANAGE,COMPLAINT_MANAGE")]
    public async Task<ApiResponse<DisciplineView>> Create([FromBody] DisciplineRequest request,
                                                          CancellationToken ct) =>
        ApiResponse<DisciplineView>.Ok(
            await _discipline.CreateViewAsync(_currentUser.RequireUserId(), request, ct),
            "Discipline record created");

    [HttpGet]
    [Authorize(Policy = "USER_MANAGE,COMPLAINT_MANAGE,DASHBOARD_EXEC")]
    public async Task<ApiResponse<IReadOnlyList<DisciplineView>>> All(
        [FromQuery] string? status = null,
        [FromQuery] int page = 0,
        [FromQuery] int size = 500,
        CancellationToken ct = default) =>
        ApiResponse<IReadOnlyList<DisciplineView>>.Ok(
            await _discipline.AllViewAsync(status, page, size, ct));

    /// <summary>Records about the caller. No permission needed — it is their own file.</summary>
    [HttpGet("mine")]
    public async Task<ApiResponse<IReadOnlyList<DisciplineView>>> Mine(CancellationToken ct) =>
        ApiResponse<IReadOnlyList<DisciplineView>>.Ok(
            await _discipline.MineViewAsync(_currentUser.RequireUserId(), ct));

    [HttpGet("pending-review")]
    [Authorize(Policy = "USER_MANAGE,DASHBOARD_EXEC")]
    public async Task<ApiResponse<IReadOnlyList<DisciplineView>>> PendingReview(CancellationToken ct) =>
        ApiResponse<IReadOnlyList<DisciplineView>>.Ok(
            await _discipline.PendingReviewAsync(ct));

    [HttpGet("{id:long}")]
    public async Task<ApiResponse<DisciplineView>> Get(long id, CancellationToken ct) =>
        ApiResponse<DisciplineView>.Ok(
            await _discipline.GetViewAsync(_currentUser.RequireUserId(), id, CanManage(), ct));

    [HttpPut("{id:long}")]
    [Authorize(Policy = "USER_MANAGE,COMPLAINT_MANAGE")]
    public async Task<ApiResponse<DisciplineView>> Update(long id,
                                                         [FromBody] UpdateDisciplineRequest request,
                                                         CancellationToken ct) =>
        ApiResponse<DisciplineView>.Ok(
            await _discipline.UpdateAsync(_currentUser.RequireUserId(), id, request, ct),
            "Updated");

    /// <summary>The subject's right of reply. Deliberately open to any signed-in user.</summary>
    [HttpPost("{id:long}/response")]
    public async Task<ApiResponse<DisciplineView>> Respond(long id,
                                                           [FromBody] ResponseRequest request,
                                                           CancellationToken ct) =>
        ApiResponse<DisciplineView>.Ok(
            await _discipline.RespondViewAsync(_currentUser.RequireUserId(), id,
                                               request.Response, ct),
            "Response saved");

    [HttpPost("{id:long}/review")]
    [Authorize(Policy = "USER_MANAGE,DASHBOARD_EXEC")]
    public async Task<ApiResponse<DisciplineView>> Review(long id,
                                                         [FromBody] ReviewDisciplineRequest request,
                                                         CancellationToken ct) =>
        ApiResponse<DisciplineView>.Ok(
            await _discipline.ReviewAsync(_currentUser.RequireUserId(), id, request, ct),
            "Review saved");

    [HttpPost("{id:long}/cancel")]
    [Authorize(Policy = "USER_MANAGE,COMPLAINT_MANAGE")]
    public async Task<ApiResponse<object>> Cancel(long id, CancellationToken ct)
    {
        await _discipline.CancelDisciplineAsync(_currentUser.RequireUserId(), id, ct);
        return ApiResponse.Message("Discipline record withdrawn");
    }

    [HttpPost("upload")]
    [Authorize(Policy = "USER_MANAGE,COMPLAINT_MANAGE")]
    public async Task<ApiResponse<IReadOnlyDictionary<string, string>>> Upload(
        IFormFile file,
        CancellationToken ct)
    {
        if (file == null || file.Length == 0)
        {
            throw ApiException.Business("No file received");
        }

        using Stream stream = file.OpenReadStream();
        string path = await _storage.StoreAsync(
            stream,
            file.FileName,
            file.ContentType,
            file.Length,
            "discipline-attachments",
            ct);

        return ApiResponse<IReadOnlyDictionary<string, string>>.Ok(
            new Dictionary<string, string> { ["path"] = path },
            "Uploaded");
    }

    public sealed record ResponseRequest(string? Response);
}
