using System.Data;
using System.Diagnostics;
using System.Text;
using System.Text.Json;
using Azure.Identity;
using Azure.Messaging.EventHubs;
using Azure.Messaging.EventHubs.Producer;
using ExperienceIq.KustoToEventHub;
using Kusto.Data;
using Kusto.Data.Common;
using Kusto.Data.Net.Client;
using Microsoft.Azure.Cosmos;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

var configuration = new ConfigurationBuilder()
    .AddJsonFile("appsettings.json", optional: false)
    .AddEnvironmentVariables()
    .AddCommandLine(args, CommandLineSwitchMappings.All)
    .Build();

using var loggerFactory = LoggerFactory.Create(builder =>
    builder.AddConsole().SetMinimumLevel(
        Enum.TryParse<LogLevel>(configuration["Logging:LogLevel:Default"], out var level) ? level : LogLevel.Information));

var logger = loggerFactory.CreateLogger("KustoToEventHub");

// When -i/--input-file is supplied, the file is treated as the direct Kusto
// query output (CSV) and is sent to Event Hub as-is, skipping the live Cosmos
// watermark lookup and Kusto query.
var inputFile = configuration["InputFile"];
var useInputFile = !string.IsNullOrWhiteSpace(inputFile);

var ehOptions = configuration.GetSection(EventHubProducerOptions.SectionName).Get<EventHubProducerOptions>()
    ?? throw new InvalidOperationException("EventHub configuration section is missing.");

if (string.IsNullOrWhiteSpace(ehOptions.FullyQualifiedNamespace))
    throw new InvalidOperationException("EventHub:FullyQualifiedNamespace is required.");
if (string.IsNullOrWhiteSpace(ehOptions.EventHubName))
    throw new InvalidOperationException("EventHub:EventHubName is required.");

var credential = new DefaultAzureCredential();
var stopwatch = Stopwatch.StartNew();

// ── Step 1-3: Resolve the rows to send, either from a CSV input file or live. ─

IEnumerable<Dictionary<string, object?>> rows;
IDisposable? rowSource = null;

if (useInputFile)
{
    if (!File.Exists(inputFile))
        throw new FileNotFoundException($"Input file not found: {inputFile}", inputFile);

    logger.LogInformation(
        "Input file mode: reading rows from {InputFile} (skipping Cosmos watermark lookup and Kusto query).",
        inputFile);

    // The live Kusto path emits rows already ordered (| order by clientTime asc). A saved CSV export
    // carries no such guarantee (ADX exports are commonly newest-first), so sort by event time here
    // to mirror the live pipeline and keep Event Hub sequence numbers chronological.
    rows = ChronologicalRowOrder.ByEventTimeAscending(CsvRowReader.ReadRows(inputFile!));
}
else
{
    var kustoOptions = configuration.GetSection(KustoOptions.SectionName).Get<KustoOptions>()
        ?? throw new InvalidOperationException("Kusto configuration section is missing.");
    var cosmosOptions = configuration.GetSection(CosmosWatermarkOptions.SectionName).Get<CosmosWatermarkOptions>()
        ?? throw new InvalidOperationException("Cosmos configuration section is missing.");
    var filterBySessionId = !string.IsNullOrWhiteSpace(kustoOptions.SessionId);
    var filterByUserId = !filterBySessionId || CommandLineSwitchMappings.HasExplicitUserId(args);

    if (string.IsNullOrWhiteSpace(kustoOptions.ClusterUri))
        throw new InvalidOperationException("Kusto:ClusterUri is required.");
    if (string.IsNullOrWhiteSpace(kustoOptions.Database))
        throw new InvalidOperationException("Kusto:Database is required.");
    if (filterByUserId && cosmosOptions.ObjectIds.Count == 0)
        throw new InvalidOperationException("Cosmos:ObjectIds must contain at least one oid.");

    var reader = await ResolveKustoRowsAsync(kustoOptions, cosmosOptions, filterByUserId, credential, logger, stopwatch);
    rowSource = reader;
    rows = ReadKustoRows(reader);
}

// ── Step 4: Batch-send rows to Event Hub ─────────────────────────────────────

logger.LogInformation("Streaming rows to Event Hub {Namespace}/{Hub} (partition key field: '{Field}').",
    ehOptions.FullyQualifiedNamespace, ehOptions.EventHubName, ehOptions.PartitionKeyField);

await using var producer = new EventHubProducerClient(
    ehOptions.FullyQualifiedNamespace,
    ehOptions.EventHubName,
    credential);

var counters = new SendCounters();
long rowsFetched = 0;
var distinctKeys = new HashSet<string>(StringComparer.Ordinal);

// One open batch per distinct partition-key value. Events sharing a key are added to
// that key's batch and sent together, so the Event Hubs service routes them all to the
// same partition. Sends for a key are sequential (fill -> send -> new batch), preserving
// per-key ordering. This is a finite one-shot tool, so the number of open batches is
// bounded by the distinct keys in the input (e.g. one per session).
var batchesByKey = new Dictionary<string, EventDataBatch>(StringComparer.Ordinal);

// Marker dictionary key for unkeyed events (only used when AllowUnkeyedEvents is true).
// Not a valid Event Hub partition key.
const string unkeyedMarker = "\u0000__unkeyed__";

try
{
    foreach (var row in rows)
    {
        rowsFetched++;

        var partitionKey = ResolvePartitionKey(row, ehOptions.PartitionKeyField);

        if (string.IsNullOrWhiteSpace(partitionKey) && !ehOptions.AllowUnkeyedEvents)
        {
            counters.Skipped++;
            logger.LogWarning(
                "Row {Row} has no '{Field}' value; skipped to avoid scattering it across partitions. "
                + "Set EventHub:AllowUnkeyedEvents=true to send such rows unkeyed.",
                rowsFetched, ehOptions.PartitionKeyField);
            continue;
        }

        var json = JsonSerializer.Serialize(row);
        var eventData = new EventData(Encoding.UTF8.GetBytes(json));

        var dictKey = partitionKey ?? unkeyedMarker;
        distinctKeys.Add(dictKey);

        if (!batchesByKey.TryGetValue(dictKey, out var batch))
        {
            batch = await CreateBatchForKeyAsync(producer, partitionKey);
            batchesByKey[dictKey] = batch;
        }

        if (!batch.TryAdd(eventData))
        {
            // Current batch is full: send it, then start a fresh batch for the same key.
            await SendBatchAsync(producer, batch, counters, logger);
            batch.Dispose();

            batch = await CreateBatchForKeyAsync(producer, partitionKey);
            batchesByKey[dictKey] = batch;

            if (!batch.TryAdd(eventData))
            {
                counters.Skipped++;
                logger.LogWarning("Row {Row} exceeds max Event Hub batch size and was skipped.", rowsFetched);
            }
        }
    }

    // Flush any remaining non-empty batches.
    foreach (var batch in batchesByKey.Values)
    {
        if (batch.Count > 0)
            await SendBatchAsync(producer, batch, counters, logger);
    }
}
finally
{
    foreach (var batch in batchesByKey.Values)
        batch.Dispose();
}

rowSource?.Dispose();
stopwatch.Stop();

logger.LogInformation(
    "Done. Rows read: {Rows}, batches sent: {Batches}, batches failed: {Failed}, rows skipped: {Skipped}, "
    + "distinct partition keys: {Keys}, elapsed: {Elapsed:F1}s.",
    rowsFetched, counters.Sent, counters.Failed, counters.Skipped, distinctKeys.Count, stopwatch.Elapsed.TotalSeconds);

if (rowsFetched == 0)
    logger.LogInformation("No rows to send — nothing was sent to Event Hub.");

return counters.Failed > 0 || counters.Skipped > 0 ? 1 : 0;

// ── Helpers ───────────────────────────────────────────────────────────────────

// Resolve the partition key value from a row by field name (case-insensitive).
static string? ResolvePartitionKey(Dictionary<string, object?> row, string field)
{
    if (row.TryGetValue(field, out var value) && value is not null)
    {
        var s = value.ToString();
        if (!string.IsNullOrWhiteSpace(s)) return s;
    }

    foreach (var kvp in row)
    {
        if (string.Equals(kvp.Key, field, StringComparison.OrdinalIgnoreCase) && kvp.Value is not null)
        {
            var s = kvp.Value.ToString();
            if (!string.IsNullOrWhiteSpace(s)) return s;
        }
    }

    return null;
}

// Create a batch bound to the given partition key (or unkeyed when key is null/empty).
static async Task<EventDataBatch> CreateBatchForKeyAsync(EventHubProducerClient producer, string? partitionKey)
    => string.IsNullOrWhiteSpace(partitionKey)
        ? await producer.CreateBatchAsync()
        : await producer.CreateBatchAsync(new CreateBatchOptions { PartitionKey = partitionKey });

// Resolve per-oid watermarks from Cosmos, build the KQL query and execute it.
static async Task<IDataReader> ResolveKustoRowsAsync(
    KustoOptions kustoOptions,
    CosmosWatermarkOptions cosmosOptions,
    bool filterByUserId,
    DefaultAzureCredential credential,
    ILogger logger,
    Stopwatch stopwatch)
{
    // ── Step 1: Resolve per-oid watermarks from Cosmos ───────────────────────
    var watermarks = new Dictionary<string, DateTimeOffset?>(StringComparer.OrdinalIgnoreCase);
    if (filterByUserId)
    {
        foreach (var oid in cosmosOptions.ObjectIds)
            watermarks[oid] = null;
    }

    if (!string.IsNullOrWhiteSpace(kustoOptions.SessionId))
    {
        logger.LogInformation(
            "SessionId filter supplied; skipping Cosmos watermark lookup and query-window filtering.");
    }
    else
    {
        if (string.IsNullOrWhiteSpace(cosmosOptions.AccountEndpoint))
            throw new InvalidOperationException("Cosmos:AccountEndpoint is required.");
        if (string.IsNullOrWhiteSpace(cosmosOptions.DatabaseName))
            throw new InvalidOperationException("Cosmos:DatabaseName is required.");

        logger.LogInformation("Querying Cosmos {Endpoint} for latest clientTime per oid ({Count} oids).",
            cosmosOptions.AccountEndpoint, cosmosOptions.ObjectIds.Count);

        using var cosmosClient = new CosmosClient(cosmosOptions.AccountEndpoint, credential,
            new CosmosClientOptions { ConnectionMode = ConnectionMode.Direct });

        var container = cosmosClient.GetContainer(cosmosOptions.DatabaseName, cosmosOptions.ContainerName);

        // One query per oid — cheap point-reads, each scoped to its userId partition.
        foreach (var oid in cosmosOptions.ObjectIds)
        {
            try
            {
                var queryDef = new QueryDefinition(
                    "SELECT VALUE MAX(c.clientTime) FROM c WHERE c.userId = @oid")
                    .WithParameter("@oid", oid);

                using var feed = container.GetItemQueryIterator<string>(
                    queryDef,
                    requestOptions: new QueryRequestOptions { PartitionKey = new PartitionKey(oid) });

                while (feed.HasMoreResults)
                {
                    var page = await feed.ReadNextAsync();
                    foreach (var value in page)
                    {
                        if (!string.IsNullOrEmpty(value) && DateTimeOffset.TryParse(value, out var ts))
                            watermarks[oid] = ts;
                    }
                }

                logger.LogInformation("oid={Oid}: Cosmos watermark = {Watermark}.",
                    oid, watermarks[oid]?.ToString("O") ?? "(none — using default lookback)");
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "oid={Oid}: Cosmos watermark query failed; using default lookback.", oid);
            }
        }
    }

    // ── Step 2: Build KQL query ──────────────────────────────────────────────
    var kql = KustoQueryBuilder.BuildClientTelemetryQuery(
        watermarks,
        kustoOptions.DefaultLookbackWindow,
        kustoOptions.SessionId);

    logger.LogInformation("Executing KQL query against {ClusterUri}/{Database}:\n{Query}",
        kustoOptions.ClusterUri, kustoOptions.Database, kql);

    // ── Step 3: Run Kusto query ──────────────────────────────────────────────
    var kustoConnectionString = new KustoConnectionStringBuilder(kustoOptions.ClusterUri, kustoOptions.Database)
        .WithAadAzureTokenCredentialsAuthentication(credential);

    var kustoClient = KustoClientFactory.CreateCslQueryProvider(kustoConnectionString);

    var requestProperties = new ClientRequestProperties { ClientRequestId = kustoOptions.ClientRequestId };

    var reader = await Task.Run(() =>
        kustoClient.ExecuteQuery(kustoOptions.Database, kql, requestProperties));

    logger.LogInformation("Kusto query complete in {Elapsed:F1}s.", stopwatch.Elapsed.TotalSeconds);
    return reader;
}

// Project a Kusto IDataReader into per-row dictionaries keyed by column name.
static IEnumerable<Dictionary<string, object?>> ReadKustoRows(IDataReader reader)
{
    var columns = Enumerable.Range(0, reader.FieldCount)
        .Select(reader.GetName)
        .ToArray();

    while (reader.Read())
    {
        var row = new Dictionary<string, object?>(columns.Length);
        for (int i = 0; i < columns.Length; i++)
        {
            var value = reader.IsDBNull(i) ? null : reader.GetValue(i);
            row[columns[i]] = value switch
            {
                DateTime dt        => dt.ToString("O"),
                DateTimeOffset dto => dto.ToString("O"),
                TimeSpan ts        => ts.ToString("c"),
                Guid g             => g.ToString(),
                _                  => value
            };
        }

        yield return row;
    }
}

static async Task SendBatchAsync(
    EventHubProducerClient producer,
    EventDataBatch batch,
    SendCounters counters,
    ILogger logger)
{
    try
    {
        await producer.SendAsync(batch);
        counters.Sent++;
        logger.LogDebug("Sent batch {Batch} ({Count} events).", counters.Sent, batch.Count);
    }
    catch (Exception ex)
    {
        counters.Failed++;
        logger.LogError(ex, "Failed to send batch ({Count} events).", batch.Count);
    }
}

internal sealed class SendCounters
{
    public int Sent { get; set; }
    public int Failed { get; set; }
    public int Skipped { get; set; }
}
