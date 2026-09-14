using Dapper;
using System.Data;
using Microsoft.Extensions.Logging;

namespace Pixous.HrPortal.Infrastructure.Persistence;

/// <summary>
/// Refuses to start against a database this application is not allowed to own.
///
/// The Spring Boot application and Flyway own the schema. This one maps to what
/// they have already built and must never migrate, generate or alter it. That
/// rule is easy to state and easy to lose: an ORM added later, a "helpful"
/// EnsureCreated, a migration runner wired in by a template. The check runs at
/// startup so a mistake stops the process rather than altering a live schema
/// nobody meant to touch.
///
/// What it verifies, in order:
///
///   1. **No migration machinery is loaded.** Flyway, EF Core Migrations and
///      similar tools are looked for by assembly name. Their mere presence is
///      treated as a fault, because nothing in this solution needs them.
///
///   2. **The schema is at or beyond the version the code expects.** An older
///      schema is missing columns the DAL selects by name, and the failure that
///      follows is a confusing "unknown column" on the first request rather than
///      a clear message here. This is the check that would have caught the
///      V122-vs-V154 mismatch immediately instead of at the first punch.
///
///   3. **The connection cannot write, when it is supposed to be read-only.**
///      Verified by asking the server what it granted, not by trusting
///      configuration.
/// </summary>
public sealed class SchemaSafetyGuard
{
    /// <summary>
    /// The Flyway version the ported code was written against. The DAL selects
    /// columns introduced up to here -- attendance.in_auth_method and its
    /// siblings arrive in V140-V141.
    /// </summary>
    public const int RequiredSchemaVersion = 154;

    private readonly IDbConnectionFactory _connectionFactory;
    private readonly ILogger<SchemaSafetyGuard> _log;

    public SchemaSafetyGuard(IDbConnectionFactory connectionFactory, ILogger<SchemaSafetyGuard> log)
    {
        _connectionFactory = connectionFactory;
        _log = log;
    }

    /// <summary>
    /// Runs every check. Throws <see cref="InvalidOperationException"/> rather
    /// than logging a warning: a process that has already decided it is unsafe
    /// should not go on to serve requests.
    /// </summary>
    public async Task AssertSafeAsync(bool expectReadOnly, CancellationToken ct = default)
    {
        AssertNoMigrationMachinery();

        using IDbConnection connection = await _connectionFactory.CreateOpenConnectionAsync(ct);

        await AssertSchemaVersionAsync(connection, ct);

        if (expectReadOnly)
        {
            await AssertConnectionIsReadOnlyAsync(connection, ct);
        }
    }

    /// <summary>
    /// No schema tooling may be loaded into this process.
    ///
    /// Checked by assembly name rather than by configuration, because the danger
    /// is precisely the case where somebody added the package and did not think
    /// to configure anything.
    /// </summary>
    private void AssertNoMigrationMachinery()
    {
        string[] forbidden =
        [
            "Flyway",
            "Evolve",                                  // the common .NET Flyway equivalent
            "FluentMigrator",
            "DbUp",
            "Microsoft.EntityFrameworkCore.Migrations",
            "Microsoft.EntityFrameworkCore.Design"
        ];

        var loaded = AppDomain.CurrentDomain.GetAssemblies()
            .Select(a => a.GetName().Name ?? string.Empty)
            .ToArray();

        var offenders = forbidden
            .Where(name => loaded.Any(l => l.StartsWith(name, StringComparison.OrdinalIgnoreCase)))
            .ToArray();

        if (offenders.Length > 0)
        {
            throw new InvalidOperationException(
                "Schema migration tooling is loaded into this process: "
                + string.Join(", ", offenders)
                + ". The Spring Boot application and Flyway own this schema; this application "
                + "maps to it and must never migrate, generate or alter it. Remove the package.");
        }
    }

    /// <summary>
    /// The schema must be at least the version the DAL was written against.
    ///
    /// flyway_schema_history is READ here and never written. Its version column
    /// is a string ("154", but also "1.1" in some histories), so only the rows
    /// that parse as a plain integer are considered -- the rest cannot be
    /// compared numerically and are not what this check is about.
    /// </summary>
    private async Task AssertSchemaVersionAsync(IDbConnection connection, CancellationToken ct)
    {
        bool hasHistory = await connection.ExecuteScalarAsync<bool>(new CommandDefinition("""
            SELECT EXISTS(
                SELECT 1 FROM information_schema.tables
                WHERE table_schema = DATABASE() AND table_name = 'flyway_schema_history')
            """, cancellationToken: ct));

        if (!hasHistory)
        {
            throw new InvalidOperationException(
                "This database has no flyway_schema_history table, so it is not a schema this "
                + "application recognises. Point it at the HR portal database.");
        }

        int? version = await connection.ExecuteScalarAsync<int?>(new CommandDefinition("""
            SELECT MAX(CAST(version AS UNSIGNED))
            FROM flyway_schema_history
            WHERE success = 1 AND version REGEXP '^[0-9]+$'
            """, cancellationToken: ct));

        if (version is null || version < RequiredSchemaVersion)
        {
            throw new InvalidOperationException(
                $"This database is at Flyway version {version?.ToString() ?? "none"}, but the code "
                + $"expects at least V{RequiredSchemaVersion}. Columns the data access reads by name "
                + "(for example attendance.in_auth_method, added in V141) do not exist yet. "
                + "Run the Spring Boot application against it to migrate, or point this one at a "
                + "database that is already current. This application will not migrate it.");
        }

        _log.LogInformation("Schema check passed: Flyway V{Version} (need V{Required})",
            version, RequiredSchemaVersion);
    }

    /// <summary>
    /// Confirms with the SERVER that this connection cannot write.
    ///
    /// Asking the server is the point. A connection string can say anything, and
    /// "I will only run SELECTs" is a promise the process makes to itself. SHOW
    /// GRANTS is what the database will actually enforce.
    /// </summary>
    private async Task AssertConnectionIsReadOnlyAsync(IDbConnection connection, CancellationToken ct)
    {
        var grants = (await connection.QueryAsync<string>(
            new CommandDefinition("SHOW GRANTS FOR CURRENT_USER()", cancellationToken: ct)))
            .ToArray();

        string[] writePrivileges =
            ["INSERT", "UPDATE", "DELETE", "DROP", "ALTER", "CREATE", "TRUNCATE", "ALL PRIVILEGES"];

        var granted = grants
            .Where(g => writePrivileges.Any(p => g.Contains(p, StringComparison.OrdinalIgnoreCase)))
            .ToArray();

        if (granted.Length > 0)
        {
            throw new InvalidOperationException(
                "This connection was expected to be read-only, but the server reports write "
                + "privileges: " + string.Join(" | ", granted)
                + ". Use an account granted SELECT only.");
        }

        _log.LogInformation("Read-only check passed: the server grants no write privileges.");
    }
}
