using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Pixous.HrPortal.Domain.Common;
using Pixous.HrPortal.Domain.Modules.Org;

namespace Pixous.HrPortal.Api.Controllers;

/// <summary>
/// Organisation master data and dropdowns, ported from
/// com.pixous.hrportal.modules.org.OrgController.
///
/// Three forms of the same dropdown are kept, because the Java keeps them for
/// backwards compatibility with the legacy PHP API and dropping one would break
/// whichever client still uses it:
///
///     GET  /api/org/dropdown/{type}        single, path form
///     GET  /api/org/dropdown?type=...      single, query form
///     POST /api/org/dropdowns  ["a","b"]   several at once
///
/// Not yet ported: the write endpoints (`POST /designations`,
/// `POST /office-locations`, `POST /holidays`), which need the cache-eviction
/// behaviour that goes with them.
/// </summary>
[ApiController]
[Route("api/org")]
[Authorize]
public sealed class OrgController : ControllerBase
{
    private readonly IOrgBal _org;

    public OrgController(IOrgBal org)
    {
        _org = org;
    }

    [HttpGet("dropdown/{type}")]
    public async Task<ApiResponse<IReadOnlyList<DropdownItem>>> DropdownByPath(
        string type, [FromQuery] string? industry, CancellationToken ct) =>
        ApiResponse<IReadOnlyList<DropdownItem>>.Ok(await _org.DropdownAsync(type, industry, ct));

    [HttpGet("dropdown")]
    public async Task<ApiResponse<IReadOnlyList<DropdownItem>>> DropdownByQuery(
        [FromQuery] string type, [FromQuery] string? industry, CancellationToken ct) =>
        ApiResponse<IReadOnlyList<DropdownItem>>.Ok(await _org.DropdownAsync(type, industry, ct));

    /// <summary>
    /// Several dropdowns in one call. The body is a bare JSON array of type
    /// names — <c>["department","designation"]</c> — not an object, which is
    /// what the Java's <c>@RequestBody List&lt;String&gt;</c> accepts.
    /// </summary>
    [HttpPost("dropdowns")]
    public async Task<ApiResponse<IReadOnlyDictionary<string, IReadOnlyList<DropdownItem>>>> Dropdowns(
        [FromBody] List<string> types, [FromQuery] string? industry, CancellationToken ct) =>
        ApiResponse<IReadOnlyDictionary<string, IReadOnlyList<DropdownItem>>>.Ok(
            await _org.DropdownsAsync(types, industry, ct));

    [HttpGet("sites")]
    public async Task<ApiResponse<IReadOnlyList<GeoPlaceItem>>> Sites(CancellationToken ct) =>
        ApiResponse<IReadOnlyList<GeoPlaceItem>>.Ok(await _org.ListSitesAsync(ct));

    [HttpGet("office-locations")]
    public async Task<ApiResponse<IReadOnlyList<GeoPlaceItem>>> OfficeLocations(
        CancellationToken ct) =>
        ApiResponse<IReadOnlyList<GeoPlaceItem>>.Ok(await _org.ListOfficeLocationsAsync(ct));

    [HttpGet("holidays")]
    public async Task<ApiResponse<IReadOnlyList<HolidayItem>>> Holidays(
        [FromQuery] int? year, CancellationToken ct) =>
        ApiResponse<IReadOnlyList<HolidayItem>>.Ok(await _org.ListHolidaysAsync(year, ct));

    [HttpPost("designations")]
    [Authorize(Policy = "USER_MANAGE,ORG_MANAGE,TEAM_MANAGE")]
    public async Task<ApiResponse<DropdownItem>> CreateDesignation(
        [FromBody] DesignationRequest request, CancellationToken ct) =>
        ApiResponse<DropdownItem>.Ok(
            await _org.CreateDesignationAsync(request.Name, request.Industry, ct),
            "Team created");

    [HttpDelete("designations")]
    [Authorize(Policy = "USER_MANAGE,ORG_MANAGE,TEAM_MANAGE")]
    public async Task<ApiResponse<object>> DeleteDesignation(
        [FromQuery] string name, CancellationToken ct)
    {
        await _org.DeleteDesignationAsync(name, ct);
        return ApiResponse.Message("Team deleted");
    }

    [HttpPost("office-locations")]
    [Authorize(Policy = "USER_MANAGE,ORG_MANAGE,EMPLOYEE_MANAGE")]
    public async Task<ApiResponse<OfficeLocationItem>> SaveOfficeLocation(
        [FromBody] OfficeLocationRequest request, CancellationToken ct) =>
        ApiResponse<OfficeLocationItem>.Ok(
            await _org.SaveOfficeLocationAsync(request, ct),
            "Office location saved");

    [HttpDelete("office-locations/{id:long}")]
    [Authorize(Policy = "USER_MANAGE,ORG_MANAGE")]
    public async Task<ApiResponse<object>> DeleteOfficeLocation(
        long id, CancellationToken ct)
    {
        await _org.DeleteOfficeLocationAsync(id, ct);
        return ApiResponse.Message("Office location removed");
    }

    [HttpPost("holidays")]
    [Authorize(Policy = "ORG_MANAGE,CALENDAR_MANAGE")]
    public async Task<ApiResponse<HolidayItem>> CreateHoliday(
        [FromBody] HolidayRequest request, CancellationToken ct) =>
        ApiResponse<HolidayItem>.Ok(
            await _org.CreateHolidayAsync(request, ct),
            "Holiday created");

    [HttpDelete("holidays/{id:long}")]
    [Authorize(Policy = "ORG_MANAGE,CALENDAR_MANAGE")]
    public async Task<ApiResponse<object>> DeleteHoliday(
        long id, CancellationToken ct)
    {
        await _org.DeleteHolidayAsync(id, ct);
        return ApiResponse.Message("Holiday removed");
    }
}
