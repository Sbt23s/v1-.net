using Dapper;
using Pixous.HrPortal.Domain.Modules.Attendance;
using Pixous.HrPortal.Infrastructure.Persistence;

namespace Pixous.HrPortal.Infrastructure.Modules.Attendance;

/// <summary>
/// Lookups for the places a punch is measured against. Read-only: nothing in
/// the punch flow writes to sites, office_locations or users.
/// </summary>
public sealed class OfficeLookupDal : DalBase, IOfficeLookupDal
{
    public OfficeLookupDal(IDbConnectionFactory connectionFactory) : base(connectionFactory) { }

    /// <summary>
    /// Both place tables carry the same columns, so one projection serves for
    /// each. The table name is interpolated, and the only two callers pass
    /// constants -- no caller-supplied value reaches this string.
    /// </summary>
    private const string PlaceColumns = """
        id                     AS Id,
        name                   AS Name,
        latitude               AS Latitude,
        longitude              AS Longitude,
        geofence_radius_metres AS GeofenceRadiusMetres
        """;

    public Task<GeoPlace?> FindSiteAsync(long siteId, CancellationToken ct = default) =>
        QueryAsync(conn => conn.QueryFirstOrDefaultAsync<GeoPlace>(
            new CommandDefinition(
                $"SELECT {PlaceColumns} FROM sites WHERE id = @id",
                new { id = siteId }, cancellationToken: ct)), ct);

    public Task<GeoPlace?> FindOfficeLocationAsync(long officeLocationId, CancellationToken ct = default) =>
        QueryAsync(conn => conn.QueryFirstOrDefaultAsync<GeoPlace>(
            new CommandDefinition(
                $"SELECT {PlaceColumns} FROM office_locations WHERE id = @id",
                new { id = officeLocationId }, cancellationToken: ct)), ct);

    public Task<UserPlacement?> FindUserPlacementAsync(long userId, CancellationToken ct = default) =>
        QueryAsync(conn => conn.QueryFirstOrDefaultAsync<UserPlacement>(
            new CommandDefinition("""
                SELECT id AS Id,
                       site_id AS SiteId,
                       office_location_id AS OfficeLocationId
                FROM users
                WHERE id = @userId
                """,
                new { userId }, cancellationToken: ct)), ct);

    /// <summary>
    /// Active or onboarding employees only -- offboarded and disabled are
    /// excluded from every team view.
    ///
    /// The Java side loads every user and filters in memory; this asks the
    /// database for the ids instead. Same set, and it does not pull sixty-five
    /// wide rows across the wire to read one column off each.
    /// </summary>
    private const string CurrentEmployeeFilter = """
        enabled = 1
        AND (profile_status IS NULL OR UPPER(profile_status) <> 'OFFBOARDED')
        """;

    public async Task<IReadOnlyList<long>> FindCurrentEmployeeIdsAsync(CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<long>(
            new CommandDefinition(
                $"SELECT id FROM users WHERE {CurrentEmployeeFilter}",
                cancellationToken: ct)), ct)).AsList();

    /// <summary>
    /// A Team Leader's team is everyone sharing their designation title, compared
    /// case-insensitively and ignoring surrounding space.
    ///
    /// A caller with no title of their own would otherwise match every employee
    /// whose title is also blank, so that case returns nobody instead -- the Java
    /// comparison uses "" and would gather exactly those rows, which is not a
    /// team.
    /// </summary>
    public async Task<IReadOnlyList<long>> FindCurrentEmployeeIdsByDesignationAsync(
        string? designationTitle, CancellationToken ct = default)
    {
        string title = designationTitle?.Trim() ?? string.Empty;
        if (title.Length == 0)
        {
            return [];
        }

        return (await QueryAsync(conn => conn.QueryAsync<long>(
            new CommandDefinition(
                $"""
                 SELECT id FROM users
                 WHERE {CurrentEmployeeFilter}
                   AND designation_title IS NOT NULL
                   AND UPPER(TRIM(designation_title)) = UPPER(@title)
                 """,
                new { title }, cancellationToken: ct)), ct)).AsList();
    }

    public async Task<IReadOnlyList<long>> FindCurrentEmployeeIdsByManagerAsync(
        long managerId, CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<long>(
            new CommandDefinition(
                $"""
                 SELECT id FROM users
                 WHERE {CurrentEmployeeFilter}
                   AND reporting_manager_id = @managerId
                 """,
                new { managerId }, cancellationToken: ct)), ct)).AsList();

    public async Task<ViewerProfile?> FindViewerProfileAsync(long userId, CancellationToken ct = default)
    {
        ViewerProfile? viewer = await QueryAsync(conn => conn.QueryFirstOrDefaultAsync<ViewerProfile>(
            new CommandDefinition(
                "SELECT id AS Id, designation_title AS DesignationTitle FROM users WHERE id = @userId",
                new { userId }, cancellationToken: ct)), ct);

        if (viewer is null)
        {
            return null;
        }

        viewer.RoleCodes = (await QueryAsync(conn => conn.QueryAsync<string>(
            new CommandDefinition("""
                SELECT r.code
                FROM user_roles ur
                JOIN roles r ON r.id = ur.role_id
                WHERE ur.user_id = @userId
                """,
                new { userId }, cancellationToken: ct)), ct)).AsList();

        return viewer;
    }
}
