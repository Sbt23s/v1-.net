using System.Text.Json;
using System.Text.Json.Serialization;

namespace Pixous.HrPortal.Api.Serialization;

/// <summary>
/// Writes a <see cref="DateTime"/> the way Jackson writes a
/// <c>java.time.LocalDateTime</c>: "2026-09-01T08:58:56", with no offset and no
/// trailing Z.
///
/// Without this the same field is serialised two different ways in one response.
/// A row read back from MySQL arrives with DateTimeKind.Unspecified and writes
/// as "2026-09-01T08:58:56"; a row just created from DateTime.Now carries
/// DateTimeKind.Local and writes as "2026-09-12T21:18:38.7729985+05:30". The
/// client then has one punch it can compare against a date and another it
/// cannot, from the same endpoint.
///
/// Java has no such split, because every one of these columns is a naive
/// LocalDateTime in Asia/Kolkata -- the zone is a property of the deployment,
/// not of the value. Offsets are therefore dropped rather than converted: the
/// instant is already correct in the only zone this application uses, and
/// converting it to UTC would move every displayed punch by five and a half
/// hours.
///
/// Sub-second precision is dropped for the same reason. The columns are DATETIME
/// with no fractional part, so a value that has just been through the database
/// never has one, and a value that has not been should not look different.
/// </summary>
public sealed class LocalDateTimeConverter : JsonConverter<DateTime>
{
    /// <summary>ISO-8601 without a zone, which is what LocalDateTime.toString() produces.</summary>
    private const string Format = "yyyy-MM-dd'T'HH:mm:ss";

    public override DateTime Read(ref Utf8JsonReader reader, Type typeToConvert,
                                  JsonSerializerOptions options)
    {
        string? text = reader.GetString();
        if (string.IsNullOrWhiteSpace(text))
        {
            return default;
        }

        // Round-trips what this converter writes, and still accepts a value that
        // carries an offset -- the client echoing back something it was given by
        // another service. RoundtripKind keeps an offset-free value Unspecified
        // rather than assuming it is local.
        return DateTime.Parse(text, System.Globalization.CultureInfo.InvariantCulture,
                              System.Globalization.DateTimeStyles.RoundtripKind);
    }

    public override void Write(Utf8JsonWriter writer, DateTime value, JsonSerializerOptions options) =>
        writer.WriteStringValue(value.ToString(Format, System.Globalization.CultureInfo.InvariantCulture));
}

/// <summary>The nullable counterpart; a null stays null rather than becoming a default date.</summary>
public sealed class NullableLocalDateTimeConverter : JsonConverter<DateTime?>
{
    private static readonly LocalDateTimeConverter Inner = new();

    public override DateTime? Read(ref Utf8JsonReader reader, Type typeToConvert,
                                   JsonSerializerOptions options) =>
        reader.TokenType == JsonTokenType.Null
            ? null
            : Inner.Read(ref reader, typeof(DateTime), options);

    public override void Write(Utf8JsonWriter writer, DateTime? value, JsonSerializerOptions options)
    {
        if (value is null)
        {
            writer.WriteNullValue();
            return;
        }

        Inner.Write(writer, value.Value, options);
    }
}
