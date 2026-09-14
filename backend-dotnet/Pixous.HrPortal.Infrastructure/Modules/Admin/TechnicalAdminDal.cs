using Dapper;
using Pixous.HrPortal.Domain.Modules.Admin;
using Pixous.HrPortal.Infrastructure.Persistence;

namespace Pixous.HrPortal.Infrastructure.Modules.Admin;

/// <summary>Dapper access to <c>technical_admins</c>.</summary>
public sealed class TechnicalAdminDal : DalBase, ITechnicalAdminDal
{
    public TechnicalAdminDal(IDbConnectionFactory connectionFactory) : base(connectionFactory) { }

    private const string Columns = """
        id                 AS Id,
        username           AS Username,
        name               AS Name,
        email              AS Email,
        password_hash      AS PasswordHash,
        enabled            AS Enabled,
        mfa_enabled        AS MfaEnabled,
        failed_login_count AS FailedLoginCount,
        locked_until       AS LockedUntil,
        last_login_at      AS LastLoginAt
        """;

    public Task<TechnicalAdminRecord?> FindByUsernameAsync(string username,
                                                           CancellationToken ct = default) =>
        QueryAsync(conn => conn.QueryFirstOrDefaultAsync<TechnicalAdminRecord>(
            new CommandDefinition(
                $"SELECT {Columns} FROM technical_admins WHERE username = @username LIMIT 1",
                new { username }, cancellationToken: ct)), ct);

    public Task<TechnicalAdminRecord?> FindByIdAsync(long id, CancellationToken ct = default) =>
        QueryAsync(conn => conn.QueryFirstOrDefaultAsync<TechnicalAdminRecord>(
            new CommandDefinition(
                $"SELECT {Columns} FROM technical_admins WHERE id = @id",
                new { id }, cancellationToken: ct)), ct);
}
