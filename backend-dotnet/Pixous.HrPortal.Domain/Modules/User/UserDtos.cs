using System.ComponentModel.DataAnnotations;

namespace Pixous.HrPortal.Domain.Modules.User;

public sealed record AddressDto(
    string? CareOf,
    string? House,
    string? Street,
    string? Locality,
    string? Vtc,
    string? District,
    string? State,
    string? Country,
    string? Pincode,
    string? PostOffice
);

public sealed record ProfileResponse(
    long Id,
    string? EmployeeCode,
    string? Username,
    string? Name,
    DateOnly? Dob,
    string? Gender,
    string? Aadhar,
    string? Phone,
    string? Email,
    string? PhotoPath,
    string? CoverPhotoPath,
    AddressDto? Address,
    long? DepartmentId,
    long? DesignationId,
    long? OfficeLocationId,
    long? ReportingManagerId,
    string? Industry,
    string? EmploymentType,
    DateOnly? DateOfJoining,
    DateOnly? ProbationEndDate,
    string? ProfileStatus,
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
    IReadOnlyList<string> Roles,
    IReadOnlyList<string> Permissions,
    string? Documents,
    string? FacePhotoPath,
    DateTime? FaceRegisteredAt,
    string? FaceRegisteredByName
);

public sealed record UpdateProfileRequest(
    [property: MaxLength(150)] string? Name,
    string? Dob,
    string? Gender,
    [property: EmailAddress] string? Email,
    string? CareOf,
    string? House,
    string? Street,
    string? Locality,
    string? Vtc,
    string? District,
    string? State,
    string? Country,
    string? Pincode,
    string? PostOffice
);

public sealed record UpdateEmployeeRequest(
    [property: MaxLength(150)] string? Name,
    string? Dob,
    string? Gender,
    [property: EmailAddress] string? Email,
    string? Phone,
    string? Aadhar,
    string? Pan,
    string? PfNumber,
    string? AlternatePhone,
    string? EmergencyContact,
    string? EmergencyContactRelation,
    string? BloodGroup,
    string? PersonalEmail,
    string? DesignationTitle,
    string? TechStack,
    string? DepartmentTitle,
    string? PositionTitle,
    string? CareOf,
    string? House,
    string? Street,
    string? Locality,
    string? Vtc,
    string? District,
    string? State,
    string? Country,
    string? Pincode,
    string? PostOffice,
    string? Industry,
    long? DepartmentId,
    long? DesignationId,
    long? OfficeLocationId,
    long? ReportingManagerId,
    string? EmploymentType,
    string? DateOfJoining,
    string? ProbationEndDate,
    string? ProfileStatus,
    string? EmployeeCode,
    IReadOnlyList<string>? Roles,
    string? Documents
);

public sealed record BankRequest(
    [property: Required] string BankName,
    string? BranchName,
    [property: Required, RegularExpression(@"^\d{6,20}$", ErrorMessage = "Invalid account number")] string AccountNumber,
    [property: Required, RegularExpression(@"^[A-Z]{4}0[A-Z0-9]{6}$", ErrorMessage = "Invalid IFSC code")] string IfscCode,
    [property: Required] string AccountHolderName,
    bool? Primary
);

public sealed record BankResponse(
    long Id,
    string? BankName,
    string? BranchName,
    string? AccountNumber,
    string? IfscCode,
    string? AccountHolderName,
    bool Primary
);

public sealed record OffboardingRequest(
    DateOnly? RelievingDate,
    string? Reason,
    string? Notes
);

public sealed record DeleteEmployeeRequest(
    string? ConfirmName
);

public sealed record SetCredentialsRequest(
    string? Username,
    string? Password
);

public sealed record AssignTeamRequest(
    string? TeamTitle
);

public sealed record FacePhotoResponse(
    string? FacePhotoPath,
    DateTime? FaceRegisteredAt,
    string? FaceRegisteredBy
);

public sealed record PasswordResponse(
    string? Password
);
