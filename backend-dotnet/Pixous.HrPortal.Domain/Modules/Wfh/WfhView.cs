namespace Pixous.HrPortal.Domain.Modules.Wfh;

/// <summary>
/// One request, as every screen sees it.
/// Ported from com.pixous.hrportal.modules.wfh.dto.WfhDtos.WfhView.
///
/// Carries the names as well as the ids so a table needs no second lookup,
/// and canAct so a client never has to work out for itself whether the person
/// reading may decide it.
/// </summary>
public sealed record WfhView(
    long Id,
    long UserId,
    string EmployeeName,
    string? EmployeeCode,
    string? Team,
    string? Designation,
    string RoleLabel,
    DateOnly FromDate,
    DateOnly ToDate,
    decimal WorkingDays,
    string? Reason,
    string? Remarks,
    string Status,
    long? RequestedTo,
    string? RequestedToName,
    string? RequestedToRole,
    long? DecidedBy,
    string? DecidedByName,
    DateTime? DecidedAt,
    string? DecisionComment,
    DateTime? CreatedAt,
    bool CanAct,
    bool CanCancel
);
