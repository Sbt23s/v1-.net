namespace Pixous.HrPortal.Domain.Security;

/// <summary>
/// BCrypt hashing, matching Spring Security's BCryptPasswordEncoder.
///
/// This has to interoperate with hashes already in the database: every existing
/// password was hashed by the Java side, and a user must be able to sign in to
/// either backend with the same password.
/// </summary>
public interface IPasswordHasher
{
    /// <summary>A new BCrypt hash of <paramref name="rawPassword"/>.</summary>
    string Hash(string rawPassword);

    /// <summary>
    /// Whether <paramref name="rawPassword"/> matches <paramref name="hash"/>.
    /// Returns false rather than throwing when the stored hash is malformed.
    /// </summary>
    bool Verify(string rawPassword, string? hash);
}
