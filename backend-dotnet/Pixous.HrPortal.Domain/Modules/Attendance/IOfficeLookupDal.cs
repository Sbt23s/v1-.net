namespace Pixous.HrPortal.Domain.Modules.Attendance;

/// <summary>
/// The places a punch can be measured against, and the two columns on the user
/// that say which place is theirs by default.
///
/// Separate from <see cref="IAttendanceDal"/> because these are lookups against
/// other modules' tables (sites, office_locations, users) rather than access to
/// the attendance table itself.
/// </summary>
public interface IOfficeLookupDal
{
    Task<GeoPlace?> FindSiteAsync(long siteId, CancellationToken ct = default);

    Task<GeoPlace?> FindOfficeLocationAsync(long officeLocationId, CancellationToken ct = default);

    /// <summary>
    /// The site and office this person belongs to, used when the punch does not
    /// name one. Null when the user does not exist, which the punch flow reports
    /// as a missing user rather than a missing place.
    /// </summary>
    Task<UserPlacement?> FindUserPlacementAsync(long userId, CancellationToken ct = default);

    /// <summary>
    /// Ids of every current employee: enabled, and not OFFBOARDED.
    /// Offboarded and disabled accounts are excluded from every team view.
    /// </summary>
    Task<IReadOnlyList<long>> FindCurrentEmployeeIdsAsync(CancellationToken ct = default);

    /// <summary>
    /// Ids of current employees sharing this designation title, compared
    /// case-insensitively and ignoring surrounding space -- which is how a Team
    /// Leader's "team" is defined here. Not by a reporting line.
    /// </summary>
    Task<IReadOnlyList<long>> FindCurrentEmployeeIdsByDesignationAsync(
        string? designationTitle, CancellationToken ct = default);

    /// <summary>Ids of current employees who report to this person.</summary>
    Task<IReadOnlyList<long>> FindCurrentEmployeeIdsByManagerAsync(
        long managerId, CancellationToken ct = default);

    /// <summary>The caller's own role codes and designation title, for the team rules.</summary>
    Task<ViewerProfile?> FindViewerProfileAsync(long userId, CancellationToken ct = default);
}

/// <summary>What the team-visibility rules need to know about the caller.</summary>
public sealed class ViewerProfile
{
    public long Id { get; set; }
    public string? DesignationTitle { get; set; }
    public IReadOnlyList<string> RoleCodes { get; set; } = [];
}

/// <summary>
/// A geofenced place: an office or a site. Both tables carry the same three
/// columns, so one type serves for both.
/// </summary>
public sealed class GeoPlace
{
    public long Id { get; set; }
    public string? Name { get; set; }
    public decimal? Latitude { get; set; }
    public decimal? Longitude { get; set; }

    /// <summary>
    /// Null means "use the configured default radius" rather than "no fence" --
    /// the punch flow substitutes App:Attendance:DefaultGeofenceRadiusMetres.
    /// </summary>
    public int? GeofenceRadiusMetres { get; set; }
}

/// <summary>Where a person is expected to be, when the punch does not say.</summary>
public sealed class UserPlacement
{
    public long Id { get; set; }
    public long? SiteId { get; set; }
    public long? OfficeLocationId { get; set; }
}
