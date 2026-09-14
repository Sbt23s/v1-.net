using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Pixous.HrPortal.Domain.Common;
using Pixous.HrPortal.Domain.Modules.Performance;
using Pixous.HrPortal.Domain.Security;

namespace Pixous.HrPortal.Api.Controllers;

/// <summary>
/// Goals and review cycles. Ported from PerformanceController.
///
/// Both write endpoints take QUERY PARAMETERS rather than a JSON body, which is
/// unusual here but is what the Java declares with @RequestParam — so
/// [FromQuery] rather than [FromBody], or the existing client's calls would
/// stop binding.
/// </summary>
[ApiController]
[Route("api/performance")]
[Authorize]
public sealed class PerformanceController : ControllerBase
{
    private readonly IPerformanceBal _bal;
    private readonly ICurrentUser _currentUser;

    public PerformanceController(IPerformanceBal bal, ICurrentUser currentUser)
    {
        _bal = bal;
        _currentUser = currentUser;
    }

    [HttpPost("goals")]
    public async Task<ApiResponse<PerformanceGoalResponse>> CreateGoal(
        [FromQuery] string title, [FromQuery] string? description, CancellationToken ct) =>
        ApiResponse<PerformanceGoalResponse>.Ok(
            await _bal.CreateGoalAsync(_currentUser.RequireUserId(), title, description, ct),
            "Goal created");

    [HttpGet("goals/me")]
    public async Task<ApiResponse<IReadOnlyList<PerformanceGoalResponse>>> MyGoals(
        CancellationToken ct) =>
        ApiResponse<IReadOnlyList<PerformanceGoalResponse>>.Ok(
            await _bal.MyGoalsAsync(_currentUser.RequireUserId(), ct));

    /// <summary>Opens a review cycle. The caller becomes its manager.</summary>
    [HttpPost("reviews")]
    [Authorize(Policy = "USER_MANAGE")]
    public async Task<ApiResponse<PerformanceReviewResponse>> CreateReview(
        [FromQuery] long userId, [FromQuery] string period, CancellationToken ct) =>
        ApiResponse<PerformanceReviewResponse>.Ok(
            await _bal.CreateReviewAsync(userId, _currentUser.RequireUserId(), period, ct),
            "Review cycle created");

    [HttpGet("reviews/me")]
    public async Task<ApiResponse<IReadOnlyList<PerformanceReviewResponse>>> MyReviews(
        CancellationToken ct) =>
        ApiResponse<IReadOnlyList<PerformanceReviewResponse>>.Ok(
            await _bal.MyReviewsAsync(_currentUser.RequireUserId(), ct));

    /// <summary>Reviews the caller owns as manager.</summary>
    [HttpGet("reviews/team")]
    [Authorize(Policy = "USER_MANAGE")]
    public async Task<ApiResponse<IReadOnlyList<PerformanceReviewResponse>>> TeamReviews(
        CancellationToken ct) =>
        ApiResponse<IReadOnlyList<PerformanceReviewResponse>>.Ok(
            await _bal.TeamReviewsAsync(_currentUser.RequireUserId(), ct));
}
