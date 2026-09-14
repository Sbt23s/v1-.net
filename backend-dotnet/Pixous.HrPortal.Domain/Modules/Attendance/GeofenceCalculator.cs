namespace Pixous.HrPortal.Domain.Modules.Attendance;

/// <summary>
/// Haversine distance + geofence containment used for GPS attendance validation.
/// Ported from com.pixous.hrportal.modules.attendance.GeofenceService.
///
/// Static and dependency-free, so the rule that decides whether somebody was at
/// work can be tested without a database.
/// </summary>
public static class GeofenceCalculator
{
    private const double EarthRadiusMetres = 6_371_000.0;

    /// <summary>Great-circle distance between two lat/lng points, in metres.</summary>
    public static double DistanceMetres(double lat1, double lng1, double lat2, double lng2)
    {
        double dLat = DegreesToRadians(lat2 - lat1);
        double dLng = DegreesToRadians(lng2 - lng1);
        double a = Math.Sin(dLat / 2) * Math.Sin(dLat / 2)
                 + Math.Cos(DegreesToRadians(lat1)) * Math.Cos(DegreesToRadians(lat2))
                 * Math.Sin(dLng / 2) * Math.Sin(dLng / 2);
        double c = 2 * Math.Atan2(Math.Sqrt(a), Math.Sqrt(1 - a));
        return EarthRadiusMetres * c;
    }

    /// <summary>
    /// Whether the punch fell inside the circle. A missing coordinate on either
    /// side is false rather than an error: a device that sent no fix has not
    /// proved it was anywhere.
    ///
    /// The comparison is inclusive -- a punch exactly on the boundary is inside.
    /// </summary>
    public static bool IsWithin(decimal? punchLat, decimal? punchLng,
                                decimal? centreLat, decimal? centreLng,
                                int radiusMetres)
    {
        if (punchLat is null || punchLng is null || centreLat is null || centreLng is null)
        {
            return false;
        }

        double distance = DistanceMetres(
            (double)punchLat.Value, (double)punchLng.Value,
            (double)centreLat.Value, (double)centreLng.Value);

        return distance <= radiusMetres;
    }

    /// <summary>Java's Math.toRadians, which .NET has no direct equivalent of.</summary>
    private static double DegreesToRadians(double degrees) => degrees * Math.PI / 180.0;
}
