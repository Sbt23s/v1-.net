namespace Pixous.HrPortal.Domain.Security;

/// <summary>
/// The reversible copy of an account's password, kept beside the BCrypt hash so
/// HR can read it back rather than only replace it.
///
/// Two things this is NOT: it is not what signing in checks — that is still the
/// hash — and it is not a substitute for one. It exists because the product
/// requires showing a password on an employee record.
/// </summary>
public interface IPasswordVault
{
    /// <summary>Encrypts a password for storage. Null in, null out.</summary>
    string? Seal(string? plain);

    /// <summary>
    /// Decrypts a stored password, or null when there is nothing stored or the
    /// value cannot be opened with the current secret. Never throws.
    /// </summary>
    string? Open(string? sealedValue);
}
