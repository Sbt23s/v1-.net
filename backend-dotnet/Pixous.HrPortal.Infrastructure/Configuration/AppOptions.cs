namespace Pixous.HrPortal.Infrastructure.Configuration;

/// <summary>
/// Strongly-typed binding for the "App" section of appsettings.json.
/// Ported from com.pixous.hrportal.config.AppProperties, which binds "app.*"
/// in application.yml. Names and defaults are kept identical so a value tuned
/// on the Java side means the same thing here.
///
/// Nothing secret has a committed default. The secrets stay in environment
/// variables or user-secrets exactly as they do for Spring.
/// </summary>
public sealed class AppOptions
{
    public const string SectionName = "App";

    public JwtOptions Jwt { get; init; } = new();
    public CorsOptions Cors { get; init; } = new();
    public StorageOptions Storage { get; init; } = new();
    public AttendanceOptions Attendance { get; init; } = new();
    public SecurityOptions Security { get; init; } = new();
    public MailOptions Mail { get; init; } = new();
}

public sealed class MailOptions
{
    public string Host { get; init; } = string.Empty;
    public int Port { get; init; } = 587;
    public string Username { get; init; } = string.Empty;
    public string Password { get; init; } = string.Empty;
    public string From { get; init; } = string.Empty;
    public bool EnableSsl { get; init; } = true;
}

public sealed class JwtOptions
{
    /// <summary>
    /// The HMAC signing key. No default on purpose: it MUST come from
    /// APP_JWT_SECRET (or user-secrets) or the app fails to start rather than
    /// running with a publicly-known key. Validated at startup.
    /// </summary>
    public string Secret { get; init; } = string.Empty;

    /// <summary>
    /// A four-hour session, and four hours means four hours: the refresh token
    /// expires with the access token rather than quietly extending the session
    /// for a week. Inside the window nothing expires and no request can fail on
    /// auth; at the boundary the refresh fails and the client returns to login.
    /// </summary>
    public long AccessTokenTtlSeconds { get; init; } = 14400;

    public long RefreshTokenTtlSeconds { get; init; } = 14400;

    public string Issuer { get; init; } = "hr-portal";
}

public sealed class CorsOptions
{
    /// <summary>
    /// Allowed web origins. The Java default is the two local dev servers; in
    /// production this is set from the environment to the deployed frontend.
    /// </summary>
    public string[] AllowedOrigins { get; init; } =
        [
            "https://pixoushrportal.pixous.info",
            "http://pixoushrportal.pixous.info",
            "https://www.pixoushrportal.pixous.info",
            "http://www.pixoushrportal.pixous.info",
            "http://localhost:5174",
            "http://localhost:5173",
            "http://localhost:3000"
        ];
}

public sealed class StorageOptions
{
    /// <summary>local | s3 | minio</summary>
    public string Type { get; init; } = "local";
    public string LocalPath { get; init; } = "/mnt/2tb-storage/hr-files";
}

public sealed class AttendanceOptions
{
    public int DefaultGeofenceRadiusMetres { get; init; } = 200;

    /// <summary>
    /// Grace is zero: 09:00 is on time, 09:01 is one minute late.
    ///
    /// The two Java config files disagreed here -- application.properties said
    /// 15 and .properties wins over .yml in Spring Boot, so the running grace
    /// was fifteen minutes while the yml claimed none. Changing this changes
    /// what counts as late company-wide.
    /// </summary>
    public int LateGraceMinutes { get; init; } = 0;

    public int StandardWorkHours { get; init; } = 8;

    /// <summary>Office start, e.g. "09:00". A punch after this counts as late.</summary>
    public string OfficeStart { get; init; } = "09:00";

    /// <summary>Office end, e.g. "18:00". Time worked past this counts as overtime.</summary>
    public string OfficeEnd { get; init; } = "18:00";
}

public sealed class SecurityOptions
{
    public int MaxFailedLoginAttempts { get; init; } = 5;
    public int AccountLockMinutes { get; init; } = 15;
}
