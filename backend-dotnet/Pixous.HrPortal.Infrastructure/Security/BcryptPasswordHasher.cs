using Pixous.HrPortal.Domain.Security;

namespace Pixous.HrPortal.Infrastructure.Security;

/// <summary>
/// BCrypt hashing that interoperates with Spring Security's
/// BCryptPasswordEncoder, because the hashes in the database were written by it.
///
/// Two details are load-bearing:
///
///   1. **Cost 10.** BCryptPasswordEncoder's no-argument constructor uses
///      strength 10, which is what the Java side constructs. The cost is stored
///      in the hash, so verification of an existing password would work at any
///      setting -- but a password CHANGED here would be written at a different
///      cost from every other row, so the default is pinned rather than left to
///      the library.
///
///   2. **Both $2a$ and $2b$ are accepted.** The live table holds a mix of the
///      two: jBCrypt writes $2a$ and newer encoders write $2b$. They differ only
///      in a header byte, not in the algorithm, and refusing either would lock
///      out the accounts that carry it. Verified in the sandbox schema: 2 rows
///      at $2a$10$ and 29 at $2b$10$.
/// </summary>
public sealed class BcryptPasswordHasher : IPasswordHasher
{
    /// <summary>BCryptPasswordEncoder()'s default strength.</summary>
    private const int WorkFactor = 10;

    public string Hash(string rawPassword) =>
        BCrypt.Net.BCrypt.HashPassword(rawPassword, WorkFactor);

    public bool Verify(string rawPassword, string? hash)
    {
        // A row with no hash at all cannot be signed into. Spring's encoder logs
        // a warning and answers false rather than throwing, and a null here must
        // not become a 500 on the login form.
        if (string.IsNullOrWhiteSpace(hash))
        {
            return false;
        }

        try
        {
            return BCrypt.Net.BCrypt.Verify(rawPassword, hash);
        }
        catch (BCrypt.Net.SaltParseException)
        {
            // A malformed or truncated hash -- a row written by something else,
            // or a column that has been cut. Not a server fault, and not a
            // successful login either.
            return false;
        }
    }
}
