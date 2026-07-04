namespace ExperienceIq.KustoToEventHub;

internal static class KustoQueryBuilder
{
    public static string BuildClientTelemetryQuery(
        IReadOnlyDictionary<string, DateTimeOffset?> watermarks,
        string defaultLookbackWindow,
        string? sessionId)
    {
        var filterBySessionId = !string.IsNullOrWhiteSpace(sessionId);
        var lookback = ParseIso8601Duration(defaultLookbackWindow);

        var lines = new List<string> { "ClientTelemetry" };

        if (filterBySessionId)
            lines.Add($"| where sessionId == \"{EscapeKql(sessionId!)}\"");

        if (watermarks.Count > 0)
        {
            var oidClauses = watermarks.Select(kvp =>
            {
                if (filterBySessionId)
                    return $"(objectId == \"{EscapeKql(kvp.Key)}\")";

                var condition = kvp.Value.HasValue
                    ? $"clientTime > datetime({kvp.Value.Value:yyyy-MM-ddTHH:mm:ss.fffZ})"
                    : $"TIMESTAMP > ago({FormatTimespanKql(lookback)})";
                return $"(objectId == \"{EscapeKql(kvp.Key)}\" and {condition})";
            });

            lines.Add($"| where {string.Join("\n        or ", oidClauses)}");
        }
        else if (!filterBySessionId)
        {
            throw new InvalidOperationException("At least one objectId or a sessionId is required.");
        }

        lines.Add("| order by clientTime asc");

        return string.Join(Environment.NewLine, lines);
    }

    // Parse ISO 8601 duration — supports PT#H, PT#M, PT#S and combinations.
    private static TimeSpan ParseIso8601Duration(string duration)
    {
        if (string.IsNullOrWhiteSpace(duration)) return TimeSpan.FromHours(2);
        if (System.Xml.XmlConvert.ToTimeSpan(duration) is { } ts) return ts;
        return TimeSpan.FromHours(2);
    }

    // Format a TimeSpan as a KQL ago() argument, e.g. "2h", "30m".
    private static string FormatTimespanKql(TimeSpan ts)
    {
        if (ts.TotalDays >= 1 && ts.TotalDays % 1 == 0) return $"{(int)ts.TotalDays}d";
        if (ts.TotalHours >= 1 && ts.TotalMinutes % 60 == 0) return $"{(int)ts.TotalHours}h";
        if (ts.TotalMinutes >= 1 && ts.TotalSeconds % 60 == 0) return $"{(int)ts.TotalMinutes}m";
        return $"{(int)ts.TotalSeconds}s";
    }

    // Escape a string value for inline KQL (escape backslash and double-quote).
    private static string EscapeKql(string value) => value.Replace("\\", "\\\\").Replace("\"", "\\\"");
}
