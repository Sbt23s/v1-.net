namespace Pixous.HrPortal.Domain.Modules.Expense;

/// <summary>
/// Travel-allowance claims. Ported from
/// com.pixous.hrportal.modules.expense.TaExpenseService.
/// </summary>
public interface IExpenseBal
{
    Task<ExpenseRecord> CreateAsync(long userId, ExpenseRequest request,
                                    CancellationToken ct = default);

    /// <summary>
    /// Edits a claim. The author may edit their own while it is still PENDING;
    /// an approver may edit at any time.
    /// </summary>
    Task<ExpenseRecord> UpdateAsync(long userId, long id, ExpenseRequest request,
                                    bool isApprover, CancellationToken ct = default);

    Task<IReadOnlyList<ExpenseRecord>> MineAsync(long userId, CancellationToken ct = default);

    Task<IReadOnlyList<ExpenseRecord>> MyTeamAsync(long userId, CancellationToken ct = default);

    Task<IReadOnlyList<ExpenseRecord>> AllAsync(CancellationToken ct = default);

    /// <summary>
    /// Decides a claim. **Nobody decides their own** — see the implementation.
    /// A rejection must carry a reason.
    /// </summary>
    Task<ExpenseRecord> DecideAsync(long deciderId, long id, string? status, string? comment,
                                    CancellationToken ct = default);

    Task<ExpenseRecord> CancelAsync(long userId, long id, CancellationToken ct = default);

    Task DeleteAsync(long userId, long id, bool isAdmin, CancellationToken ct = default);
}

/// <summary>A travel claim as submitted. Every amount comes from the form.</summary>
public sealed record ExpenseRequest
{
    public required DateOnly Date { get; init; }
    public string? Location { get; init; }
    public decimal? StartingKm { get; init; }
    public decimal? EndingKm { get; init; }
    public decimal? TotalKm { get; init; }
    public decimal? HillsKm { get; init; }
    public decimal? PlainsKm { get; init; }
    public decimal? TotalAmount { get; init; }
    public decimal? BusFare { get; init; }
    public decimal? Others { get; init; }
    public decimal? GrossTotal { get; init; }
    public string? Remarks { get; init; }
    public string? Category { get; init; }
    public string? PetrolSlipPath { get; init; }
    public string? Photos { get; init; }
}

/// <summary>A row of <c>ta_expenses</c>.</summary>
public sealed class ExpenseRecord
{
    public long Id { get; set; }
    public long UserId { get; set; }
    public DateOnly? Date { get; set; }
    public string? Location { get; set; }
    public decimal? StartingKm { get; set; }
    public decimal? EndingKm { get; set; }
    public decimal? TotalKm { get; set; }
    public decimal? HillsKm { get; set; }
    public decimal? PlainsKm { get; set; }
    public decimal? TotalAmount { get; set; }
    public decimal? BusFare { get; set; }
    public decimal? Others { get; set; }
    public decimal? GrossTotal { get; set; }
    public string? Remarks { get; set; }
    public string? Status { get; set; }
    public string? Category { get; set; }
    public string? PetrolSlipPath { get; set; }
    public string? Photos { get; set; }
    public string? DecisionComment { get; set; }
    public long? DecidedBy { get; set; }
    public DateTime? DecidedAt { get; set; }
    public DateTime? CreatedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }

    /// <summary>Denormalised for the list views.</summary>
    public string? UserName { get; set; }
    public string? EmployeeCode { get; set; }
    public string? DesignationTitle { get; set; }
}

/// <summary>Data access for travel claims.</summary>
public interface IExpenseDal
{
    Task<long> InsertAsync(ExpenseRecord expense, CancellationToken ct = default);
    Task UpdateAsync(ExpenseRecord expense, CancellationToken ct = default);
    Task<ExpenseRecord?> FindAsync(long id, CancellationToken ct = default);
    Task<IReadOnlyList<ExpenseRecord>> FindForUserAsync(long userId, CancellationToken ct = default);
    Task<IReadOnlyList<ExpenseRecord>> FindAllAsync(CancellationToken ct = default);
    Task<IReadOnlyList<ExpenseRecord>> FindForTeamAsync(IReadOnlyList<long> userIds, CancellationToken ct = default);
    Task<IReadOnlyList<long>> FindTeammateIdsAsync(long userId, CancellationToken ct = default);
    Task DeleteAsync(long id, CancellationToken ct = default);
}
