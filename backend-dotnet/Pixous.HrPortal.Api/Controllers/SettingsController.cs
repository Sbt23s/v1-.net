using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Pixous.HrPortal.Domain.Common;
using Pixous.HrPortal.Domain.Modules.Org;
using Pixous.HrPortal.Domain.Modules.Privileges;

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

    /// <summary>What a secret reads as here. Its presence is visible; its value is not.</summary>
    public const string SecretMask = "********";

    /// <summary>
    /// Open to every signed-in user, because the claim form reads the KM rates
    /// from it. It used to return the AI provider keys along with them; those
    /// are masked now, and the AI settings screen reads them from its own
    /// admin-only endpoint.
    /// </summary>
    [HttpGet]
    public async Task<ApiResponse<IReadOnlyDictionary<string, string>>> GetAllSettings(
        CancellationToken ct)
    {
        IReadOnlyDictionary<string, string> all = await _org.GetAllSettingsAsync(ct);
        var masked = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach ((string key, string value) in all)
        {
            masked[key] = ConfigCatalog.IsSecretKey(key) && !string.IsNullOrEmpty(value) ? SecretMask : value;
        }
        return ApiResponse<IReadOnlyDictionary<string, string>>.Ok(masked);
    }

    [HttpPost]
    [Authorize(Policy = "USER_MANAGE")]
    public async Task<ApiResponse<object>> UpdateSettings(
        [FromBody] Dictionary<string, string> settings,
        CancellationToken ct)
    {
        // A client that saves back what it read must not overwrite a real key
        // with the mask.
        var writable = settings
            .Where(kv => !(ConfigCatalog.IsSecretKey(kv.Key) && kv.Value == SecretMask))
            .ToDictionary(kv => kv.Key, kv => kv.Value);
        await _org.UpdateSettingsAsync(writable, ct);
        return ApiResponse.Message("Settings updated");
    }
}
