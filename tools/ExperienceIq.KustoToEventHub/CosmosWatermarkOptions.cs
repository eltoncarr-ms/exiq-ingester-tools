namespace ExperienceIq.KustoToEventHub;

public sealed class CosmosWatermarkOptions
{
    public const string SectionName = "Cosmos";

    /// <summary>Cosmos DB account endpoint, e.g. https://exiqsqldb.documents.azure.com:443/</summary>
    public string AccountEndpoint { get; init; } = string.Empty;

    /// <summary>Cosmos database name.</summary>
    public string DatabaseName { get; init; } = string.Empty;

    /// <summary>Container to query for the latest clientTime watermark per oid.</summary>
    public string ContainerName { get; init; } = "events";

    /// <summary>
    /// List of AAD object IDs (oids) to pull data for.
    /// The tool queries Cosmos for the max clientTime per oid to determine the per-oid time window.
    /// </summary>
    public List<string> ObjectIds { get; init; } = [];
}
