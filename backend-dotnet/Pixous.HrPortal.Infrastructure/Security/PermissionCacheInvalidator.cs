using Pixous.HrPortal.Domain.Security;

namespace Pixous.HrPortal.Infrastructure.Security;

/// <summary>
/// A generation counter rather than a list of keys to evict: bumping it makes
/// every existing entry unreachable at once, and the old ones expire on their
/// own within their 60 seconds.
/// </summary>
public sealed class PermissionCacheInvalidator : IPermissionCacheInvalidator
{
    private long _version;

    public long Version => Interlocked.Read(ref _version);

    public void InvalidateAll() => Interlocked.Increment(ref _version);
}
