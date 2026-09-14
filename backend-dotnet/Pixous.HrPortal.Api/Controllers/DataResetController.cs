using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Pixous.HrPortal.Domain.Common;
using Pixous.HrPortal.Domain.Modules.Admin;
using Pixous.HrPortal.Domain.Security;

namespace Pixous.HrPortal.Api.Controllers;

/// <summary>
/// Clears operational data, area by area. Ported from
/// com.pixous.hrportal.modules.admin.DataResetController.
///
/// This endpoint deletes real data and there is no undo. Two guards stand in
/// front of it, exactly as in the Java:
///
///   1. `hasRole('SUPER_ADMIN') or hasRole('COMPANY_ADMIN')` — the ROLES, not a
///      permission code, which is why this uses role authorization rather than
///      the permission policy the rest of the API uses.
///   2. the word RESET, typed out, checked in the service rather than only in
///      the browser.
/// </summary>
[ApiController]
[Route("api/admin/reset")]
[Authorize(Roles = "ROLE_SUPER_ADMIN,ROLE_COMPANY_ADMIN")]
public sealed class DataResetController : ControllerBase
{
    private readonly IDataResetBal _reset;
    private readonly ICurrentUser _currentUser;

    public DataResetController(IDataResetBal reset, ICurrentUser currentUser)
    {
        _reset = reset;
        _currentUser = currentUser;
    }

    /// <summary>What each area holds right now, and what it would leave behind.</summary>
    [HttpGet]
    public async Task<ApiResponse<IReadOnlyList<DataResetPreview>>> Preview(CancellationToken ct) =>
        ApiResponse<IReadOnlyList<DataResetPreview>>.Ok(await _reset.PreviewAsync(ct));

    [HttpPost]
    public async Task<ApiResponse<DataResetResult>> Reset([FromBody] ResetRequest body,
                                                          CancellationToken ct)
    {
        DataResetResult result = await _reset.ResetAsync(
            body.Areas, body.Confirmation, _currentUser.UserId, ct);

        return ApiResponse<DataResetResult>.Ok(result, $"Cleared {result.Total} record(s)");
    }

    /// <summary>The areas to clear, and the word RESET typed out.</summary>
    public sealed record ResetRequest(IReadOnlyCollection<string>? Areas, string? Confirmation);
}
