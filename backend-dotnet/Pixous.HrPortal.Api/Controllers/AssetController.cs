using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Pixous.HrPortal.Domain.Common;
using Pixous.HrPortal.Domain.Modules.Asset;
using Pixous.HrPortal.Domain.Security;

namespace Pixous.HrPortal.Api.Controllers;

/// <summary>
/// Company assets, ported from
/// com.pixous.hrportal.modules.asset.AssetController.
/// </summary>
[ApiController]
[Route("api/assets")]
[Authorize]
public sealed class AssetController : ControllerBase
{
    private readonly IAssetBal _assets;
    private readonly ICurrentUser _currentUser;

    public AssetController(IAssetBal assets, ICurrentUser currentUser)
    {
        _assets = assets;
        _currentUser = currentUser;
    }

    [HttpGet]
    [Authorize(Policy = "ASSET_MANAGE")]
    public async Task<PageResponse<AssetResponse>> List(
        [FromQuery] string? status,
        [FromQuery] string? category,
        [FromQuery] int page = 0,
        [FromQuery] int size = 20,
        CancellationToken ct = default) =>
        await _assets.ListPagedAsync(status, category, page, size, ct);

    [HttpGet("my-assets")]
    public async Task<ApiResponse<IReadOnlyList<AssetResponse>>> MyAssets(CancellationToken ct) =>
        ApiResponse<IReadOnlyList<AssetResponse>>.Ok(
            await _assets.MyAssetsResponseAsync(_currentUser.RequireUserId(), ct));

    [HttpGet("{id:long}")]
    public async Task<ApiResponse<AssetResponse>> Get(long id, CancellationToken ct) =>
        ApiResponse<AssetResponse>.Ok(await _assets.GetResponseAsync(id, ct));

    [HttpPost]
    [Authorize(Policy = "ASSET_MANAGE")]
    public async Task<ApiResponse<AssetResponse>> Create(
        [FromBody] AssetRequest request,
        CancellationToken ct) =>
        ApiResponse<AssetResponse>.Ok(
            await _assets.CreateAsync(request, ct),
            "Asset registered");

    [HttpGet("{id:long}/qr")]
    public async Task<IActionResult> Qr(long id, CancellationToken ct)
    {
        byte[] png = await _assets.QrPngAsync(id, ct);
        return File(png, "image/png");
    }

    [HttpDelete("{id:long}")]
    [Authorize(Policy = "ASSET_MANAGE")]
    public async Task<ApiResponse<object>> Delete(long id, CancellationToken ct)
    {
        await _assets.DeleteAsync(id, ct);
        return ApiResponse.Message("Asset deleted");
    }

    [HttpPost("{id:long}/allocate")]
    [Authorize(Policy = "ASSET_MANAGE")]
    public async Task<ApiResponse<AssetResponse>> Allocate(
        long id,
        [FromBody] AllocateRequest request,
        CancellationToken ct) =>
        ApiResponse<AssetResponse>.Ok(
            await _assets.AllocateAssetAsync(id, request.UserId, ct),
            "Asset allocated");

    [HttpPost("{id:long}/acknowledge")]
    public async Task<ApiResponse<AssetResponse>> Acknowledge(long id, CancellationToken ct) =>
        ApiResponse<AssetResponse>.Ok(
            await _assets.AcknowledgeAssetAsync(_currentUser.RequireUserId(), id, ct),
            "Receipt acknowledged");

    [HttpPost("{id:long}/return")]
    [Authorize(Policy = "ASSET_MANAGE")]
    public async Task<ApiResponse<AssetResponse>> Return(
        long id,
        [FromBody] ReturnRequest request,
        CancellationToken ct) =>
        ApiResponse<AssetResponse>.Ok(
            await _assets.ReturnAssetAsync(id, request.Condition, ct),
            "Asset returned");

    [HttpGet("lookup")]
    public async Task<ApiResponse<AssetResponse>> GetByCode(
        [FromQuery] string code,
        CancellationToken ct) =>
        ApiResponse<AssetResponse>.Ok(await _assets.GetByCodeAsync(code, ct));
}
