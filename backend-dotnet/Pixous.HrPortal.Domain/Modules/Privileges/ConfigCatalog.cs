using System.Globalization;
using System.Text.RegularExpressions;

namespace Pixous.HrPortal.Domain.Modules.Privileges;

public enum ConfigType { Boolean, Integer, Decimal, Time }

/// <summary>
/// A system_settings key that some module reads, and what a valid value is.
///
/// Only keys with a reader are listed. A setting the code never looks at would
/// be a switch wired to nothing, and the whole point of this screen is that
/// every change on it does something.
/// </summary>
public sealed record ConfigDefinition(
    string Key,
    string Group,
    string Label,
    string Description,
    ConfigType Type,
    string DefaultValue,
    decimal? Min = null,
    decimal? Max = null);

public static partial class ConfigCatalog
{
    public static readonly IReadOnlyList<ConfigDefinition> Settings =
    [
        new("task.reminder_enabled", "Tasks", "Daily task reminders",
            "Send each assignee a reminder about tasks that are due. Read by the scheduler on every tick.",
            ConfigType.Boolean, "true"),
        new("task.reminder_time", "Tasks", "Task reminder time",
            "Time of day (24h, IST) the task reminder goes out.",
            ConfigType.Time, "09:30"),
        new("task.reminder_lead_days", "Tasks", "Remind this many days before due",
            "0 reminds on the due date only.",
            ConfigType.Integer, "1", 0, 30),

        new("workreport.reminder_enabled", "Work Reports", "Daily work report reminder",
            "Remind employees who have not submitted today's work report.",
            ConfigType.Boolean, "true"),
        new("workreport.reminder_time", "Work Reports", "Work report reminder time",
            "Time of day (24h, IST) the reminder goes out.",
            ConfigType.Time, "18:30"),

        new("chat.retention_days", "Chat & Communities", "Message retention (days)",
            "Community messages older than this are removed. 0 keeps everything.",
            ConfigType.Integer, "0", 0, 3650),

        new("HILLS_KM_RATE", "Claims", "Hills rate per KM (₹)",
            "Used by the claim form to price hill-road travel.",
            ConfigType.Decimal, "5.0", 0, 1000),
        new("PLAINS_KM_RATE", "Claims", "Plains rate per KM (₹)",
            "Used by the claim form to price plains travel.",
            ConfigType.Decimal, "3.0", 0, 1000),
    ];

    public static readonly IReadOnlyDictionary<string, ConfigDefinition> ByKey =
        Settings.ToDictionary(s => s.Key, StringComparer.Ordinal);

    [GeneratedRegex("^([01][0-9]|2[0-3]):[0-5][0-9]$")]
    private static partial Regex TimePattern();

    /// <summary>
    /// The value as it should be stored, or an error. Booleans and numbers are
    /// normalised so "TRUE" and "1.50" are written the way the readers parse
    /// them.
    /// </summary>
    public static (string? Value, string? Error) Normalise(string key, string? raw)
    {
        if (!ByKey.TryGetValue(key, out ConfigDefinition? def))
        {
            return (null, $"'{key}' is not a configurable setting.");
        }

        string value = (raw ?? string.Empty).Trim();

        switch (def.Type)
        {
            case ConfigType.Boolean:
                if (bool.TryParse(value, out bool b))
                {
                    return (b ? "true" : "false", null);
                }
                return (null, $"{def.Label}: must be true or false.");

            case ConfigType.Time:
                return TimePattern().IsMatch(value)
                    ? (value, null)
                    : (null, $"{def.Label}: must be a time like 09:30.");

            case ConfigType.Integer:
                if (!int.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out int i))
                {
                    return (null, $"{def.Label}: must be a whole number.");
                }
                return InRange(def, i) ?? (i.ToString(CultureInfo.InvariantCulture), null);

            case ConfigType.Decimal:
                if (!decimal.TryParse(value, NumberStyles.Number, CultureInfo.InvariantCulture, out decimal d))
                {
                    return (null, $"{def.Label}: must be a number.");
                }
                return InRange(def, d) ?? (d.ToString("0.0#", CultureInfo.InvariantCulture), null);

            default:
                return (null, $"{def.Label}: unsupported type.");
        }
    }

    private static (string?, string?)? InRange(ConfigDefinition def, decimal v)
    {
        if ((def.Min is decimal min && v < min) || (def.Max is decimal max && v > max))
        {
            return (null, $"{def.Label}: must be between {def.Min} and {def.Max}.");
        }
        return null;
    }

    /// <summary>
    /// Keys whose values are secrets. GET /api/settings answers every signed-in
    /// user, so these are masked there; the AI settings screen has its own
    /// admin-only endpoint for them.
    /// </summary>
    public static bool IsSecretKey(string key) =>
        key.Contains("API_KEY", StringComparison.OrdinalIgnoreCase)
        || key.Contains("SECRET", StringComparison.OrdinalIgnoreCase)
        || key.Contains("TOKEN", StringComparison.OrdinalIgnoreCase)
        || key.Contains("PASSWORD", StringComparison.OrdinalIgnoreCase);
}
