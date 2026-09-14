using System.ComponentModel.DataAnnotations;

namespace Pixous.HrPortal.Domain.Modules.Auth.Dto;

/// <summary>
/// Login by username + password.
/// Ported from com.pixous.hrportal.modules.auth.dto.LoginRequest.
///
/// The validation messages are the strings the Java @NotBlank annotations
/// carry, and they reach the client verbatim under "errors" -- confirmed
/// against the running Java backend:
///   POST /api/auth/login {}  ->  400
///   {"success":false,"message":"Validation failed",
///    "errors":{"password":"Password is required",
///              "username":"Username is required"}}
/// </summary>
public sealed record LoginRequest(
    [Required(AllowEmptyStrings = false, ErrorMessage = "Username is required")]
    string? Username,

    [Required(AllowEmptyStrings = false, ErrorMessage = "Password is required")]
    string? Password);

/// <summary>Access + refresh tokens returned on successful auth / refresh.</summary>
public sealed record TokenPair(
    string AccessToken,
    string RefreshToken,
    string TokenType,
    long ExpiresIn);

/// <summary>Auth result: tokens plus a compact view of the signed-in user for the client.</summary>
public sealed record LoginResponse(
    TokenPair Tokens,
    AuthUser User);

/// <summary>
/// The signed-in user as the client sees it. Field order matches the Java
/// record's component order.
///
/// Note that <paramref name="CompanyName"/> is the company's NAME resolved from
/// company_id, and falls back to the literal "Company" when the id is null or
/// names no row -- not to null, and not to an error.
/// </summary>
public sealed record AuthUser(
    long Id,
    string? EmployeeCode,
    string Username,
    string? Name,
    string? Aadhar,
    string? Email,
    string? Phone,
    string? Industry,
    string? PhotoPath,
    string CompanyName,
    IReadOnlyList<string> Roles,
    IReadOnlyList<string> Permissions);

/// <summary>Exchange a refresh token for a new access token.</summary>
public sealed record RefreshRequest(
    [Required(AllowEmptyStrings = false, ErrorMessage = "Refresh token is required")]
    string? RefreshToken);

/// <summary>Change the current user's password.</summary>
public sealed record ChangePasswordRequest(
    [Required(AllowEmptyStrings = false, ErrorMessage = "Current password is required")]
    string? OldPassword,

    [Required(AllowEmptyStrings = false, ErrorMessage = "New password is required")]
    string? NewPassword);

/// <summary>Check whether a phone number is already registered.</summary>
public sealed record PhoneValidateRequest(
    [Required(AllowEmptyStrings = false, ErrorMessage = "Phone is required")]
    string? Phone);

/// <summary>Self-signup or admin employee registration request.</summary>
public sealed record SignupRequest(
    [Required(AllowEmptyStrings = false, ErrorMessage = "Username is required")]
    string Username,
    [Required(AllowEmptyStrings = false, ErrorMessage = "Name is required")]
    string Name,
    string? Dob,
    string? Gender,
    string? Aadhar,
    string? Phone,
    string? Email,
    [Required(AllowEmptyStrings = false, ErrorMessage = "Password is required")]
    string Password,
    string? CareOf, string? House, string? Street, string? Locality, string? Vtc,
    string? District, string? State, string? Country, string? Pincode, string? PostOffice,
    string? Industry,
    long? DepartmentId,
    long? DesignationId,
    long? OfficeLocationId);

/// <summary>Admin / HR single employee creation request.</summary>
public sealed record CreateEmployeeRequest(
    [Required(AllowEmptyStrings = false, ErrorMessage = "Username is required")]
    string Username,
    [Required(AllowEmptyStrings = false, ErrorMessage = "Password is required")]
    string Password,
    [Required(AllowEmptyStrings = false, ErrorMessage = "Name is required")]
    string Name,
    string? EmployeeCode,
    string? Dob,
    string? Gender,
    string? Aadhar,
    string? Phone,
    string? Email,
    string? CareOf, string? House, string? Street, string? Locality, string? Vtc,
    string? District, string? State, string? Country, string? Pincode, string? PostOffice,
    string? Industry,
    string? RoleCode,
    string? DateOfJoining,
    string? CompanyId,
    long? DepartmentId,
    long? DesignationId,
    long? OfficeLocationId,
    long? ReportingManagerId,
    string? Pan,
    string? PfNumber,
    string? AlternatePhone,
    string? EmergencyContact,
    string? EmergencyContactRelation,
    string? BloodGroup,
    string? PersonalEmail,
    string? DesignationTitle,
    string? DepartmentTitle,
    string? PositionTitle,
    string? ProfileStatus,
    string? Documents);

/// <summary>Result of one item in a bulk creation batch.</summary>
public sealed record BulkEmployeeResult(
    string? Username,
    string? Name,
    bool Created,
    string? Error);

