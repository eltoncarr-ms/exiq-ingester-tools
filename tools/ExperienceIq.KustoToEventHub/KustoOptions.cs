namespace ExperienceIq.KustoToEventHub;

public sealed class KustoOptions
{
    public const string SectionName = "Kusto";

    /// <summary>ADX cluster URI, e.g. https://azportalpartnerrow.westus.kusto.windows.net</summary>
    public string ClusterUri { get; init; } = string.Empty;

    /// <summary>Kusto database name to query against.</summary>
    public string Database { get; init; } = string.Empty;

    /// <summary>Optional client request ID to tag the Kusto query for observability.</summary>
    public string ClientRequestId { get; init; } = "ExperienceIq.KustoToEventHub;1";

    /// <summary>
    /// Fallback lookback window used when no Cosmos watermark exists for an oid.
    /// ISO 8601 duration string, e.g. "PT2H". Defaults to 2 hours.
    /// </summary>
    public string DefaultLookbackWindow { get; init; } = "PT2H";

    /// <summary>Optional sessionId filter applied to the Kusto query.</summary>
    public string? SessionId { get; init; }
}
