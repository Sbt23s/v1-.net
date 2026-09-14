using Pixous.HrPortal.Domain.Modules.Auth.Dto;

namespace Pixous.HrPortal.Domain.Modules.Auth;

/// <summary>
/// Authentication flows: login (with lockout), token refresh, logout,
/// password change, and the two existence checks the signup form calls.
///
/// Ported from com.pixous.hrportal.modules.auth.AuthService. Signup, the
/// create-employee flows and the bulk import land here as Phase 2 continues.
/// </summary>
public interface IAuthBal
{
    Task<LoginResponse> LoginAsync(LoginRequest request, string? ip, string? userAgent,
                                   CancellationToken ct = default);

    Task<TokenPair> RefreshAsync(RefreshRequest request, CancellationToken ct = default);

    Task LogoutAsync(long userId, CancellationToken ct = default);

    Task ChangePasswordAsync(long userId, ChangePasswordRequest request, CancellationToken ct = default);

    /// <summary>The signed-in user with roles and permissions.</summary>
    Task<AuthUser> CurrentUserAsync(long userId, CancellationToken ct = default);

    Task<bool> PhoneExistsAsync(string? phone, CancellationToken ct = default);

    Task<bool> UsernameExistsAsync(string? username, CancellationToken ct = default);

    Task<LoginResponse> SignupAsync(SignupRequest req, CancellationToken ct = default);

    Task<AuthUser> CreateEmployeeAsync(CreateEmployeeRequest req, CancellationToken ct = default);

    Task<IReadOnlyList<BulkEmployeeResult>> CreateEmployeesBulkAsync(
        IReadOnlyList<CreateEmployeeRequest> requests, string? fileName, long? actorId, CancellationToken ct = default);

    Task<IReadOnlyList<Dictionary<string, object?>>> ListImportsAsync(CancellationToken ct = default);

    Task<Dictionary<string, object?>> AdoptImportAsync(
        string? fileName, IReadOnlyList<string>? identifiers, long? actorId, CancellationToken ct = default);

    Task<Dictionary<string, object?>> PreviewImportAsync(long batchId, CancellationToken ct = default);

    Task<Dictionary<string, object?>> RevertImportAsync(long batchId, long? actorId, CancellationToken ct = default);

    Task ForgetImportAsync(long batchId, CancellationToken ct = default);
}

