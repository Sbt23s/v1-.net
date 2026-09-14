using Pixous.HrPortal.Domain.Modules.Audit;

namespace Pixous.HrPortal.Infrastructure.Modules.Audit;

/// <summary>
/// Reading the audit trail, ported from
/// com.pixous.hrportal.modules.audit.AuditController.
/// </summary>
public sealed class AuditBal : IAuditBal
{
    private readonly IAuditReadDal _dal;

    public AuditBal(IAuditReadDal dal)
    {
        _dal = dal;
    }

    /// <summary>
    /// The page size is CLAMPED rather than refused: `min(200, max(1, size))`.
    ///
    /// Different from the notification feed and the employee directory, which
    /// answer 400 for a bad size. That is the Java's choice here and it is kept
    /// -- this screen is an operator tool where a silently-corrected size is
    /// less annoying than an error, and the cap protects a table with thousands
    /// of rows from a size=100000 request.
    /// </summary>
    private static int ClampSize(int size) => Math.Min(200, Math.Max(1, size));

    private static int ClampPage(int page) => Math.Max(0, page);

    public async Task<AuditPage> SearchAsync(AuditQuery query, CancellationToken ct = default)
    {
        var normalised = query with { Page = ClampPage(query.Page), Size = ClampSize(query.Size) };

        (IReadOnlyList<AuditRow> rows, long total) = await _dal.SearchAsync(normalised, ct);

        return new AuditPage(rows, total, TotalPages(total, normalised.Size),
                             normalised.Page, normalised.Size);
    }

    public Task<AuditSummary> SummaryAsync(DateTime from, DateTime to,
                                           CancellationToken ct = default) =>
        _dal.SummaryAsync(from, to, ct);

    public async Task<AuditPage> LoginsAsync(DateTime from, DateTime to, int page, int size,
                                             CancellationToken ct = default)
    {
        int p = ClampPage(page);
        int s = ClampSize(size);

        (IReadOnlyList<AuditRow> rows, long total) = await _dal.LoginsAsync(from, to, p, s, ct);

        return new AuditPage(rows, total, TotalPages(total, s), p, s);
    }

    public Task<IReadOnlyList<AuditRow>> ForEntityAsync(string entityType, string entityId,
                                                        CancellationToken ct = default) =>
        _dal.ForEntityAsync(entityType, entityId, ct);

    private static int TotalPages(long total, int size) =>
        size <= 0 ? 1 : (int)Math.Ceiling(total / (double)size);
}
