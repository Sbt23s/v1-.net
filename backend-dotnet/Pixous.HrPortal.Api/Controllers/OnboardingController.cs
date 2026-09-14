using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Pixous.HrPortal.Domain.Common;
using Pixous.HrPortal.Domain.Modules.Onboarding;
using Pixous.HrPortal.Domain.Security;

namespace Pixous.HrPortal.Api.Controllers;

/// <summary>
/// The joining checklist. Ported from OnboardingController.
///
/// Two of these routes are guarded by a POLICY and two by a rule decided in the
/// action — you may read and tick YOUR OWN checklist, or anybody's if you hold
/// USER_MANAGE. That rule depends on the row being addressed, so it cannot be
/// declared on the endpoint; it is transcribed here exactly as the Java has it,
/// including the fact that it throws a business error rather than a 403.
/// </summary>
[ApiController]
[Route("api/onboarding")]
[Authorize]
public sealed class OnboardingController : ControllerBase
{
    private readonly IOnboardingBal _bal;
    private readonly ICurrentUser _currentUser;

    public OnboardingController(IOnboardingBal bal, ICurrentUser currentUser)
    {
        _bal = bal;
        _currentUser = currentUser;
    }

    [HttpPost("{userId:long}/start")]
    [Authorize(Policy = "USER_MANAGE")]
    public async Task<ApiResponse<OnboardingChecklistResponse>> Start(
        long userId, CancellationToken ct) =>
        ApiResponse<OnboardingChecklistResponse>.Ok(await _bal.StartAsync(userId, ct),
                                                    "Onboarding started");

    /// <summary>
    /// Ids of employees currently in onboarding, used to scope announcement
    /// channels. HR builds those channels too, so EMPLOYEE_MANAGE reads it as
    /// well.
    /// </summary>
    [HttpGet("employees")]
    [Authorize(Policy = "USER_MANAGE,EMPLOYEE_MANAGE,COMMUNITY_MANAGE")]
    public async Task<ApiResponse<IReadOnlyList<long>>> OnboardingEmployees(CancellationToken ct) =>
        ApiResponse<IReadOnlyList<long>>.Ok(await _bal.OnboardingUserIdsAsync(ct));

    [HttpGet("{userId:long}")]
    public async Task<ApiResponse<OnboardingChecklistResponse>> Get(long userId,
                                                                    CancellationToken ct)
    {
        RequireSelfOrPrivileged(userId, "You can only view your own onboarding checklist");
        return ApiResponse<OnboardingChecklistResponse>.Ok(await _bal.GetAsync(userId, ct));
    }

    [HttpPost("{userId:long}/tasks/{taskId:long}/complete")]
    public async Task<ApiResponse<OnboardingChecklistResponse>> CompleteTask(
        long userId, long taskId, CancellationToken ct)
    {
        RequireSelfOrPrivileged(userId, "You can only update your own onboarding checklist");
        return ApiResponse<OnboardingChecklistResponse>.Ok(
            await _bal.CompleteTaskAsync(userId, taskId, ct), "Task marked as completed");
    }

    /// <summary>
    /// Your own checklist, or anybody's with USER_MANAGE.
    ///
    /// A business error rather than a 403, which is what the Java throws -- so
    /// the status code the client already handles does not change.
    /// </summary>
    private void RequireSelfOrPrivileged(long userId, string message)
    {
        bool isSelf = _currentUser.UserId == userId;
        bool isPrivileged = _currentUser.HasPermission("USER_MANAGE");

        if (!isSelf && !isPrivileged)
        {
            throw ApiException.Business(message);
        }
    }
}
