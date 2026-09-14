namespace Pixous.HrPortal.Domain.Modules.Attendance.Dto;

/// <summary>
/// Punch-in / punch-out payload. Latitude/longitude come from the browser or
/// mobile GPS; <c>Mode</c> = OFFICE | WFH | SITE | BIOMETRIC.
///
/// Every member is optional because the controller accepts a body that is
/// absent altogether -- the Java signature is
/// @RequestBody(required = false) PunchRequest, and a punch from a desk with no
/// location permission sends nothing at all.
/// </summary>
public sealed record PunchRequest(
    decimal? Latitude,
    decimal? Longitude,
    string? Mode,
    long? SiteId,
    long? OfficeLocationId,
    long? ShiftId);

/// <summary>
/// One attendance row as the client sees it. Ported field for field from
/// com.pixous.hrportal.modules.attendance.dto.AttendanceResponse, in the same
/// order, because the record's component order is the JSON order.
/// </summary>
public sealed record AttendanceResponse(
    long Id,
    long UserId,
    DateOnly WorkDate,
    DateTime? PunchInAt,
    DateTime? PunchOutAt,
    string? Mode,
    string? Status,
    bool Late,

    /// <summary>How many minutes past the office start this punch was.</summary>
    int LateMinutes,

    bool? WithinGeofence,
    bool GeofenceException,
    int? WorkedMinutes,
    int? OvertimeMinutes,
    decimal? InLatitude,
    decimal? InLongitude,
    decimal? OutLatitude,
    decimal? OutLongitude,

    /// <summary>
    /// Where the punch was made, named.
    ///
    /// Coordinates are true and unreadable: nobody looking at a timesheet can
    /// tell whether 12.97610, 80.22140 is the office. These are the same numbers
    /// matched against the offices and sites on record -- so a punch inside one
    /// carries its name, and a punch outside every one of them says so, with how
    /// far from the nearest it was.
    /// </summary>
    string? InLocationName,
    string? OutLocationName,

    /// <summary>Metres from the nearest known office or site, when outside all of them.</summary>
    int? InDistanceMetres,

    /// <summary>How accurate the device said its own fix was.</summary>
    int? InAccuracyMetres,

    /// <summary>
    /// The face check. The selfie is what makes a punch answerable for months
    /// later, so it travels with the row rather than needing a second call.
    /// </summary>
    bool FaceVerified,
    string? FacePhotoPath,
    decimal? FaceScore,
    bool OutFaceVerified,
    string? OutFacePhotoPath,
    string? InDevice,

    /// <summary>The browser or terminal the punch-out was made from.</summary>
    string? OutDevice,

    /// <summary>
    /// How the punch was made: FACE, FINGERPRINT, FACE_FINGERPRINT, or null for
    /// a punch that did not come from a biometric terminal.
    ///
    /// The distinction people actually ask about. A punch from the app is
    /// somebody saying they arrived; a punch at the terminal is the terminal
    /// recognising their face, and a timesheet that shows them identically
    /// cannot answer "did they really come in".
    /// </summary>
    string? InAuthMethod,
    string? OutAuthMethod,

    /// <summary>
    /// Where the terminal stands, as Hikvision names it -- "Main Gate",
    /// "Second Floor Entry".
    ///
    /// Separate from <c>InLocationName</c>, which is derived from GPS by
    /// matching coordinates against the offices on record. A wall-mounted
    /// terminal sends no coordinates, so that field is empty for these punches
    /// however real the location is; the area is the location, and it is a
    /// better one -- a named door rather than a point that happens to fall
    /// inside a radius.
    /// </summary>
    string? InAreaName,
    string? OutAreaName);
