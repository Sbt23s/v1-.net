using System.Data;
using Dapper;
using MySqlConnector;
using Pixous.HrPortal.Domain.Common;

namespace Pixous.HrPortal.Infrastructure.Persistence;

/// <summary>
/// Shared plumbing for every DAL: opening a connection, running Dapper against
/// it, and translating driver faults into the domain exceptions the middleware
/// knows how to answer.
///
/// Deriving from this is what keeps the DAL classes down to their SQL. It is
/// not a repository abstraction -- each DAL still writes its own queries, as
/// the reference architecture requires.
///
/// Every query here goes through Dapper's parameter binding. No DAL in this
/// solution builds SQL by concatenating a caller's value; the exceptions are
/// identifiers (sort columns, table names), which are validated against a fixed
/// allow-list before they are interpolated.
/// </summary>
public abstract class DalBase
{
    private readonly IDbConnectionFactory _connectionFactory;

    protected DalBase(IDbConnectionFactory connectionFactory)
    {
        _connectionFactory = connectionFactory;
    }

    /// <summary>
    /// Runs <paramref name="work"/> against an open connection and disposes it
    /// afterwards, translating driver faults on the way out.
    /// </summary>
    protected async Task<T> QueryAsync<T>(
        Func<IDbConnection, Task<T>> work,
        CancellationToken cancellationToken = default)
    {
        using IDbConnection connection =
            await _connectionFactory.CreateOpenConnectionAsync(cancellationToken);
        try
        {
            return await work(connection);
        }
        catch (MySqlException ex)
        {
            throw Translate(ex);
        }
    }

    /// <summary>
    /// Runs <paramref name="work"/> inside a transaction, committing on success
    /// and rolling back on any fault.
    ///
    /// This is the equivalent of Spring's @Transactional for the places that
    /// need it. It is opt-in rather than ambient: Java applies @Transactional
    /// per service method, so wrapping every DAL call in a transaction here
    /// would change the isolation of operations that do not have one today.
    /// </summary>
    protected async Task<T> TransactionAsync<T>(
        Func<IDbConnection, IDbTransaction, Task<T>> work,
        IsolationLevel isolationLevel = IsolationLevel.ReadCommitted,
        CancellationToken cancellationToken = default)
    {
        using IDbConnection connection =
            await _connectionFactory.CreateOpenConnectionAsync(cancellationToken);
        using IDbTransaction transaction = connection.BeginTransaction(isolationLevel);
        try
        {
            T result = await work(connection, transaction);
            transaction.Commit();
            return result;
        }
        catch (MySqlException ex)
        {
            SafeRollback(transaction);
            throw Translate(ex);
        }
        catch
        {
            SafeRollback(transaction);
            throw;
        }
    }

    protected async Task TransactionAsync(
        Func<IDbConnection, IDbTransaction, Task> work,
        IsolationLevel isolationLevel = IsolationLevel.ReadCommitted,
        CancellationToken cancellationToken = default)
    {
        await TransactionAsync<int>(async (conn, tx) =>
        {
            await work(conn, tx);
            return 0;
        }, isolationLevel, cancellationToken);
    }

    protected Task<T> TransactionAsync<T>(
        Func<IDbConnection, IDbTransaction, Task<T>> work,
        CancellationToken cancellationToken) =>
        TransactionAsync(work, IsolationLevel.ReadCommitted, cancellationToken);

    protected Task TransactionAsync(
        Func<IDbConnection, IDbTransaction, Task> work,
        CancellationToken cancellationToken) =>
        TransactionAsync(work, IsolationLevel.ReadCommitted, cancellationToken);

    /// <summary>
    /// A rollback that cannot mask the fault that caused it. If the connection
    /// has already gone the server has rolled the transaction back anyway, and
    /// throwing from here would replace the real exception with a meaningless
    /// one.
    /// </summary>
    private static void SafeRollback(IDbTransaction transaction)
    {
        try
        {
            transaction.Rollback();
        }
        catch
        {
            // Intentionally swallowed: see above.
        }
    }

    /// <summary>
    /// Turns a driver fault into the domain exception the middleware answers.
    ///
    /// 1062 (ER_DUP_ENTRY) and 1586 are MySQL's duplicate-key errors, and they
    /// are what Spring surfaces as DataIntegrityViolationException. The message
    /// is carried through unchanged because the middleware reads the constraint
    /// name out of it to tell the user which field collided.
    ///
    /// 1451/1452 are foreign-key failures, which Spring also reports as data
    /// integrity violations.
    /// </summary>
    private static Exception Translate(MySqlException ex) => ex.Number switch
    {
        1062 or 1586 or 1451 or 1452 => new DataIntegrityException(ex.Message, ex),
        _ => ex
    };
}
