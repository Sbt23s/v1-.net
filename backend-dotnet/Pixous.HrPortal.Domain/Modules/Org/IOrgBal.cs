namespace Pixous.HrPortal.Domain.Modules.Org;

/// <summary>
/// Organisation master data, dropdowns, office locations, holidays and settings.
/// Ported from com.pixous.hrportal.modules.org.OrgService.
/// </summary>
public interface IOrgBal
{
    /// <summary>
    /// One dropdown by type. <paramref name="industry"/> filters designations
    /// only; null or blank means no filter.
    /// </summary>
    Task<IReadOnlyList<DropdownItem>> DropdownAsync(string? type, string? industry,
                                                    CancellationToken ct = default);

    /// <summary>
    /// Several dropdowns in one call, keyed by the type as the caller spelled
    /// it — not the normalised form, because the client looks the result up by
    /// the string it sent.
    /// </summary>
    Task<IReadOnlyDictionary<string, IReadOnlyList<DropdownItem>>> DropdownsAsync(
        IReadOnlyList<string> types, string? industry, CancellationToken ct = default);

    Task<IReadOnlyList<GeoPlaceItem>> ListSitesAsync(CancellationToken ct = default);

    Task<IReadOnlyList<GeoPlaceItem>> ListOfficeLocationsAsync(CancellationToken ct = default);

    Task<OfficeLocationItem> SaveOfficeLocationAsync(OfficeLocationRequest request,
                                                     CancellationToken ct = default);

    Task DeleteOfficeLocationAsync(long id, CancellationToken ct = default);

    Task<IReadOnlyList<HolidayItem>> ListHolidaysAsync(int? year, CancellationToken ct = default);

    Task<HolidayItem> CreateHolidayAsync(HolidayRequest request, CancellationToken ct = default);

    Task DeleteHolidayAsync(long id, CancellationToken ct = default);

    Task<DropdownItem> CreateDesignationAsync(string? name, string? industry,
                                             CancellationToken ct = default);

    Task DeleteDesignationAsync(string name, CancellationToken ct = default);

    Task<IReadOnlyDictionary<string, string>> GetAllSettingsAsync(CancellationToken ct = default);

    Task UpdateSettingsAsync(IDictionary<string, string> settings, CancellationToken ct = default);
}

/// <summary>One option in a dropdown: the id the form submits and the label it shows.</summary>
public sealed record DropdownItem(long Id, string? Name)
{
    public string? Label => Name;
}

/// <summary>A site or office location, with the geofence the attendance module uses.</summary>
public sealed record GeoPlaceItem(
    long Id,
    string? Name,
    decimal? Latitude,
    decimal? Longitude,
    int? GeofenceRadiusMetres);

/// <summary>Full representation of an office location.</summary>
public sealed record OfficeLocationItem(
    long Id,
    string? Name,
    string? Address,
    decimal? Latitude,
    decimal? Longitude,
    int? GeofenceRadiusMetres,
    bool Active = true);

/// <summary>Payload to create or update an office location.</summary>
public sealed record OfficeLocationRequest(
    long? Id,
    string? Name,
    string? Address,
    decimal? Latitude,
    decimal? Longitude,
    int? GeofenceRadiusMetres);

/// <summary>A public holiday.</summary>
public sealed record HolidayItem(long Id, string? Name, DateOnly HolidayDate, string? State);

/// <summary>Payload to add a holiday.</summary>
public sealed record HolidayRequest(
    [System.ComponentModel.DataAnnotations.Required(AllowEmptyStrings = false, ErrorMessage = "Name is required")]
    string Name,
    [System.ComponentModel.DataAnnotations.Required(ErrorMessage = "Holiday date is required")]
    DateOnly HolidayDate,
    string? State);

/// <summary>Payload to create a designation/team.</summary>
public sealed record DesignationRequest(string? Name, string? Industry);

