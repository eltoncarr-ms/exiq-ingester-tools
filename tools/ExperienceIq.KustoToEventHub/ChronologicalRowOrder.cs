using System.Globalization;

namespace ExperienceIq.KustoToEventHub;

/// <summary>
/// Orders CSV-replay rows by event time ascending before they are sent to Event Hub.
/// <para>
/// The live Kusto path emits rows already sorted (<c>| order by clientTime asc</c>), so Event Hub
/// sequence numbers come out chronological. A saved CSV export carries no such guarantee — ADX
/// exports are frequently newest-first — and the <c>-i</c>/<c>--input-file</c> path would otherwise
/// publish rows in file order, making Event Hub sequence numbers run reverse-chronological. That
/// inversion makes every downstream consumer (and the replay visualizer) render the session
/// backwards. Sorting here mirrors the live query and keeps sequence numbers chronological.
/// </para>
/// </summary>
internal static class ChronologicalRowOrder
{
    // Time columns in priority order. clientTime (epoch milliseconds) is the field the live KQL
    // sorts on; the datetime columns are fallbacks for rows missing or with an unparsable clientTime.
    private static readonly string[] EpochMsColumns = ["clientTime"];
    private static readonly string[] DateTimeColumns = ["PreciseTimeStamp", "TIMESTAMP", "env_time"];

    private static readonly CultureInfo EnUs = CultureInfo.GetCultureInfo("en-US");

    /// <summary>
    /// Returns the rows sorted by event time ascending. The sort is stable, so rows that share an
    /// identical timestamp keep their original relative order, and rows with no recognizable
    /// timestamp are kept (in original order) at the end rather than dropped.
    /// </summary>
    public static IEnumerable<Dictionary<string, object?>> ByEventTimeAscending(
        IEnumerable<Dictionary<string, object?>> rows)
        => rows.OrderBy(SortKeyMs); // Enumerable.OrderBy is documented as a stable sort.

    /// <summary>
    /// Computes the sort key (Unix milliseconds) for a row, preferring <c>clientTime</c> and falling
    /// back to datetime columns. Rows with no parsable time sort last via <see cref="long.MaxValue"/>.
    /// </summary>
    internal static long SortKeyMs(Dictionary<string, object?> row)
    {
        foreach (var col in EpochMsColumns)
        {
            if (TryEpochMs(GetField(row, col), out var ms)) return ms;
        }

        foreach (var col in DateTimeColumns)
        {
            if (TryDateTimeMs(GetField(row, col), out var ms)) return ms;
        }

        return long.MaxValue;
    }

    // Parse an epoch-millisecond value, tolerating thousands separators (e.g. "1,782,496,457,655").
    internal static bool TryEpochMs(string? value, out long ms)
    {
        ms = 0;
        if (string.IsNullOrWhiteSpace(value)) return false;
        return long.TryParse(
            value.Trim(),
            NumberStyles.AllowThousands | NumberStyles.AllowLeadingSign,
            CultureInfo.InvariantCulture,
            out ms);
    }

    // Parse a datetime value (e.g. "6/26/2026, 5:54:27.64159 PM"), treating it as UTC.
    internal static bool TryDateTimeMs(string? value, out long ms)
    {
        ms = 0;
        if (string.IsNullOrWhiteSpace(value)) return false;

        const DateTimeStyles styles = DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal;
        if (DateTimeOffset.TryParse(value.Trim(), EnUs, styles, out var dto)
            || DateTimeOffset.TryParse(value.Trim(), CultureInfo.InvariantCulture, styles, out dto))
        {
            ms = dto.ToUnixTimeMilliseconds();
            return true;
        }

        return false;
    }

    // Case-insensitive field lookup; returns the first non-blank string value for the column name.
    private static string? GetField(Dictionary<string, object?> row, string name)
    {
        if (row.TryGetValue(name, out var value) && value is not null)
        {
            var s = value.ToString();
            if (!string.IsNullOrWhiteSpace(s)) return s;
        }

        foreach (var kvp in row)
        {
            if (string.Equals(kvp.Key, name, StringComparison.OrdinalIgnoreCase) && kvp.Value is not null)
            {
                var s = kvp.Value.ToString();
                if (!string.IsNullOrWhiteSpace(s)) return s;
            }
        }

        return null;
    }
}
