using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Pixous.HrPortal.Domain.Common;
using Pixous.HrPortal.Domain.Modules.Auth;
using Pixous.HrPortal.Domain.Modules.Auth.Dto;
using Pixous.HrPortal.Domain.Security;

namespace Pixous.HrPortal.Api.Controllers;

/// <summary>
/// Authentication endpoints, ported from
/// com.pixous.hrportal.modules.auth.AuthController.
///
/// The whole of /api/auth/** is permitAll in the Spring filter chain, so every
/// action here is reachable without a token and the ones that need a signed-in
/// user get it from ICurrentUser.RequireUserId(), which throws
/// ApiException(UNAUTHENTICATED) -- a 401 in the ApiResponse ENVELOPE rather
/// than the container's error shape. That distinction is deliberate and is
/// reproduced here: a challenge the pipeline raises looks different from an
/// exception a handler raises, and the Java behaviour is the latter for these.
/// </summary>
[ApiController]
[Route("api/auth")]
[AllowAnonymous]
public sealed class AuthController : ControllerBase
{
    private readonly IAuthBal _auth;
    private readonly ICurrentUser _currentUser;

    public AuthController(IAuthBal auth, ICurrentUser currentUser)
    {
        _auth = auth;
        _currentUser = currentUser;
    }

    [HttpPost("login")]
    public async Task<ApiResponse<LoginResponse>> Login([FromBody] LoginRequest request,
                                                        CancellationToken ct)
    {
        LoginResponse result = await _auth.LoginAsync(request, ClientIp(), UserAgent(), ct);
        return ApiResponse<LoginResponse>.Ok(result);
    }

    [HttpPost("refresh")]
    public async Task<ApiResponse<TokenPair>> Refresh([FromBody] RefreshRequest request,
                                                      CancellationToken ct) =>
        ApiResponse<TokenPair>.Ok(await _auth.RefreshAsync(request, ct));

    [HttpGet("me")]
    public async Task<ApiResponse<AuthUser>> Me(CancellationToken ct) =>
        ApiResponse<AuthUser>.Ok(await _auth.CurrentUserAsync(_currentUser.RequireUserId(), ct));

    [HttpPost("logout")]
    public async Task<ApiResponse<object>> Logout(CancellationToken ct)
    {
        await _auth.LogoutAsync(_currentUser.RequireUserId(), ct);
        return ApiResponse.Message("Logged out");
    }

    [HttpPost("change-password")]
    public async Task<ApiResponse<object>> ChangePassword([FromBody] ChangePasswordRequest request,
                                                          CancellationToken ct)
    {
        await _auth.ChangePasswordAsync(_currentUser.RequireUserId(), request, ct);
        return ApiResponse.Message("Password updated");
    }

    /// <summary>
    /// Answers {"exists": true|false} -- a one-key object rather than a bare
    /// boolean, which is what Java's Map.of("exists", ..) serialises to and what
    /// the signup form reads.
    /// </summary>
    [HttpGet("check-username")]
    public async Task<ApiResponse<Dictionary<string, bool>>> CheckUsername(
        [FromQuery] string username, CancellationToken ct)
    {
        bool exists = await _auth.UsernameExistsAsync(username, ct);
        return ApiResponse<Dictionary<string, bool>>.Ok(new() { ["exists"] = exists });
    }

    [HttpPost("validate-phone")]
    public async Task<ApiResponse<Dictionary<string, bool>>> ValidatePhone(
        [FromBody] PhoneValidateRequest request, CancellationToken ct)
    {
        bool exists = await _auth.PhoneExistsAsync(request.Phone, ct);
        return ApiResponse<Dictionary<string, bool>>.Ok(new() { ["exists"] = exists });
    }

    [HttpPost("signup")]
    public async Task<ActionResult<ApiResponse<LoginResponse>>> Signup(
        [FromBody] SignupRequest request, CancellationToken ct)
    {
        RequireManagePermission();
        LoginResponse result = await _auth.SignupAsync(request, ct);
        return StatusCode(201, ApiResponse<LoginResponse>.Ok(result, "Account created"));
    }

    [HttpPost("employees")]
    public async Task<ActionResult<ApiResponse<AuthUser>>> CreateEmployee(
        [FromBody] CreateEmployeeRequest request, CancellationToken ct)
    {
        RequireManagePermission();
        AuthUser result = await _auth.CreateEmployeeAsync(request, ct);
        return StatusCode(201, ApiResponse<AuthUser>.Ok(result, "Employee account created"));
    }

    [HttpPost("employees/bulk")]
    public async Task<ApiResponse<IReadOnlyList<BulkEmployeeResult>>> CreateEmployeesBulk(
        [FromBody] IReadOnlyList<CreateEmployeeRequest> requests,
        [FromQuery] string? fileName,
        CancellationToken ct)
    {
        RequireManagePermission();
        var results = await _auth.CreateEmployeesBulkAsync(requests, fileName, _currentUser.UserId, ct);
        int ok = results.Count(r => r.Created);
        return ApiResponse<IReadOnlyList<BulkEmployeeResult>>.Ok(results, $"{ok} of {results.Count} employees created");
    }

    [HttpGet("employees/imports")]
    public async Task<ApiResponse<IReadOnlyList<Dictionary<string, object?>>>> ListImports(CancellationToken ct)
    {
        RequireManagePermission();
        var imports = await _auth.ListImportsAsync(ct);
        return ApiResponse<IReadOnlyList<Dictionary<string, object?>>>.Ok(imports);
    }

    [HttpPost("employees/imports/adopt")]
    public async Task<ApiResponse<Dictionary<string, object?>>> AdoptImport(
        [FromQuery] string? fileName,
        [FromBody] IReadOnlyList<string>? identifiers,
        CancellationToken ct)
    {
        RequireManagePermission();
        var result = await _auth.AdoptImportAsync(fileName, identifiers, _currentUser.UserId, ct);
        return ApiResponse<Dictionary<string, object?>>.Ok(result, $"{result["linkedCount"]} employee(s) matched to this sheet");
    }

    [HttpGet("employees/imports/{id:long}/preview")]
    public async Task<ApiResponse<Dictionary<string, object?>>> PreviewImport(
        long id, CancellationToken ct)
    {
        RequireManagePermission();
        var result = await _auth.PreviewImportAsync(id, ct);
        return ApiResponse<Dictionary<string, object?>>.Ok(result);
    }

    [HttpDelete("employees/imports/{id:long}")]
    public async Task<ApiResponse<Dictionary<string, object?>>> RevertImport(
        long id, CancellationToken ct)
    {
        RequireManagePermission();
        var result = await _auth.RevertImportAsync(id, _currentUser.UserId, ct);
        return ApiResponse<Dictionary<string, object?>>.Ok(result, $"{result["removedCount"]} account(s) removed");
    }

    [HttpDelete("employees/imports/{id:long}/record")]
    public async Task<ApiResponse<object>> ForgetImport(long id, CancellationToken ct)
    {
        RequireManagePermission();
        await _auth.ForgetImportAsync(id, ct);
        return ApiResponse.Message("Import record removed");
    }

    private void RequireManagePermission()
    {
        if (!_currentUser.HasAnyPermission("USER_MANAGE", "EMPLOYEE_MANAGE") &&
            !_currentUser.IsInRole("TECHNICAL_ADMIN") &&
            !_currentUser.IsInRole("ADMIN"))
        {
            throw ApiException.Forbidden("Access denied: requires USER_MANAGE or EMPLOYEE_MANAGE permission");
        }
    }


    /// <summary>
    /// The caller's address for the audit row.
    ///
    /// X-Forwarded-For is honoured because the portal runs behind nginx and IIS,
    /// where the socket address is the proxy's rather than the client's. The
    /// first entry of that header is the original client; the rest are the
    /// proxies it passed through.
    /// </summary>
    private string? ClientIp()
    {
        string? forwarded = Request.Headers["X-Forwarded-For"].FirstOrDefault();
        if (!string.IsNullOrWhiteSpace(forwarded))
        {
            return forwarded.Split(',')[0].Trim();
        }
        return HttpContext.Connection.RemoteIpAddress?.ToString();
    }

    private string? UserAgent() => Request.Headers.UserAgent.FirstOrDefault();
}
