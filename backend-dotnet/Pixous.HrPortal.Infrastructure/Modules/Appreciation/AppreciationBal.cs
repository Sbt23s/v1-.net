using Pixous.HrPortal.Domain.Common;
using Pixous.HrPortal.Domain.Modules.Appreciation;
using Pixous.HrPortal.Domain.Modules.Notification;

namespace Pixous.HrPortal.Infrastructure.Modules.Appreciation;

/// <summary>
/// Appreciation letters, ported from
/// com.pixous.hrportal.modules.appreciation.AppreciationService.
///
/// Two rules carry the module, and both are about not undoing praise:
///
///   - a SENT letter cannot be deleted, because the person it praises has
///     already read it; and
///   - a sent letter is marked viewed the first time its SUBJECT opens it, and
///     the issuer is told — but writing a letter and then opening it yourself
///     must not mark it viewed.
/// </summary>
public sealed class AppreciationBal : IAppreciationBal
{
    private readonly IAppreciationDal _dal;
    private readonly INotificationBal _notifications;

    public AppreciationBal(IAppreciationDal dal, INotificationBal notifications)
    {
        _dal = dal;
        _notifications = notifications;
    }

    public async Task<AppreciationRecord> CreateAsync(long issuerId, AppreciationRequest req,
                                                      CancellationToken ct = default)
    {
        bool send = req.Send ?? false;

        var letter = new AppreciationRecord
        {
            ReferenceCode = await NextCodeAsync(ct),
            EmployeeId = req.EmployeeId,
            IssuedBy = issuerId,
            LetterDate = req.LetterDate,
            Achievement = req.Achievement.Trim(),
            Message = req.Message.Trim(),
            Template = req.Template,
            Status = send ? "SENT" : "DRAFT"
        };

        await _dal.InsertAsync(letter, ct);

        if (send)
        {
            await NotifyIssuedAsync(letter, ct);
        }

        return await _dal.FindAsync(letter.Id, ct) ?? letter;
    }

    public async Task<AppreciationRecord> SendAsync(long actorId, long id,
                                                    CancellationToken ct = default)
    {
        AppreciationRecord letter = await Require(id, ct);

        if (string.Equals(letter.Status, "SENT", StringComparison.Ordinal))
        {
            throw ApiException.Business("This letter has already been sent.");
        }

        letter.Status = "SENT";
        letter.UpdatedAt = DateTime.Now;
        await _dal.UpdateAsync(letter, ct);

        await NotifyIssuedAsync(letter, ct);

        return await _dal.FindAsync(id, ct) ?? letter;
    }

    public async Task DeleteAsync(long id, CancellationToken ct = default)
    {
        AppreciationRecord letter = await Require(id, ct);

        // Only a draft. A sent one has been read by the person it praises, and
        // withdrawing an appreciation after the fact is not a thing the product
        // should make easy.
        if (string.Equals(letter.Status, "SENT", StringComparison.Ordinal))
        {
            throw ApiException.Business(
                "A letter that has been sent cannot be deleted. The employee has already seen it.");
        }

        await _dal.DeleteAsync(id, ct);
    }

    public Task<IReadOnlyList<AppreciationRecord>> AllAsync(CancellationToken ct = default) =>
        _dal.FindAllAsync(ct);

    public Task<IReadOnlyList<AppreciationRecord>> MineAsync(long userId,
                                                             CancellationToken ct = default) =>
        _dal.FindForEmployeeAsync(userId, ct);

    public async Task<AppreciationRecord> GetAsync(long viewerId, long id, bool canIssue,
                                                   CancellationToken ct = default)
    {
        AppreciationRecord letter = await Require(id, ct);

        bool isSubject = letter.EmployeeId == viewerId;
        bool allowed = isSubject || letter.IssuedBy == viewerId || canIssue;

        if (!allowed)
        {
            throw ApiException.Business("That letter is not yours to read.");
        }

        // Marked viewed only for the SUBJECT, only when SENT, and only once --
        // writing a letter and then opening it should not mark it viewed.
        if (isSubject
            && string.Equals(letter.Status, "SENT", StringComparison.Ordinal)
            && letter.ViewedAt is null)
        {
            letter.ViewedAt = DateTime.Now;
            await _dal.UpdateAsync(letter, ct);

            if (letter.IssuedBy is not null)
            {
                await _notifications.CreateAndPushAsync(
                    letter.IssuedBy.Value,
                    "Appreciation letter viewed",
                    $"{letter.EmployeeName ?? "The employee"} opened {letter.ReferenceCode}.",
                    "APPRECIATION", "/appreciation", ct);
            }
        }

        return letter;
    }

    private Task NotifyIssuedAsync(AppreciationRecord letter, CancellationToken ct) =>
        _notifications.CreateAndPushAsync(
            letter.EmployeeId,
            "You have an appreciation letter",
            $"{letter.ReferenceCode}: {letter.Achievement}",
            "APPRECIATION", "/appreciation", ct);

    /// <summary>
    /// The next reference code: <c>AL-{year}-{00001}</c>, counted up from the
    /// highest existing one rather than from the row count — the same reason as
    /// discipline: counting rows regenerates a used code after a deletion and
    /// the column is unique.
    /// </summary>
    private async Task<string> NextCodeAsync(CancellationToken ct)
    {
        string prefix = $"AL-{DateTime.Now.Year}-";
        string? max = await _dal.FindMaxReferenceCodeAsync(prefix, ct);

        long next = 1;
        if (max is not null && max.Length > prefix.Length
            && long.TryParse(max[prefix.Length..], out long parsed))
        {
            next = parsed + 1;
        }

        return prefix + next.ToString("00000");
    }

    public async Task<byte[]> GetPdfAsync(long viewerId, long id, bool canIssue, CancellationToken ct = default)
    {
        AppreciationRecord letter = await Require(id, ct);

        bool isSubject = letter.EmployeeId == viewerId;
        bool allowed = isSubject || letter.IssuedBy == viewerId || canIssue;

        if (!allowed)
        {
            throw ApiException.Business("That letter is not yours to read.");
        }

        byte[] pdfBytes = Reporting.AppreciationPdfRenderer.Render(
            letter,
            letter.EmployeeName,
            letter.EmployeeDesignation,
            letter.IssuedByName,
            letter.IssuedByDesignation);

        if (isSubject && letter.DownloadedAt is null)
        {
            letter.DownloadedAt = DateTime.Now;
            await _dal.UpdateAsync(letter, ct);

            if (letter.IssuedBy is not null)
            {
                await _notifications.CreateAndPushAsync(
                    letter.IssuedBy.Value,
                    "Appreciation letter downloaded",
                    $"{letter.EmployeeName ?? "The employee"} downloaded {letter.ReferenceCode}.",
                    "APPRECIATION", "/appreciation", ct);
            }
        }

        return pdfBytes;
    }

    public async Task MarkDownloadedAsync(long viewerId, long id, CancellationToken ct = default)
    {
        AppreciationRecord letter = await Require(id, ct);
        if (letter.EmployeeId != viewerId) return;
        if (letter.DownloadedAt is not null) return;

        letter.DownloadedAt = DateTime.Now;
        await _dal.UpdateAsync(letter, ct);

        if (letter.IssuedBy is not null)
        {
            await _notifications.CreateAndPushAsync(
                letter.IssuedBy.Value,
                "Appreciation letter downloaded",
                $"{letter.EmployeeName ?? "The employee"} downloaded {letter.ReferenceCode}.",
                "APPRECIATION", "/appreciation", ct);
        }
    }

    private async Task<AppreciationRecord> Require(long id, CancellationToken ct) =>
        await _dal.FindAsync(id, ct) ?? throw ApiException.NotFound("Appreciation letter");
}

