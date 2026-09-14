using System.ComponentModel.DataAnnotations;
using Pixous.HrPortal.Domain.Common;

namespace Pixous.HrPortal.Domain.Modules.Asset;

/// <summary>
/// Company assets and who holds them. Ported from
/// com.pixous.hrportal.modules.asset.AssetService.
/// </summary>
public interface IAssetBal
{
    Task<IReadOnlyList<AssetRecord>> AllAsync(CancellationToken ct = default);

    Task<PageResponse<AssetResponse>> ListPagedAsync(string? status, string? category, int page,
                                                     int size, CancellationToken ct = default);

    /// <summary>Assets currently held by this person.</summary>
    Task<IReadOnlyList<AssetRecord>> MineAsync(long userId, CancellationToken ct = default);

    Task<IReadOnlyList<AssetResponse>> MyAssetsResponseAsync(long userId, CancellationToken ct = default);

    Task<AssetRecord> GetAsync(long id, CancellationToken ct = default);

    Task<AssetResponse> GetResponseAsync(long id, CancellationToken ct = default);

    Task<AssetResponse> CreateAsync(AssetRequest req, CancellationToken ct = default);

    Task<byte[]> QrPngAsync(long id, CancellationToken ct = default);

    Task DeleteAsync(long id, CancellationToken ct = default);

    /// <summary>
    /// Hands an asset to somebody. Refused when there is none left, and refused
    /// for an asset that is retired or lost.
    /// </summary>
    Task<AssetRecord> AllocateAsync(long assetId, long userId, CancellationToken ct = default);

    Task<AssetResponse> AllocateAssetAsync(long assetId, long userId, CancellationToken ct = default);

    /// <summary>
    /// The holder confirms receipt. **Only the assignee** — an administrator
    /// cannot acknowledge on somebody's behalf, because the acknowledgement is
    /// the evidence that they actually received it.
    /// </summary>
    Task<AssetRecord> AcknowledgeAsync(long userId, long assetId, CancellationToken ct = default);

    Task<AssetResponse> AcknowledgeAssetAsync(long userId, long assetId, CancellationToken ct = default);

    /// <summary>
    /// Takes an asset back. The CONDITION decides the new status: LOST leaves it
    /// lost, DAMAGED sends it for repair, anything else returns it to stock.
    /// </summary>
    Task<AssetRecord> ReturnAsync(long assetId, string? condition, CancellationToken ct = default);

    Task<AssetResponse> ReturnAssetAsync(long assetId, string? condition, CancellationToken ct = default);

    Task<AssetResponse> GetByCodeAsync(string code, CancellationToken ct = default);
}

/// <summary>Request payload to register a new asset.</summary>
public sealed record AssetRequest(
    string? Category,
    string? AssetType,
    string? Brand,
    string? Model,
    string? SerialNumber,
    string? RegistrationNo,
    DateOnly? PurchaseDate,
    decimal? PurchaseCost,
    DateOnly? WarrantyExpiry,
    DateOnly? AmcExpiry,
    long? SiteId,
    decimal? DepreciationRate,
    int? Quantity
);

/// <summary>Asset wire contract matching Spring Boot AssetResponse and React Asset.</summary>
public sealed record AssetResponse(
    long Id,
    string? AssetCode,
    string? Category,
    string? AssetType,
    string? Brand,
    string? Model,
    string? SerialNumber,
    string? RegistrationNo,
    DateOnly? PurchaseDate,
    decimal? PurchaseCost,
    DateOnly? WarrantyExpiry,
    DateOnly? AmcExpiry,
    string? Status,
    long? SiteId,
    long? AssignedTo,
    string? AssignedToName,
    string? QrPath,
    decimal? DepreciationRate,
    int Quantity,
    DateTime? CreatedAt
);

/// <summary>A row of <c>assets</c>.</summary>
public sealed class AssetRecord
{
    public long Id { get; set; }
    public string? AssetCode { get; set; }
    public string? Category { get; set; }
    public string? AssetType { get; set; }
    public string? Brand { get; set; }
    public string? Model { get; set; }
    public string? SerialNumber { get; set; }
    public string? RegistrationNo { get; set; }
    public DateOnly? PurchaseDate { get; set; }
    public decimal? PurchaseCost { get; set; }
    public DateOnly? WarrantyExpiry { get; set; }
    public DateOnly? AmcExpiry { get; set; }
    public string? Status { get; set; }
    public long? SiteId { get; set; }
    public long? AssignedTo { get; set; }
    public string? QrPath { get; set; }
    public decimal? DepreciationRate { get; set; }

    /// <summary>How many of this asset remain. One row can be several items.</summary>
    public int Quantity { get; set; }

    public long? CompanyId { get; set; }
    public DateTime? CreatedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }

    /// <summary>Denormalised for the list views.</summary>
    public string? AssignedToName { get; set; }
}

/// <summary>A row of <c>asset_allocations</c>.</summary>
public sealed class AssetAllocationRecord
{
    public long Id { get; set; }
    public long AssetId { get; set; }
    public long UserId { get; set; }
    public DateTime? AllocatedAt { get; set; }
    public bool Acknowledged { get; set; }
    public DateTime? AcknowledgedAt { get; set; }
    public DateTime? ReturnedAt { get; set; }
    public string? ReturnCondition { get; set; }
    public long? CompanyId { get; set; }
}

/// <summary>Who an asset is being handed to.</summary>
public sealed record AllocateRequest
{
    [Required(ErrorMessage = "userId is required")]
    public required long UserId { get; init; }
}

/// <summary>How an asset came back.</summary>
public sealed record ReturnRequest
{
    /// <summary>GOOD | DAMAGED | LOST. Null is treated as GOOD.</summary>
    public string? Condition { get; init; }
}

/// <summary>Data access for assets.</summary>
public interface IAssetDal
{
    Task<IReadOnlyList<AssetRecord>> FindAllAsync(CancellationToken ct = default);
    Task<IReadOnlyList<AssetRecord>> FindForHolderAsync(long userId, CancellationToken ct = default);
    Task<AssetRecord?> FindAsync(long id, CancellationToken ct = default);
    Task<AssetRecord?> FindByCodeAsync(string code, CancellationToken ct = default);
    Task<long> CountAssetsAsync(CancellationToken ct = default);
    Task<long> InsertAsync(AssetRecord asset, CancellationToken ct = default);
    Task UpdateAsync(AssetRecord asset, CancellationToken ct = default);
    Task DeleteAsync(long id, CancellationToken ct = default);
    Task DeleteAllocationsByAssetIdAsync(long assetId, CancellationToken ct = default);

    Task<(IReadOnlyList<AssetRecord> Items, long Total)> FindPagedAsync(
        string? status, string? category, int offset, int limit, CancellationToken ct = default);

    /// <summary>The allocation that has not been returned, if there is one.</summary>
    Task<AssetAllocationRecord?> FindActiveAllocationAsync(long assetId,
                                                           CancellationToken ct = default);

    Task<long> InsertAllocationAsync(AssetAllocationRecord allocation,
                                     CancellationToken ct = default);

    Task UpdateAllocationAsync(AssetAllocationRecord allocation, CancellationToken ct = default);

    /// <summary>The holder's phone, for the SMS that follows an allocation.</summary>
    Task<(string? Name, string? Phone)> FindUserContactAsync(long userId,
                                                             CancellationToken ct = default);
}
