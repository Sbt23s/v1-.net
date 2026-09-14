using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Pixous.HrPortal.Domain.Common;
using Pixous.HrPortal.Domain.Modules.Calendar;
using Pixous.HrPortal.Domain.Security;

namespace Pixous.HrPortal.Api.Controllers;

/// <summary>
/// The company calendar. Ported from CalendarController.
///
/// Reading is open to any signed-in employee -- narrowed per caller by the
/// audience rule in the BAL -- and every write needs ORG_MANAGE or USER_MANAGE.
/// </summary>
[ApiController]
[Route("api/calendar")]
[Authorize]
public sealed class CalendarController : ControllerBase
{
    private readonly ICalendarBal _bal;
    private readonly ICurrentUser _currentUser;

    public CalendarController(ICalendarBal bal, ICurrentUser currentUser)
    {
        _bal = bal;
        _currentUser = currentUser;
    }

    /// <summary>
    /// Birthdays, work anniversaries and company events touching the range --
    /// everything the calendar draws besides holidays, leave and task due
    /// dates, which the page reads from their own modules.
    /// </summary>
    [HttpGet("events")]
    public async Task<ApiResponse<IReadOnlyList<CalendarEvent>>> Events(
        [FromQuery] DateOnly? from, [FromQuery] DateOnly? to, CancellationToken ct) =>
        ApiResponse<IReadOnlyList<CalendarEvent>>.Ok(
            await _bal.EventsAsync(from, to, _currentUser.UserId, ct));

    [HttpPost("events")]
    [Authorize(Policy = "ORG_MANAGE,USER_MANAGE")]
    public async Task<ApiResponse<CalendarEvent>> Create(
        [FromBody] EventRequest request, CancellationToken ct) =>
        ApiResponse<CalendarEvent>.Ok(
            await _bal.CreateAsync(request, _currentUser.UserId, ct), "Event added");

    [HttpPut("events/{id:long}")]
    [Authorize(Policy = "ORG_MANAGE,USER_MANAGE")]
    public async Task<ApiResponse<CalendarEvent>> Update(
        long id, [FromBody] EventRequest request, CancellationToken ct) =>
        ApiResponse<CalendarEvent>.Ok(await _bal.UpdateAsync(id, request, ct), "Event updated");

    [HttpDelete("events/{id:long}")]
    [Authorize(Policy = "ORG_MANAGE,USER_MANAGE")]
    public async Task<ApiResponse<object>> Delete(long id, CancellationToken ct)
    {
        await _bal.DeleteAsync(id, ct);
        return ApiResponse<object>.MessageOnly("Event removed");
    }
}
