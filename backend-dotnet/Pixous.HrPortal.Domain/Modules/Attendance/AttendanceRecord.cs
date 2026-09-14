namespace Pixous.HrPortal.Domain.Modules.Attendance;

/// <summary>
/// A row of the <c>attendance</c> table. One row per person per day: the punch
/// out updates the row the punch in created, rather than adding a second.
///
/// Mutable, because the punch flows read the row, change a few fields and write
/// it back, exactly as the JPA entity does.
/// </summary>
public sealed class AttendanceRecord
{
    public long Id { get; set; }
    public long UserId { get; set; }
    public DateOnly WorkDate { get; set; }

    /// <summary>
    /// Naive local times, as the column holds them. The Java side writes
    /// LocalDateTime.now() in Asia/Kolkata and every comparison in the module
    /// is against local time, so these must never be treated as UTC.
    /// </summary>
    public DateTime? PunchInAt { get; set; }
    public DateTime? PunchOutAt { get; set; }

    /// <summary>OFFICE | WFH | SITE | BIOMETRIC.</summary>
    public string? Mode { get; set; }

    /// <summary>PRESENT | WFH | and the rest the module writes.</summary>
    public string? Status { get; set; }

    public decimal? InLatitude { get; set; }
    public decimal? InLongitude { get; set; }
    public decimal? OutLatitude { get; set; }
    public decimal? OutLongitude { get; set; }

    public long? SiteId { get; set; }
    public long? ShiftId { get; set; }

    /// <summary>
    /// Nullable on purpose: a WFH punch sets it to null rather than false,
    /// because "not applicable" and "outside the fence" are different answers
    /// and the client renders them differently.
    /// </summary>
    public bool? WithinGeofence { get; set; }

    public bool GeofenceException { get; set; }

    public bool IsLate { get; set; }
    public int LateMinutes { get; set; }
    public int? WorkedMinutes { get; set; }
    public int? OvertimeMinutes { get; set; }

    public bool FaceVerified { get; set; }
    public string? FacePhotoPath { get; set; }
    public decimal? FaceScore { get; set; }
    public string? FaceDetail { get; set; }
    public bool OutFaceVerified { get; set; }
    public string? OutFacePhotoPath { get; set; }
    public decimal? OutFaceScore { get; set; }
    public string? OutFaceDetail { get; set; }

    public int? InAccuracyM { get; set; }
    public int? OutAccuracyM { get; set; }
    public string? InDevice { get; set; }
    public string? OutDevice { get; set; }

    /// <summary>FACE | FINGERPRINT | FACE_FINGERPRINT, or null for a non-terminal punch.</summary>
    public string? InAuthMethod { get; set; }
    public string? OutAuthMethod { get; set; }

    /// <summary>The terminal's own name for where it stands.</summary>
    public string? InAreaName { get; set; }
    public string? OutAreaName { get; set; }

    public long? CompanyId { get; set; }
}
