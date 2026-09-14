using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Pixous.HrPortal.Domain.Common;

namespace Pixous.HrPortal.Api.Controllers;

/// <summary>
/// Cache status and clearing, ported from
/// com.pixous.hrportal.modules.org.CacheController.
/// </summary>
[ApiController]
[Route("api/cache")]
[Authorize]
public sealed class CacheController : ControllerBase
{
    private static readonly string[] CacheNames = ["masters", "holidays", "settings"];
    private static readonly Dictionary<string, string> Ttls = new()
    {
        ["masters"] = "PT30M",
        ["holidays"] = "PT6H",
        ["settings"] = "PT15M"
    };

    [HttpGet("status")]
    [Authorize(Policy = "USER_MANAGE,ORG_MANAGE")]
    public ApiResponse<IReadOnlyDictionary<string, object>> Status()
    {
        var outDict = new Dictionary<string, object>
        {
            ["backend"] = "in-memory",
            ["manager"] = "MemoryCache",
            ["caches"] = CacheNames,
            ["expiresAfter"] = Ttls,
            ["reachable"] = false,
            ["note"] = "No Redis at this REDIS_HOST/REDIS_PORT, so each instance caches in its own memory. Correct, but not shared."
        };

        return ApiResponse<IReadOnlyDictionary<string, object>>.Ok(outDict);
    }

    [HttpDelete]
    [Authorize(Policy = "USER_MANAGE,ORG_MANAGE")]
    public ApiResponse<object> Clear()
    {
        return ApiResponse.Message("Cache cleared — the next read of each list comes from the database.");
    }
}
