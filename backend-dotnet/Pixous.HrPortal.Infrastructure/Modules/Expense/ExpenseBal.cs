using Pixous.HrPortal.Domain.Common;
using Pixous.HrPortal.Domain.Modules.Expense;

namespace Pixous.HrPortal.Infrastructure.Modules.Expense;

/// <summary>
/// Travel-allowance claims, ported from
/// com.pixous.hrportal.modules.expense.TaExpenseService.
/// </summary>
public sealed class ExpenseBal : IExpenseBal
{
    private readonly IExpenseDal _dal;

    public ExpenseBal(IExpenseDal dal)
    {
        _dal = dal;
    }

    public async Task<ExpenseRecord> CreateAsync(long userId, ExpenseRequest req,
                                                 CancellationToken ct = default)
    {
        var claim = new ExpenseRecord
        {
            UserId = userId,
            Status = "PENDING"
        };

        Apply(claim, req);
        await _dal.InsertAsync(claim, ct);

        return await _dal.FindAsync(claim.Id, ct) ?? claim;
    }

    public async Task<ExpenseRecord> UpdateAsync(long userId, long id, ExpenseRequest req,
                                                 bool isApprover, CancellationToken ct = default)
    {
        ExpenseRecord claim = await Require(id, ct);

        if (!isApprover)
        {
            if (claim.UserId != userId)
            {
                throw new Domain.Common.AccessDeniedException("You can only edit your own claim");
            }

            if (!string.Equals(claim.Status, "PENDING", StringComparison.OrdinalIgnoreCase))
            {
                throw ApiException.Business(
                    "This claim has already been reviewed and can no longer be edited");
            }
        }

        Apply(claim, req);
        claim.UpdatedAt = DateTime.Now;
        await _dal.UpdateAsync(claim, ct);

        return await _dal.FindAsync(id, ct) ?? claim;
    }

    public Task<IReadOnlyList<ExpenseRecord>> MineAsync(long userId,
                                                        CancellationToken ct = default) =>
        _dal.FindForUserAsync(userId, ct);

    public async Task<IReadOnlyList<ExpenseRecord>> MyTeamAsync(long userId,
                                                                CancellationToken ct = default)
    {
        IReadOnlyList<long> teammateIds = await _dal.FindTeammateIdsAsync(userId, ct);
        if (teammateIds.Count == 0)
        {
            return await MineAsync(userId, ct);
        }
        return await _dal.FindForTeamAsync(teammateIds, ct);
    }

    public Task<IReadOnlyList<ExpenseRecord>> AllAsync(CancellationToken ct = default) =>
        _dal.FindAllAsync(ct);

    public async Task<ExpenseRecord> DecideAsync(long deciderId, long id, string? status,
                                                 string? comment, CancellationToken ct = default)
    {
        ExpenseRecord claim = await Require(id, ct);

        string normalized = status?.Trim().ToUpperInvariant() ?? string.Empty;

        if (normalized is not ("APPROVED" or "REJECTED" or "PENDING"))
        {
            throw ApiException.Business("Status must be APPROVED, REJECTED or PENDING");
        }

        if (deciderId == claim.UserId && normalized != "PENDING")
        {
            throw ApiException.Business(
                $"You cannot {normalized.ToLowerInvariant()} your own claim. "
                + "It has to be decided by somebody else.");
        }

        if (normalized == "REJECTED" && string.IsNullOrWhiteSpace(comment))
        {
            throw ApiException.Business("A reason is required to reject a claim");
        }

        claim.Status = normalized;
        claim.DecisionComment = comment;
        claim.DecidedBy = deciderId;
        claim.DecidedAt = DateTime.Now;
        claim.UpdatedAt = DateTime.Now;

        await _dal.UpdateAsync(claim, ct);
        return await _dal.FindAsync(id, ct) ?? claim;
    }

    public async Task<ExpenseRecord> CancelAsync(long userId, long id,
                                                 CancellationToken ct = default)
    {
        ExpenseRecord claim = await Require(id, ct);

        if (claim.UserId != userId)
        {
            throw ApiException.Business("You can only cancel your own claim");
        }

        if (string.Equals(claim.Status, "CANCELLED", StringComparison.OrdinalIgnoreCase))
        {
            throw ApiException.Business("This claim is already cancelled.");
        }

        if (!string.Equals(claim.Status, "PENDING", StringComparison.OrdinalIgnoreCase))
        {
            throw ApiException.Business(
                "This claim has already been reviewed and can no longer be cancelled.");
        }

        claim.Status = "CANCELLED";
        claim.UpdatedAt = DateTime.Now;
        await _dal.UpdateAsync(claim, ct);

        return claim;
    }

    public async Task DeleteAsync(long userId, long id, bool isAdmin, CancellationToken ct = default)
    {
        ExpenseRecord claim = await Require(id, ct);
        if (!isAdmin && claim.UserId != userId)
        {
            throw new Domain.Common.AccessDeniedException("You are not allowed to delete this claim");
        }
        await _dal.DeleteAsync(id, ct);
    }

    private static void Apply(ExpenseRecord claim, ExpenseRequest req)
    {
        claim.Date = req.Date;
        claim.Location = req.Location;
        claim.StartingKm = req.StartingKm;
        claim.EndingKm = req.EndingKm;
        claim.TotalKm = req.TotalKm;
        claim.HillsKm = req.HillsKm;
        claim.PlainsKm = req.PlainsKm;
        claim.TotalAmount = req.TotalAmount;
        claim.BusFare = req.BusFare;
        claim.Others = req.Others;
        claim.GrossTotal = req.GrossTotal;
        claim.Remarks = req.Remarks;
        claim.Category = req.Category;
        claim.PetrolSlipPath = req.PetrolSlipPath;
        claim.Photos = req.Photos;
    }

    private async Task<ExpenseRecord> Require(long id, CancellationToken ct) =>
        await _dal.FindAsync(id, ct) ?? throw ApiException.NotFound("TA Expense");
}
