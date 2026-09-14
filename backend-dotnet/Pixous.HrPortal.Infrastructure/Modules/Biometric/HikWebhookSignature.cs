using System.Security.Cryptography;
using System.Text;

namespace Pixous.HrPortal.Infrastructure.Modules.Biometric;

/// <summary>
/// The HMAC-SHA256 signature on a Hikvision webhook message.
/// Implements §4.17 of the Hik-Connect OpenAPI guide.
/// </summary>
public static class HikWebhookSignature
{
    private const string Prefix = "sha256=";

    public static string Sign(string signSecret, string timestamp, string batchId)
    {
        if (string.IsNullOrEmpty(signSecret))
        {
            throw new ArgumentException("A signing secret is required", nameof(signSecret));
        }

        string message = $"{timestamp}.{batchId}";
        byte[] keyBytes = Encoding.UTF8.GetBytes(signSecret);
        byte[] msgBytes = Encoding.UTF8.GetBytes(message);

        using var hmac = new HMACSHA256(keyBytes);
        byte[] hash = hmac.ComputeHash(msgBytes);

        var hex = new StringBuilder(Prefix, Prefix.Length + hash.Length * 2);
        foreach (byte b in hash)
        {
            hex.Append(b.ToString("x2"));
        }

        return hex.ToString();
    }

    public static bool Matches(string signSecret, string timestamp, string batchId, string? presented)
    {
        if (string.IsNullOrEmpty(presented) || string.IsNullOrEmpty(signSecret))
        {
            return false;
        }

        string expected = Sign(signSecret, timestamp, batchId);
        byte[] expectedBytes = Encoding.UTF8.GetBytes(expected);
        byte[] presentedBytes = Encoding.UTF8.GetBytes(presented);

        return CryptographicOperations.FixedTimeEquals(expectedBytes, presentedBytes);
    }
}
