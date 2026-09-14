using System.Data;

namespace Pixous.HrPortal.Infrastructure.Persistence;

/// <summary>
/// Hands out connections to the existing MySQL database. Every DAL takes this
/// rather than a connection string, so no data-access class knows where the
/// database lives or how it is pooled.
///
/// The connection returned is already open and is the caller's to dispose --
/// DAL methods wrap it in a using, which returns it to the ADO.NET pool rather
/// than closing a socket.
/// </summary>
public interface IDbConnectionFactory
{
    /// <summary>Opens a new connection to the application database.</summary>
    Task<IDbConnection> CreateOpenConnectionAsync(CancellationToken cancellationToken = default);
}
