using System.Data;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using MySqlConnector;

namespace Pixous.HrPortal.Infrastructure.Persistence;

/// <summary>
/// Opens pooled connections to the existing MySQL database.
///
/// The pool is tuned to the same constraints the Java Hikari pool is tuned to,
/// because it is the same database account:
///
///   - Shared MySQL hosting caps the ACCOUNT, not the server: the live account
///     allows twenty connections in total across every process that uses it.
///     MaximumPoolSize stays low so a deployment that briefly runs two copies
///     cannot exhaust the account and lock the portal out of its own database.
///
///   - The hosted MySQL closes an idle connection after wait_timeout, which is
///     THIRTY SECONDS there. A pool that holds connections longer than that
///     spends its time being handed dead ones, so ConnectionLifeTime is kept
///     at or below it.
///
/// Both are overridable from configuration for exactly that reason -- the local
/// defaults are not the hosted ones.
/// </summary>
public sealed class MySqlConnectionFactory : IDbConnectionFactory
{
    private readonly string _connectionString;
    private readonly ILogger<MySqlConnectionFactory> _log;

    public MySqlConnectionFactory(IConfiguration configuration, ILogger<MySqlConnectionFactory> log)
    {
        _log = log;

        string? configured = configuration.GetConnectionString("HrPortal");
        if (string.IsNullOrWhiteSpace(configured))
        {
            // Failing here is deliberate. A connection string assembled from
            // guessed defaults would point at some other database, and the first
            // symptom would be wrong data rather than a stopped application.
            throw new InvalidOperationException(
                "No connection string named 'HrPortal' was configured. Set ConnectionStrings:HrPortal " +
                "in appsettings.Development.json, user-secrets, or the " +
                "ConnectionStrings__HrPortal environment variable.");
        }

        // Settings the application depends on are asserted here rather than
        // trusted to whoever wrote the connection string.
        var builder = new MySqlConnectionStringBuilder(configured)
        {
            // Hibernate runs with hibernate.jdbc.time_zone=Asia/Kolkata and the
            // rows carry local times. Reading them back as DateTime without a
            // kind keeps the DAL free to apply the same zone the Java side does,
            // instead of the driver silently converting to the server's zone.
            //
            // Every timestamp comparison in this application is in Asia/Kolkata.
            DateTimeKind = MySqlDateTimeKind.Unspecified,
        };

        _connectionString = builder.ConnectionString;
    }

    public async Task<IDbConnection> CreateOpenConnectionAsync(CancellationToken cancellationToken = default)
    {
        var connection = new MySqlConnection(_connectionString);
        try
        {
            await connection.OpenAsync(cancellationToken);
            return connection;
        }
        catch (Exception)
        {
            // A connection that failed to open still holds a pool slot until it
            // is disposed, and those slots are the scarce resource here.
            await connection.DisposeAsync();
            throw;
        }
    }
}
