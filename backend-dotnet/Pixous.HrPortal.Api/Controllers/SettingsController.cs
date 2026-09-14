using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Pixous.HrPortal.Domain.Common;
using Pixous.HrPortal.Domain.Modules.Org;

namespace Pixous.HrPortal.Api.Controllers;

/// <summary>
/// Global system settings, ported from
/// com.pixous.hrportal.modules.org.SettingsController.
/// </summary>
[ApiController]
[Route("api/settings")]
[Authorize]
public sealed class SettingsController : ControllerBase
{
    private readonly IOrgBal _org;

    public SettingsController(IOrgBal org)
    {
        _org = org;
    }

    [HttpGet]
    public async Task<ApiResponse<IReadOnlyDictionary<string, string>>> GetAllSettings(
        CancellationToken ct) =>
        ApiResponse<IReadOnlyDictionary<string, string>>.Ok(
            await _org.GetAllSettingsAsync(ct));

    [HttpPost]
    [Authorize(Policy = "USER_MANAGE")]
    public async Task<ApiResponse<object>> UpdateSettings(
        [FromBody] Dictionary<string, string> settings,
        CancellationToken ct)
    {
        await _org.UpdateSettingsAsync(settings, ct);
        return ApiResponse.Message("Settings updated");
    }
}
