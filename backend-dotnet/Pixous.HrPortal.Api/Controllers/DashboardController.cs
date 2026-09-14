using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Pixous.HrPortal.Domain.Common;
using Pixous.HrPortal.Domain.Modules.Dashboard;
using Pixous.HrPortal.Domain.Security;

namespace Pixous.HrPortal.Api.Controllers;

/// <summary>
/// The dashboards. Ported from DashboardController.
///
/// Three levels of access, and they are deliberately different: the personal
/// widgets and the celebrations are open to any signed-in employee, the
/// organisation view needs one of three permissions, and the executive KPIs
/// need DASHBOARD_EXEC alone.
/// </summary>
[ApiController]
[Route("api/dashboard")]
[Authorize]
public sealed class DashboardController : ControllerBase
{
    private readonly IDashboardBal _bal;
    private readonly ICurrentUser _currentUser;

    public DashboardController(IDashboardBal bal, ICurrentUser currentUser)
    {
        _bal = bal;
        _currentUser = currentUser;
    }

    /// <summary>Personal widgets for the signed-in employee.</summary>
    [HttpGet("me")]
    public async Task<ApiResponse<EmployeeDashboard>> Me(CancellationToken ct) =>
        ApiResponse<EmployeeDashboard>.Ok(
            await _bal.EmployeeAsync(_currentUser.RequireUserId(), ct));

    /// <summary>
    /// Upcoming birthdays and work anniversaries, visible to every employee.
    ///
    /// An <c>industry</c> narrows it to that side of the company; leaving it off
    /// covers everybody, which is what every existing caller does.
    /// </summary>
    [HttpGet("celebrations")]
    public async Task<ApiResponse<IReadOnlyList<Celebration>>> Celebrations(
        [FromQuery] string? industry, CancellationToken ct) =>
        ApiResponse<IReadOnlyList<Celebration>>.Ok(await _bal.CelebrationsAsync(industry, ct));

    /// <summary>
    /// Every birthday and work anniversary in one calendar year.
    ///
    /// A separate endpoint from the card above, because that one is a "coming
    /// up soon" widget -- sixty days, twelve rows -- and this is a register
    /// somebody reads a year at a time, dates already past included.
    /// </summary>
    [HttpGet("celebrations/year/{year:int}")]
    public async Task<ApiResponse<IReadOnlyList<Celebration>>> CelebrationsInYear(
        int year, [FromQuery] string? industry, CancellationToken ct)
    {
        // A path variable is whatever the caller typed. Bounded here so a typo
        // asks for a year rather than reaching date arithmetic that throws.
        if (!CelebrationRules.IsYearInRange(year))
        {
            throw ApiException.Business("Choose a year between 1970 and 2200.");
        }

        return ApiResponse<IReadOnlyList<Celebration>>.Ok(
            await _bal.CelebrationsInYearAsync(year, industry, ct));
    }

    /// <summary>
    /// The organisation at a glance. Read by whoever runs the organisation
    /// dashboard: an admin, HR, or the company head.
    /// </summary>
    [HttpGet("org-insights")]
    [Authorize(Policy = "USER_MANAGE,DASHBOARD_EXEC,ATTENDANCE_TEAM")]
    public async Task<ApiResponse<OrgInsights>> OrgInsights(
        [FromQuery] string? industry, CancellationToken ct) =>
        ApiResponse<OrgInsights>.Ok(await _bal.OrgInsightsAsync(industry, ct));

    /// <summary>Org-wide KPIs, restricted to executive and leadership roles.</summary>
    [HttpGet("executive")]
    [Authorize(Policy = "DASHBOARD_EXEC")]
    public async Task<ApiResponse<ExecutiveDashboard>> Executive(
        [FromQuery] string? industry, CancellationToken ct) =>
        ApiResponse<ExecutiveDashboard>.Ok(await _bal.ExecutiveAsync(industry, ct));
}
