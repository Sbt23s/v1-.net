using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Pixous.HrPortal.Domain.Security;
using Pixous.HrPortal.Infrastructure.Configuration;

namespace Pixous.HrPortal.Infrastructure.Security;

/// <summary>
/// Keeps a readable-back copy of each account's current password, so HR and the
/// admin can see the actual password on an employee's record rather than only
/// being able to replace it.
///
/// Ported from com.pixous.hrportal.modules.auth.PasswordVault.
///
/// Signing in is unaffected: it still checks the BCrypt hash in
/// <c>users.password_hash</c>, which stays exactly as it was. This is a second,
/// reversible copy kept beside it, written every time a password is set.
///
/// It is encrypted rather than stored as text. AES-GCM under a key derived from
/// APP_JWT_SECRET, so a database dump on its own carries nothing readable; the
/// application's secret is needed as well. **Anyone holding both can read every
/// password, which is the cost of showing them at all.**
///
/// The format must match the Java byte for byte, because the two backends read
/// each other's rows:
///
///     key         = SHA-256("pixous:password-vault:v1:" + appSecret)
///     ciphertext  = AES/GCM/NoPadding, 12-byte IV, 128-bit tag
///     stored      = Base64( IV || ciphertext || tag )
///
/// The tag placement is the subtle part. Java's GCM cipher APPENDS the 16-byte
/// tag to the ciphertext, while .NET's AesGcm takes it as a separate argument —
/// so it is split off the end here and re-appended on the way out. Getting that
/// backwards produces output that looks right and never decrypts.
/// </summary>
public sealed class PasswordVault : IPasswordVault
{
    private const int IvBytes = 12;
    private const int TagBytes = 16; // 128 bits

    private readonly byte[] _key;
    private readonly ILogger<PasswordVault> _log;

    public PasswordVault(IOptions<AppOptions> options, ILogger<PasswordVault> log)
    {
        _log = log;

        // A distinct label mixed in, so this key is not the token-signing key
        // itself even though it is grown from the same secret.
        _key = SHA256.HashData(
            Encoding.UTF8.GetBytes("pixous:password-vault:v1:" + options.Value.Jwt.Secret));
    }

    /// <summary>Encrypts a password for storage. Returns null for nothing to store.</summary>
    public string? Seal(string? plain)
    {
        if (string.IsNullOrEmpty(plain))
        {
            return null;
        }

        byte[] iv = RandomNumberGenerator.GetBytes(IvBytes);
        byte[] plaintext = Encoding.UTF8.GetBytes(plain);
        byte[] ciphertext = new byte[plaintext.Length];
        byte[] tag = new byte[TagBytes];

        using (var aes = new AesGcm(_key, TagBytes))
        {
            aes.Encrypt(iv, plaintext, ciphertext, tag);
        }

        // IV || ciphertext || tag -- the layout Java's Cipher produces, where the
        // tag is appended to the ciphertext.
        byte[] output = new byte[iv.Length + ciphertext.Length + tag.Length];
        Buffer.BlockCopy(iv, 0, output, 0, iv.Length);
        Buffer.BlockCopy(ciphertext, 0, output, iv.Length, ciphertext.Length);
        Buffer.BlockCopy(tag, 0, output, iv.Length + ciphertext.Length, tag.Length);

        return Convert.ToBase64String(output);
    }

    /// <summary>
    /// Decrypts a stored password. Returns null when there is nothing stored, or
    /// when the stored value cannot be opened with the current secret — a row
    /// written under a previous APP_JWT_SECRET, or one that is not a vault value
    /// at all. Never throws: HR opening an employee record must not meet a 500
    /// because one row predates a secret rotation.
    /// </summary>
    public string? Open(string? sealed_)
    {
        if (string.IsNullOrEmpty(sealed_))
        {
            return null;
        }

        try
        {
            byte[] all = Convert.FromBase64String(sealed_);

            if (all.Length < IvBytes + TagBytes)
            {
                return null;
            }

            byte[] iv = new byte[IvBytes];
            Buffer.BlockCopy(all, 0, iv, 0, IvBytes);

            int cipherLength = all.Length - IvBytes - TagBytes;
            byte[] ciphertext = new byte[cipherLength];
            Buffer.BlockCopy(all, IvBytes, ciphertext, 0, cipherLength);

            byte[] tag = new byte[TagBytes];
            Buffer.BlockCopy(all, IvBytes + cipherLength, tag, 0, TagBytes);

            byte[] plaintext = new byte[cipherLength];
            using (var aes = new AesGcm(_key, TagBytes))
            {
                aes.Decrypt(iv, ciphertext, tag, plaintext);
            }

            return Encoding.UTF8.GetString(plaintext);
        }
        catch (Exception ex)
        {
            // A value sealed under a different secret fails authentication here,
            // which is the expected outcome rather than an error to report.
            _log.LogDebug(ex, "A vault value could not be opened with the current secret.");
            return null;
        }
    }
}
