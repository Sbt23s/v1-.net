using Dapper;
using Pixous.HrPortal.Domain.Modules.Asset;
using Pixous.HrPortal.Infrastructure.Persistence;

namespace Pixous.HrPortal.Infrastructure.Modules.Asset;

/// <summary>Dapper access to <c>assets</c> and <c>asset_allocations</c>.</summary>
public sealed class AssetDal : DalBase, IAssetDal
{
    public AssetDal(IDbConnectionFactory connectionFactory) : base(connectionFactory) { }

    private const string Columns = """
        a.id                AS Id,
        a.asset_code        AS AssetCode,
        a.category          AS Category,
        a.asset_type        AS AssetType,
        a.brand             AS Brand,
        a.model             AS Model,
        a.serial_number     AS SerialNumber,
        a.registration_no   AS RegistrationNo,
        a.purchase_date     AS PurchaseDate,
        a.purchase_cost     AS PurchaseCost,
        a.warranty_expiry   AS WarrantyExpiry,
        a.amc_expiry        AS AmcExpiry,
        a.status            AS Status,
        a.site_id           AS SiteId,
        a.assigned_to       AS AssignedTo,
        a.qr_path           AS QrPath,
        a.depreciation_rate AS DepreciationRate,
        a.quantity          AS Quantity,
        a.company_id        AS CompanyId,
        a.created_at        AS CreatedAt,
        a.updated_at        AS UpdatedAt,
        u.name              AS AssignedToName
        """;

    private const string From = """
        FROM assets a
        LEFT JOIN users u ON u.id = a.assigned_to
        """;

    public async Task<IReadOnlyList<AssetRecord>> FindAllAsync(CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<AssetRecord>(
            new CommandDefinition($"SELECT {Columns} {From} ORDER BY a.id DESC",
                cancellationToken: ct)), ct)).AsList();

    public async Task<(IReadOnlyList<AssetRecord> Items, long Total)> FindPagedAsync(
        string? status, string? category, int offset, int limit, CancellationToken ct = default) =>
        await QueryAsync(async conn =>
        {
            List<string> clauses = new();
            if (!string.IsNullOrWhiteSpace(status)) clauses.Add("a.status = @status");
            if (!string.IsNullOrWhiteSpace(category)) clauses.Add("a.category = @category");

            string where = clauses.Count > 0 ? "WHERE " + string.Join(" AND ", clauses) : "";

            long total = await conn.ExecuteScalarAsync<long>(new CommandDefinition(
                $"SELECT COUNT(*) FROM assets a {where}",
                new { status, category }, cancellationToken: ct));

            var items = (await conn.QueryAsync<AssetRecord>(new CommandDefinition($"""
                SELECT {Columns} {From}
                {where}
                ORDER BY a.id DESC
                LIMIT @limit OFFSET @offset
                """, new { status, category, limit, offset }, cancellationToken: ct))).AsList();

            return (items, total);
        }, ct);

    public async Task<IReadOnlyList<AssetRecord>> FindForHolderAsync(
        long userId, CancellationToken ct = default) =>
        (await QueryAsync(conn => conn.QueryAsync<AssetRecord>(
            new CommandDefinition($"""
                SELECT {Columns} {From}
                WHERE EXISTS (
                    SELECT 1 FROM asset_allocations al
                    WHERE al.asset_id = a.id
                      AND al.user_id = @userId
                      AND al.returned_at IS NULL)
                ORDER BY a.id DESC
                """,
                new { userId }, cancellationToken: ct)), ct)).AsList();

    public Task<AssetRecord?> FindAsync(long id, CancellationToken ct = default) =>
        QueryAsync(conn => conn.QueryFirstOrDefaultAsync<AssetRecord>(
            new CommandDefinition($"SELECT {Columns} {From} WHERE a.id = @id",
                new { id }, cancellationToken: ct)), ct);

    public Task<AssetRecord?> FindByCodeAsync(string code, CancellationToken ct = default) =>
        QueryAsync(conn => conn.QueryFirstOrDefaultAsync<AssetRecord>(
            new CommandDefinition($"SELECT {Columns} {From} WHERE a.asset_code = @code LIMIT 1",
                new { code }, cancellationToken: ct)), ct);

    public Task<long> CountAssetsAsync(CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteScalarAsync<long>(
            new CommandDefinition("SELECT COUNT(*) FROM assets", cancellationToken: ct)), ct);

    public Task<long> InsertAsync(AssetRecord a, CancellationToken ct = default) =>
        QueryAsync(async conn =>
        {
            a.CreatedAt ??= DateTime.Now;
            a.Id = await conn.ExecuteScalarAsync<long>(new CommandDefinition("""
                INSERT INTO assets
                    (asset_code, category, asset_type, brand, model, serial_number, registration_no,
                     purchase_date, purchase_cost, warranty_expiry, amc_expiry, status, site_id,
                     assigned_to, qr_path, depreciation_rate, quantity, company_id, created_at, updated_at)
                VALUES
                    (@AssetCode, @Category, @AssetType, @Brand, @Model, @SerialNumber, @RegistrationNo,
                     @PurchaseDate, @PurchaseCost, @WarrantyExpiry, @AmcExpiry, @Status, @SiteId,
                     @AssignedTo, @QrPath, @DepreciationRate, @Quantity, @CompanyId, @CreatedAt, @CreatedAt);
                SELECT LAST_INSERT_ID();
                """, a, cancellationToken: ct));
            return a.Id;
        }, ct);

    public Task UpdateAsync(AssetRecord a, CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteAsync(new CommandDefinition("""
            UPDATE assets SET
                status = @Status,
                quantity = @Quantity,
                assigned_to = @AssignedTo,
                qr_path = @QrPath,
                updated_at = @UpdatedAt
            WHERE id = @Id
            """, a, cancellationToken: ct)), ct);

    public Task DeleteAsync(long id, CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteAsync(new CommandDefinition(
            "DELETE FROM assets WHERE id = @id", new { id }, cancellationToken: ct)), ct);

    public Task DeleteAllocationsByAssetIdAsync(long assetId, CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteAsync(new CommandDefinition(
            "DELETE FROM asset_allocations WHERE asset_id = @assetId", new { assetId }, cancellationToken: ct)), ct);

    public Task<AssetAllocationRecord?> FindActiveAllocationAsync(long assetId,
                                                                  CancellationToken ct = default) =>
        QueryAsync(conn => conn.QueryFirstOrDefaultAsync<AssetAllocationRecord>(
            new CommandDefinition("""
                SELECT id AS Id, asset_id AS AssetId, user_id AS UserId,
                       allocated_at AS AllocatedAt, acknowledged AS Acknowledged,
                       acknowledged_at AS AcknowledgedAt, returned_at AS ReturnedAt,
                       return_condition AS ReturnCondition, company_id AS CompanyId
                FROM asset_allocations
                WHERE asset_id = @assetId AND returned_at IS NULL
                ORDER BY id DESC
                LIMIT 1
                """,
                new { assetId }, cancellationToken: ct)), ct);

    public Task<long> InsertAllocationAsync(AssetAllocationRecord al,
                                            CancellationToken ct = default) =>
        QueryAsync(async conn =>
        {
            al.AllocatedAt ??= DateTime.Now;
            al.Id = await conn.ExecuteScalarAsync<long>(new CommandDefinition("""
                INSERT INTO asset_allocations
                    (asset_id, user_id, allocated_at, acknowledged, company_id)
                VALUES (@AssetId, @UserId, @AllocatedAt, @Acknowledged, @CompanyId);
                SELECT LAST_INSERT_ID();
                """, al, cancellationToken: ct));
            return al.Id;
        }, ct);

    public Task UpdateAllocationAsync(AssetAllocationRecord al, CancellationToken ct = default) =>
        QueryAsync(conn => conn.ExecuteAsync(new CommandDefinition("""
            UPDATE asset_allocations SET
                acknowledged = @Acknowledged,
                acknowledged_at = @AcknowledgedAt,
                returned_at = @ReturnedAt,
                return_condition = @ReturnCondition
            WHERE id = @Id
            """, al, cancellationToken: ct)), ct);

    public async Task<(string? Name, string? Phone)> FindUserContactAsync(
        long userId, CancellationToken ct = default)
    {
        var row = await QueryAsync(conn => conn.QueryFirstOrDefaultAsync<(string?, string?)>(
            new CommandDefinition("SELECT name, phone FROM users WHERE id = @userId",
                new { userId }, cancellationToken: ct)), ct);
        return row;
    }
}
