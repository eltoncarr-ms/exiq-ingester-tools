namespace ExperienceIq.EventHubPeek;

public sealed class EventHubPeekOptions
{
    public const string SectionName = "EventHub";

    /// <summary>Fully-qualified Event Hubs namespace, e.g. exiq-portal-data.servicebus.windows.net</summary>
    public string FullyQualifiedNamespace { get; init; } = string.Empty;

    /// <summary>Event Hub entity name.</summary>
    public string EventHubName { get; init; } = string.Empty;

    /// <summary>Consumer group used for the read-only peek. Defaults to the built-in $Default group.</summary>
    public string ConsumerGroup { get; init; } = "$Default";

    /// <summary>
    /// Storage account name for checkpoint store (required for clear mode).
    /// Uses MSI (managed identity) authentication via Azure CLI or DefaultAzureCredential.
    /// Example: exiqstorage
    /// </summary>
    public string? CheckpointStorageAccountName { get; init; }

    /// <summary>
    /// Blob container name for checkpoints (required for clear mode).
    /// Default: exiq-checkpoints
    /// </summary>
    public string? CheckpointContainerName { get; init; } = "exiq-checkpoints";
}
