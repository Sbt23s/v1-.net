using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Pixous.HrPortal.Domain.Common;
using Pixous.HrPortal.Domain.Modules.User;
using Pixous.HrPortal.Domain.Security;

namespace Pixous.HrPortal.Api.Controllers;

/// <summary>
/// The employee directory, self-service profile, photos, credentials,
/// offboarding, face enrolment, and bank details. Ported from
/// com.pixous.hrportal.modules.user.UserController.
/// </summary>
[ApiController]
[Route("api/users")]
[Authorize]
public sealed class UserController : ControllerBase
{
    private readonly IUserBal _users;
    private readonly ICurrentUser _currentUser;

    public UserController(IUserBal users, ICurrentUser currentUser)
    {
        _users = users;
        _currentUser = currentUser;
    }

    /// <summary>The caller's own profile. No permission needed — it is their own row.</summary>
    [HttpGet("me")]
    public async Task<ApiResponse<ProfileResponse>> Me(CancellationToken ct) =>
        ApiResponse<ProfileResponse>.Ok(await _users.GetProfileAsync(_currentUser.RequireUserId(), ct));

    /// <summary>Update the signed-in user's profile.</summary>
    [HttpPut("me")]
    public async Task<ApiResponse<ProfileResponse>> UpdateMe([FromBody] UpdateProfileRequest request, CancellationToken ct) =>
        ApiResponse<ProfileResponse>.Ok(
            await _users.UpdateProfileAsync(_currentUser.RequireUserId(), request, ct),
            "Profile updated");

    /// <summary>Upload / replace profile photo.</summary>
    [HttpPost("me/photo")]
    [Consumes("multipart/form-data")]
    public async Task<ApiResponse<Dictionary<string, string>>> UploadPhoto(IFormFile file, CancellationToken ct)
    {
        if (file is null || file.Length == 0)
        {
            throw ApiException.Business("No photo was received.");
        }

        using var stream = file.OpenReadStream();
        string path = await _users.UpdatePhotoAsync(_currentUser.RequireUserId(), stream, file.FileName, file.ContentType, file.Length, ct);
        return ApiResponse<Dictionary<string, string>>.Ok(new() { ["photoPath"] = path }, "Photo updated");
    }

    /// <summary>Remove the signed-in user's profile photo.</summary>
    [HttpDelete("me/photo")]
    public async Task<ApiResponse<object>> RemovePhoto(CancellationToken ct)
    {
        await _users.RemovePhotoAsync(_currentUser.RequireUserId(), ct);
        return ApiResponse.Message("Photo removed");
    }

    /// <summary>Upload / replace the dashboard banner image.</summary>
    [HttpPost("me/cover")]
    [Consumes("multipart/form-data")]
    public async Task<ApiResponse<Dictionary<string, string>>> UploadCover(IFormFile file, CancellationToken ct)
    {
        if (file is null || file.Length == 0)
        {
            throw ApiException.Business("No cover photo was received.");
        }

        using var stream = file.OpenReadStream();
        string path = await _users.UpdateCoverPhotoAsync(_currentUser.RequireUserId(), stream, file.FileName, file.ContentType, file.Length, ct);
        return ApiResponse<Dictionary<string, string>>.Ok(new() { ["coverPhotoPath"] = path }, "Cover updated");
    }

    /// <summary>Remove the dashboard banner image.</summary>
    [HttpDelete("me/cover")]
    public async Task<ApiResponse<object>> RemoveCover(CancellationToken ct)
    {
        await _users.RemoveCoverPhotoAsync(_currentUser.RequireUserId(), ct);
        return ApiResponse.Message("Cover removed");
    }

    /// <summary>HR/Admin: upload one employee document.</summary>
    [HttpPost("documents")]
    [Authorize(Policy = "USER_MANAGE,EMPLOYEE_MANAGE")]
    [Consumes("multipart/form-data")]
    public async Task<ApiResponse<Dictionary<string, string>>> UploadDocument(IFormFile file, CancellationToken ct)
    {
        if (file is null || file.Length == 0)
        {
            throw ApiException.Business("No file was received.");
        }

        using var stream = file.OpenReadStream();
        string path = await _users.StoreDocumentAsync(stream, file.FileName, file.ContentType, file.Length, ct);
        return ApiResponse<Dictionary<string, string>>.Ok(new() { ["path"] = path }, "File uploaded");
    }

    /// <summary>
    /// Employee directory. Beyond the search box it narrows by team, role,
    /// department and a joining-date window — all optional, so a call that sends
    /// none of them behaves exactly as it always did.
    /// </summary>
    [HttpGet]
    [Authorize(Policy = "USER_MANAGE,ATTENDANCE_TEAM,DASHBOARD_EXEC+TECHNICAL_ADMIN")]
    public async Task<ApiResponse<PageResponse<UserSummary>>> Directory(
        [FromQuery] string? q,
        [FromQuery] string? industry,
        [FromQuery] long? departmentId,
        [FromQuery] long? designationId,
        [FromQuery] string? designationTitle,
        [FromQuery] string? roleCode,
        [FromQuery] DateOnly? joinedFrom,
        [FromQuery] DateOnly? joinedTo,
        [FromQuery] string? status,
        [FromQuery] int page = 0,
        [FromQuery] int size = 20,
        CancellationToken ct = default)
    {
        var query = new UserDirectoryQuery
        {
            Q = q,
            Industry = industry,
            DepartmentId = departmentId,
            DesignationId = designationId,
            DesignationTitle = designationTitle,
            RoleCode = roleCode,
            JoinedFrom = joinedFrom,
            JoinedTo = joinedTo,
            Status = status,
            Page = page,
            Size = size
        };

        return ApiResponse<PageResponse<UserSummary>>.Ok(await _users.DirectoryAsync(query, ct));
    }

    /// <summary>Get a single employee profile by id.</summary>
    [HttpGet("{id:long}")]
    [Authorize(Policy = "USER_MANAGE,ATTENDANCE_TEAM,DASHBOARD_EXEC")]
    public async Task<ApiResponse<ProfileResponse>> GetById(long id, CancellationToken ct) =>
        ApiResponse<ProfileResponse>.Ok(await _users.GetProfileAsync(id, ct));

    /// <summary>Update an employee profile by id.</summary>
    [HttpPut("{id:long}")]
    [Authorize(Policy = "USER_MANAGE,EMPLOYEE_MANAGE+TECHNICAL_ADMIN")]
    public async Task<ApiResponse<ProfileResponse>> UpdateById(
        long id, [FromBody] UpdateEmployeeRequest request, CancellationToken ct) =>
        ApiResponse<ProfileResponse>.Ok(
            await _users.UpdateEmployeeAsync(id, request, ct),
            "Profile updated successfully");

    /// <summary>Set an employee's login username and/or reset their password.</summary>
    [HttpPost("{id:long}/credentials")]
    [Authorize(Policy = "USER_MANAGE,EMPLOYEE_MANAGE+TECHNICAL_ADMIN")]
    public async Task<ApiResponse<object>> SetCredentials(
        long id, [FromBody] SetCredentialsRequest request, CancellationToken ct)
    {
        await _users.SetCredentialsAsync(id, request.Username, request.Password, ct);
        return ApiResponse.Message("Login updated");
    }

    /// <summary>Remove an employee from their team (clear designation).</summary>
    [HttpDelete("{id:long}/designation")]
    [Authorize(Policy = "USER_MANAGE")]
    public async Task<ApiResponse<object>> ClearDesignation(long id, CancellationToken ct)
    {
        await _users.ClearDesignationAsync(id, ct);
        return ApiResponse.Message("Removed from team");
    }

    /// <summary>Offboard an employee.</summary>
    [HttpPost("{id:long}/offboarding")]
    [Authorize(Policy = "USER_MANAGE")]
    public async Task<ApiResponse<object>> OffboardUser(
        long id, [FromBody] OffboardingRequest request, CancellationToken ct)
    {
        await _users.OffboardUserAsync(id, request, ct);
        return ApiResponse.Message("Employee offboarded successfully");
    }

    // ---- bank details ----

    /// <summary>The caller's own bank accounts.</summary>
    [HttpGet("me/bank")]
    public async Task<ApiResponse<IReadOnlyList<BankView>>> MyBanks(CancellationToken ct) =>
        ApiResponse<IReadOnlyList<BankView>>.Ok(
            await _users.ListBanksAsync(_currentUser.RequireUserId(), ct));

    /// <summary>List a specific employee's bank accounts.</summary>
    [HttpGet("{id:long}/bank")]
    [Authorize(Policy = "PAYROLL_RUN,PAYROLL_VIEW,USER_MANAGE,EMPLOYEE_MANAGE")]
    public async Task<ApiResponse<IReadOnlyList<BankView>>> BanksOf(long id, CancellationToken ct) =>
        ApiResponse<IReadOnlyList<BankView>>.Ok(await _users.ListBanksAsync(id, ct));

    /// <summary>Add a bank account for the signed-in user.</summary>
    [HttpPost("me/bank")]
    public async Task<ApiResponse<BankResponse>> AddBank([FromBody] BankRequest request, CancellationToken ct) =>
        ApiResponse<BankResponse>.Ok(
            await _users.AddBankAsync(_currentUser.RequireUserId(), request, ct),
            "Bank account added");

    /// <summary>HR/Admin: add a bank account for a specific employee.</summary>
    [HttpPost("{id:long}/bank")]
    [Authorize(Policy = "USER_MANAGE,EMPLOYEE_MANAGE")]
    public async Task<ApiResponse<BankResponse>> AddBankForUser(
        long id, [FromBody] BankRequest request, CancellationToken ct) =>
        ApiResponse<BankResponse>.Ok(
            await _users.AddBankAsync(id, request, ct),
            "Bank account added");

    /// <summary>HR/Admin: update an employee's bank account.</summary>
    [HttpPut("{id:long}/bank/{bankId:long}")]
    [Authorize(Policy = "USER_MANAGE,EMPLOYEE_MANAGE")]
    public async Task<ApiResponse<BankResponse>> UpdateBankForUser(
        long id, long bankId, [FromBody] BankRequest request, CancellationToken ct) =>
        ApiResponse<BankResponse>.Ok(
            await _users.UpdateBankAsync(id, bankId, request, ct),
            "Bank account updated");

    /// <summary>Update the caller's bank account.</summary>
    [HttpPut("me/bank/{bankId:long}")]
    public async Task<ApiResponse<BankResponse>> UpdateMyBank(
        long bankId, [FromBody] BankRequest request, CancellationToken ct) =>
        ApiResponse<BankResponse>.Ok(
            await _users.UpdateBankAsync(_currentUser.RequireUserId(), bankId, request, ct),
            "Bank account updated");

    /// <summary>Delete the caller's bank account.</summary>
    [HttpDelete("me/bank/{bankId:long}")]
    public async Task<ApiResponse<object>> DeleteMyBank(long bankId, CancellationToken ct)
    {
        await _users.DeleteBankAsync(_currentUser.RequireUserId(), bankId, ct);
        return ApiResponse.Message("Bank account deleted");
    }

    /// <summary>Permanently remove an employee account.</summary>
    [HttpDelete("{id:long}")]
    [Authorize(Policy = "USER_MANAGE,EMPLOYEE_MANAGE+TECHNICAL_ADMIN")]
    public async Task<ApiResponse<object>> DeleteUser(
        long id, [FromBody] DeleteEmployeeRequest? body, CancellationToken ct)
    {
        await _users.DeleteEmployeeAsync(_currentUser.RequireUserId(), id, body?.ConfirmName, ct);
        return ApiResponse.Message("Employee deleted successfully");
    }

    /// <summary>HR/Admin: record an employee's face enrolment photo.</summary>
    [HttpPost("{id:long}/face-photo")]
    [Authorize(Policy = "USER_MANAGE,EMPLOYEE_MANAGE")]
    [Consumes("multipart/form-data")]
    public async Task<ApiResponse<FacePhotoResponse>> SaveFacePhoto(
        long id, IFormFile photo, CancellationToken ct)
    {
        if (photo is null || photo.Length == 0)
        {
            throw ApiException.Business("No photo was received.");
        }

        using var stream = photo.OpenReadStream();
        var result = await _users.SaveFacePhotoAsync(
            id, stream, photo.FileName, photo.ContentType, photo.Length, _currentUser.UserId, ct);
        return ApiResponse<FacePhotoResponse>.Ok(result, "Face registered");
    }

    /// <summary>HR/Admin: forget an employee's face enrolment photo.</summary>
    [HttpDelete("{id:long}/face-photo")]
    [Authorize(Policy = "USER_MANAGE,EMPLOYEE_MANAGE")]
    public async Task<ApiResponse<object>> ClearFacePhoto(long id, CancellationToken ct)
    {
        await _users.ClearFacePhotoAsync(id, ct);
        return ApiResponse.Message("Face registration removed");
    }

    /// <summary>HR/Admin: read an employee's current password.</summary>
    [HttpGet("{id:long}/password")]
    [Authorize(Policy = "USER_MANAGE,EMPLOYEE_MANAGE")]
    public async Task<ApiResponse<Dictionary<string, string?>>> CurrentPassword(long id, CancellationToken ct)
    {
        string? password = await _users.GetCurrentPasswordAsync(id, ct);
        return ApiResponse<Dictionary<string, string?>>.Ok(new() { ["password"] = password });
    }

    // ---- the read-only views ----

    /// <summary>The caller's team and its active members.</summary>
    [HttpGet("my-team")]
    public async Task<ApiResponse<MyTeamResponse>> MyTeam(CancellationToken ct) =>
        ApiResponse<MyTeamResponse>.Ok(await _users.MyTeamAsync(_currentUser.RequireUserId(), ct));
}
