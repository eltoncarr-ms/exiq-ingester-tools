using System.Collections.Concurrent;
using Azure.Identity;
using ExperienceIq.CosmosCleanup;
using Microsoft.Azure.Cosmos;
using Microsoft.Extensions.Configuration;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

return await RunAsync(args);

static async Task<int> RunAsync(string[] args)
{
    using var cancellation = new CancellationTokenSource();
    Console.CancelKeyPress += (_, eventArgs) =>
    {
        eventArgs.Cancel = true;
        cancellation.Cancel();
    };

    try
    {
        var configuration = new ConfigurationBuilder()
            .SetBasePath(AppContext.BaseDirectory)
            .AddJsonFile("appsettings.json", optional: false)
            .AddJsonFile("appsettings.local.json", optional: true)
            .AddEnvironmentVariables()
            .AddCommandLine(args)
            .Build();

        var options = configuration
            .GetSection(CosmosCleanupOptions.SectionName)
            .Get<CosmosCleanupOptions>()
            ?? throw new InvalidOperationException(
                $"{CosmosCleanupOptions.SectionName} configuration is missing.");

        options.Validate();

        Console.WriteLine("================ Cosmos Cleanup ================");
        Console.WriteLine($"Endpoint         : {options.AccountEndpoint}");
        Console.WriteLine($"Database         : {options.DatabaseName}");
        Console.WriteLine($"Containers       : {string.Join(", ", options.Containers.Select(c => c.Name))}");
        Console.WriteLine($"Delete concurrency: {options.PartitionDeleteConcurrency}");
        Console.WriteLine(
            $"Delete retries    : {options.PartitionDeleteRetryAttempts} " +
            $"every {options.PartitionDeleteRetryDelaySeconds}s");
        Console.WriteLine($"Timestamp (UTC)  : {DateTimeOffset.UtcNow:O}");
        Console.WriteLine("================================================");

        var credential = new ChainedTokenCredential(
            new AzureCliCredential(),
            new VisualStudioCredential());

        using var client = new CosmosClient(
            options.AccountEndpoint,
            credential,
            new CosmosClientOptions
            {
                ApplicationName = "ExperienceIq.CosmosCleanup",
                ConnectionMode = ConnectionMode.Direct,
            });

        foreach (var containerOptions in options.Containers)
        {
            cancellation.Token.ThrowIfCancellationRequested();

            var container = client.GetContainer(options.DatabaseName, containerOptions.Name);
            var partitions = await ReadDistinctPartitionKeysAsync(
                container,
                containerOptions,
                cancellation.Token);

            if (partitions.Count == 0)
            {
                Console.WriteLine($"{containerOptions.Name}: already empty.");
                continue;
            }

            Console.WriteLine(
                $"{containerOptions.Name}: validating server-side partition purge support.");

            var purgeLimitNoticeWritten = 0;
            Action reportPurgeLimit = () =>
            {
                if (Interlocked.Exchange(ref purgeLimitNoticeWritten, 1) == 0)
                {
                    Console.WriteLine(
                        $"{containerOptions.Name}: Cosmos active purge limit reached; " +
                        $"retrying every {options.PartitionDeleteRetryDelaySeconds}s.");
                }
            };

            var firstFailure = await StartPartitionPurgeWithRetryAsync(
                container,
                partitions[0],
                options.PartitionDeleteRetryAttempts,
                options.PartitionDeleteRetryDelaySeconds,
                reportPurgeLimit,
                cancellation.Token);

            if (firstFailure is not null)
            {
                if (firstFailure.Contains(
                    "Partition key delete feature is disabled",
                    StringComparison.OrdinalIgnoreCase))
                {
                    throw new InvalidOperationException(
                        $"{containerOptions.Name}: server-side partition deletion is disabled for " +
                        "this Cosmos DB account. Contact Azure Support to enable the " +
                        "DeleteAllItemsByPartitionKey capability: https://azure.microsoft.com/support");
                }

                throw new InvalidOperationException(
                    $"{containerOptions.Name}: partition purge validation failed:{Environment.NewLine}" +
                    firstFailure);
            }

            Console.WriteLine(
                $"{containerOptions.Name}: starting {partitions.Count} server-side partition purges.");

            var failures = new ConcurrentBag<string>();
            var started = 1;
            var parallelOptions = new ParallelOptions
            {
                MaxDegreeOfParallelism = options.PartitionDeleteConcurrency,
                CancellationToken = cancellation.Token,
            };

            await Parallel.ForEachAsync(
                partitions.Skip(1),
                parallelOptions,
                async (partitionKey, cancellationToken) =>
                {
                    try
                    {
                        var failure = await StartPartitionPurgeWithRetryAsync(
                            container,
                            partitionKey,
                            options.PartitionDeleteRetryAttempts,
                            options.PartitionDeleteRetryDelaySeconds,
                            reportPurgeLimit,
                            cancellationToken);
                        if (failure is not null)
                        {
                            failures.Add(failure);
                            return;
                        }

                        var current = Interlocked.Increment(ref started);
                        if (current == partitions.Count || current % 100 == 0)
                        {
                            Console.WriteLine(
                                $"{containerOptions.Name}: {current}/{partitions.Count} purges started.");
                        }
                    }
                    catch (Exception exception) when (exception is not OperationCanceledException)
                    {
                        failures.Add($"{partitionKey}: {exception}");
                    }
                });

            if (!failures.IsEmpty)
            {
                throw new InvalidOperationException(
                    $"{containerOptions.Name}: {failures.Count} partition purge failures. " +
                    $"First {Math.Min(failures.Count, 20)}:{Environment.NewLine}" +
                    string.Join(Environment.NewLine, failures.Take(20)));
            }

            await VerifyEmptyAsync(
                container,
                options.VerificationAttempts,
                options.VerificationDelaySeconds,
                cancellation.Token);

            Console.WriteLine($"{containerOptions.Name}: empty.");
        }

        Console.WriteLine("Cosmos cleanup complete.");
        return 0;
    }
    catch (OperationCanceledException)
    {
        Console.Error.WriteLine("Cosmos cleanup canceled.");
        return 1;
    }
    catch (Exception exception)
    {
        Console.Error.WriteLine($"Cosmos cleanup failed:{Environment.NewLine}{exception}");
        return 2;
    }
}

static async Task<IReadOnlyList<PartitionKey>> ReadDistinctPartitionKeysAsync(
    Container container,
    ContainerCleanupOptions options,
    CancellationToken cancellationToken)
{
    var projection = string.Join(
        ", ",
        options.PartitionKeyPaths.Select(path => $"c.{PartitionKeyPath.Normalize(path)}"));

    var query = new QueryDefinition($"SELECT DISTINCT {projection} FROM c");
    using var iterator = container.GetItemQueryIterator<JObject>(
        query,
        requestOptions: new QueryRequestOptions { MaxItemCount = 1000 });

    var partitions = new List<PartitionKey>();
    var uniqueKeys = new HashSet<string>(StringComparer.Ordinal);

    while (iterator.HasMoreResults)
    {
        var page = await iterator.ReadNextAsync(cancellationToken);
        foreach (var row in page)
        {
            var builder = new PartitionKeyBuilder();
            var keyParts = new List<string>();

            foreach (var path in options.PartitionKeyPaths)
            {
                var property = PartitionKeyPath.Normalize(path);
                var value = row[property];
                if (value is null)
                {
                    throw new InvalidOperationException(
                        $"{options.Name}: query result is missing partition-key property '{property}'.");
                }

                AddPartitionKeyValue(builder, value);
                keyParts.Add(value.ToString(Formatting.None));
            }

            if (uniqueKeys.Add(string.Join("|", keyParts)))
            {
                partitions.Add(builder.Build());
            }
        }
    }

    return partitions;
}

static async Task<string?> StartPartitionPurgeWithRetryAsync(
    Container container,
    PartitionKey partitionKey,
    int retryAttempts,
    int retryDelaySeconds,
    Action reportPurgeLimit,
    CancellationToken cancellationToken)
{
    for (var attempt = 1; attempt <= retryAttempts; attempt++)
    {
        var result = await TryStartPartitionPurgeAsync(
            container,
            partitionKey,
            cancellationToken);

        if (result.Failure is null)
        {
            return null;
        }

        if (!result.ActivePurgeLimitReached || attempt == retryAttempts)
        {
            return attempt == retryAttempts && result.ActivePurgeLimitReached
                ? $"{result.Failure} Retry limit reached after {retryAttempts} attempts."
                : result.Failure;
        }

        reportPurgeLimit();
        await Task.Delay(TimeSpan.FromSeconds(retryDelaySeconds), cancellationToken);
    }

    throw new InvalidOperationException("Partition purge retry loop completed unexpectedly.");
}

static async Task<(string? Failure, bool ActivePurgeLimitReached)> TryStartPartitionPurgeAsync(
    Container container,
    PartitionKey partitionKey,
    CancellationToken cancellationToken)
{
    using var response = await container.DeleteAllItemsByPartitionKeyStreamAsync(
        partitionKey,
        cancellationToken: cancellationToken);

    if (response.IsSuccessStatusCode)
    {
        return (null, false);
    }

    var detail = response.ErrorMessage;
    if (string.IsNullOrWhiteSpace(detail) && response.Content is not null)
    {
        using var reader = new StreamReader(response.Content);
        detail = await reader.ReadToEndAsync(cancellationToken);
    }

    if (string.IsNullOrWhiteSpace(detail))
    {
        detail = response.Diagnostics.ToString();
    }

    var failure = $"{partitionKey}: HTTP {(int)response.StatusCode} {response.StatusCode}; " +
        $"ActivityId={response.Headers.ActivityId}; {detail}";
    var activePurgeLimitReached = detail.Contains(
        "Reached maximum limit for number of Partition Key deletes",
        StringComparison.OrdinalIgnoreCase);

    return (failure, activePurgeLimitReached);
}

static async Task VerifyEmptyAsync(
    Container container,
    int verificationAttempts,
    int verificationDelaySeconds,
    CancellationToken cancellationToken)
{
    for (var attempt = 1; attempt <= verificationAttempts; attempt++)
    {
        using var iterator = container.GetItemQueryIterator<JToken>(
            "SELECT TOP 1 VALUE c.id FROM c",
            requestOptions: new QueryRequestOptions { MaxItemCount = 1 });

        var page = await iterator.ReadNextAsync(cancellationToken);
        if (page.Count == 0)
        {
            return;
        }

        if (attempt < verificationAttempts)
        {
            await Task.Delay(
                TimeSpan.FromSeconds(verificationDelaySeconds),
                cancellationToken);
        }
    }

    throw new InvalidOperationException(
        $"Verification failed: container '{container.Id}' still returns documents.");
}

static void AddPartitionKeyValue(PartitionKeyBuilder builder, JToken value)
{
    switch (value.Type)
    {
        case JTokenType.String:
            builder.Add(value.Value<string>()!);
            break;
        case JTokenType.Integer:
        case JTokenType.Float:
            builder.Add(value.Value<double>());
            break;
        case JTokenType.Boolean:
            builder.Add(value.Value<bool>());
            break;
        case JTokenType.Null:
            builder.AddNullValue();
            break;
        default:
            throw new InvalidOperationException(
                $"Unsupported partition-key value: {value.ToString(Formatting.None)}");
    }
}
