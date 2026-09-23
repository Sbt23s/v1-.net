namespace Pixous.HrPortal.Domain.Security;

/// <summary>
/// Forgets every cached principal enrichment, so the next request from each
/// signed-in user reloads their roles and permissions from the database.
///
/// The enricher caches a user's permission codes for up to 60 seconds. Without
/// this, a privilege change would take up to a minute to reach the endpoints;
/// with it, the very next request sees it. Per process: a second instance
/// still catches up within its own 60-second window.
/// </summary>
public interface IPermissionCacheInvalidator
{
    /// <summary>Changes whenever the cache is invalidated; part of every cache key.</summary>
    long Version { get; }

    void InvalidateAll();
}
