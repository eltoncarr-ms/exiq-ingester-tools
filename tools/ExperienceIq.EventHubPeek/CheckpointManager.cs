using System.Text.Json;
using System.Text.Json.Serialization;
using Azure.Core;
using Azure.Storage.Blobs;

namespace ExperienceIq.EventHubPeek;

/// <summary>
/// Manages Event Hub checkpoint operations and metadata retrieval.
/// </summary>
public class CheckpointManager
{
    private readonly BlobContainerClient _blobContainerClient;
    private readonly string _consumerGroup;
    private readonly string _eventHubName;

    public CheckpointManager(BlobContainerClient blobContainerClient, string consumerGroup, string eventHubName)
    {
        _blobContainerClient = blobContainerClient;
        _consumerGroup = consumerGroup;
        _eventHubName = eventHubName;
    }

    /// <summary>
    /// Fetches checkpoint metadata for all partitions.
    /// </summary>
    public async Task<CheckpointMetadata> FetchCheckpointsAsync(string[] partitionIds, Dictionary<string, long> partitionLastSequences)
    {
        var metadata = new CheckpointMetadata
        {
            ConsumerGroup = _consumerGroup,
            EventHubName = _eventHubName,
            FetchedAt = DateTime.UtcNow,
            Partitions = []
        };

        foreach (var partitionId in partitionIds)
        {
            var partitionCheckpoint = await FetchPartitionCheckpointAsync(partitionId, partitionLastSequences);
            metadata.Partitions.Add(partitionCheckpoint);

            if (partitionCheckpoint.SequenceNumber.HasValue)
            {
                metadata.TotalCheckpointedSequence = Math.Max(
                    metadata.TotalCheckpointedSequence ?? -1,
                    partitionCheckpoint.SequenceNumber.Value
                );
            }
        }

        metadata.TotalUnprocessedMessages = metadata.Partitions.Sum(p => p.UnprocessedMessageCount);

        return metadata;
    }

    /// <summary>
    /// Fetches checkpoint metadata for a specific partition.
    /// </summary>
    private async Task<PartitionCheckpoint> FetchPartitionCheckpointAsync(string partitionId, Dictionary<string, long> partitionLastSequences)
    {
        var checkpoint = new PartitionCheckpoint
        {
            PartitionId = partitionId,
            LastEnqueuedSequenceNumber = partitionLastSequences.TryGetValue(partitionId, out var seq) ? seq : -1
        };

        var checkpointBlobPath = $"{_consumerGroup}/{_eventHubName}/{partitionId}";
        var blobClient = _blobContainerClient.GetBlobClient(checkpointBlobPath);

        try
        {
            var checkpointBlob = await blobClient.DownloadAsync();
            using var reader = new StreamReader(checkpointBlob.Value.Content);
            var checkpointJson = await reader.ReadToEndAsync();
            var checkpointData = JsonSerializer.Deserialize<Dictionary<string, object>>(checkpointJson);

            if (checkpointData != null && checkpointData.ContainsKey("SequenceNumber"))
            {
                checkpoint.SequenceNumber = long.Parse(checkpointData["SequenceNumber"]?.ToString() ?? "-1");
                checkpoint.Offset = checkpointData.ContainsKey("Offset") ? checkpointData["Offset"]?.ToString() : null;
                checkpoint.RetrievalTime = checkpointData.ContainsKey("RetrievalTime")
                    ? DateTime.Parse(checkpointData["RetrievalTime"]?.ToString() ?? DateTime.UtcNow.ToString("O"))
                    : null;
            }
        }
        catch (Azure.RequestFailedException ex) when (ex.Status == 404)
        {
            checkpoint.Status = "no_checkpoint";
        }
        catch (Exception ex)
        {
            checkpoint.Status = $"error: {ex.GetType().Name}";
            checkpoint.Error = ex.Message;
        }

        if (checkpoint.SequenceNumber.HasValue && checkpoint.LastEnqueuedSequenceNumber >= 0)
        {
            checkpoint.UnprocessedMessageCount = checkpoint.LastEnqueuedSequenceNumber > checkpoint.SequenceNumber.Value
                ? (checkpoint.LastEnqueuedSequenceNumber - checkpoint.SequenceNumber.Value)
                : 0;
        }

        return checkpoint;
    }

    /// <summary>
    /// Reads checkpoints for all partitions (parallelized).
    /// </summary>
    public async Task<Dictionary<string, PartitionCheckpoint?>> ReadAllPartitionCheckpointsAsync(string[] partitionIds)
    {
        var tasks = partitionIds.Select(pid => 
            ReadPartitionCheckpointAsync(pid).ContinueWith(t => (partitionId: pid, checkpoint: t.Result))
        );
        var results = await Task.WhenAll(tasks);
        return results.ToDictionary(r => r.partitionId, r => r.checkpoint);
    }

    /// <summary>
    /// Reads checkpoint for a specific partition (used for resuming reads).
    /// </summary>
    public async Task<PartitionCheckpoint?> ReadPartitionCheckpointAsync(string partitionId)
    {
        var checkpointBlobPath = $"{_consumerGroup}/{_eventHubName}/{partitionId}";
        var blobClient = _blobContainerClient.GetBlobClient(checkpointBlobPath);

        try
        {
            var checkpointBlob = await blobClient.DownloadAsync();
            using var reader = new StreamReader(checkpointBlob.Value.Content);
            var checkpointJson = await reader.ReadToEndAsync();
            var checkpointData = JsonSerializer.Deserialize<Dictionary<string, object>>(checkpointJson);

            if (checkpointData != null && checkpointData.ContainsKey("SequenceNumber"))
            {
                return new PartitionCheckpoint
                {
                    PartitionId = partitionId,
                    SequenceNumber = long.Parse(checkpointData["SequenceNumber"]?.ToString() ?? "-1"),
                    Offset = checkpointData.ContainsKey("Offset") ? checkpointData["Offset"]?.ToString() : null,
                    RetrievalTime = checkpointData.ContainsKey("RetrievalTime")
                        ? DateTime.Parse(checkpointData["RetrievalTime"]?.ToString() ?? DateTime.UtcNow.ToString("O"))
                        : null
                };
            }
        }
        catch (Azure.RequestFailedException ex) when (ex.Status == 404)
        {
            return null;
        }

        return null;
    }

    /// <summary>
    /// Writes a checkpoint for a partition.
    /// </summary>
    public async Task WritePartitionCheckpointAsync(
        string partitionId,
        long sequenceNumber,
        string offsetString,
        string fullyQualifiedNamespace)
    {
        var checkpointPath = $"{_consumerGroup}/{_eventHubName}/{partitionId}";
        var checkpointData = new
        {
            FullyQualifiedNamespace = fullyQualifiedNamespace,
            EventHubName = _eventHubName,
            ConsumerGroup = _consumerGroup,
            PartitionId = partitionId,
            Offset = offsetString,
            SequenceNumber = sequenceNumber,
            RetrievalTime = DateTime.UtcNow.ToString("O")
        };

        var jsonData = JsonSerializer.Serialize(checkpointData);
        var blobClient = _blobContainerClient.GetBlobClient(checkpointPath);
        await blobClient.UploadAsync(new MemoryStream(System.Text.Encoding.UTF8.GetBytes(jsonData)), overwrite: true);
    }
}

/// <summary>
/// Metadata for a collection of partition checkpoints.
/// </summary>
public class CheckpointMetadata
{
    [JsonPropertyName("consumerGroup")]
    public string ConsumerGroup { get; set; } = string.Empty;

    [JsonPropertyName("eventHubName")]
    public string EventHubName { get; set; } = string.Empty;

    [JsonPropertyName("fetchedAt")]
    public DateTime FetchedAt { get; set; }

    [JsonPropertyName("partitions")]
    public List<PartitionCheckpoint> Partitions { get; set; } = [];

    [JsonPropertyName("totalUnprocessedMessages")]
    public long TotalUnprocessedMessages { get; set; }

    [JsonPropertyName("totalCheckpointedSequence")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public long? TotalCheckpointedSequence { get; set; }
}

/// <summary>
/// Checkpoint metadata for a single partition.
/// </summary>
public class PartitionCheckpoint
{
    [JsonPropertyName("partitionId")]
    public string PartitionId { get; set; } = string.Empty;

    [JsonPropertyName("sequenceNumber")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public long? SequenceNumber { get; set; }

    [JsonPropertyName("offset")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Offset { get; set; }

    [JsonPropertyName("retrievalTime")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public DateTime? RetrievalTime { get; set; }

    [JsonPropertyName("lastEnqueuedSequenceNumber")]
    public long LastEnqueuedSequenceNumber { get; set; } = -1;

    [JsonPropertyName("unprocessedMessageCount")]
    public long UnprocessedMessageCount { get; set; }

    [JsonPropertyName("status")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Status { get; set; }

    [JsonPropertyName("error")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Error { get; set; }
}
