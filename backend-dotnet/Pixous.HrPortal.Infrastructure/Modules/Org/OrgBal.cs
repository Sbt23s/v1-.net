using Dapper;
using Pixous.HrPortal.Domain.Common;
using Pixous.HrPortal.Domain.Modules.Notification;
using Pixous.HrPortal.Domain.Modules.Org;
using Pixous.HrPortal.Domain.Security;
using Pixous.HrPortal.Infrastructure.Persistence;

namespace Pixous.HrPortal.Infrastructure.Modules.Org;

/// <summary>
/// Organisation master data, ported from
/// com.pixous.hrportal.modules.org.OrgService.
/// </summary>
public sealed class OrgBal : DalBase, IOrgBal
{
    private readonly INotificationBal _notifications;
    private readonly ICurrentUser _currentUser;

    public OrgBal(
        IDbConnectionFactory connectionFactory,
        INotificationBal notifications,
        ICurrentUser currentUser) : base(connectionFactory)
    {
        _notifications = notifications;
        _currentUser = currentUser;
    }

    /// <summary>
    /// The table and ordering behind each dropdown type.
    ///
    /// Designation is absent because it is the one type that filters on industry
    /// and is handled separately below.
    /// </summary>
    private static readonly Dictionary<string, string> SimpleDropdowns = new()
    {
        ["blood_group"] = "blood_groups",
        ["department"] = "departments",
        ["employment_status"] = "employment_statuses",
        ["position"] = "positions",
        ["office_location"] = "office_locations",
        ["shift"] = "shifts",
        ["site"] = "sites"
    };

    /// <summary>
    /// Lower-cased, trimmed, hyphens folded to underscores — so "Office-Location",
    /// "office_location" and " OFFICE-LOCATION " are one type. The legacy PHP API
    /// used hyphens and the current client uses underscores.
    /// </summary>
    public static string Normalize(string? type) =>
        type is null ? string.Empty : type.Trim().ToLowerInvariant().Replace('-', '_');

    /// <summary>
    /// Canonicalises an industry filter to the codes stored in the database.
    /// Accepts the UI labels too ("DIGITAL"/"INFRA"). Null or blank means no
    /// filter, so every active designation is returned.
    /// </summary>
    private static string? NormalizeIndustry(string? industry)
    {
        if (string.IsNullOrWhiteSpace(industry))
        {
            return null;
        }

        string v = industry.Trim().ToUpperInvariant();
        return v switch
        {
            "CIVIL" or "INFRA" => "CIVIL",
            "IT" or "DIGITAL" => "IT",
            _ => v
        };
    }

    public async Task<IReadOnlyList<DropdownItem>> DropdownAsync(string? type, string? industry,
                                                                 CancellationToken ct = default)
    {
        string key = Normalize(type);

        if (key == "designation")
        {
            string? ind = NormalizeIndustry(industry);

            // An exact match on industry, or no filter at all when none is
            // given. Deliberately NOT widened to include industry = 'BOTH':
            // DesignationRepository.findActiveByIndustry is
            //
            //     WHERE d.active = true AND (:industry IS NULL OR d.industry = :industry)
            //
            // and nothing else. A 'BOTH' row would be excluded by an IT filter
            // there, so it is excluded here. Roles carry a BOTH industry and
            // designations may look like they should too, but adding that clause
            // would change which designations appear on the employee form.
            return (await QueryAsync(conn => conn.QueryAsync<DropdownItem>(
                new CommandDefinition("""
                    SELECT id AS Id, name AS Name
                    FROM designations
                    WHERE active = 1
                      AND (@ind IS NULL OR industry = @ind)
                    ORDER BY name
                    """,
                    new { ind }, cancellationToken: ct)), ct)).AsList();
        }

        if (!SimpleDropdowns.TryGetValue(key, out string? table))
        {
            // An unknown type is a business error, not an empty list. A form
            // asking for a list that does not exist has a bug, and [] hides it.
            throw ApiException.Business($"Unknown dropdown type: {type}");
        }

        // The table name comes from the dictionary above, which holds constants
        // -- the caller's string selects a key, it never reaches the SQL.
        return (await QueryAsync(conn => conn.QueryAsync<DropdownItem>(
            new CommandDefinition(
                $"SELECT id AS Id, name AS Name FROM {table} WHERE active = 1 ORDER BY name",
                cancellationToken: ct)), ct)).AsList();
    }

    public async Task<IReadOnlyDictionary<string, IReadOnlyList<DropdownItem>>> DropdownsAsync(
        IReadOnlyList<string> types, string? industry, CancellationToken ct = default)
    {
        var result = new Dictionary<string, IReadOnlyList<DropdownItem>>();

        foreach (string type in types)
        {
            // Keyed by the type AS THE CALLER SPELLED IT, not the normalised
            // form: the client looks the result up by the string it sent.
            result[type] = await DropdownAsync(type, industry, ct);
        }

        return result;
    }

    public async Task<IReadOnlyList<GeoPlaceItem>> ListSitesAsync(CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<GeoPlaceItem>(
            new CommandDefinition("""
                SELECT id AS Id, name AS Name, latitude AS Latitude, longitude AS Longitude,
                       geofence_radius_metres AS GeofenceRadiusMetres
                FROM sites WHERE active = 1 ORDER BY name
                """, cancellationToken: ct)), ct)).AsList();

    public async Task<IReadOnlyList<GeoPlaceItem>> ListOfficeLocationsAsync(
        CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<GeoPlaceItem>(
            new CommandDefinition("""
                SELECT id AS Id, name AS Name, latitude AS Latitude, longitude AS Longitude,
                       geofence_radius_metres AS GeofenceRadiusMetres
                FROM office_locations WHERE active = 1 ORDER BY name
                """, cancellationToken: ct)), ct)).AsList();

    /// <summary>
    /// Holidays, optionally for one year. No <c>active</c> column on this table —
    /// a holiday is removed by deleting the row.
    /// </summary>
    public async Task<IReadOnlyList<HolidayItem>> ListHolidaysAsync(int? year,
                                                                    CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<HolidayItem>(
            new CommandDefinition("""
                SELECT id AS Id, name AS Name, holiday_date AS HolidayDate, state AS State
                FROM holidays
                WHERE (@year IS NULL OR YEAR(holiday_date) = @year)
                  AND (@companyId IS NULL OR company_id = @companyId OR company_id IS NULL)
                ORDER BY holiday_date
                """,
                new { year, companyId = _currentUser.CompanyId }, cancellationToken: ct)), ct)).AsList();

    public async Task<OfficeLocationItem> SaveOfficeLocationAsync(OfficeLocationRequest request,
                                                                   CancellationToken ct = default)
    {
        string name = request.Name?.Trim() ?? string.Empty;
        if (string.IsNullOrWhiteSpace(name))
        {
            throw ApiException.Business("A name for this office is required");
        }

        if (!request.Latitude.HasValue || !request.Longitude.HasValue)
        {
            throw ApiException.Business("Coordinates are required. Stand in the office and use your current location.");
        }

        decimal lat = request.Latitude.Value;
        decimal lng = request.Longitude.Value;
        if (lat < -90m || lat > 90m || lng < -180m || lng > 180m)
        {
            throw ApiException.Business("Those are not valid coordinates.");
        }

        int radius = request.GeofenceRadiusMetres.HasValue
            ? Math.Max(50, Math.Min(5000, request.GeofenceRadiusMetres.Value))
            : 200;

        if (!request.Id.HasValue || request.Id.Value <= 0)
        {
            int existing = await QueryAsync(conn => conn.ExecuteScalarAsync<int>(
                new CommandDefinition("SELECT COUNT(*) FROM office_locations WHERE LOWER(name) = LOWER(@name)",
                    new { name }, cancellationToken: ct)), ct);
            if (existing > 0)
            {
                throw ApiException.Conflict($"An office named '{name}' already exists");
            }

            long newId = await QueryAsync(async conn =>
            {
                return await conn.QuerySingleAsync<long>(
                    new CommandDefinition("""
                        INSERT INTO office_locations (name, address, latitude, longitude, geofence_radius_metres, active)
                        VALUES (@name, @address, @lat, @lng, @radius, 1);
                        SELECT LAST_INSERT_ID();
                        """,
                        new { name, address = request.Address, lat, lng, radius },
                        cancellationToken: ct));
            }, ct);

            return new OfficeLocationItem(newId, name, request.Address, lat, lng, radius, true);
        }
        else
        {
            long id = request.Id.Value;
            var found = await QueryAsync(conn => conn.QueryFirstOrDefaultAsync<OfficeLocationItem>(
                new CommandDefinition("""
                    SELECT id AS Id, name AS Name, address AS Address, latitude AS Latitude,
                           longitude AS Longitude, geofence_radius_metres AS GeofenceRadiusMetres,
                           active AS Active
                    FROM office_locations WHERE id = @id
                    """, new { id }, cancellationToken: ct)), ct);

            if (found is null)
            {
                throw ApiException.NotFound("Office location");
            }

            await QueryAsync(conn => conn.ExecuteAsync(
                new CommandDefinition("""
                    UPDATE office_locations
                    SET name = @name, address = @address, latitude = @lat, longitude = @lng,
                        geofence_radius_metres = @radius, active = 1
                    WHERE id = @id
                    """,
                    new { id, name, address = request.Address, lat, lng, radius },
                    cancellationToken: ct)), ct);

            return new OfficeLocationItem(id, name, request.Address, lat, lng, radius, true);
        }
    }

    public async Task DeleteOfficeLocationAsync(long id, CancellationToken ct = default)
    {
        var found = await QueryAsync(conn => conn.QueryFirstOrDefaultAsync<int?>(
            new CommandDefinition("SELECT 1 FROM office_locations WHERE id = @id", new { id }, cancellationToken: ct)), ct);

        if (found is null)
        {
            throw ApiException.NotFound("Office location");
        }

        await QueryAsync(conn => conn.ExecuteAsync(
            new CommandDefinition("UPDATE office_locations SET active = 0 WHERE id = @id", new { id }, cancellationToken: ct)), ct);
    }

    public async Task<HolidayItem> CreateHolidayAsync(HolidayRequest request,
                                                      CancellationToken ct = default)
    {
        string name = request.Name?.Trim() ?? string.Empty;
        if (string.IsNullOrWhiteSpace(name))
        {
            throw ApiException.Business("Holiday name is required");
        }

        string? state = string.IsNullOrWhiteSpace(request.State) ? null : request.State.Trim();
        long? companyId = _currentUser.CompanyId;

        long newId = await QueryAsync(async conn =>
        {
            return await conn.QuerySingleAsync<long>(
                new CommandDefinition("""
                    INSERT INTO holidays (name, holiday_date, state, company_id, created_at)
                    VALUES (@name, @holidayDate, @state, @companyId, @createdAt);
                    SELECT LAST_INSERT_ID();
                    """,
                    new { name, holidayDate = request.HolidayDate, state, companyId, createdAt = DateTime.UtcNow },
                    cancellationToken: ct));
        }, ct);

        var item = new HolidayItem(newId, name, request.HolidayDate, state);

        try
        {
            var userIds = (await QueryAsync(conn => conn.QueryAsync<long>(
                new CommandDefinition("""
                    SELECT id FROM users
                    WHERE enabled = 1
                      AND (profile_status IS NULL OR UPPER(profile_status) <> 'OFFBOARDED')
                    """, cancellationToken: ct)), ct)).AsList();

            string when = request.HolidayDate.ToString("yyyy-MM-dd");
            foreach (long uid in userIds)
            {
                await _notifications.CreateAndPushAsync(
                    uid,
                    "New calendar entry: " + name,
                    name + " on " + when,
                    "CALENDAR",
                    "/calendar",
                    ct);
            }
        }
        catch
        {
            // Notification failures must not fail holiday creation
        }

        return item;
    }

    public Task DeleteHolidayAsync(long id, CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteAsync(
            new CommandDefinition("DELETE FROM holidays WHERE id = @id", new { id }, cancellationToken: ct)), ct);

    public async Task<DropdownItem> CreateDesignationAsync(string? name, string? industry,
                                                           CancellationToken ct = default)
    {
        string clean = name?.Trim() ?? string.Empty;
        if (string.IsNullOrEmpty(clean))
        {
            throw ApiException.Business("Team name is required");
        }

        int count = await QueryAsync(conn => conn.ExecuteScalarAsync<int>(
            new CommandDefinition("SELECT COUNT(*) FROM designations WHERE active = 1 AND LOWER(name) = LOWER(@clean)",
                new { clean }, cancellationToken: ct)), ct);

        if (count > 0)
        {
            throw ApiException.Conflict($"A team named '{clean}' already exists");
        }

        string? ind = NormalizeIndustry(industry);
        string finalInd = ind ?? "IT";
        string code = System.Text.RegularExpressions.Regex.Replace(clean.ToUpperInvariant(), "[^A-Z0-9]+", "_").Trim('_');
        if (code.Length > 40) code = code[..40];

        long id = await QueryAsync(async conn =>
        {
            return await conn.QuerySingleAsync<long>(
                new CommandDefinition("""
                    INSERT INTO designations (name, code, industry, active)
                    VALUES (@name, @code, @industry, 1);
                    SELECT LAST_INSERT_ID();
                    """,
                    new { name = clean, code, industry = finalInd },
                    cancellationToken: ct));
        }, ct);

        return new DropdownItem(id, clean);
    }

    public async Task DeleteDesignationAsync(string name, CancellationToken ct = default)
    {
        string clean = name?.Trim() ?? string.Empty;
        if (string.IsNullOrEmpty(clean))
        {
            throw ApiException.Business("Team name is required");
        }

        var matches = (await QueryAsync(conn => conn.QueryAsync<long>(
            new CommandDefinition("SELECT id FROM designations WHERE LOWER(name) = LOWER(@clean)",
                new { clean }, cancellationToken: ct)), ct)).AsList();

        if (matches.Count > 0)
        {
            await QueryAsync(conn => conn.ExecuteAsync(
                new CommandDefinition("UPDATE users SET designation_title = NULL WHERE LOWER(designation_title) = LOWER(@clean)",
                    new { clean }, cancellationToken: ct)), ct);

            await QueryAsync(conn => conn.ExecuteAsync(
                new CommandDefinition("UPDATE users SET designation_id = NULL WHERE designation_id IN @matches",
                    new { matches }, cancellationToken: ct)), ct);

            await QueryAsync(conn => conn.ExecuteAsync(
                new CommandDefinition("DELETE FROM designations WHERE id IN @matches",
                    new { matches }, cancellationToken: ct)), ct);
        }
    }

    public async Task<IReadOnlyDictionary<string, string>> GetAllSettingsAsync(CancellationToken ct = default)
    {
        var rows = (await QueryAsync(conn => conn.QueryAsync<(string Key, string Value)>(
            new CommandDefinition("SELECT setting_key AS `Key`, setting_value AS `Value` FROM system_settings",
                cancellationToken: ct)), ct)).AsList();

        var dict = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var row in rows)
        {
            if (row.Key != null) dict[row.Key] = row.Value ?? "";
        }
        return dict;
    }

    public async Task UpdateSettingsAsync(IDictionary<string, string> settings, CancellationToken ct = default)
    {
        if (settings == null || settings.Count == 0) return;

        foreach (var kvp in settings)
        {
            await QueryAsync(conn => conn.ExecuteAsync(
                new CommandDefinition("""
                    UPDATE system_settings
                    SET setting_value = @value
                    WHERE setting_key = @key
                    """, new { key = kvp.Key, value = kvp.Value }, cancellationToken: ct)), ct);
        }
    }
}
