namespace ExperienceIq.EventHubPeek;

public sealed class PeekOptions
{
    public const string SectionName = "Peek";

    /// <summary>
    /// Seconds to wait for the next event before treating a partition as drained.
    /// Acts as the per-partition idle timeout while reading from earliest.
    /// </summary>
    public int IdleSeconds { get; init; } = 5;

    /// <summary>Upper bound on the total number of events listed across all partitions.</summary>
    public int MaxEvents { get; init; } = 100_000;

    /// <summary>Maximum number of body characters rendered inline per event (full body still written to JSON).</summary>
    public int BodyPreview { get; init; } = 1000;

    /// <summary>
    /// When true, suppress per-message output and only print partition summary information.
    /// </summary>
    public bool Quiet { get; init; } = true;

    /// <summary>
    /// When true, attempt a read from earliest even on partitions reported empty,
    /// to definitively confirm there are no retained events.
    /// </summary>
    public bool ForceReadEmptyPartitions { get; init; } = true;

    /// <summary>
    /// Optional path for the full metadata JSON dump. When unset, a timestamped
    /// file is written to the system temp directory.
    /// </summary>
    public string? OutputPath { get; init; }

    /// <summary>
    /// When true, read messages and checkpoint them all to advance the consumer
    /// group's committed position (events remain in the hub until retention expiry).
    /// Automatically enables Quiet mode. Uses EventProcessorClient to interact with checkpoint blob store.
    /// </summary>
    public bool Clear { get; init; }

    /// <summary>
    /// When true (and Clear is false), fetch and display consumer group checkpoint state.
    /// Shows which messages have been processed vs. remain unprocessed.
    /// </summary>
    public bool ShowConsumerGroupState { get; init; }
}
