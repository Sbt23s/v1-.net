using Pixous.HrPortal.Domain.Common;
using Pixous.HrPortal.Domain.Modules.Asset;
using Pixous.HrPortal.Domain.Modules.Notification;
using QRCoder;

namespace Pixous.HrPortal.Infrastructure.Modules.Asset;

/// <summary>
/// Company assets, ported from
/// com.pixous.hrportal.modules.asset.AssetService.
/// </summary>
public sealed class AssetBal : IAssetBal
{
    private readonly IAssetDal _dal;
    private readonly IStorageService _storage;
    private readonly INotificationBal _notifications;
    private readonly ISmsService _sms;

    public AssetBal(
        IAssetDal dal,
        IStorageService storage,
        INotificationBal notifications,
        ISmsService sms)
    {
        _dal = dal;
        _storage = storage;
        _notifications = notifications;
        _sms = sms;
    }

    public Task<IReadOnlyList<AssetRecord>> AllAsync(CancellationToken ct = default) =>
        _dal.FindAllAsync(ct);

    public async Task<PageResponse<AssetResponse>> ListPagedAsync(string? status, string? category,
                                                                  int page, int size,
                                                                  CancellationToken ct = default)
    {
        int offset = Math.Max(0, page) * Math.Max(1, size);
        var (items, total) = await _dal.FindPagedAsync(status, category, offset, size, ct);
        var content = items.Select(ToResponse).ToList();
        return PageResponse<AssetResponse>.Of(content, page, size, total);
    }

    public Task<IReadOnlyList<AssetRecord>> MineAsync(long userId, CancellationToken ct = default) =>
        _dal.FindForHolderAsync(userId, ct);

    public async Task<IReadOnlyList<AssetResponse>> MyAssetsResponseAsync(long userId,
                                                                          CancellationToken ct = default)
    {
        IReadOnlyList<AssetRecord> rows = await _dal.FindForHolderAsync(userId, ct);
        return rows.Select(ToResponse).ToList();
    }

    public async Task<AssetRecord> GetAsync(long id, CancellationToken ct = default) =>
        await _dal.FindAsync(id, ct) ?? throw ApiException.NotFound("Asset");

    public async Task<AssetResponse> GetResponseAsync(long id, CancellationToken ct = default) =>
        ToResponse(await GetAsync(id, ct));

    public async Task<AssetResponse> CreateAsync(AssetRequest req, CancellationToken ct = default)
    {
        long count = await _dal.CountAssetsAsync(ct) + 1;
        string prefix = (req.Category?.ToUpperInvariant()) switch
        {
            "INFRA" => "INF",
            "MACHINERY" => "MCH",
            _ => "AST"
        };
        string assetCode = $"{prefix}-{DateTime.Now.Year}-{count:D5}";

        int qty = req.Quantity.HasValue ? req.Quantity.Value : 1;
        string status = qty <= 0 ? "OUT_OF_STOCK" : "IN_STOCK";

        byte[] qrBytes = GenerateQrCodePng("ASSET:" + assetCode, 10);
        string qrPath = await _storage.StoreBytesAsync(qrBytes, "qr", $"asset_{assetCode}.png", ct);

        var asset = new AssetRecord
        {
            AssetCode = assetCode,
            Category = req.Category,
            AssetType = req.AssetType,
            Brand = req.Brand,
            Model = req.Model,
            SerialNumber = req.SerialNumber,
            RegistrationNo = req.RegistrationNo,
            PurchaseDate = req.PurchaseDate,
            PurchaseCost = req.PurchaseCost,
            WarrantyExpiry = req.WarrantyExpiry,
            AmcExpiry = req.AmcExpiry,
            SiteId = req.SiteId,
            DepreciationRate = req.DepreciationRate,
            Quantity = qty,
            Status = status,
            QrPath = qrPath,
            CreatedAt = DateTime.Now
        };

        await _dal.InsertAsync(asset, ct);
        AssetRecord created = await GetAsync(asset.Id, ct);
        return ToResponse(created);
    }

    public async Task<byte[]> QrPngAsync(long id, CancellationToken ct = default)
    {
        AssetRecord asset = await GetAsync(id, ct);
        return GenerateQrCodePng("ASSET:" + asset.AssetCode, 10);
    }

    public async Task DeleteAsync(long id, CancellationToken ct = default)
    {
        await GetAsync(id, ct);
        await _dal.DeleteAllocationsByAssetIdAsync(id, ct);
        await _dal.DeleteAsync(id, ct);
    }

    public async Task<AssetRecord> AllocateAsync(long assetId, long userId,
                                                 CancellationToken ct = default)
    {
        AssetResponse res = await AllocateAssetAsync(assetId, userId, ct);
        return await GetAsync(res.Id, ct);
    }

    public async Task<AssetResponse> AllocateAssetAsync(long assetId, long userId,
                                                        CancellationToken ct = default)
    {
        AssetRecord asset = await GetAsync(assetId, ct);

        if (string.Equals(asset.Status, "OUT_OF_STOCK", StringComparison.Ordinal)
            || asset.Quantity <= 0)
        {
            throw ApiException.Business("Asset is out of stock");
        }

        if (asset.Status is "RETIRED" or "LOST")
        {
            throw ApiException.Business(
                $"Cannot allocate a {asset.Status.ToLowerInvariant()} asset");
        }

        (string? name, string? phone) = await _dal.FindUserContactAsync(userId, ct);
        if (name is null)
        {
            throw ApiException.NotFound("User");
        }

        await _dal.InsertAllocationAsync(new AssetAllocationRecord
        {
            AssetId = assetId,
            UserId = userId,
            AllocatedAt = DateTime.Now,
            Acknowledged = false,
            CompanyId = asset.CompanyId
        }, ct);

        asset.Quantity -= 1;
        if (asset.Quantity <= 0)
        {
            asset.Status = "OUT_OF_STOCK";
        }

        asset.AssignedTo = userId;
        asset.UpdatedAt = DateTime.Now;
        await _dal.UpdateAsync(asset, ct);

        string detail = $"{asset.AssetType} ({asset.AssetCode}) has been assigned to you. "
                      + "Please acknowledge receipt.";

        await _notifications.CreateAndPushAsync(userId, "Asset assigned", detail,
                                                "ASSET", "/assets", ct);

        if (!string.IsNullOrWhiteSpace(phone))
        {
            await _sms.SendAsync(phone, "Pixous HR: " + detail, ct);
        }

        AssetRecord updated = await GetAsync(assetId, ct);
        return ToResponse(updated);
    }

    public async Task<AssetRecord> AcknowledgeAsync(long userId, long assetId,
                                                    CancellationToken ct = default)
    {
        AssetResponse res = await AcknowledgeAssetAsync(userId, assetId, ct);
        return await GetAsync(res.Id, ct);
    }

    public async Task<AssetResponse> AcknowledgeAssetAsync(long userId, long assetId,
                                                           CancellationToken ct = default)
    {
        AssetRecord asset = await GetAsync(assetId, ct);

        AssetAllocationRecord alloc = await _dal.FindActiveAllocationAsync(assetId, ct)
            ?? throw ApiException.Business("No active allocation for this asset");

        if (alloc.UserId != userId)
        {
            throw ApiException.Business("Only the assignee can acknowledge this asset");
        }

        alloc.Acknowledged = true;
        alloc.AcknowledgedAt = DateTime.Now;
        await _dal.UpdateAllocationAsync(alloc, ct);

        return ToResponse(asset);
    }

    public async Task<AssetRecord> ReturnAsync(long assetId, string? condition,
                                               CancellationToken ct = default)
    {
        AssetResponse res = await ReturnAssetAsync(assetId, condition, ct);
        return await GetAsync(res.Id, ct);
    }

    public async Task<AssetResponse> ReturnAssetAsync(long assetId, string? condition,
                                                      CancellationToken ct = default)
    {
        AssetRecord asset = await GetAsync(assetId, ct);

        AssetAllocationRecord alloc = await _dal.FindActiveAllocationAsync(assetId, ct)
            ?? throw ApiException.Business("Asset is not currently allocated");

        alloc.ReturnedAt = DateTime.Now;
        alloc.ReturnCondition = condition;
        await _dal.UpdateAllocationAsync(alloc, ct);

        string normalised = condition?.ToUpperInvariant() ?? "GOOD";

        asset.Quantity += 1;
        asset.Status = normalised switch
        {
            "LOST" => "LOST",
            "DAMAGED" => "UNDER_REPAIR",
            _ => "IN_STOCK"
        };
        asset.AssignedTo = null;
        asset.UpdatedAt = DateTime.Now;
        await _dal.UpdateAsync(asset, ct);

        AssetRecord updated = await GetAsync(assetId, ct);
        return ToResponse(updated);
    }

    public async Task<AssetResponse> GetByCodeAsync(string code, CancellationToken ct = default)
    {
        AssetRecord? asset = await _dal.FindByCodeAsync(code, ct);
        if (asset is null)
        {
            throw ApiException.NotFound("Asset");
        }
        return ToResponse(asset);
    }

    private static byte[] GenerateQrCodePng(string content, int pixelsPerModule)
    {
        using var generator = new QRCodeGenerator();
        using var data = generator.CreateQrCode(content, QRCodeGenerator.ECCLevel.M);
        var qrCode = new PngByteQRCode(data);
        return qrCode.GetGraphic(pixelsPerModule);
    }

    private static AssetResponse ToResponse(AssetRecord a) =>
        new(a.Id, a.AssetCode, a.Category, a.AssetType, a.Brand, a.Model, a.SerialNumber,
            a.RegistrationNo, a.PurchaseDate, a.PurchaseCost, a.WarrantyExpiry, a.AmcExpiry,
            a.Status, a.SiteId, a.AssignedTo, a.AssignedToName, a.QrPath, a.DepreciationRate,
            a.Quantity, a.CreatedAt);
}
