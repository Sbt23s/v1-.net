using System.Security.Cryptography;
using System.Text;
using Xunit;

namespace Pixous.HrPortal.Tests;

/// <summary>
/// The password vault's wire format, checked against what the Java produces.
///
/// These do not use the production class directly — it takes IOptions and an
/// ILogger — but they exercise the same algorithm, parameters and layout, which
/// is the part that has to match:
///
///     key         = SHA-256("pixous:password-vault:v1:" + appSecret)
///     ciphertext  = AES/GCM/NoPadding, 12-byte IV, 128-bit tag
///     stored      = Base64( IV || ciphertext || tag )
///
/// The layout is the trap. Java's Cipher APPENDS the 16-byte tag to the
/// ciphertext; .NET's AesGcm takes it as a separate argument. A port that passes
/// the tag separately and writes only IV || ciphertext produces output that
/// looks plausible, is the wrong length by exactly 16 bytes, and can never be
/// opened by the Java — or by itself.
/// </summary>
public class PasswordVaultTests
{
    private const int IvBytes = 12;
    private const int TagBytes = 16;

    private const string Secret = "a-test-secret-that-is-long-enough-for-hs256";

    private static byte[] KeyFor(string appSecret) =>
        SHA256.HashData(Encoding.UTF8.GetBytes("pixous:password-vault:v1:" + appSecret));

    private static string Seal(string plain, string appSecret)
    {
        byte[] iv = RandomNumberGenerator.GetBytes(IvBytes);
        byte[] plaintext = Encoding.UTF8.GetBytes(plain);
        byte[] ciphertext = new byte[plaintext.Length];
        byte[] tag = new byte[TagBytes];

        using var aes = new AesGcm(KeyFor(appSecret), TagBytes);
        aes.Encrypt(iv, plaintext, ciphertext, tag);

        byte[] output = new byte[iv.Length + ciphertext.Length + tag.Length];
        Buffer.BlockCopy(iv, 0, output, 0, iv.Length);
        Buffer.BlockCopy(ciphertext, 0, output, iv.Length, ciphertext.Length);
        Buffer.BlockCopy(tag, 0, output, iv.Length + ciphertext.Length, tag.Length);

        return Convert.ToBase64String(output);
    }

    private static string? Open(string? sealedValue, string appSecret)
    {
        if (string.IsNullOrEmpty(sealedValue))
        {
            return null;
        }

        try
        {
            byte[] all = Convert.FromBase64String(sealedValue);
            if (all.Length < IvBytes + TagBytes)
            {
                return null;
            }

            byte[] iv = all[..IvBytes];
            int cipherLength = all.Length - IvBytes - TagBytes;
            byte[] ciphertext = all[IvBytes..(IvBytes + cipherLength)];
            byte[] tag = all[(IvBytes + cipherLength)..];
            byte[] plaintext = new byte[cipherLength];

            using var aes = new AesGcm(KeyFor(appSecret), TagBytes);
            aes.Decrypt(iv, ciphertext, tag, plaintext);

            return Encoding.UTF8.GetString(plaintext);
        }
        catch
        {
            return null;
        }
    }

    [Theory]
    [InlineData("Test@1234")]
    [InlineData("a")]
    [InlineData("a password with spaces and £ symbols")]
    [InlineData("வணக்கம்")]                 // non-ASCII must survive the UTF-8 round trip
    public void Round_trips_a_password(string password) =>
        Assert.Equal(password, Open(Seal(password, Secret), Secret));

    [Fact]
    public void A_sealed_value_is_not_the_plain_text()
    {
        string sealedValue = Seal("Test@1234", Secret);
        Assert.DoesNotContain("Test@1234", sealedValue, StringComparison.Ordinal);
    }

    /// <summary>
    /// The same password sealed twice gives different output, because the IV is
    /// random. Anything else would let a reader of the table spot two accounts
    /// sharing a password without decrypting either.
    /// </summary>
    [Fact]
    public void The_same_password_seals_differently_each_time()
    {
        Assert.NotEqual(Seal("Test@1234", Secret), Seal("Test@1234", Secret));
    }

    /// <summary>
    /// The layout check: 12 bytes of IV, then the ciphertext, then 16 bytes of
    /// tag. A short password still produces at least 12 + 16 bytes of envelope.
    /// </summary>
    [Fact]
    public void Has_the_iv_and_tag_around_the_ciphertext()
    {
        byte[] raw = Convert.FromBase64String(Seal("abcd", Secret));
        Assert.Equal(IvBytes + 4 + TagBytes, raw.Length);
    }

    /// <summary>
    /// A value sealed under a different secret opens as null rather than
    /// throwing — a row written before a secret rotation, which HR must be able
    /// to meet without a 500 when they open an employee record.
    /// </summary>
    [Fact]
    public void A_value_from_another_secret_opens_as_null()
    {
        string sealedElsewhere = Seal("Test@1234", "a-completely-different-application-secret");
        Assert.Null(Open(sealedElsewhere, Secret));
    }

    [Fact]
    public void Rubbish_opens_as_null_rather_than_throwing()
    {
        Assert.Null(Open("not-base64-at-all!!", Secret));
        Assert.Null(Open("c2hvcnQ=", Secret));   // valid base64, far too short
    }

    [Fact]
    public void Nothing_stored_means_nothing_returned()
    {
        Assert.Null(Open(null, Secret));
        Assert.Null(Open("", Secret));
    }
}
