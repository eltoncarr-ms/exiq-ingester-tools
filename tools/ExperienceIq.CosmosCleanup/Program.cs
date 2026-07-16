using System.Collections.Concurrent;
using System.Text.Json;
using Azure.Identity;
using ExperienceIq.CosmosCleanup;
using Microsoft.Azure.Cosmos;
using Microsoft.Extensions.Configuration;

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
                $"{containerOptions.Name}: starting {partitions.Count} server-side partition purges.");

            var failures = new ConcurrentBag<string>();
            var started = 0;
            var parallelOptions = new ParallelOptions
            {
                MaxDegreeOfParallelism = options.PartitionDeleteConcurrency,
                CancellationToken = cancellation.Token,
            };

            await Parallel.ForEachAsync(
                partitions,
                parallelOptions,
                async (partitionKey, cancellationToken) =>
                {
                    try
                    {
                        using var response =
                            await container.DeleteAllItemsByPartitionKeyStreamAsync(
                                partitionKey,
                                cancellationToken: cancellationToken);

                        if (!response.IsSuccessStatusCode)
                        {
                            using var reader = new StreamReader(response.Content);
                            var detail = await reader.ReadToEndAsync(cancellationToken);
                            failures.Add(
                                $"{partitionKey}: HTTP {(int)response.StatusCode} {detail}");
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
                        failures.Add($"{partitionKey}: {exception.Message}");
                    }
                });

            if (!failures.IsEmpty)
            {
                throw new InvalidOperationException(
                    $"{containerOptions.Name}: partition purge failures:{Environment.NewLine}" +
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
        Console.Error.WriteLine($"Cosmos cleanup failed: {exception.Message}");
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
    using var iterator = container.GetItemQueryIterator<JsonElement>(
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
                if (!row.TryGetProperty(property, out var value))
                {
                    throw new InvalidOperationException(
                        $"{options.Name}: query result is missing partition-key property '{property}'.");
                }

                AddPartitionKeyValue(builder, value);
                keyParts.Add(value.GetRawText());
            }

            if (uniqueKeys.Add(string.Join("|", keyParts)))
            {
                partitions.Add(builder.Build());
            }
        }
    }

    return partitions;
}

static async Task VerifyEmptyAsync(
    Container container,
    int verificationAttempts,
    int verificationDelaySeconds,
    CancellationToken cancellationToken)
{
    for (var attempt = 1; attempt <= verificationAttempts; attempt++)
    {
        using var iterator = container.GetItemQueryIterator<JsonElement>(
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

static void AddPartitionKeyValue(PartitionKeyBuilder builder, JsonElement value)
{
    switch (value.ValueKind)
    {
        case JsonValueKind.String:
            builder.Add(value.GetString()!);
            break;
        case JsonValueKind.Number:
            builder.Add(value.GetDouble());
            break;
        case JsonValueKind.True:
        case JsonValueKind.False:
            builder.Add(value.GetBoolean());
            break;
        case JsonValueKind.Null:
            builder.AddNullValue();
            break;
        default:
            throw new InvalidOperationException(
                $"Unsupported partition-key value: {value.GetRawText()}");
    }
}
