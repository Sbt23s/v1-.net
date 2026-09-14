using System.Data;
using Dapper;

namespace Pixous.HrPortal.Infrastructure.Persistence;

/// <summary>
/// Teaches Dapper to bind <see cref="DateOnly"/> and <see cref="TimeOnly"/> as
/// query parameters.
///
/// Dapper maps these when READING a column -- a MySQL DATE comes back as a
/// DateOnly without help -- but refuses to send one as a parameter, because
/// ADO.NET has no DbType for them:
///
///     NotSupportedException: The member workDate of type System.DateOnly
///     cannot be used as a parameter value
///
/// Every attendance query is keyed by work_date, so without these the whole
/// module answers 500. The alternative -- modelling dates as DateTime -- would
/// put a meaningless midnight on every calendar day and invite exactly the
/// timezone mistakes this application has already been bitten by.
/// </summary>
public sealed class DateOnlyTypeHandler : SqlMapper.TypeHandler<DateOnly>
{
    public override void SetValue(IDbDataParameter parameter, DateOnly value)
    {
        // DbType.Date, so the driver sends a bare date and the server does not
        // apply a time or a zone to it.
        parameter.DbType = DbType.Date;
        parameter.Value = value.ToDateTime(TimeOnly.MinValue);
    }

    public override DateOnly Parse(object value) => value switch
    {
        DateOnly date => date,
        DateTime dateTime => DateOnly.FromDateTime(dateTime),
        string text => DateOnly.Parse(text, System.Globalization.CultureInfo.InvariantCulture),
        _ => DateOnly.FromDateTime(Convert.ToDateTime(value, System.Globalization.CultureInfo.InvariantCulture))
    };
}

/// <summary>
/// The same for <see cref="TimeOnly"/>, which the shift start time is read as.
/// </summary>
public sealed class TimeOnlyTypeHandler : SqlMapper.TypeHandler<TimeOnly>
{
    public override void SetValue(IDbDataParameter parameter, TimeOnly value)
    {
        parameter.DbType = DbType.Time;
        parameter.Value = value.ToTimeSpan();
    }

    public override TimeOnly Parse(object value) => value switch
    {
        TimeOnly time => time,
        TimeSpan span => TimeOnly.FromTimeSpan(span),
        DateTime dateTime => TimeOnly.FromDateTime(dateTime),
        string text => TimeOnly.Parse(text, System.Globalization.CultureInfo.InvariantCulture),
        _ => TimeOnly.FromTimeSpan((TimeSpan)value)
    };
}

public static class DapperTypeHandlers
{
    private static bool _registered;
    private static readonly Lock Gate = new();

    /// <summary>
    /// Registers the handlers once. Dapper's handler table is process-wide
    /// static, so this is idempotent and safe to call from startup more than
    /// once (the integration tests build several hosts).
    /// </summary>
    public static void Register()
    {
        lock (Gate)
        {
            if (_registered)
            {
                return;
            }

            SqlMapper.AddTypeHandler(new DateOnlyTypeHandler());
            SqlMapper.AddTypeHandler(new TimeOnlyTypeHandler());

            // Nullable variants resolve to the same handlers automatically, but
            // only once the non-nullable ones are registered.
            _registered = true;
        }
    }
}
