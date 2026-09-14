using System.Globalization;
using Pixous.HrPortal.Domain.Common;
using Pixous.HrPortal.Domain.Modules.Notification;
using Pixous.HrPortal.Domain.Modules.Safety;

namespace Pixous.HrPortal.Infrastructure.Modules.Safety;

/// <summary>
/// Ported from SafetyIncidentService.
///
/// The rule that carries the module is anonymity: the row records who reported
/// an incident, and every view of it shows "Anonymous" when they asked for
/// that. Applied in <see cref="ToResponseAsync"/>, which is the only way a row
/// becomes a response, so no caller can go round it.
/// </summary>
public sealed class SafetyBal : ISafetyBal
{
    private readonly ISafetyDal _dal;
    private readonly INotificationBal _notifications;
    private readonly ISmsService _sms;

    public SafetyBal(ISafetyDal dal, INotificationBal notifications, ISmsService sms)
    {
        _dal = dal;
        _notifications = notifications;
        _sms = sms;
    }

    public async Task<SafetyIncidentResponse> ReportAsync(long userId,
                                                          SafetyIncidentRequest request,
                                                          CancellationToken ct = default)
    {
        var row = new SafetyIncidentRow
        {
            ReferenceCode = await NextCodeAsync(ct),
            ReportedBy = userId,
            IncidentType = SafetyVocabulary.Normalise(request.IncidentType,
                                                      SafetyVocabulary.IncidentTypes, "NEAR_MISS"),
            Description = request.Description.Trim(),
            Zone = string.IsNullOrWhiteSpace(request.Zone) ? null : request.Zone,
            Anonymous = request.Anonymous,
            Severity = SafetyVocabulary.Normalise(request.Severity,
                                                  SafetyVocabulary.Severities, "MEDIUM"),
            Status = "OPEN",
            OccurredAt = ParseOccurredAt(request.OccurredAt)
        };

        await _dal.InsertAsync(row, ct);

        await NotifyStaffAsync(row, userId, ct);

        return await ToResponseAsync(row, ct);
    }

    public async Task<PageResponse<SafetyIncidentResponse>> MyReportsAsync(
        long userId, int page, int size, CancellationToken ct = default)
    {
        (IReadOnlyList<SafetyIncidentRow> rows, long total) =
            await _dal.FindForReporterAsync(userId, page, size, ct);

        return await PageAsync(rows, total, page, size, ct);
    }

    public async Task<PageResponse<SafetyIncidentResponse>> AllAsync(
        string? status, string? incidentType, int page, int size, CancellationToken ct = default)
    {
        // Blank means no filter; otherwise upper-cased, because the stored
        // values are upper case and a lower-case filter would match nothing.
        string? statusFilter = string.IsNullOrWhiteSpace(status)
            ? null
            : status.ToUpperInvariant();

        string? typeFilter = string.IsNullOrWhiteSpace(incidentType)
            ? null
            : incidentType.ToUpperInvariant();

        (IReadOnlyList<SafetyIncidentRow> rows, long total) =
            await _dal.FilterAllAsync(statusFilter, typeFilter, page, size, ct);

        return await PageAsync(rows, total, page, size, ct);
    }

    public async Task<SafetyIncidentResponse> GetAsync(long id, CancellationToken ct = default) =>
        await ToResponseAsync(await FindAsync(id, ct), ct);

    public async Task<SafetyIncidentResponse> ResolveAsync(long staffId, long id,
                                                           SafetyResolutionRequest request,
                                                           CancellationToken ct = default)
    {
        SafetyIncidentRow row = await FindAsync(id, ct);

        // Validated, not defaulted -- staff are acting on this incident, and
        // quietly filing it under the wrong state would be worse than saying
        // the value was wrong.
        if (!SafetyVocabulary.IsValidStatus(request.Status))
        {
            throw ApiException.Business($"Invalid status: {request.Status}");
        }

        string status = request.Status.Trim().ToUpperInvariant();
        row.Status = status;

        // Only overwrite the notes when something was actually written: a
        // status change with no note must not erase the note already there.
        if (!string.IsNullOrWhiteSpace(request.ResolutionNotes))
        {
            row.ResolutionNotes = request.ResolutionNotes.Trim();
        }

        row.ResolvedBy = staffId;

        // Both endings stamp the time, and anything else CLEARS it -- moving an
        // incident back to INVESTIGATING must not leave a resolved-at time on
        // an incident that is open again.
        row.ResolvedAt = SafetyVocabulary.IsFinished(status) ? DateTime.Now : null;

        await _dal.UpdateAsync(row, ct);

        await NotifyReporterAsync(row, status, ct);

        return await ToResponseAsync(row, ct);
    }

    // ---- internals ---------------------------------------------------------

    private async Task<SafetyIncidentRow> FindAsync(long id, CancellationToken ct) =>
        await _dal.FindAsync(id, ct) ?? throw ApiException.NotFound("Safety Incident");

    /// <summary>
    /// <c>SI-{year}-{00001}</c>, from the row count plus one.
    ///
    /// Transcribed rather than improved. It is not collision-proof -- two
    /// reports in the same instant can take the same number, and a deleted row
    /// makes it reuse one -- but the code is display only, the id is the key,
    /// and changing the scheme would renumber against the Java while both run.
    /// The sibling modules count from the highest existing code instead; this
    /// one does not, and that difference is the Java's.
    /// </summary>
    private async Task<string> NextCodeAsync(CancellationToken ct)
    {
        long next = await _dal.CountAsync(ct) + 1;
        return $"SI-{DateTime.Now.Year}-{next:00000}";
    }

    /// <summary>
    /// An optional ISO date-time. Unparseable input is left null rather than
    /// failing the report -- somebody is telling us about an injury, and a
    /// malformed timestamp is not a reason to lose that.
    /// </summary>
    private static DateTime? ParseOccurredAt(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        return DateTime.TryParse(value, CultureInfo.InvariantCulture,
                                 DateTimeStyles.None, out DateTime parsed)
            ? parsed
            : null;
    }

    private async Task<PageResponse<SafetyIncidentResponse>> PageAsync(
        IReadOnlyList<SafetyIncidentRow> rows, long total, int page, int size,
        CancellationToken ct)
    {
        var content = new List<SafetyIncidentResponse>(rows.Count);

        foreach (SafetyIncidentRow row in rows)
        {
            content.Add(await ToResponseAsync(row, ct));
        }

        return PageResponse<SafetyIncidentResponse>.Of(content, page, size, total);
    }

    /// <summary>
    /// The only way a row becomes a response, so the anonymity rule cannot be
    /// gone round: an anonymous report reads "Anonymous" however the row is
    /// reached.
    /// </summary>
    private async Task<SafetyIncidentResponse> ToResponseAsync(SafetyIncidentRow s,
                                                               CancellationToken ct)
    {
        string? reportedByName = s.Anonymous ? "Anonymous" : await SafeNameAsync(s.ReportedBy, ct);
        string? resolvedByName = await SafeNameAsync(s.ResolvedBy, ct);

        return new SafetyIncidentResponse(
            s.Id, s.ReferenceCode, s.ReportedBy, reportedByName, s.SiteId,
            s.IncidentType, s.Description, s.Zone, s.Anonymous, s.Status, s.Severity,
            s.OccurredAt, s.ResolvedBy, resolvedByName, s.ResolutionNotes,
            s.ResolvedAt, s.CreatedAt);
    }

    /// <summary>A name, or "User" when the account has gone. Null for no id.</summary>
    private async Task<string?> SafeNameAsync(long? userId, CancellationToken ct)
    {
        if (userId is null)
        {
            return null;
        }

        var user = await _dal.FindUserAsync(userId.Value, ct);
        return user?.Name ?? "User";
    }

    /// <summary>
    /// Tells everybody who investigates safety that something was reported,
    /// except the person who reported it.
    ///
    /// The submitter's name honours anonymity here too -- a notification saying
    /// who filed an anonymous report would undo the promise as surely as the
    /// list would.
    /// </summary>
    private async Task NotifyStaffAsync(SafetyIncidentRow row, long reporterId,
                                        CancellationToken ct)
    {
        string submitter = row.Anonymous
            ? "Anonymous"
            : await SafeNameAsync(reporterId, ct) ?? "User";

        string what = SafetyVocabulary.Humanise(row.IncidentType);

        foreach ((long id, _, string? phone) in await _dal.FindHoldersOfAsync("REPORT_VIEW", ct))
        {
            if (id == reporterId)
            {
                continue;
            }

            await _notifications.CreateAndPushAsync(
                id,
                $"New safety incident: {row.ReferenceCode}",
                $"{submitter} reported a {what}",
                "SAFETY", "/safety-incidents", ct);

            await SmsAsync(phone,
                $"{submitter} reported a safety incident ({row.ReferenceCode}). "
                + "Please review in the portal.", ct);
        }
    }

    private async Task NotifyReporterAsync(SafetyIncidentRow row, string status,
                                           CancellationToken ct)
    {
        if (row.ReportedBy is null)
        {
            return;
        }

        string readable = SafetyVocabulary.Humanise(status);

        await _notifications.CreateAndPushAsync(
            row.ReportedBy.Value,
            $"{row.ReferenceCode} updated",
            $"Your safety incident is now {readable}",
            "SAFETY", "/safety-incidents", ct);

        var user = await _dal.FindUserAsync(row.ReportedBy.Value, ct);
        await SmsAsync(user?.Phone, $"{row.ReferenceCode} is now {readable}.", ct);
    }

    /// <summary>
    /// Texts somebody if there is a usable number. Never throws: a gateway
    /// being down must not fail the report or the resolution that was the point
    /// of the request.
    /// </summary>
    private async Task SmsAsync(string? phone, string message, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(phone))
        {
            return;
        }

        try
        {
            await _sms.SendAsync(phone, "Pixous HR: " + message, ct);
        }
        catch
        {
            // Deliberately swallowed, as the Java's SmsService does internally.
        }
    }
}
