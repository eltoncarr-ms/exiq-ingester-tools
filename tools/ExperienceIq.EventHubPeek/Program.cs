using System.Text;
using System.Text.Json;
using Azure.Core;
using Azure.Identity;
using Azure.Messaging.EventHubs;
using Azure.Messaging.EventHubs.Consumer;
using Azure.Messaging.EventHubs.Processor;
using Azure.Storage.Blobs;
using ExperienceIq.EventHubPeek;
using Microsoft.Extensions.Configuration;

// ── Read-only Event Hub metadata peek ────────────────────────────────────────
// Lists metadata for every event currently retained in an Event Hub WITHOUT
// moving any checkpoint. It uses EventHubConsumerClient (not EventProcessorClient),
// so the blob checkpoint store is never opened or written — the ingester's
// committed position is left exactly as it was.
//
// ── Clear mode (-c / --clear) ────────────────────────────────────────────────
// With the -c flag, reads all messages from earliest and checkpoints them all to
// advance the consumer group's committed position. This does NOT delete events —
// Event Hubs are not queues; events remain in the hub until the retention policy
// expires them. Uses EventProcessorClient to interact with the checkpoint blob
// store. Automatically enables quiet mode (-q).
//
// Note: the read-only peek (-q) reports the consumer group checkpoint state by
// default, so you can see the unprocessed backlog relative to the committed
// position rather than just the raw retained-event count.

// Print usage and exit before touching config/Azure when help is requested.
if (args.Any(a =>
        string.Equals(a, "-h", StringComparison.OrdinalIgnoreCase) ||
        string.Equals(a, "--help", StringComparison.OrdinalIgnoreCase) ||
        string.Equals(a, "/h", StringComparison.OrdinalIgnoreCase) ||
        string.Equals(a, "/?", StringComparison.Ordinal)))
{
    PrintUsage();
    return 0;
}

var configuration = new ConfigurationBuilder()
    .SetBasePath(AppContext.BaseDirectory)
    .AddJsonFile("appsettings.json", optional: false)
    .AddEnvironmentVariables()
    .AddCommandLine(NormalizeCommandLine(args))
    .Build();
var eh = configuration.GetSection(EventHubPeekOptions.SectionName).Get<EventHubPeekOptions>()
    ?? throw new InvalidOperationException("EventHub configuration section is missing.");
var peek = configuration.GetSection(PeekOptions.SectionName).Get<PeekOptions>() ?? new PeekOptions();

if (string.IsNullOrWhiteSpace(eh.FullyQualifiedNamespace))
    throw new InvalidOperationException("EventHub:FullyQualifiedNamespace is required.");
if (string.IsNullOrWhiteSpace(eh.EventHubName))
    throw new InvalidOperationException("EventHub:EventHubName is required.");

var consumerGroup = string.IsNullOrWhiteSpace(eh.ConsumerGroup)
    ? EventHubConsumerClient.DefaultConsumerGroupName
    : eh.ConsumerGroup;

Console.OutputEncoding = Encoding.UTF8;

// az login is the common local path; try the CLI credential first, then fall back.
TokenCredential credential = new ChainedTokenCredential(
    new AzureCliCredential(),
    new DefaultAzureCredential(new DefaultAzureCredentialOptions
    {
        ExcludeInteractiveBrowserCredential = true
    }));

string modeDisplay = peek.Clear ? "EventProcessorClient (CLEAR mode — advance checkpoint)" : "EventHubConsumerClient (read-only)";
Console.WriteLine("================== Event Hub Peek ==================");
Console.WriteLine($"Namespace      : {eh.FullyQualifiedNamespace}");
Console.WriteLine($"Event Hub      : {eh.EventHubName}");
Console.WriteLine($"Consumer group : {consumerGroup}");
Console.WriteLine($"Mode           : {modeDisplay}");
Console.WriteLine($"Timestamp (UTC): {DateTimeOffset.UtcNow:O}");
Console.WriteLine("====================================================");

if (peek.Clear)
{
    return await RunClearMode(credential, eh, consumerGroup, peek);
}
else
{
    return await RunReadOnlyMode(credential, eh, consumerGroup, peek);
}

async Task<int> RunReadOnlyMode(TokenCredential credential, EventHubPeekOptions eh, string consumerGroup, PeekOptions peek)
{
    await using var consumer = new EventHubConsumerClient(
        consumerGroup,
        eh.FullyQualifiedNamespace,
        eh.EventHubName,
        credential);

    EventHubProperties hubProps;
    try
    {
        hubProps = await consumer.GetEventHubPropertiesAsync();
    }
    catch (Exception ex)
    {
        Console.Error.WriteLine($"\nFAILED to connect / authorize against the Event Hub:\n{ex.GetType().Name}: {ex.Message}");
        Console.Error.WriteLine("\nEnsure the signed-in identity has the 'Azure Event Hubs Data Receiver' role on the namespace or hub.");
        return 2;
    }

    var partitionIds = hubProps.PartitionIds
        .OrderBy(p => int.TryParse(p, out var n) ? n : int.MaxValue)
        .ToArray();

    Console.WriteLine($"\nHub name           : {hubProps.Name}");
    Console.WriteLine($"Hub created (UTC)  : {hubProps.CreatedOn:O}");
    Console.WriteLine($"Partition count    : {partitionIds.Length}");
    Console.WriteLine($"Partition ids      : {string.Join(", ", partitionIds)}");
    Console.WriteLine($"Quiet mode         : {peek.Quiet}");
    Console.WriteLine($"Show consumer group state : {peek.ShowConsumerGroupState}");

    // Capture per-partition properties up front to bound the read deterministically.
    var partitionInfo = new Dictionary<string, PartitionProperties>(StringComparer.Ordinal);
    Dictionary<string, PartitionCheckpoint?> checkpointsByPartition = new();
    
    foreach (var pid in partitionIds)
    {
        var pp = await consumer.GetPartitionPropertiesAsync(pid);
        partitionInfo[pid] = pp;
    }

    // Fetch checkpoints if requested
    if (peek.ShowConsumerGroupState && !string.IsNullOrWhiteSpace(eh.CheckpointStorageAccountName))
    {
        try
        {
            var containerUri = new Uri($"https://{eh.CheckpointStorageAccountName}.blob.core.windows.net/{eh.CheckpointContainerName}");
            var blobContainerClient = new BlobContainerClient(containerUri, credential);
            var checkpointManager = new CheckpointManager(blobContainerClient, consumerGroup, eh.EventHubName);

            checkpointsByPartition = await checkpointManager.ReadAllPartitionCheckpointsAsync(partitionIds);

            // ReadAllPartitionCheckpointsAsync only reads the committed sequence from the
            // checkpoint blob; it does not know the live partition head. Enrich each
            // checkpoint with the current last-enqueued sequence so the unprocessed
            // backlog reflects events appended since the last checkpoint.
            foreach (var pid in partitionIds)
            {
                if (checkpointsByPartition.TryGetValue(pid, out var checkpoint) && checkpoint != null
                    && partitionInfo.TryGetValue(pid, out var pp))
                {
                    checkpoint.LastEnqueuedSequenceNumber = pp.LastEnqueuedSequenceNumber;
                    checkpoint.UnprocessedMessageCount =
                        checkpoint.SequenceNumber.HasValue && pp.LastEnqueuedSequenceNumber > checkpoint.SequenceNumber.Value
                            ? pp.LastEnqueuedSequenceNumber - checkpoint.SequenceNumber.Value
                            : 0;
                }
            }
        }
        catch (Exception)
        {
            // Silently skip if checkpoint store is unavailable
        }
    }

    // Display partition summary with checkpoint-aware info
    long totalBacklog = 0;
    Console.WriteLine("\n---- Partition summary ----");
    foreach (var pid in partitionIds)
    {
        var pp = partitionInfo[pid];
        
        // Calculate displayed count based on checkpoint state
        long displayCount = 0;
        bool isEffectivelyEmpty = pp.IsEmpty;
        
        if (peek.ShowConsumerGroupState && checkpointsByPartition.TryGetValue(pid, out var checkpoint) && checkpoint != null)
        {
            // Show unprocessed message count
            displayCount = checkpoint.UnprocessedMessageCount;
            isEffectivelyEmpty = displayCount == 0;
        }
        else
        {
            // Show total message count
            displayCount = pp.IsEmpty ? 0 : (pp.LastEnqueuedSequenceNumber - pp.BeginningSequenceNumber + 1);
        }
        
        if (displayCount < 0) displayCount = 0;
        totalBacklog += displayCount;
        
        Console.WriteLine(
            $"  partition {pid,-3} | empty={isEffectivelyEmpty,-5} | beginSeq={pp.BeginningSequenceNumber,-8} " +
            $"| lastSeq={pp.LastEnqueuedSequenceNumber,-8} | approxCount={displayCount,-8} | lastEnqueued(UTC)={(pp.IsEmpty ? "-" : pp.LastEnqueuedTime.ToString("O"))}");
    }
    Console.WriteLine($"\nApprox. total retained events across partitions: {totalBacklog}");

    // Display detailed checkpoint status if showing consumer group state
    if (peek.ShowConsumerGroupState && checkpointsByPartition.Count > 0)
    {
        Console.WriteLine($"\n---- Consumer group checkpoint status ('{consumerGroup}') ----");
        foreach (var pid in partitionIds)
        {
            if (checkpointsByPartition.TryGetValue(pid, out var checkpoint) && checkpoint != null)
            {
                if (checkpoint.SequenceNumber.HasValue)
                {
                    Console.WriteLine($"  partition {pid,-3} | checkpointed at seq {checkpoint.SequenceNumber.Value,-8} | unprocessed: {checkpoint.UnprocessedMessageCount,-8}");
                }
                else
                {
                    Console.WriteLine($"  partition {pid,-3} | no checkpoint | all {checkpoint.LastEnqueuedSequenceNumber - checkpoint.LastEnqueuedSequenceNumber + 1} messages unprocessed");
                }
            }
        }
    }

    int globalIndex = 0;
    bool capped = false;
    List<Dictionary<string, object?>>? records = peek.Quiet ? null : [];

    if (!peek.Quiet)
    {
        Console.WriteLine("\n---- Per-event metadata ----");
    }

    foreach (var pid in partitionIds)
    {
        var pp = partitionInfo[pid];
        
        // When showing consumer group state, skip partitions with no unprocessed
        // messages — the checkpoint status block above already reports them.
        if (peek.ShowConsumerGroupState && checkpointsByPartition.TryGetValue(pid, out var checkpoint) && checkpoint != null)
        {
            if (checkpoint.UnprocessedMessageCount == 0)
            {
                continue;
            }
        }
        
        if (pp.IsEmpty && !peek.ForceReadEmptyPartitions)
        {
            Console.WriteLine($"\n  [partition {pid}] empty — nothing to read.");
            continue;
        }

        long stopAtSeq = pp.LastEnqueuedSequenceNumber;
        var readOptions = new ReadEventOptions { MaximumWaitTime = TimeSpan.FromSeconds(peek.IdleSeconds) };

        // Determine read start position based on checkpoint
        EventPosition startPosition = EventPosition.Earliest;
        string note = string.Empty;
        
        if (peek.ShowConsumerGroupState && checkpointsByPartition.TryGetValue(pid, out var ckpt) && ckpt?.SequenceNumber.HasValue == true)
        {
            // Start from AFTER the checkpoint
            startPosition = EventPosition.FromSequenceNumber(ckpt.SequenceNumber.Value, isInclusive: false);
            note = $" (from checkpoint seq {ckpt.SequenceNumber})";
        }
        else if (pp.IsEmpty)
        {
            note = " (reported empty — confirming via forced read from earliest)";
        }
        
        if (!peek.Quiet)
        {
            Console.WriteLine($"\n  [partition {pid}] reading from {(peek.ShowConsumerGroupState && checkpointsByPartition.TryGetValue(pid, out _) ? "checkpoint" : "earliest")} up to seq {stopAtSeq}{note} ...");
        }

        int partitionCount = 0;
        await foreach (var pe in consumer.ReadEventsFromPartitionAsync(pid, startPosition, readOptions))
        {
            if (pe.Data is null)
            {
                // MaximumWaitTime elapsed with no further event — partition drained.
                break;
            }

            var data = pe.Data;
            globalIndex++;
            partitionCount++;

            if (!peek.Quiet)
            {
                var bodyBytes = data.EventBody.ToArray();
                string bodyText;
                try { bodyText = Encoding.UTF8.GetString(bodyBytes); }
                catch { bodyText = string.Empty; }

                string preview = bodyText.Length > peek.BodyPreview
                    ? bodyText[..peek.BodyPreview] + $"…(+{bodyText.Length - peek.BodyPreview} more chars)"
                    : bodyText;

                var appProps = data.Properties?.ToDictionary(kvp => kvp.Key, kvp => Stringify(kvp.Value))
                               ?? new Dictionary<string, string?>();
                var sysProps = data.SystemProperties?.ToDictionary(kvp => kvp.Key, kvp => Stringify(kvp.Value))
                               ?? new Dictionary<string, string?>();

                string? offsetStr = SafeOffset(data);

                Console.WriteLine($"\n  #{globalIndex}  partition={pid}  seq={data.SequenceNumber}  offset={offsetStr}");
                Console.WriteLine($"      enqueuedTime(UTC) : {data.EnqueuedTime:O}");
                Console.WriteLine($"      partitionKey      : {data.PartitionKey ?? "(none)"}");
                Console.WriteLine($"      messageId         : {data.MessageId ?? "(none)"}");
                Console.WriteLine($"      correlationId     : {data.CorrelationId ?? "(none)"}");
                Console.WriteLine($"      contentType       : {data.ContentType ?? "(none)"}");
                Console.WriteLine($"      bodyBytes         : {bodyBytes.Length}");
                Console.WriteLine($"      systemProperties  : {(sysProps.Count == 0 ? "(none)" : JsonSerializer.Serialize(sysProps))}");
                Console.WriteLine($"      appProperties     : {(appProps.Count == 0 ? "(none)" : JsonSerializer.Serialize(appProps))}");
                Console.WriteLine($"      body              : {preview}");

                records!.Add(new Dictionary<string, object?>
                {
                    ["index"] = globalIndex,
                    ["partitionId"] = pid,
                    ["sequenceNumber"] = data.SequenceNumber,
                    ["offset"] = offsetStr,
                    ["enqueuedTimeUtc"] = data.EnqueuedTime.ToString("O"),
                    ["partitionKey"] = data.PartitionKey,
                    ["messageId"] = data.MessageId,
                    ["correlationId"] = data.CorrelationId,
                    ["contentType"] = data.ContentType,
                    ["bodyBytes"] = bodyBytes.Length,
                    ["systemProperties"] = sysProps,
                    ["appProperties"] = appProps,
                    ["body"] = bodyText
                });
            }

            if (globalIndex >= peek.MaxEvents)
            {
                capped = true;
                if (!peek.Quiet)
                {
                    Console.WriteLine($"\n  Reached MaxEvents cap ({peek.MaxEvents}); stopping.");
                }
                break;
            }

            if (data.SequenceNumber >= stopAtSeq)
            {
                // Caught up to the last event that existed when the read began.
                break;
            }
        }

        // In consumer-group-state mode the checkpoint status block above already
        // reports per-partition counts, so skip the redundant per-partition line.
        if (!peek.ShowConsumerGroupState)
        {
            Console.WriteLine($"  [partition {pid}] messages: {partitionCount}");
        }

        if (capped) break;
    }

    Console.WriteLine("\n====================================================");
    Console.WriteLine($"Total events listed : {globalIndex}{(capped ? " (capped)" : string.Empty)}");
    Console.WriteLine("Checkpoint moved    : NO (read-only consumer; checkpoint blob never accessed)");

    if (!peek.Quiet)
    {
        var outFile = string.IsNullOrWhiteSpace(peek.OutputPath)
            ? Path.Combine(Path.GetTempPath(), $"eventhub-metadata-{DateTimeOffset.UtcNow:yyyyMMdd'T'HHmmss'Z'}.json")
            : peek.OutputPath!;
        try
        {
            var json = JsonSerializer.Serialize(records, new JsonSerializerOptions { WriteIndented = true });
            await File.WriteAllTextAsync(outFile, json);
            Console.WriteLine($"Full metadata JSON  : {outFile}");
        }
        catch (Exception ex)
        {
            Console.WriteLine($"(Could not write JSON file: {ex.Message})");
        }
    }
    Console.WriteLine("====================================================");

    return 0;
}

async Task<int> RunClearMode(TokenCredential credential, EventHubPeekOptions eh, string consumerGroup, PeekOptions peek)
{
    // Checkpoint store is required for clear mode
    if (string.IsNullOrWhiteSpace(eh.CheckpointStorageAccountName))
    {
        Console.Error.WriteLine("\n❌ CLEAR MODE REQUIRES CONFIGURATION:");
        Console.Error.WriteLine("\nEventHub:CheckpointStorageAccountName must be configured in appsettings.json");
        Console.Error.WriteLine("Example:");
        Console.Error.WriteLine(@"  ""EventHub"": {");
        Console.Error.WriteLine(@"    ""CheckpointStorageAccountName"": ""exiqstorage""");
        Console.Error.WriteLine(@"  }");
        return 2;
    }

    if (string.IsNullOrWhiteSpace(eh.CheckpointContainerName))
    {
        eh = new EventHubPeekOptions
        {
            FullyQualifiedNamespace = eh.FullyQualifiedNamespace,
            EventHubName = eh.EventHubName,
            ConsumerGroup = eh.ConsumerGroup,
            CheckpointStorageAccountName = eh.CheckpointStorageAccountName,
            CheckpointContainerName = "exiq-checkpoints"
        };
    }

    // Setup blob container for checkpoint storage
    BlobContainerClient blobContainerClient;
    try
    {
        var containerUri = new Uri($"https://{eh.CheckpointStorageAccountName}.blob.core.windows.net/{eh.CheckpointContainerName}");
        blobContainerClient = new BlobContainerClient(containerUri, credential);
        // Verify access
        await blobContainerClient.GetPropertiesAsync();
        Console.WriteLine($"Checkpoint store: {eh.CheckpointStorageAccountName}/{eh.CheckpointContainerName}");
    }
    catch (Exception ex)
    {
        Console.Error.WriteLine($"\n❌ ERROR accessing checkpoint store:");
        Console.Error.WriteLine($"   {ex.GetType().Name}: {ex.Message}");
        Console.Error.WriteLine($"\nVerify:");
        Console.Error.WriteLine($"  - Storage account name '{eh.CheckpointStorageAccountName}' is correct");
        Console.Error.WriteLine($"  - Container '{eh.CheckpointContainerName}' exists");
        Console.Error.WriteLine($"  - Signed-in identity has 'Storage Blob Data Contributor' role on storage account");
        Console.Error.WriteLine($"  - Run: az login (or use managed identity)");
        return 2;
    }

    // Use EventHubConsumerClient to read messages from earliest
    var consumerOptions = new EventHubConsumerClientOptions();

    var consumer = new EventHubConsumerClient(
        consumerGroup,
        eh.FullyQualifiedNamespace,
        eh.EventHubName,
        credential,
        consumerOptions);

    long totalEventsRead = 0;
    long totalEventsCheckpointed = 0;
    
    var checkpointManager = new CheckpointManager(blobContainerClient, consumerGroup, eh.EventHubName);

    try
    {
        Console.WriteLine("\n---- Reading and checkpointing messages ----");

        // Get all partitions and their properties
        var hubProps = await consumer.GetEventHubPropertiesAsync();
        var partitionIds = hubProps.PartitionIds;

        // Fetch all checkpoints upfront (parallelized)
        var allCheckpoints = await checkpointManager.ReadAllPartitionCheckpointsAsync(partitionIds);

        // For each partition, read from checkpoint position (or earliest if no checkpoint exists) and checkpoint
        foreach (var partitionId in partitionIds)
        {
            try
            {
                var pp = await consumer.GetPartitionPropertiesAsync(partitionId);
                if (pp.IsEmpty)
                {
                    Console.WriteLine($"[partition {partitionId}] empty — skipping.");
                    continue;
                }

                // Get existing checkpoint from cache
                var existingCheckpoint = allCheckpoints.TryGetValue(partitionId, out var checkpoint) ? checkpoint : null;
                
                EventPosition startPosition = EventPosition.Earliest;
                var checkpointNote = string.Empty;

                if (existingCheckpoint?.SequenceNumber.HasValue ?? false)
                {
                    // Start from AFTER the last checkpointed sequence number
                    var lastSeq = existingCheckpoint.SequenceNumber.Value;
                    startPosition = EventPosition.FromSequenceNumber(lastSeq, isInclusive: false);
                    checkpointNote = $" (resuming from checkpoint at seq {lastSeq})";
                }
                else
                {
                    checkpointNote = " (no existing checkpoint; reading from earliest)";
                }

                long stopAtSeq = pp.LastEnqueuedSequenceNumber;
                var readOptions = new ReadEventOptions { MaximumWaitTime = TimeSpan.FromSeconds(peek.IdleSeconds) };

                // Check if checkpoint is already at the tail
                if (existingCheckpoint?.SequenceNumber >= stopAtSeq)
                {
                    Console.WriteLine($"[partition {partitionId}] already checkpointed at seq {existingCheckpoint.SequenceNumber} (current tail: {stopAtSeq}). Nothing to do.");
                    continue;
                }

                Console.WriteLine($"[partition {partitionId}] reading up to seq {stopAtSeq}{checkpointNote} ...");

                // A checkpoint is just the highest processed sequence number, so we read
                // through the backlog and persist a SINGLE checkpoint per partition at the end.
                // Writing a blob per message turns this into thousands of sequential round-trips.
                long lastReadSeq = -1;
                string? lastOffset = null;
                long partitionEventsRead = 0;
                bool reachedMaxEvents = false;

                await foreach (var partitionEvent in consumer.ReadEventsFromPartitionAsync(partitionId, startPosition, readOptions))
                {
                    // A null Data means the idle timeout elapsed with no further events —
                    // the partition is drained, so stop rather than waiting indefinitely.
                    if (partitionEvent.Data == null)
                        break;

                    totalEventsRead++;
                    partitionEventsRead++;
                    lastReadSeq = partitionEvent.Data.SequenceNumber;
                    lastOffset = partitionEvent.Data.OffsetString;

                    if (partitionEventsRead % 1000 == 0)
                    {
                        Console.WriteLine($"  [partition {partitionId}] read {partitionEventsRead} messages (seq {lastReadSeq})...");
                    }

                    // Stop once we've reached the tail captured at the start of this partition.
                    if (lastReadSeq >= stopAtSeq)
                        break;

                    if (totalEventsRead >= peek.MaxEvents)
                    {
                        reachedMaxEvents = true;
                        break;
                    }
                }

                // Persist one checkpoint at the highest sequence number processed.
                if (lastReadSeq >= 0)
                {
                    try
                    {
                        await checkpointManager.WritePartitionCheckpointAsync(
                            partitionId,
                            lastReadSeq,
                            lastOffset ?? string.Empty,
                            eh.FullyQualifiedNamespace);
                        totalEventsCheckpointed += partitionEventsRead;
                        Console.WriteLine($"[partition {partitionId}] checkpointed at seq {lastReadSeq} ({partitionEventsRead} messages).");
                    }
                    catch (Exception ex)
                    {
                        Console.Error.WriteLine($"❌ Error checkpointing partition {partitionId}: {ex.GetType().Name}: {ex.Message}");
                        return 3;
                    }
                }

                if (reachedMaxEvents || totalEventsRead >= peek.MaxEvents)
                {
                    break;
                }
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"❌ Error reading partition {partitionId}: {ex.GetType().Name}: {ex.Message}");
            }
        }
    }
    catch (Exception ex)
    {
        Console.Error.WriteLine($"\n❌ ERROR during clear processing:\n{ex.GetType().Name}: {ex.Message}");
        return 3;
    }
    finally
    {
        await consumer.CloseAsync();
    }

    Console.WriteLine("\n====================================================");
    Console.WriteLine($"Total events read        : {totalEventsRead}");
    Console.WriteLine($"Total events checkpointed: {totalEventsCheckpointed}");
    Console.WriteLine("Checkpoint status        : ✓ COMMITTED to blob storage");
    Console.WriteLine("Consumer group status    : checkpoint advanced (events remain in hub until retention expiry)");
    Console.WriteLine("====================================================");

    return 0;
}

static void PrintUsage()
{
    Console.WriteLine("""
        Event Hub Peek — read-only Event Hub inspector and checkpoint-advance tool.

        USAGE:
          ExperienceIq.EventHubPeek.exe [flags] [Section:Key=value ...]

        FLAGS:
          -q, --quiet, /q        Quiet mode: print partition summary only (no per-event
                                 dump), and overlay consumer-group checkpoint state so the
                                 'unprocessed' backlog is shown. Accepts a value form too,
                                 e.g. -q=false.
          -c, --clear, /c        Clear mode: read and checkpoint all messages to advance the
                                 consumer group's committed position. Does NOT delete events
                                 (they remain until retention expiry). Implies quiet mode.
                                 Requires EventHub:CheckpointStorageAccountName.
          -h, --help, /h, /?     Show this help and exit.

        CONFIG OVERRIDES (also settable in appsettings.json / env vars):
          Peek:Quiet                      (default true)   Summary-only output.
          Peek:ShowConsumerGroupState     (default true)   Overlay checkpoint backlog.
          Peek:Clear                      (default false)  Clear/checkpoint mode.
          Peek:IdleSeconds                (default 5)       Per-partition idle wait (seconds).
          Peek:MaxEvents                  (default 100000)  Cap on total events listed.
          Peek:BodyPreview                (default 1000)    Max inline body chars (non-quiet).
          Peek:ForceReadEmptyPartitions   (default true)    Confirm empties via forced read.
          Peek:OutputPath                 (default temp)    JSON metadata dump path.
          EventHub:FullyQualifiedNamespace                  e.g. ns.servicebus.windows.net
          EventHub:EventHubName                             Event Hub entity name.
          EventHub:ConsumerGroup          (default $Default)
          EventHub:CheckpointStorageAccountName             Required for -c and backlog overlay.
          EventHub:CheckpointContainerName (default exiq-checkpoints)

        EXAMPLES:
          ExperienceIq.EventHubPeek.exe
          ExperienceIq.EventHubPeek.exe -q
          ExperienceIq.EventHubPeek.exe -c
          ExperienceIq.EventHubPeek.exe Peek:IdleSeconds=10 Peek:OutputPath=C:\temp\events.json
          ExperienceIq.EventHubPeek.exe EventHub:ConsumerGroup=my-group

        EXIT CODES:
          0  success
          2  configuration missing or cannot connect/authorize
          3  checkpointing failed in clear mode
        """);
}

static string[] NormalizeCommandLine(string[] args)
{
    var normalized = new List<string>(args.Length);
    foreach (var arg in args)
    {
        if (string.Equals(arg, "-q", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(arg, "--quiet", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(arg, "/q", StringComparison.OrdinalIgnoreCase))
        {
            normalized.Add("Peek:Quiet=true");
            normalized.Add("Peek:ShowConsumerGroupState=true");
            continue;
        }

        if (arg.StartsWith("-q=", StringComparison.OrdinalIgnoreCase) ||
            arg.StartsWith("-q:", StringComparison.OrdinalIgnoreCase))
        {
            normalized.Add("Peek:Quiet=" + arg[3..]);
            continue;
        }

        if (arg.StartsWith("--quiet=", StringComparison.OrdinalIgnoreCase))
        {
            normalized.Add("Peek:Quiet=" + arg[8..]);
            continue;
        }

        if (arg.StartsWith("--quiet:", StringComparison.OrdinalIgnoreCase))
        {
            normalized.Add("Peek:Quiet=" + arg[8..]);
            continue;
        }

        if (string.Equals(arg, "-c", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(arg, "--clear", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(arg, "/c", StringComparison.OrdinalIgnoreCase))
        {
            normalized.Add("Peek:Clear=true");
            normalized.Add("Peek:Quiet=true");
            continue;
        }

        if (arg.StartsWith("-c=", StringComparison.OrdinalIgnoreCase) ||
            arg.StartsWith("-c:", StringComparison.OrdinalIgnoreCase))
        {
            normalized.Add("Peek:Clear=" + arg[3..]);
            normalized.Add("Peek:Quiet=true");
            continue;
        }

        if (arg.StartsWith("--clear=", StringComparison.OrdinalIgnoreCase))
        {
            normalized.Add("Peek:Clear=" + arg[8..]);
            normalized.Add("Peek:Quiet=true");
            continue;
        }

        if (arg.StartsWith("--clear:", StringComparison.OrdinalIgnoreCase))
        {
            normalized.Add("Peek:Clear=" + arg[8..]);
            normalized.Add("Peek:Quiet=true");
            continue;
        }

        normalized.Add(arg);
    }

    return [.. normalized];
}

static string? Stringify(object? value) => value switch
{
    null => null,
    byte[] bytes => Convert.ToBase64String(bytes),
    DateTimeOffset dto => dto.ToString("O"),
    DateTime dt => dt.ToString("O"),
    _ => value.ToString()
};

static string? SafeOffset(EventData data)
{
    // OffsetString is preferred (supports geo-DR string offsets); fall back to numeric.
    try
    {
        var prop = typeof(EventData).GetProperty("OffsetString");
        if (prop?.GetValue(data) is string s && !string.IsNullOrEmpty(s)) return s;
    }
    catch { /* ignore */ }
#pragma warning disable CS0618
    try { return data.Offset.ToString(); } catch { return null; }
#pragma warning restore CS0618
}
