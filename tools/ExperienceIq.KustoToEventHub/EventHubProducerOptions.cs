namespace ExperienceIq.KustoToEventHub;

public sealed class EventHubProducerOptions
{
    public const string SectionName = "EventHub";

    /// <summary>Fully-qualified Event Hubs namespace, e.g. exiq-portal-data.servicebus.windows.net</summary>
    public string FullyQualifiedNamespace { get; init; } = string.Empty;

    /// <summary>Event Hub entity name.</summary>
    public string EventHubName { get; init; } = string.Empty;

    /// <summary>
    /// Name of the row/event field whose value is used as the Event Hub partition key.
    /// All events sharing the same key are hashed to the same partition, co-locating a
    /// logical unit (e.g. a session) on one partition. Defaults to "sessionId" to match
    /// the ingester's assembly key (sessionId, eventId) and the Cosmos partition key.
    /// Lookup is case-insensitive.
    /// </summary>
    public string PartitionKeyField { get; init; } = "sessionId";

    /// <summary>
    /// When false (default), a row missing a non-empty <see cref="PartitionKeyField"/>
    /// value is skipped (and the run exits non-zero) rather than being sent without a
    /// partition key — which would scatter it across partitions. Set true to allow such
    /// rows to be sent unkeyed (service-balanced).
    /// </summary>
    public bool AllowUnkeyedEvents { get; init; }
}
