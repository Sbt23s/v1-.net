using Pixous.HrPortal.Domain.Common;
using Pixous.HrPortal.Domain.Modules.Announcement;


namespace Pixous.HrPortal.Infrastructure.Modules.Announcement;

/// <summary>
/// Ported from GlobalLoginAnnouncementService.
///
/// The one invariant the module maintains: at most one announcement is ACTIVE.
/// Publishing retires the others rather than adding to them, because the login
/// screen has room for exactly one.
/// </summary>
public sealed class AnnouncementBal : IAnnouncementBal
{
    private readonly IAnnouncementDal _dal;
    private readonly IRealtimePublisher _realtime;
    private readonly IStorageService _storage;

    public AnnouncementBal(IAnnouncementDal dal, IRealtimePublisher realtime, IStorageService storage)
    {
        _dal = dal;
        _realtime = realtime;
        _storage = storage;
    }

    public async Task<AnnouncementRecord?> ActiveForRoleAsync(string? role,
                                                              CancellationToken ct = default)
    {
        AnnouncementRecord? ann = await _dal.FindLatestActiveAsync(ct);

        if (ann is null)
        {
            return null;
        }

        // The role test runs AFTER the single row has been chosen: not reaching
        // this caller means they see nothing, not that an older announcement is
        // tried instead. That is the Java's behaviour and it is kept.
        return AnnouncementTargeting.Reaches(ann.TargetRoles, role) ? ann : null;
    }

    public Task<IReadOnlyList<AnnouncementRecord>> ListAllAsync(CancellationToken ct = default) =>
        _dal.FindNotDeletedAsync(ct);

    public async Task<AnnouncementRecord> UpdateStatusAsync(long id, string? status,
                                                            CancellationToken ct = default)
    {
        AnnouncementRecord ann = await _dal.FindAsync(id, ct)
            ?? throw ApiException.NotFound("Announcement not found");

        // The controller defaults a missing status to INACTIVE, and anything
        // that is not ACTIVE retires the announcement -- there is no validation
        // arm here in the Java, and adding one would reject requests the live
        // client may already be sending.
        string newStatus = (status ?? "INACTIVE").ToUpperInvariant();

        if (newStatus == "ACTIVE")
        {
            // Retire whatever else is on the login screen first, skipping this
            // row so it is not retired and republished in the same call.
            foreach (AnnouncementRecord other in await _dal.FindByStatusAsync("ACTIVE", ct))
            {
                if (other.Id != id)
                {
                    await _dal.UpdateStatusAsync(other.Id, "INACTIVE", null, null, ct);
                }
            }

            ann.Status = "ACTIVE";
            ann.PublishedAt = DateTime.Now;
            await _dal.UpdateStatusAsync(id, "ACTIVE", ann.PublishedAt, null, ct);
        }
        else
        {
            ann.Status = "INACTIVE";
            await _dal.UpdateStatusAsync(id, "INACTIVE", null, null, ct);
        }

        await BroadcastAsync(newStatus == "ACTIVE" ? "PUBLISHED" : "INACTIVATED", ann, ct);
        return ann;
    }

    public async Task DeleteAsync(long id, CancellationToken ct = default)
    {
        AnnouncementRecord ann = await _dal.FindAsync(id, ct)
            ?? throw ApiException.NotFound("Announcement not found");

        // Soft: the row stays and only stops being listed.
        ann.Status = "DELETED";
        ann.DeletedAt = DateTime.Now;
        await _dal.UpdateStatusAsync(id, "DELETED", null, ann.DeletedAt, ct);

        await BroadcastAsync("DELETED", ann, ct);
    }

    public async Task<AnnouncementRecord> CreateAndPublishAsync(
        string? mediaType,
        string? title,
        string? description,
        string? targetRoles,
        int? durationSeconds,
        bool? publishImmediately,
        Stream? fileStream,
        string? fileName,
        string? contentType,
        long? fileSize,
        Stream? effectStream,
        string? effectFileName,
        string? effectContentType,
        long? effectFileSize,
        bool? effectEnabled,
        long? createdBy,
        string? createdByName,
        CancellationToken ct = default)
    {
        if (fileStream is null || fileSize is null or <= 0)
        {
            throw ApiException.Business("Media file is required for announcement");
        }

        string storedMedia = await _storage.StoreAsync(fileStream, fileName, contentType, fileSize.Value, "announcements", ct);
        string mediaUrl = storedMedia.StartsWith("/api/files/")
            ? storedMedia
            : "/api/files/" + storedMedia.TrimStart('/');

        string? effectUrl = null;
        string? effectName = null;
        long? effectSize = null;

        if (effectStream is not null && effectFileSize is > 0)
        {
            string storedEffect = await _storage.StoreAsync(effectStream, effectFileName, effectContentType, effectFileSize.Value, "announcements", ct);
            effectUrl = storedEffect.StartsWith("/api/files/")
                ? storedEffect
                : "/api/files/" + storedEffect.TrimStart('/');
            effectName = effectFileName;
            effectSize = effectFileSize;
        }

        bool playEffect = (effectEnabled == true) && effectUrl is not null;
        bool active = publishImmediately ?? true;

        if (active)
        {
            var activeList = await _dal.FindByStatusAsync("ACTIVE", ct);
            foreach (var item in activeList)
            {
                await _dal.UpdateStatusAsync(item.Id, "INACTIVE", null, null, ct);
            }
        }

        var ann = new AnnouncementRecord
        {
            Title = title,
            Description = description,
            MediaType = string.IsNullOrWhiteSpace(mediaType) ? "IMAGE" : mediaType.Trim().ToUpperInvariant(),
            MediaUrl = mediaUrl,
            MediaName = fileName,
            MediaSize = fileSize,
            EffectUrl = effectUrl,
            EffectName = effectName,
            EffectSize = effectSize,
            EffectEnabled = playEffect,
            Status = active ? "ACTIVE" : "INACTIVE",
            TargetRoles = !string.IsNullOrWhiteSpace(targetRoles) ? targetRoles.Trim() : "Employee,TL,HR,Admin",
            DurationSeconds = durationSeconds is > 0 ? durationSeconds.Value : 15,
            CreatedBy = createdBy,
            CreatedByName = createdByName,
            CreatedAt = DateTime.Now,
            UpdatedAt = DateTime.Now,
            PublishedAt = active ? DateTime.Now : null
        };

        long id = await _dal.InsertAsync(ann, ct);
        ann.Id = id;

        if (active)
        {
            await BroadcastAsync("PUBLISHED", ann, ct);
        }

        return ann;
    }

    /// <summary>
    /// Tells every open login screen the announcement changed.
    ///
    /// The Java swallows any failure here, and so does the publisher: a
    /// broadcast that does not go out must not undo a status change that did.
    /// Carries no media URL beyond what the login popup renders.
    /// </summary>
    private Task BroadcastAsync(string action, AnnouncementRecord ann, CancellationToken ct) =>
        _realtime.SendAsync("/topic/global-announcement", new Dictionary<string, object?>
        {
            ["action"] = action,
            ["id"] = ann.Id,
            ["title"] = ann.Title,
            ["description"] = ann.Description,
            ["mediaType"] = ann.MediaType,
            ["mediaUrl"] = ann.MediaUrl,
            ["status"] = ann.Status,
            ["targetRoles"] = ann.TargetRoles,
            ["durationSeconds"] = ann.DurationSeconds,
            ["timestamp"] = DateTimeOffset.Now.ToUnixTimeMilliseconds()
        }, ct);
}
